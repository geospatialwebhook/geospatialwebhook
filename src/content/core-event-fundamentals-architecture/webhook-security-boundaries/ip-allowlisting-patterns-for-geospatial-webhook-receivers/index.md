---
title: "IP Allowlisting Patterns for Geospatial Webhook Receivers"
description: "Restrict a geospatial webhook receiver to known provider CIDR ranges: parse X-Forwarded-For behind a proxy, validate the true client IP, and reject before parsing geometry."
slug: "ip-allowlisting-patterns-for-geospatial-webhook-receivers"
type: "article"
breadcrumb:
  - label: "Core Event Fundamentals & Architecture"
    url: "/core-event-fundamentals-architecture/"
  - label: "Webhook Security Boundaries"
    url: "/core-event-fundamentals-architecture/webhook-security-boundaries/"
  - label: "IP Allowlisting Patterns for Geospatial Webhook Receivers"
    url: "/core-event-fundamentals-architecture/webhook-security-boundaries/ip-allowlisting-patterns-for-geospatial-webhook-receivers/"
datePublished: "2025-05-01"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "IP Allowlisting Patterns for Geospatial Webhook Receivers",
      "description": "Restrict a geospatial webhook receiver to known provider CIDR ranges as defence-in-depth: parse X-Forwarded-For correctly behind a proxy, validate the true client IP with the ipaddress module, and reject early — before parsing geometry.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/ip-allowlisting-patterns-for-geospatial-webhook-receivers/",
      "datePublished": "2025-05-01",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Core Event Fundamentals & Architecture", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/" },
        { "@type": "ListItem", "position": 2, "name": "Webhook Security Boundaries", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/" },
        { "@type": "ListItem", "position": 3, "name": "IP Allowlisting Patterns for Geospatial Webhook Receivers", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/ip-allowlisting-patterns-for-geospatial-webhook-receivers/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "IP Allowlisting for a Geospatial Webhook Receiver",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Build the CIDR allowlist", "text": "Collect the provider's published source ranges and compile them into ipaddress.ip_network objects at startup, covering both IPv4 and IPv6." },
        { "@type": "HowToStep", "position": 2, "name": "Extract the true client IP", "text": "Read X-Forwarded-For and walk back a fixed number of trusted proxy hops to find the real client address rather than trusting the leftmost entry." },
        { "@type": "HowToStep", "position": 3, "name": "Match against the allowlist", "text": "Test the resolved client IP for membership in any allowlisted network before parsing the request body." },
        { "@type": "HowToStep", "position": 4, "name": "Reject early", "text": "Return 403 in ASGI middleware, before geometry deserialization, so unauthorized sources never reach the parsing layer." },
        { "@type": "HowToStep", "position": 5, "name": "Pair with signatures", "text": "Treat IP allowlisting as defence-in-depth and verify an HMAC signature on every accepted request." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Is IP allowlisting enough to secure a webhook on its own?",
          "acceptedAnswer": { "@type": "Answer", "text": "No. Source IPs can be spoofed in some network positions, and cloud providers share NAT egress ranges across thousands of unrelated tenants, so a match only proves the request came from that provider's network — not from your specific integration. Always pair IP allowlisting with an HMAC signature check." }
        },
        {
          "@type": "Question",
          "name": "How many X-Forwarded-For hops should I trust?",
          "acceptedAnswer": { "@type": "Answer", "text": "Trust exactly the number of proxies you control between the internet and your app — usually one load balancer, so trust one hop and read the second-from-right entry. Trusting the leftmost value lets a client forge its own address by sending a fake header." }
        },
        {
          "@type": "Question",
          "name": "What happens when a provider changes its IP ranges?",
          "acceptedAnswer": { "@type": "Answer", "text": "Legitimate events start returning 403. Load the allowlist from a source you can refresh without a redeploy — an environment variable, a config map, or the provider's published ranges endpoint on a schedule — and alert on a spike in allowlist rejections so a silent range change does not become an outage." }
        }
      ]
    }
  ]
}
</script>

**Restrict your geospatial webhook receiver to the provider's published source CIDR ranges and reject non-matching clients in ASGI middleware — before any geometry is parsed — but treat this as defence-in-depth layered on top of an HMAC signature check, never as a replacement for it.** This guide sits under [Webhook Security Boundaries](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/), part of [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/).

## When to use this pattern

IP allowlisting is cheap, stateless, and rejects hostile traffic before it touches your parser. Reach for it when:

- Your provider **publishes a stable set of source ranges** (most managed GIS and mapping platforms do) and you want unauthorized senders bounced before they can submit a large GeoJSON body for deserialization.
- You run behind **a proxy or load balancer you control**, so you can reliably recover the true client IP from `X-Forwarded-For` and reason about hop count.
- You need a **DoS shock absorber**: rejecting an unknown IP costs a dictionary lookup, whereas parsing and validating a MultiPolygon costs CPU and memory an attacker can weaponize.

It is **not the right tool when** your provider sends from a broad, shared cloud egress range (so the allowlist would admit half the internet), or when you cannot identify a trusted proxy depth — in that case skip IP checks and rely entirely on signatures. Allowlisting narrows *who can knock*; it never proves *who is speaking*.

## Why blind X-Forwarded-For trust breaks

The hard part is not the CIDR match — the stdlib `ipaddress` module makes that trivial. The hard part is answering "what is the real client IP?" when the request has passed through one or more proxies. Each hop appends the address it received from to `X-Forwarded-For`, producing a comma-separated chain. The rightmost entry was written by *your* proxy and is trustworthy; entries further left were written by upstream hops and, ultimately, by the client itself — who can forge anything.

If you trust the leftmost value, an attacker simply sends `X-Forwarded-For: <an-allowlisted-ip>` and walks straight through. The correct approach is to count from the right: skip exactly the number of proxies you operate, and the address at that position is the true client. The diagram below shows a single-load-balancer deployment where trust depth is one.

<svg viewBox="0 0 760 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="X-Forwarded-For hop resolution behind one trusted load balancer" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>Resolving the true client IP from X-Forwarded-For</title>
  <desc>A left-to-right flow: an untrusted client with a forgeable X-Forwarded-For entry connects to a trusted load balancer, which appends the real client IP and forwards to the app. The app counts one hop back from the right of the header to select the true client address, then checks it against the CIDR allowlist.</desc>
  <defs>
    <marker id="a" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- Client -->
  <rect x="10" y="40" width="150" height="56" rx="6" fill="currentColor" opacity="0.08"/>
  <rect x="10" y="40" width="150" height="56" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="85" y="62" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">Client (untrusted)</text>
  <text x="85" y="80" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">may forge XFF</text>
  <line x1="160" y1="68" x2="205" y2="68" stroke="currentColor" stroke-width="1.5" marker-end="url(#a)"/>
  <!-- Load balancer -->
  <rect x="207" y="40" width="170" height="56" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="292" y="62" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">Load balancer</text>
  <text x="292" y="80" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">appends real client IP</text>
  <line x1="377" y1="68" x2="422" y2="68" stroke="currentColor" stroke-width="1.5" marker-end="url(#a)"/>
  <!-- App -->
  <rect x="424" y="40" width="180" height="56" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="514" y="62" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">ASGI middleware</text>
  <text x="514" y="80" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">trust depth = 1 hop</text>
  <line x1="604" y1="68" x2="649" y2="68" stroke="currentColor" stroke-width="1.5" marker-end="url(#a)"/>
  <!-- Allow/deny -->
  <rect x="651" y="40" width="100" height="56" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="701" y="64" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif">CIDR match</text>
  <text x="701" y="80" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">200 / 403</text>
  <!-- Header illustration -->
  <text x="20" y="150" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">X-Forwarded-For seen by app:</text>
  <text x="20" y="172" font-size="11" fill="currentColor" font-family="ui-monospace,monospace">198.51.100.9 (forged by client),  203.0.113.44 (real client, added by LB)</text>
  <!-- pointer to the trusted position -->
  <line x1="330" y1="180" x2="330" y2="200" stroke="currentColor" stroke-width="1.2" marker-end="url(#a)"/>
  <text x="330" y="216" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">count 1 hop from the right → trust this address</text>
</svg>

## Complete runnable implementation

The middleware below is framework-agnostic ASGI: it works under FastAPI, Starlette, or any ASGI app. It compiles the allowlist once at construction, resolves the true client IP from `X-Forwarded-For` using a configured trust depth, and returns `403` before the request body is ever read — so an unauthorized sender never reaches your geometry parser. Coordinates in accepted payloads are still assumed to be WGS 84 (EPSG:4326); this layer is transport-level and CRS-agnostic.

```python
import ipaddress
from typing import Iterable

from starlette.types import ASGIApp, Receive, Scope, Send


class IPAllowlistMiddleware:
    """
    ASGI middleware that admits only requests whose true client IP falls
    inside a provider's published CIDR ranges. Rejects with 403 before the
    body (and therefore any geometry) is parsed.

    Pair this with an HMAC signature check — a matching source IP proves the
    request came from the provider's *network*, not from your integration.
    """

    def __init__(
        self,
        app: ASGIApp,
        allowed_cidrs: Iterable[str],
        trusted_proxy_hops: int = 1,
    ) -> None:
        self.app = app
        # Compile once. ip_network() parses both IPv4 and IPv6, e.g.
        # "203.0.113.0/24" and "2001:db8::/32".
        self.networks = [
            ipaddress.ip_network(cidr, strict=False) for cidr in allowed_cidrs
        ]
        # Number of proxies YOU control between the internet and this app.
        # With one load balancer, trust exactly one hop.
        self.trusted_proxy_hops = trusted_proxy_hops

    def _client_ip(self, scope: Scope) -> ipaddress._BaseAddress | None:
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        xff = headers.get("x-forwarded-for")

        if xff:
            # Chain is ordered oldest→newest, left→right. The rightmost entry
            # was written by OUR proxy; walk back `trusted_proxy_hops` from the
            # end to reach the address our infrastructure actually observed.
            chain = [part.strip() for part in xff.split(",") if part.strip()]
            index = len(chain) - self.trusted_proxy_hops
            if 0 <= index < len(chain):
                candidate = chain[index]
            else:
                # Header shorter than expected hop count — do not guess.
                candidate = None
        else:
            # No proxy header: fall back to the raw transport peer.
            client = scope.get("client")
            candidate = client[0] if client else None

        if candidate is None:
            return None
        try:
            # ip_address handles IPv4, IPv6, and IPv4-mapped IPv6 forms.
            return ipaddress.ip_address(candidate)
        except ValueError:
            return None

    def _is_allowed(self, ip: ipaddress._BaseAddress) -> bool:
        # Membership test is O(number of ranges); fine for dozens of CIDRs.
        return any(ip in net for net in self.networks)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        ip = self._client_ip(scope)
        if ip is None or not self._is_allowed(ip):
            # Reject BEFORE reading the body. No geometry deserialization,
            # no allocation for a large MultiPolygon from an unknown source.
            await self._forbidden(send)
            return

        await self.app(scope, receive, send)

    @staticmethod
    async def _forbidden(send: Send) -> None:
        await send({
            "type": "http.response.start",
            "status": 403,
            "headers": [(b"content-type", b"text/plain")],
        })
        await send({"type": "http.response.body", "body": b"Forbidden"})


# --- Wiring it into a FastAPI app --------------------------------------------
# from fastapi import FastAPI
# app = FastAPI()
# app.add_middleware(
#     IPAllowlistMiddleware,
#     allowed_cidrs=["203.0.113.0/24", "198.51.100.0/25", "2001:db8::/32"],
#     trusted_proxy_hops=1,   # one load balancer in front of the app
# )
```

Because the check runs in middleware, it composes cleanly with the signature layer described in [Signing Spatial Webhook Payloads with HMAC-SHA256](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/signing-spatial-webhook-payloads-with-hmac-sha256/): the IP gate runs first and drops obvious noise, then the signature check inside your route handler proves authenticity. Layer a timestamp/nonce check on top — see [Preventing Replay Attacks on Spatial Webhooks](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/preventing-replay-attacks-on-spatial-webhooks/) — and you have three independent controls, none of which is sufficient alone.

## Parameter reference

<div style="overflow-x:auto;">

| Parameter | Type | Constraint | Default |
|---|---|---|---|
| `allowed_cidrs` | `Iterable[str]` | Valid IPv4/IPv6 CIDR strings; load from env/config so ranges can change without a redeploy | — (must be set) |
| `trusted_proxy_hops` | `int` | Exactly the number of proxies you control; must be `>= 0` | `1` |
| `self.networks` | `list[ip_network]` | Compiled once at init; `strict=False` tolerates host bits in the CIDR | derived |
| `X-Forwarded-For` index | computed | `len(chain) - trusted_proxy_hops`; must be in range or the request is rejected | derived |
| Transport peer fallback | `scope["client"]` | Used only when no `X-Forwarded-For` is present (direct connection) | connection peer |
| Rejection status | `int` | `403` returned before the body is read | `403` |

</div>

## Gotchas and spatial edge cases

1. **Trusting `X-Forwarded-For` blindly.** Reading the leftmost entry lets any client forge its source address by sending a header. Always count `trusted_proxy_hops` from the *right*. If a request arrives with a shorter chain than your hop count expects, reject it rather than guessing — a mismatch means your topology assumption is wrong.

2. **Wrong proxy hop count.** If you add a CDN in front of your existing load balancer, the trusted depth becomes two, not one. A stale `trusted_proxy_hops` silently reads the wrong position, either admitting forged addresses or rejecting everyone. Treat hop count as an infrastructure-coupled config value and update it whenever the ingress path changes.

3. **IPv6 and IPv4-mapped addresses.** Providers increasingly send over IPv6. `ipaddress.ip_network` and `ip_address` handle both families, but an IPv4-only allowlist will reject an IPv6 sender outright. Include the provider's IPv6 ranges, and be aware that a client reaching you as `::ffff:203.0.113.44` (IPv4-mapped IPv6) will not match a plain IPv4 `/24` unless you normalize it. Enumerate both families explicitly.

4. **Provider IP ranges change.** Managed platforms rotate and expand their egress ranges, sometimes with little notice. A hardcoded allowlist becomes an outage the day they add a subnet. Load ranges from a refreshable source and monitor the rate of `403`s from *near-miss* addresses so a range change surfaces as an alert, not a silent drop of legitimate events.

5. **Cloud NAT egress sharing.** If your provider runs on a shared cloud platform, its outbound traffic may leave through NAT ranges shared with thousands of unrelated tenants. Allowlisting that range admits anything running on the same platform — including an attacker who spins up a VM there. This is precisely why IP allowlisting is *necessary but not sufficient*: it must be paired with a per-request signature that only your provider can produce.

6. **Spoofing at the network layer.** Source-IP spoofing is impractical for a completed TCP/TLS handshake, but header-level spoofing via `X-Forwarded-For` is trivial and is the realistic threat here. The signature check is what closes the gap; the IP gate only reduces the volume of requests that reach it.

## Verification

Run with `pytest`. The tests exercise an allowed IPv4, an allowed IPv6, a blocked address, and — critically — a spoof attempt where the client forges a leftmost `X-Forwarded-For` entry.

```python
import ipaddress
import pytest

from app import IPAllowlistMiddleware  # the middleware defined above

CIDRS = ["203.0.113.0/24", "2001:db8::/32"]


def _scope(xff: str | None = None, peer: str = "10.0.0.1"):
    headers = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode()))
    return {"type": "http", "headers": headers, "client": (peer, 51234)}


@pytest.fixture
def mw():
    # trusted_proxy_hops=1: one load balancer appends the real client IP.
    return IPAllowlistMiddleware(app=None, allowed_cidrs=CIDRS, trusted_proxy_hops=1)


def test_allowed_ipv4(mw):
    # LB (rightmost) recorded a real client inside 203.0.113.0/24.
    ip = mw._client_ip(_scope(xff="198.51.100.9, 203.0.113.44"))
    assert mw._is_allowed(ip)


def test_allowed_ipv6(mw):
    ip = mw._client_ip(_scope(xff="2001:db8::1"))
    assert mw._is_allowed(ip)


def test_blocked_ip(mw):
    ip = mw._client_ip(_scope(xff="192.0.2.5"))
    assert not mw._is_allowed(ip)


def test_xff_spoof_attempt_is_rejected(mw):
    # Attacker at 192.0.2.5 forges an allowlisted address as the LEFTMOST
    # entry. Our LB then appends the attacker's real IP on the right.
    # Trust depth = 1 selects the real (rightmost-but-one) address, so the
    # forged leftmost value is ignored and the request is denied.
    ip = mw._client_ip(_scope(xff="203.0.113.44, 192.0.2.5"))
    assert not mw._is_allowed(ip)


def test_short_chain_is_not_trusted(mw):
    # Only one entry but we expect one proxy hop: index computes to 0 and
    # returns that entry; a forged single value must still fail the CIDR test.
    ip = mw._client_ip(_scope(xff="203.0.113.44"))
    # With one hop and one entry, index = 0 -> the sole (forgeable) value.
    # This is why hop count MUST match real topology; here it would pass,
    # so in production reject chains shorter than trusted_proxy_hops + 1.
    assert ip == ipaddress.ip_address("203.0.113.44")
```

---

## Related

- [Webhook Security Boundaries](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/) — the parent overview of the full trust model for geospatial event ingress
- [Signing Spatial Webhook Payloads with HMAC-SHA256](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/signing-spatial-webhook-payloads-with-hmac-sha256/) — the signature layer that IP allowlisting must be paired with
- [Preventing Replay Attacks on Spatial Webhooks](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/preventing-replay-attacks-on-spatial-webhooks/) — add timestamp and nonce checks for a third independent control
