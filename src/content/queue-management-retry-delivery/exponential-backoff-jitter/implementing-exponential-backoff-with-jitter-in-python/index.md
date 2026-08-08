---
title: "Implementing Exponential Backoff with Jitter in Python"
description: "Build an async decorrelated-jitter retry helper in Python that safely re-POSTs GeoJSON webhook payloads with aiohttp, with cap, base, max-attempts params and a bounds test."
slug: "implementing-exponential-backoff-with-jitter-in-python"
type: "article"
breadcrumb:
  - label: "Queue Management, Retries & Delivery Guarantees"
    url: "/queue-management-retry-delivery/"
  - label: "Exponential Backoff & Jitter for Spatial Webhooks"
    url: "/queue-management-retry-delivery/exponential-backoff-jitter/"
  - label: "Implementing Exponential Backoff with Jitter in Python"
    url: "/queue-management-retry-delivery/exponential-backoff-jitter/implementing-exponential-backoff-with-jitter-in-python/"
datePublished: "2025-05-01"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Implementing Exponential Backoff with Jitter in Python",
      "description": "Build an async decorrelated-jitter retry helper in Python that safely re-POSTs GeoJSON webhook payloads with aiohttp, with cap, base, and max-attempts parameters and a bounds test.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/implementing-exponential-backoff-with-jitter-in-python/",
      "datePublished": "2025-05-01",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Queue Management, Retries & Delivery Guarantees", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/" },
        { "@type": "ListItem", "position": 2, "name": "Exponential Backoff & Jitter for Spatial Webhooks", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/" },
        { "@type": "ListItem", "position": 3, "name": "Implementing Exponential Backoff with Jitter in Python", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/implementing-exponential-backoff-with-jitter-in-python/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Implement Exponential Backoff with Jitter for GeoJSON Webhook Retries",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Gate on idempotency", "text": "Only enter the retry loop for idempotent-safe operations. Re-POSTing a payload that performs a non-idempotent geometry write can double-apply the change; guard it with an idempotency key first." },
        { "@type": "HowToStep", "position": 2, "name": "Compute a decorrelated-jitter delay", "text": "Seed the sleep at base, then on each attempt draw a uniform random value between base and the previous sleep multiplied by three, clamped to cap. This AWS-style decorrelated jitter spreads retries and prevents synchronized retry storms." },
        { "@type": "HowToStep", "position": 3, "name": "Honour Retry-After", "text": "If the server returns a Retry-After header on a 429 or 503, use that server-specified delay instead of the computed jitter for that attempt." },
        { "@type": "HowToStep", "position": 4, "name": "Stop at max_attempts", "text": "Bound the loop with a hard max_attempts ceiling so a permanently failing endpoint drains to a dead-letter queue rather than retrying forever." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why add jitter instead of plain exponential backoff?",
          "acceptedAnswer": { "@type": "Answer", "text": "Plain exponential backoff makes every failed client wait the same deterministic interval, so after a shared outage they all retry at the same instant and hammer the recovering endpoint in synchronized waves — a retry storm. Randomized (jittered) delays spread those retries across the window, smoothing load and improving overall recovery time." }
        },
        {
          "@type": "Question",
          "name": "Is it safe to retry a GeoJSON webhook POST?",
          "acceptedAnswer": { "@type": "Answer", "text": "Only if the operation is idempotent. Re-POSTing a payload that appends a feature or increments state will double-apply the geometry write on a retry. Attach a deterministic idempotency key so the receiver can deduplicate, and never retry non-idempotent writes blindly." }
        },
        {
          "@type": "Question",
          "name": "How should I handle a Retry-After header?",
          "acceptedAnswer": { "@type": "Answer", "text": "When a 429 or 503 response carries a Retry-After header, treat it as authoritative and sleep for that server-specified duration instead of your computed jitter for that attempt. The server knows its own recovery schedule better than your local backoff curve." }
        },
        {
          "@type": "Question",
          "name": "What clock should I record for observation_time versus retry timing?",
          "acceptedAnswer": { "@type": "Answer", "text": "Use two different clocks. The event's observation_time is a wall-clock timestamp captured once at ingestion and carried unchanged through every retry, so downstream ordering stays correct. Retry delays should be measured with a monotonic clock (time.monotonic / loop.time) that never jumps when NTP adjusts the system clock." }
        }
      ]
    }
  ]
}
</script>

**To add exponential backoff with jitter in Python, seed your sleep interval at `base`, then on each retry draw a uniform random delay between `base` and the previous sleep times three, clamp it to `cap`, and stop at `max_attempts` — the AWS "decorrelated jitter" recipe. Only wrap idempotent-safe operations in the loop.** This spreads retries across time so a fleet of webhook senders never re-POSTs in lockstep after a shared outage.

This page sits within [Exponential Backoff & Jitter for Spatial Webhooks](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/), part of the broader [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/) architecture — the reference section for delivering spatial events reliably under failure.

---

## When to use this pattern

Reach for decorrelated-jitter backoff when:

- You re-POST GeoJSON payloads to a downstream endpoint that returns transient failures (`429 Too Many Requests`, `503 Service Unavailable`, connection resets) and you want retries that recover fast without synchronizing across senders.
- Many workers or shards retry against the same endpoint, so uncoordinated but time-spread retries matter — jitter is what breaks the herd.
- The delivery is idempotent-safe: the receiver deduplicates by key, or the write is naturally idempotent (an upsert keyed on feature ID).

It is **not** the right tool when the operation mutates spatial state non-idempotently — appending a geometry, incrementing a counter, or inserting a row without a unique key. Retrying those double-applies the change. Make the operation idempotent first (see the sibling patterns below), then retry.

---

## Why retries without jitter cause storms

Plain exponential backoff doubles a fixed delay: 1s, 2s, 4s, 8s. If a downstream tile service drops for thirty seconds, every sender that failed at the same moment computes the *same* deterministic schedule and retries at the same instants. The recovering endpoint is hit by synchronized waves — a **retry storm** — that can knock it back over just as it comes up.

Jitter randomizes each delay so the retries scatter across the window. Of the three AWS-documented variants — full jitter, equal jitter, and decorrelated jitter — decorrelated jitter gives the best throughput under contention because each delay is derived from the *previous* delay rather than from a fixed exponent, letting the backoff both grow and occasionally shrink to probe for recovery.

<figure class="fig">
<svg viewBox="0 3 753 247" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Comparison of synchronized retries without jitter versus spread-out retries with decorrelated jitter">
  <title>Retry storm without jitter versus spread retries with decorrelated jitter</title>
  <desc>Two horizontal timelines. The top timeline shows four senders all retrying at the same three instants, forming tall synchronized spikes. The bottom timeline shows the same senders with decorrelated jitter, their retries scattered evenly across the window with no overlap.</desc>
  <rect x="0" y="3" width="753" height="247" fill="var(--fig-bg)"/>
  <!-- top: no jitter -->
  <text x="8" y="30" font-size="12" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Without jitter — synchronized storm</text>
  <line x1="20" y1="90" x2="740" y2="90" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <g stroke="currentColor" stroke-opacity="0.55" stroke-width="3">
    <line x1="180" y1="90" x2="180" y2="52"/>
    <line x1="185" y1="90" x2="185" y2="52"/>
    <line x1="190" y1="90" x2="190" y2="52"/>
    <line x1="195" y1="90" x2="195" y2="52"/>
    <line x1="420" y1="90" x2="420" y2="52"/>
    <line x1="425" y1="90" x2="425" y2="52"/>
    <line x1="430" y1="90" x2="430" y2="52"/>
    <line x1="435" y1="90" x2="435" y2="52"/>
    <line x1="640" y1="90" x2="640" y2="52"/>
    <line x1="645" y1="90" x2="645" y2="52"/>
    <line x1="650" y1="90" x2="650" y2="52"/>
    <line x1="655" y1="90" x2="655" y2="52"/>
  </g>
  <!-- bottom: jitter -->
  <text x="8" y="150" font-size="12" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">With decorrelated jitter — spread</text>
  <line x1="20" y1="210" x2="740" y2="210" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <g stroke="currentColor" stroke-opacity="0.55" stroke-width="3">
    <line x1="90" y1="210" x2="90" y2="182"/>
    <line x1="150" y1="210" x2="150" y2="178"/>
    <line x1="245" y1="210" x2="245" y2="184"/>
    <line x1="330" y1="210" x2="330" y2="176"/>
    <line x1="410" y1="210" x2="410" y2="188"/>
    <line x1="500" y1="210" x2="500" y2="180"/>
    <line x1="590" y1="210" x2="590" y2="185"/>
    <line x1="690" y1="210" x2="690" y2="178"/>
  </g>
  <text x="380" y="234" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">time →</text>
</svg>
<figcaption><b>Figure 1.</b> Retry storm without jitter versus spread retries with decorrelated jitter</figcaption>
</figure>

---

## Complete runnable implementation

The helper below is self-contained. It re-POSTs a GeoJSON payload with `aiohttp`, computes a decorrelated-jitter delay each attempt, honours `Retry-After`, and refuses to retry unless you explicitly mark the call idempotent-safe. It records `observation_time` once from wall-clock at ingestion and measures backoff with a monotonic clock so an NTP correction mid-retry can never produce a negative sleep.

```python
import asyncio
import random
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import aiohttp


# Transient status codes worth retrying. 4xx other than 429 are caller errors
# and must NOT be retried — the payload will fail identically every time.
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


@dataclass
class RetryConfig:
    base: float = 0.5          # seconds — first-attempt floor delay
    cap: float = 30.0          # seconds — hard ceiling on any single sleep
    max_attempts: int = 6      # total tries including the first
    multiplier: float = 3.0    # decorrelated-jitter growth factor
    respect_retry_after: bool = True


class NonRetryableError(Exception):
    """Raised for a 4xx (except 429): retrying cannot help."""


def _decorrelated_sleep(prev: float, cfg: RetryConfig) -> float:
    """
    AWS-style decorrelated jitter.

    sleep = min(cap, uniform(base, prev * multiplier))

    The delay is drawn from a widening band anchored on the PREVIOUS sleep,
    so it grows on average but can shrink to probe for early recovery. The
    randomness is what breaks synchronized retry storms across many senders.
    """
    upper = min(cfg.cap, prev * cfg.multiplier)
    # uniform() needs lo <= hi; base may exceed a tiny prev on attempt one.
    lo, hi = min(cfg.base, upper), max(cfg.base, upper)
    return random.uniform(lo, hi)


def _parse_retry_after(header: Optional[str]) -> Optional[float]:
    """Retry-After is delta-seconds here; HTTP-date form is left to the caller."""
    if not header:
        return None
    try:
        return max(0.0, float(header))
    except ValueError:
        return None


async def post_geojson_with_backoff(
    session: aiohttp.ClientSession,
    url: str,
    payload: dict[str, Any],
    *,
    idempotency_key: str,
    cfg: RetryConfig = RetryConfig(),
) -> dict[str, Any]:
    """
    Re-POST a GeoJSON webhook payload with decorrelated-jitter backoff.

    `idempotency_key` is REQUIRED and non-optional by design: the receiver must
    be able to deduplicate, because at-least-once retries can deliver the same
    geometry write more than once. Never call this for a non-idempotent write
    that lacks a dedupe key.

    Raises NonRetryableError on a permanent 4xx, or the last transport error
    after max_attempts is exhausted (drain to a dead-letter queue there).
    """
    headers = {
        "Content-Type": "application/geo+json",
        "Idempotency-Key": idempotency_key,
    }
    prev = cfg.base
    last_exc: Optional[Exception] = None

    for attempt in range(1, cfg.max_attempts + 1):
        try:
            async with session.post(url, json=payload, headers=headers) as resp:
                if resp.status < 400:
                    return await resp.json()
                if resp.status not in RETRYABLE_STATUS:
                    body = await resp.text()
                    raise NonRetryableError(f"{resp.status}: {body[:200]}")
                # Retryable failure — prefer the server's Retry-After if present.
                server_delay = (
                    _parse_retry_after(resp.headers.get("Retry-After"))
                    if cfg.respect_retry_after else None
                )
                last_exc = aiohttp.ClientResponseError(
                    resp.request_info, resp.history, status=resp.status,
                )
        except (aiohttp.ClientConnectionError, asyncio.TimeoutError) as exc:
            server_delay = None
            last_exc = exc

        if attempt == cfg.max_attempts:
            break  # exhausted — let the caller dead-letter the payload

        delay = server_delay if server_delay is not None else _decorrelated_sleep(prev, cfg)
        delay = min(delay, cfg.cap)
        prev = delay
        await asyncio.sleep(delay)

    assert last_exc is not None
    raise last_exc


async def main() -> None:
    # observation_time is captured ONCE at ingestion (wall clock) and travels
    # unchanged through every retry so downstream ordering stays stable.
    feature = {
        "type": "Feature",
        "properties": {
            "sensor_id": "SN-42",
            "observation_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "geometry": {"type": "Point", "coordinates": [-73.965355, 40.782865]},
    }
    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=10)
    ) as session:
        result = await post_geojson_with_backoff(
            session,
            "https://example.test/ingest",
            feature,
            idempotency_key="evt-9f8a92b1",
            cfg=RetryConfig(base=0.5, cap=20.0, max_attempts=5),
        )
        print(result)


if __name__ == "__main__":
    asyncio.run(main())
```

The coordinates above are EPSG:4326 (WGS84) as required by [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946), and the `application/geo+json` media type signals the payload type to the receiver.

---

## Parameter reference

<div style="overflow-x:auto;">

| Parameter | Type | Meaning / spatial constraint | Default |
|---|---|---|---|
| `base` | `float` (s) | Floor delay for the first retry; also the lower bound of every jitter draw. Keep ≥ your P50 endpoint latency so retries don't pile on a slow-but-alive service | `0.5` |
| `cap` | `float` (s) | Hard ceiling on any single sleep. Bounds worst-case tail latency; must stay below the webhook provider's delivery deadline | `30.0` |
| `max_attempts` | `int` | Total tries including the first. Beyond this, drain the GeoJSON payload to a dead-letter queue rather than looping forever | `6` |
| `multiplier` | `float` | Decorrelated-jitter growth factor (AWS uses 3). Higher spreads faster but overshoots `cap` sooner | `3.0` |
| `respect_retry_after` | `bool` | When `True`, a server `Retry-After` on 429/503 overrides the computed jitter for that attempt | `True` |

</div>

---

## Gotchas and spatial edge cases

1. **Retrying without jitter causes storms.** A deterministic 1-2-4-8s schedule makes every sender that failed together retry together. The band-based decorrelated formula above is the fix — never ship fixed-interval retries against a shared endpoint.

<figure class="fig">
<svg viewBox="0 0 760 244" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The delay range each jitter variant draws from at attempt four, and what each trades">
<title>Where each jitter variant draws attempt four from</title>
<desc>The sampling range for the fourth retry, with a base of one second and a cap of thirty. No jitter picks the single value eight seconds, so every client that failed together retries together. Full jitter draws uniformly between zero and eight, giving the widest spread and the lowest collision rate, but it can also return a delay close to zero and hammer a receiver that has not recovered. Equal jitter draws between four and eight, guaranteeing a minimum wait of half the nominal delay at the cost of a narrower spread and therefore more collisions. Decorrelated jitter draws between the base and three times the previous delay, so at attempt four the range runs from one to roughly twenty-one seconds — wider than the others and with a floor that rises as attempts accumulate. The variants differ only in the range they sample; all four grow that range with attempt number, so the choice is about whether you care more about a guaranteed minimum wait or a maximum spread.</desc>
<rect x="0" y="0" width="760" height="244" fill="var(--fig-bg)"/>
<line x1="150" y1="196" x2="700" y2="196" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="150" y1="190" x2="150" y2="202" stroke="var(--fig-line)" stroke-width="1"/>
<line x1="288" y1="190" x2="288" y2="202" stroke="var(--fig-line)" stroke-width="1"/>
<line x1="425" y1="190" x2="425" y2="202" stroke="var(--fig-line)" stroke-width="1"/>
<line x1="563" y1="190" x2="563" y2="202" stroke="var(--fig-line)" stroke-width="1"/>
<line x1="700" y1="190" x2="700" y2="202" stroke="var(--fig-line)" stroke-width="1"/>
<text x="150" y="214" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">0 s</text>
<text x="288" y="214" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">8 s</text>
<text x="425" y="214" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">16 s</text>
<text x="563" y="214" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">24 s</text>
<text x="700" y="214" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">32 s</text>
<text x="425" y="232" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">delay drawn for attempt 4 — base 1 s, cap 30 s</text>
<text x="14" y="44" font-size="9.5" font-weight="600" fill="var(--fig-ink)">none</text>
<rect x="285" y="32" width="6" height="20" fill="var(--fig-rose-edge)"/>
<text x="300" y="46" font-size="8.5" fill="var(--fig-rose-edge)">exactly 8 s — every client together</text>
<text x="14" y="84" font-size="9.5" font-weight="600" fill="var(--fig-ink)">full</text>
<rect x="150" y="72" width="138" height="20" rx="3" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="300" y="86" font-size="8.5" fill="var(--fig-ink-soft)">U(0, 8) — widest spread, but can retry almost immediately</text>
<text x="14" y="124" font-size="9.5" font-weight="600" fill="var(--fig-ink)">equal</text>
<rect x="219" y="112" width="69" height="20" rx="3" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.2"/>
<text x="300" y="126" font-size="8.5" fill="var(--fig-ink-soft)">U(4, 8) — guaranteed minimum wait, narrower spread</text>
<text x="14" y="164" font-size="9.5" font-weight="600" fill="var(--fig-ink)">decorrelated</text>
<rect x="167" y="152" width="345" height="20" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="524" y="166" font-size="8.5" fill="var(--fig-mint-edge)">U(1, 3×prev) — widest range, rising floor</text>
</svg>
<figcaption><b>Figure 2.</b> Every variant grows its range with the attempt number; they differ only in the range they sample. Decorrelated jitter is the usual default because it gets both a wide spread and a floor that rises as attempts accumulate.</figcaption>
</figure>

2. **Retrying non-idempotent geometry writes double-applies them.** If the receiver appends the feature or bumps a version on each POST, a retry after a *successful-but-timed-out* delivery writes the geometry twice. Always attach an idempotency key and let the consumer deduplicate; the required `idempotency_key` argument above is deliberate friction to force this.

<figure class="fig">
<svg viewBox="0 0 760 216" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A successful write whose acknowledgement is lost to a timeout, and why the retry needs an idempotency key rather than a smarter classifier">
<title>The retry that cannot know whether it succeeded</title>
<desc>A client POSTs a GeoJSON feature. The receiver validates the geometry, writes it to PostGIS and commits, then the acknowledgement is lost — the connection drops, or the client's read timeout expires a moment before the response arrives. From the client's side this is indistinguishable from a request that never reached the receiver: both look like a timeout with no response, and no amount of classification logic can separate them, because the information needed is on the other side of the broken connection. Retrying appends a second copy of the feature. Attaching an idempotency key derived once and reused for every attempt moves the decision to the side that actually knows: the receiver claims the key before doing any spatial work, so the retry finds the key already claimed and returns the original result without writing again. This is why the key is a required argument rather than an optional one — a retry loop without it is correct only when nothing ever times out.</desc>
<rect x="0" y="0" width="760" height="216" fill="var(--fig-bg)"/>
<defs><marker id="jt-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="34" width="110" height="34" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="69" y="55" text-anchor="middle" font-size="9" fill="var(--fig-ink)">POST feature</text>
<line x1="126" y1="51" x2="158" y2="51" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#jt-a)"/>
<rect x="162" y="34" width="150" height="34" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="237" y="49" text-anchor="middle" font-size="9" fill="var(--fig-ink)">validated + written</text>
<text x="237" y="62" text-anchor="middle" font-size="8" fill="var(--fig-mint-edge)">committed to PostGIS</text>
<line x1="314" y1="51" x2="346" y2="51" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#jt-a)"/>
<rect x="350" y="34" width="150" height="34" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="425" y="49" text-anchor="middle" font-size="9" fill="var(--fig-ink)">ack lost</text>
<text x="425" y="62" text-anchor="middle" font-size="8" fill="var(--fig-ink-soft)">timeout fires a moment early</text>
<rect x="518" y="34" width="228" height="34" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="530" y="49" font-size="9" font-weight="600" fill="var(--fig-ink)">client sees: timeout, no response</text>
<text x="530" y="62" font-size="8" fill="var(--fig-ink-soft)">identical to "never arrived"</text>
<rect x="14" y="90" width="366" height="50" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="26" y="108" font-size="9.5" font-weight="600" fill="var(--fig-ink)">No classifier can separate these two cases</text>
<text x="26" y="125" font-size="9" fill="var(--fig-ink-soft)">The information needed is on the far side of the broken</text>
<text x="26" y="136" font-size="9" fill="var(--fig-ink-soft)">connection. Retrying appends the feature a second time.</text>
<rect x="394" y="90" width="352" height="50" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="406" y="108" font-size="9.5" font-weight="600" fill="var(--fig-ink)">The key moves the decision to the side that knows</text>
<text x="406" y="125" font-size="9" fill="var(--fig-ink-soft)">Derived once, reused for every attempt. The receiver claims</text>
<text x="406" y="136" font-size="9" fill="var(--fig-ink-soft)">it before any spatial work, so the retry returns the original.</text>
<rect x="14" y="156" width="732" height="46" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="26" y="174" font-size="10" font-weight="600" fill="var(--fig-ink)">A retry happens precisely when the client is least able to know what happened</text>
<text x="26" y="189" font-size="9" fill="var(--fig-ink-soft)">Which is why the idempotency key is a required argument rather than an optional one: a retry loop without it is</text>
<text x="26" y="199" font-size="9" fill="var(--fig-ink-soft)">correct only in a system where nothing ever times out.</text>
</svg>
<figcaption><b>Figure 3.</b> The ambiguity is structural, not a gap in the error handling — a timeout after a successful commit looks exactly like one before it. Only the receiver can resolve it, and only if you give it a key to resolve with.</figcaption>
</figure>

3. **Ignoring `Retry-After` fights the server.** A 429 or 503 often tells you exactly when to come back. Overriding that with a shorter jittered delay just earns another 429. Honour the header when present, and clamp it to a sane maximum so a hostile or buggy `Retry-After: 86400` can't wedge your worker.

4. **Using the wall clock for backoff timing.** Measure sleeps with a monotonic clock (`time.monotonic`, `loop.time`) — an NTP step during a retry can move the system clock backwards and yield a negative or huge delay. Reserve wall-clock time for the event's `observation_time`, which must be captured once at ingestion and carried unchanged so downstream ordering and out-of-order handling stay correct.

5. **`cap` above the provider deadline is a silent data-loss bug.** If your webhook provider considers a delivery failed after 60s but your `cap` lets a single sleep reach 90s, the provider gives up mid-backoff and the spatial event is lost. Keep `cap × worst-case remaining attempts` inside the delivery window, and size the two together — [tuning retry budgets for webhook provider SLAs](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/tuning-retry-budgets-for-webhook-provider-slas/) covers that math.

6. **Retrying 4xx caller errors.** A `400`/`422` from a malformed geometry (self-intersecting polygon, wrong CRS) fails identically on every attempt. Only the codes in `RETRYABLE_STATUS` should re-enter the loop; everything else raises immediately and heads to inspection.

---

## Verification

This pytest confirms the delay sequence stays within `[base, cap]` on every attempt and that the jitter actually varies (two runs are not identical). Seeding `random` makes the bounds check deterministic without fixing the values to a single sample.

```python
import random
import pytest

from your_module import RetryConfig, _decorrelated_sleep  # adjust import path


def _delay_sequence(cfg: RetryConfig, seed: int) -> list[float]:
    """Reproduce the delays the helper would sleep for, without any I/O."""
    random.seed(seed)
    delays, prev = [], cfg.base
    for _ in range(cfg.max_attempts - 1):   # last attempt never sleeps
        d = min(_decorrelated_sleep(prev, cfg), cfg.cap)
        delays.append(d)
        prev = d
    return delays


def test_delays_stay_within_bounds():
    cfg = RetryConfig(base=0.5, cap=20.0, max_attempts=8)
    for seed in range(200):                 # sample many jitter draws
        for d in _delay_sequence(cfg, seed):
            assert cfg.base <= d <= cfg.cap  # never below base, never above cap


def test_cap_is_never_exceeded_even_with_large_multiplier():
    cfg = RetryConfig(base=1.0, cap=5.0, multiplier=10.0, max_attempts=12)
    assert all(d <= cfg.cap for d in _delay_sequence(cfg, seed=7))


def test_jitter_actually_varies():
    cfg = RetryConfig(base=0.5, cap=20.0, max_attempts=8)
    # Different seeds must produce different sequences, or there is no jitter.
    assert _delay_sequence(cfg, 1) != _delay_sequence(cfg, 2)


def test_first_delay_respects_base_floor():
    cfg = RetryConfig(base=2.0, cap=30.0, max_attempts=4)
    first = _delay_sequence(cfg, seed=0)[0]
    assert first >= cfg.base
```

---

## FAQ

<details class="faq">
<summary><strong>Why add jitter instead of plain exponential backoff?</strong></summary>

Plain exponential backoff makes every failed client wait the same deterministic interval, so after a shared outage they all retry at the same instant and hammer the recovering endpoint in synchronized waves — a retry storm. Randomized (jittered) delays spread those retries across the window, smoothing load and improving overall recovery time.

</details>

<details class="faq">
<summary><strong>Is it safe to retry a GeoJSON webhook POST?</strong></summary>

Only if the operation is idempotent. Re-POSTing a payload that appends a feature or increments state will double-apply the geometry write on a retry. Attach a deterministic idempotency key so the receiver can deduplicate, and never retry non-idempotent writes blindly.

</details>

<details class="faq">
<summary><strong>How should I handle a Retry-After header?</strong></summary>

When a 429 or 503 response carries a `Retry-After` header, treat it as authoritative and sleep for that server-specified duration instead of your computed jitter for that attempt. The server knows its own recovery schedule better than your local backoff curve — just clamp the value so a pathological header can't wedge the worker.

</details>

<details class="faq">
<summary><strong>What clock should I record for observation_time versus retry timing?</strong></summary>

Use two different clocks. The event's `observation_time` is a wall-clock timestamp captured once at ingestion and carried unchanged through every retry, so downstream ordering stays correct. Retry delays should be measured with a monotonic clock (`time.monotonic` / `loop.time`) that never jumps when NTP adjusts the system clock.

</details>

---

## Related

- [Exponential Backoff & Jitter for Spatial Webhooks](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/) — parent: the full backoff-and-jitter strategy for spatial delivery
- [Tuning Retry Budgets for Webhook Provider SLAs](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/tuning-retry-budgets-for-webhook-provider-slas/) — sizing `cap`, `base`, and `max_attempts` against a provider's delivery deadline
- [Idempotent Consumers for Out-of-Order Spatial Events](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/idempotent-consumers-for-out-of-order-spatial-events/) — making the receiver safe to retry against
- [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) — deduplicating retried deliveries with a low-latency key store
