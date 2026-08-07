---
title: "Signing Spatial Webhook Payloads with HMAC-SHA256"
description: "Verify inbound geospatial webhook authenticity with an HMAC-SHA256 signature over the RAW request body — before any GeoJSON parsing reorders keys or rounds floats."
slug: "signing-spatial-webhook-payloads-with-hmac-sha256"
type: "article"
breadcrumb:
  - label: "Core Event Fundamentals & Architecture"
    url: "/core-event-fundamentals-architecture/"
  - label: "Webhook Security Boundaries"
    url: "/core-event-fundamentals-architecture/webhook-security-boundaries/"
  - label: "Signing Spatial Webhook Payloads with HMAC-SHA256"
    url: "/core-event-fundamentals-architecture/webhook-security-boundaries/signing-spatial-webhook-payloads-with-hmac-sha256/"
datePublished: "2025-05-01"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Signing Spatial Webhook Payloads with HMAC-SHA256",
      "description": "How to verify inbound geospatial webhook authenticity with an HMAC-SHA256 signature computed over the raw request body, and why you must sign the raw bytes rather than parsed GeoJSON.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/signing-spatial-webhook-payloads-with-hmac-sha256/",
      "datePublished": "2025-05-01",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Core Event Fundamentals & Architecture", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/" },
        { "@type": "ListItem", "position": 2, "name": "Webhook Security Boundaries", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/" },
        { "@type": "ListItem", "position": 3, "name": "Signing Spatial Webhook Payloads with HMAC-SHA256", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/signing-spatial-webhook-payloads-with-hmac-sha256/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Signing Spatial Webhook Payloads with HMAC-SHA256",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Read the raw request body", "text": "Call request.body() to obtain the exact bytes the sender signed, before any framework JSON parsing or GeoJSON normalization touches them." },
        { "@type": "HowToStep", "position": 2, "name": "Recompute the HMAC over raw bytes", "text": "Compute hmac.new(secret, raw_body, hashlib.sha256) using the shared secret and the untouched request bytes." },
        { "@type": "HowToStep", "position": 3, "name": "Compare in constant time", "text": "Compare the recomputed digest with the header signature using hmac.compare_digest to avoid leaking timing information." },
        { "@type": "HowToStep", "position": 4, "name": "Parse geometry only after the signature passes", "text": "Reject with 401 on mismatch; only decode and normalize the GeoJSON after the signature has been verified against the raw bytes." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why can't I sign the parsed GeoJSON instead of the raw bytes?",
          "acceptedAnswer": { "@type": "Answer", "text": "Parsing and reserializing GeoJSON changes the bytes: json.loads followed by json.dumps can reorder object keys, alter whitespace, round or reformat coordinate floats, and rewrite escape sequences. HMAC is computed byte-for-byte, so any of these differences produces a different digest and the signature fails. Always sign and verify the exact raw request body." }
        },
        {
          "@type": "Question",
          "name": "Why must I use hmac.compare_digest instead of ==?",
          "acceptedAnswer": { "@type": "Answer", "text": "The == operator on strings or bytes short-circuits at the first differing byte, so its runtime leaks how many leading bytes an attacker guessed correctly. Over many requests this timing side channel lets an attacker recover a valid signature byte by byte. hmac.compare_digest runs in constant time regardless of where the first difference is, closing that channel." }
        },
        {
          "@type": "Question",
          "name": "The request body is empty when I try to verify it — what happened?",
          "acceptedAnswer": { "@type": "Answer", "text": "A request body stream can only be read once. If a framework middleware, a dependency, or an earlier Pydantic model already consumed the stream, request.body() returns empty bytes. In FastAPI, read and cache the raw body in the signature dependency (or middleware) before any model binding runs, and pass those cached bytes downstream." }
        },
        {
          "@type": "Question",
          "name": "How do I rotate the signing secret without dropping events?",
          "acceptedAnswer": { "@type": "Answer", "text": "Accept more than one secret during the overlap window. Compute the HMAC against each active secret and accept the request if any comparison passes, using hmac.compare_digest for each. Once every sender has moved to the new secret and logs show no traffic on the old one, remove it." }
        }
      ]
    }
  ]
}
</script>

**Sign the RAW request body — the exact bytes on the wire — with HMAC-SHA256, and verify that signature BEFORE you parse, normalize, or reproject a single coordinate; reserializing GeoJSON changes the bytes and silently breaks the signature.** This how-to sits under [Webhook Security Boundaries](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/), part of [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/).

Where the sibling guide [Securing Webhook Endpoints with Spatial Token Validation](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/) embeds a *spatial claim* (a geohash or bounding box) inside the token and checks geographic containment, this page is narrower and more fundamental: pure body-integrity authentication. The only question here is "did the party holding the shared secret produce these exact bytes, unmodified in transit?" No geometry is trusted until that answer is yes.

## When to use this pattern

- The webhook provider (a mapping platform, a fleet telematics vendor, a tile-render service) publishes a shared secret and sends a signature header such as `X-Signature-256: sha256=<hex>`. HMAC verification is the standard way to authenticate that channel.
- You ingest GeoJSON or other spatial payloads over the public internet and need tamper-evidence: a single flipped coordinate, a swapped feature ID, or an injected geometry must invalidate the request.
- You want authentication that adds sub-millisecond overhead and no network round trip, unlike mutual TLS or an introspection call to an auth server.

This is **not** the right tool when you need to attest *where* an event physically originated — that is a geographic trust boundary, and spatial token validation or geofencing handles it. HMAC proves integrity and shared-secret possession, nothing about location. It also does not stop replay on its own; pair it with [Preventing Replay Attacks on Spatial Webhooks](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/preventing-replay-attacks-on-spatial-webhooks/) when duplicate delivery is a threat.

## Why reserialization breaks the signature

HMAC-SHA256 is a keyed hash over an exact byte sequence. The sender computes it over the bytes it puts on the wire; you must recompute it over the identical bytes. The spatial trap is that GeoJSON is JSON, and it is tempting to let your framework decode the JSON into a model and then hash *that*. But the moment you `json.loads()` and `json.dumps()` a payload — or worse, round-trip it through a geometry library — the bytes change in at least four ways that all break the digest.

<figure class="fig">
<svg viewBox="0 0 760 288" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Four byte-level changes a JSON round-trip makes to a GeoJSON payload, each of which alone breaks the HMAC digest">
<title>The four ways a JSON round-trip changes the bytes</title>
<desc>The sender's raw bytes are shown above the same payload after json.loads followed by json.dumps. Four spans differ: the key order is normalised so type sorts before coordinates, the longitude 13.4 is re-emitted as 13.400000000000001, the separator whitespace after each colon and comma is inserted, and the non-ASCII place name is escaped to a backslash-u sequence. Each difference alone changes the SHA-256 digest completely, so the recomputed signature shares no prefix with the sender's.</desc>
<rect x="0" y="0" width="760" height="288" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="11" font-weight="600" fill="var(--fig-mint-edge)">What the sender hashed — the exact bytes on the wire</text>
<rect x="14" y="28" width="732" height="42" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="26" y="46" font-size="10.5" font-family="monospace" fill="var(--fig-ink)">{"coordinates":[13.4,52.52],"type":"Point","name":"Berlin Mitte"}</text>
<text x="26" y="62" font-size="9" fill="var(--fig-ink-soft)">sha256 = 9f2c1a7b8e04d3…  ✓ matches X-Signature-256</text>
<text x="14" y="98" font-size="11" font-weight="600" fill="var(--fig-rose-edge)">What json.dumps(json.loads(body)) produces — four spans differ</text>
<rect x="14" y="106" width="732" height="42" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="26" y="124" font-size="10.5" font-family="monospace" fill="var(--fig-ink)">{"type": "Point", "coordinates": [13.400000000000001, 52.52], "name": "Berlin Mitte"}</text>
<text x="26" y="140" font-size="9" fill="var(--fig-ink-soft)">sha256 = 41ba6d09fc72e5…  ✗ shares no prefix — a digest has no partial credit</text>
<rect x="14" y="168" width="176" height="52" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="24" y="186" font-size="10" font-weight="600" fill="var(--fig-ink)">1 · Key order</text>
<text x="24" y="201" font-size="9" fill="var(--fig-ink-soft)">dicts re-emit in insertion</text>
<text x="24" y="213" font-size="9" fill="var(--fig-ink-soft)">order, not the sender's</text>
<rect x="200" y="168" width="176" height="52" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="210" y="186" font-size="10" font-weight="600" fill="var(--fig-ink)">2 · Float repr</text>
<text x="210" y="201" font-size="9" fill="var(--fig-ink-soft)">13.4 → 13.400000000000001</text>
<text x="210" y="213" font-size="9" fill="var(--fig-ink-soft)">binary64 has no exact 13.4</text>
<rect x="386" y="168" width="176" height="52" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="396" y="186" font-size="10" font-weight="600" fill="var(--fig-ink)">3 · Separators</text>
<text x="396" y="201" font-size="9" fill="var(--fig-ink-soft)">default dumps adds a space</text>
<text x="396" y="213" font-size="9" fill="var(--fig-ink-soft)">after every : and ,</text>
<rect x="572" y="168" width="174" height="52" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="582" y="186" font-size="10" font-weight="600" fill="var(--fig-ink)">4 · Unicode</text>
<text x="582" y="201" font-size="9" fill="var(--fig-ink-soft)">ensure_ascii escapes any</text>
<text x="582" y="213" font-size="9" fill="var(--fig-ink-soft)">non-ASCII place name</text>
<rect x="14" y="236" width="732" height="40" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="26" y="254" font-size="10" font-weight="600" fill="var(--fig-ink)">Any one of the four is fatal on its own.</text>
<text x="26" y="269" font-size="9.5" fill="var(--fig-ink-soft)">Read the body once as bytes, verify against those bytes, and only then parse. Never re-derive the bytes you verify.</text>
</svg>
<figcaption><b>Figure 1.</b> Four independent reasons a round-tripped payload hashes differently. This is why the verification step has to hold the original <code>bytes</code> — reconstructing them after parsing is not possible in general.</figcaption>
</figure>

<figure class="fig">
<svg viewBox="0 46 760 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Diagram contrasting verifying HMAC over raw bytes versus over reserialized GeoJSON">
  <title>Verify over raw bytes, not reserialized GeoJSON</title>
  <desc>The raw request body flows into an HMAC-SHA256 comparison that matches the sender's signature and passes. A second path first parses and reserializes the GeoJSON — reordering keys, rounding floats, changing whitespace — producing different bytes whose HMAC no longer matches, and fails.</desc>
  <rect x="0" y="46" width="760" height="220" fill="var(--fig-bg)"/>
  <defs>
    <marker id="ah" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- Raw body node -->
  <rect x="10" y="120" width="120" height="52" rx="6" fill="currentColor" opacity="0.12"/>
  <rect x="10" y="120" width="120" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="70" y="142" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">Raw request</text>
  <text x="70" y="158" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">body (bytes)</text>
  <!-- Top path: direct HMAC -->
  <line x1="130" y1="132" x2="292" y2="86" stroke="currentColor" stroke-width="1.5" marker-end="url(#ah)" opacity="0.55"/>
  <rect x="294" y="60" width="180" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="384" y="82" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif">HMAC-SHA256(secret,</text>
  <text x="384" y="98" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif">raw bytes)</text>
  <line x1="474" y1="86" x2="624" y2="86" stroke="currentColor" stroke-width="1.5" marker-end="url(#ah)" opacity="0.55"/>
  <rect x="626" y="60" width="124" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="688" y="82" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">matches</text>
  <text x="688" y="98" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">PASS</text>
  <!-- Bottom path: reserialize then HMAC -->
  <line x1="130" y1="160" x2="292" y2="206" stroke="currentColor" stroke-width="1.5" marker-end="url(#ah)" opacity="0.55"/>
  <rect x="294" y="180" width="180" height="72" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6,3"/>
  <text x="384" y="200" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">parse + reserialize</text>
  <text x="384" y="216" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">key reorder · float round</text>
  <text x="384" y="230" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">whitespace · CRS reproject</text>
  <text x="384" y="245" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">→ different bytes</text>
  <line x1="474" y1="216" x2="624" y2="216" stroke="currentColor" stroke-width="1.5" marker-end="url(#ah)" opacity="0.55"/>
  <rect x="626" y="190" width="124" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6,3"/>
  <text x="688" y="212" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">mismatch</text>
  <text x="688" y="228" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">FAIL</text>
</svg>
<figcaption><b>Figure 2.</b> Verify over raw bytes, not reserialized GeoJSON</figcaption>
</figure>

First, **key order**. A sender may emit `{"type":"Feature","geometry":{...},"properties":{...}}`; a naive re-dump under a different insertion order or a `sort_keys=True` policy rearranges those keys. Second, **float representation**. `json.loads` turns `2.000000` into the Python float `2.0`, and re-dumping writes `2.0` — the string changed. Coordinate arrays such as `[-122.41942, 37.77493]` are especially fragile because any library that rounds to a fixed precision rewrites every vertex. Third, **whitespace and separators**: the sender's compact `,` / `:` separators become `, ` / `: ` under default `json.dumps`. Fourth, and uniquely spatial, **CRS reprojection**. If your pipeline reprojects incoming coordinates from EPSG:4326 (WGS84) to EPSG:3857 (Web Mercator) before you hash, every number is different and the digest cannot possibly match. RFC 7946 mandates EPSG:4326 for GeoJSON, but many internal payloads carry other CRSs — never let that transform run ahead of verification.

The rule that dissolves all four problems: **hash the raw bytes, once, before anything else reads them.**

## Complete runnable implementation

The FastAPI app below authenticates an inbound spatial webhook. The signature check is a dependency that runs before the route body executes, reads `await request.body()` exactly once, and caches the bytes on `request.state` so the handler can parse the GeoJSON *after* verification. Install `fastapi` and run with `uvicorn app:app`.

```python
import hashlib
import hmac
import json
import os
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status

app = FastAPI()

# --- Configuration -----------------------------------------------------------
# 32-byte (256-bit) shared secret. In production load it from a secret manager;
# os.environ ensures it is never hardcoded in source control.
WEBHOOK_SECRET: bytes = os.environ.get(
    "WEBHOOK_SECRET", "change-me-to-a-32-byte-env-secret"
).encode("utf-8")

# The provider's signature header format. Many vendors prefix the hex digest
# with an algorithm tag, e.g. "sha256=ab12...". We strip it before comparing.
SIGNATURE_PREFIX = "sha256="


def _expected_signature(raw_body: bytes) -> str:
    """HMAC-SHA256 over the EXACT request bytes — never the parsed payload."""
    return hmac.new(WEBHOOK_SECRET, raw_body, hashlib.sha256).hexdigest()


async def verify_signature(
    request: Request,
    x_signature_256: Optional[str] = Header(default=None),
) -> bytes:
    """
    FastAPI dependency. Returns the verified raw body so the handler can reuse
    it without re-reading the (already consumed) request stream.

    Ordering is the whole point: we read raw bytes and check the HMAC here,
    BEFORE any GeoJSON parsing or CRS normalization can mutate them.
    """
    if not x_signature_256:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Signature-256 header",
        )

    # Read the body exactly once. Starlette caches it internally, but we also
    # stash it on request.state so downstream code never touches the stream.
    raw_body: bytes = await request.body()
    request.state.raw_body = raw_body

    # Strip the "sha256=" tag if the sender includes one.
    received = x_signature_256
    if received.startswith(SIGNATURE_PREFIX):
        received = received[len(SIGNATURE_PREFIX):]

    expected = _expected_signature(raw_body)

    # Constant-time comparison. NEVER use `received == expected` here — string
    # equality short-circuits and leaks a timing side channel byte by byte.
    if not hmac.compare_digest(received, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid signature",
        )

    return raw_body


@app.post("/webhook/geo")
async def handle_geo_webhook(raw_body: bytes = Depends(verify_signature)) -> dict:
    # We only reach this line once the HMAC has passed. It is now safe to parse,
    # normalize, and reproject the GeoJSON — the bytes are authenticated.
    feature = json.loads(raw_body)

    # Example post-verification handling. Coordinates are assumed to be
    # EPSG:4326 (WGS84) per RFC 7946; reproject to EPSG:3857 (Web Mercator)
    # here if a downstream tile pipeline needs it — AFTER verification, never
    # before it.
    geometry = feature.get("geometry", {})
    coords = geometry.get("coordinates")

    return {"status": "accepted", "geometry_type": geometry.get("type"),
            "vertex_sample": coords}
```

The load-bearing detail is the `Depends(verify_signature)` wiring: FastAPI resolves the dependency before invoking the handler, so the HMAC gate is structurally impossible to skip, and the handler receives already-verified bytes rather than re-reading a consumed stream.

## Parameter reference

<div style="overflow-x:auto;">

| Parameter | Type | Spatial / security constraint | Default |
|---|---|---|---|
| `WEBHOOK_SECRET` | `bytes` | Min 32 bytes; load from a secret manager, never hardcode | — (must be set) |
| `raw_body` | `bytes` | The EXACT wire bytes; must be hashed before any GeoJSON parse or CRS transform | `await request.body()` |
| `x_signature_256` | `str` | Hex digest, optionally `sha256=`-prefixed; from the provider header | from header |
| `SIGNATURE_PREFIX` | `str` | Vendor-specific algorithm tag to strip before compare | `"sha256="` |
| `digestmod` (`hashlib.sha256`) | callable | Must match the algorithm the sender used; SHA-256 = 64 hex chars | `hashlib.sha256` |
| `hmac.compare_digest(a, b)` | `bool` | Constant-time; both args same type (`str`/`str` or `bytes`/`bytes`) | — |

</div>

## Gotchas and spatial edge cases

1. **Signing normalized instead of raw bytes.** The defining mistake. If you verify against `json.dumps(json.loads(raw_body))`, key reordering, `2.000000` → `2.0` float reformatting, and separator whitespace all shift the bytes and every legitimate request fails. Hash `request.body()` verbatim.

2. **CRS reprojection before verification.** Reprojecting coordinates from EPSG:4326 (WGS84) to EPSG:3857 (Web Mercator) — or any datum shift — rewrites every number. It must run strictly after the HMAC passes. Keep reprojection out of middleware that sits in front of the signature check.

3. **Timing attacks via `==`.** String equality short-circuits at the first mismatched byte, leaking how far an attacker's guess matched. Always use `hmac.compare_digest`, which runs in constant time.

<figure class="fig">
<svg viewBox="0 0 760 274" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Response time against the number of correctly guessed leading signature bytes, comparing short-circuit equality with constant-time comparison">
<title>What == leaks that compare_digest does not</title>
<desc>Mean rejection time plotted against how many leading bytes of the signature an attacker has guessed correctly, from zero to seven. With the equality operator the comparison exits at the first mismatched byte, so the curve climbs in a visible staircase from about 0.4 to 3.2 microseconds — each extra correct byte costs one more loop iteration, and that difference is measurable over enough samples. With hmac.compare_digest the line is flat at about 3.4 microseconds regardless of the prefix, because every byte is always compared. The staircase is the side channel: it turns forging a signature from guessing all thirty-two bytes at once into guessing one byte at a time.</desc>
<rect x="0" y="0" width="760" height="274" fill="var(--fig-bg)"/>
<line x1="72" y1="34" x2="72" y2="196" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="72" y1="196" x2="536" y2="196" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="72" y1="156" x2="536" y2="156" stroke="var(--fig-line-soft)" stroke-width="0.7" stroke-dasharray="3,3"/>
<line x1="72" y1="116" x2="536" y2="116" stroke="var(--fig-line-soft)" stroke-width="0.7" stroke-dasharray="3,3"/>
<line x1="72" y1="76" x2="536" y2="76" stroke="var(--fig-line-soft)" stroke-width="0.7" stroke-dasharray="3,3"/>
<text x="66" y="199" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">0</text>
<text x="66" y="159" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">1</text>
<text x="66" y="119" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">2</text>
<text x="66" y="79" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">3</text>
<text x="66" y="39" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">4</text>
<text x="30" y="118" font-size="9.5" fill="var(--fig-ink-soft)" transform="rotate(-90 30 118)" text-anchor="middle">mean reject time (µs)</text>
<polyline points="72,180 130,174 130,164 188,164 188,150 246,150 246,134 304,134 304,118 362,118 362,102 420,102 420,86 478,86 478,68 536,68" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2.2"/>
<polyline points="72,60 536,60" fill="none" stroke="var(--fig-mint-edge)" stroke-width="2.2"/>
<circle cx="72" cy="180" r="3" fill="var(--fig-rose-edge)"/>
<circle cx="188" cy="164" r="3" fill="var(--fig-rose-edge)"/>
<circle cx="304" cy="134" r="3" fill="var(--fig-rose-edge)"/>
<circle cx="420" cy="102" r="3" fill="var(--fig-rose-edge)"/>
<circle cx="536" cy="68" r="3" fill="var(--fig-rose-edge)"/>
<text x="72" y="212" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">0</text>
<text x="188" y="212" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">2</text>
<text x="304" y="212" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">4</text>
<text x="420" y="212" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">6</text>
<text x="536" y="212" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">8</text>
<text x="304" y="230" text-anchor="middle" font-size="9.5" fill="var(--fig-ink-soft)">leading signature bytes the attacker has guessed correctly</text>
<rect x="556" y="56" width="192" height="42" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="566" y="73" font-size="10" font-weight="600" fill="var(--fig-ink)">hmac.compare_digest</text>
<text x="566" y="88" font-size="9" fill="var(--fig-ink-soft)">flat — every byte always read</text>
<rect x="556" y="110" width="192" height="56" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="566" y="127" font-size="10" font-weight="600" fill="var(--fig-ink)">received == expected</text>
<text x="566" y="142" font-size="9" fill="var(--fig-ink-soft)">one step per correct byte —</text>
<text x="566" y="154" font-size="9" fill="var(--fig-ink-soft)">the staircase IS the leak</text>
<rect x="72" y="240" width="676" height="26" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="84" y="257" font-size="9.5" fill="var(--fig-ink)">Cost of a forgery: 256³² guesses against a flat line, but only 32 × 256 against a staircase — one byte at a time.</text>
</svg>
<figcaption><b>Figure 3.</b> The staircase is what an attacker measures. Averaged over enough requests, a sub-microsecond step is recoverable, which reduces forging a 32-byte signature from an intractable search to about 8,000 probes.</figcaption>
</figure>

4. **Body already consumed.** A request stream reads once. If middleware or an earlier dependency parsed the body first, `request.body()` yields empty bytes and the digest is computed over nothing. Read and cache the raw body inside the signature dependency before any model binding.

5. **Encoding mismatches.** The secret and any string inputs must encode consistently — use UTF-8 and keep the body as `bytes`, never `str`. A secret stored as text and `.encode()`-d with a different codec than the sender used produces a silent, permanent mismatch. `compare_digest` also requires both arguments be the same type.

6. **Ring orientation and coordinate order are irrelevant to HMAC — and that's the point.** HMAC does not understand geometry; it authenticates bytes. Do not "fix" polygon winding order or swap `[lon, lat]` before verifying. Validate and correct geometry only in the post-verification stage, where changing the bytes no longer matters.

7. **Secret rotation.** To rotate without dropping events, hold a list of active secrets and accept the request if `compare_digest` passes against any one of them. Remove the old secret once traffic logs show no sender still using it.

## Verification

Run this with `pytest` after installing `fastapi` and `httpx`. It exercises a known-good signature, a tampered body, and a bad signature.

```python
import hashlib
import hmac
import json

from fastapi.testclient import TestClient

# Import the app and secret from the implementation above.
from app import app, WEBHOOK_SECRET

client = TestClient(app)

# A compact GeoJSON Feature in EPSG:4326 (WGS84), per RFC 7946.
BODY = json.dumps(
    {"type": "Feature",
     "geometry": {"type": "Point", "coordinates": [-122.41942, 37.77493]},
     "properties": {"id": "sensor-42"}},
    separators=(",", ":"),
).encode("utf-8")


def _sign(raw: bytes) -> str:
    return "sha256=" + hmac.new(WEBHOOK_SECRET, raw, hashlib.sha256).hexdigest()


def test_valid_signature_accepted():
    resp = client.post(
        "/webhook/geo",
        content=BODY,
        headers={"X-Signature-256": _sign(BODY),
                 "Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


def test_tampered_body_rejected():
    # Sign the original bytes, then send different bytes: HMAC must fail.
    tampered = BODY.replace(b"37.77493", b"37.80000")
    resp = client.post(
        "/webhook/geo",
        content=tampered,
        headers={"X-Signature-256": _sign(BODY),
                 "Content-Type": "application/json"},
    )
    assert resp.status_code == 401


def test_bad_signature_rejected():
    resp = client.post(
        "/webhook/geo",
        content=BODY,
        headers={"X-Signature-256": "sha256=" + "0" * 64,
                 "Content-Type": "application/json"},
    )
    assert resp.status_code == 401


def test_reserialized_body_would_fail():
    # Prove the core claim: re-dumping the parsed payload changes the bytes,
    # so a signature over the ORIGINAL body no longer matches.
    reserialized = json.dumps(json.loads(BODY)).encode("utf-8")  # spaces added
    assert reserialized != BODY
    resp = client.post(
        "/webhook/geo",
        content=reserialized,
        headers={"X-Signature-256": _sign(BODY),
                 "Content-Type": "application/json"},
    )
    assert resp.status_code == 401
```

## FAQ

<details class="faq">
<summary><strong>Why can't I sign the parsed GeoJSON instead of the raw bytes?</strong></summary>

Parsing and reserializing GeoJSON changes the bytes: `json.loads` followed by `json.dumps` can reorder object keys, alter whitespace, round or reformat coordinate floats, and rewrite escape sequences. HMAC is computed byte-for-byte, so any of these differences produces a different digest and the signature fails. Always sign and verify the exact raw request body.

</details>

<details class="faq">
<summary><strong>Why must I use hmac.compare_digest instead of ==?</strong></summary>

The `==` operator on strings or bytes short-circuits at the first differing byte, so its runtime leaks how many leading bytes an attacker guessed correctly. Over many requests this timing side channel lets an attacker recover a valid signature byte by byte. `hmac.compare_digest` runs in constant time regardless of where the first difference is, closing that channel.

</details>

<details class="faq">
<summary><strong>The request body is empty when I try to verify it — what happened?</strong></summary>

A request body stream can only be read once. If a framework middleware, a dependency, or an earlier Pydantic model already consumed the stream, `request.body()` returns empty bytes. In FastAPI, read and cache the raw body in the signature dependency (or middleware) before any model binding runs, and pass those cached bytes downstream.

</details>

<details class="faq">
<summary><strong>How do I rotate the signing secret without dropping events?</strong></summary>

Accept more than one secret during the overlap window. Compute the HMAC against each active secret and accept the request if any comparison passes, using `hmac.compare_digest` for each. Once every sender has moved to the new secret and logs show no traffic on the old one, remove it.

</details>

---

## Related

- [Webhook Security Boundaries](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/) — parent overview of the full trust model for geospatial event ingress
- [Securing Webhook Endpoints with Spatial Token Validation](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/) — go beyond body integrity to bind a signed geographic claim into the token
- [Preventing Replay Attacks on Spatial Webhooks](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/preventing-replay-attacks-on-spatial-webhooks/) — add timestamp and nonce checks so a valid signature can't be replayed
