---
title: "Using Redis to Cache Spatial Webhook Signatures"
description: "Store HMAC-SHA256 hashes of geospatial webhook payloads in Redis with SET NX EX for atomic, sub-millisecond idempotency checks preventing duplicate events."
slug: "using-redis-to-cache-spatial-webhook-signatures"
type: "article"
breadcrumb:
  - label: "Idempotency & Spatial Deduplication"
    url: "/idempotency-spatial-deduplication/"
  - label: "Cache-Backed Idempotency Checks"
    url: "/idempotency-spatial-deduplication/cache-backed-idempotency-checks/"
  - label: "Using Redis to Cache Spatial Webhook Signatures"
    url: "/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/"
datePublished: "2025-01-15"
dateModified: "2026-06-24"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Using Redis to Cache Spatial Webhook Signatures",
      "description": "Step-by-step guide to storing HMAC-SHA256 hashes of geospatial webhook payloads in Redis with SET NX EX for atomic, sub-millisecond idempotency checks that prevent duplicate spatial event processing.",
      "datePublished": "2025-01-15",
      "dateModified": "2026-06-24",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Idempotency & Spatial Deduplication", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/"},
        {"@type": "ListItem", "position": 2, "name": "Cache-Backed Idempotency Checks", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/"},
        {"@type": "ListItem", "position": 3, "name": "Using Redis to Cache Spatial Webhook Signatures", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Cache Spatial Webhook Signatures in Redis",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Normalize the GeoJSON payload", "text": "Strip transient fields and round coordinates to a fixed decimal precision before hashing."},
        {"@type": "HowToStep", "position": 2, "name": "Compute HMAC-SHA256 signature", "text": "Hash the canonical payload string using your webhook secret as the HMAC key."},
        {"@type": "HowToStep", "position": 3, "name": "Run atomic SET NX EX in Redis", "text": "Use a single-command SET with NX and EX flags to claim the key only if it does not already exist."},
        {"@type": "HowToStep", "position": 4, "name": "Branch on the result", "text": "Process the event if SET returned OK; discard it as a duplicate if SET returned nil."}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What TTL should I set for Redis webhook signature keys?",
          "acceptedAnswer": {"@type": "Answer", "text": "Set SIGNATURE_TTL to 20–30% longer than your provider's maximum redelivery window. Most providers retry for 24–72 hours, so a 90,000-second (25-hour) to 259,200-second (72-hour) TTL covers the gap safely."}
        },
        {
          "@type": "Question",
          "name": "Does SET NX EX guarantee exactly-once processing under concurrent delivery?",
          "acceptedAnswer": {"@type": "Answer", "text": "Yes for a single Redis node or Cluster slot. The SET NX EX operation is atomic in Redis — only one of N concurrent callers with the same key will receive OK. The others receive nil and must discard the event."}
        },
        {
          "@type": "Question",
          "name": "Should I fail open or fail closed when Redis is unavailable?",
          "acceptedAnswer": {"@type": "Answer", "text": "Fail open (return True / proceed) for most spatial telemetry pipelines and rely on downstream database constraints for rare duplicates. Fail closed (return False / reject) only when duplicate writes have financial or regulatory consequences, then queue the payload for later reconciliation."}
        }
      ]
    }
  ]
}
</script>

**Compute an HMAC-SHA256 signature of the canonicalized GeoJSON payload, call `SET key 1 NX EX <ttl>` in Redis, and skip processing if the command returns `nil` — the entire duplicate check completes in one atomic round-trip at under 5 ms.** This how-to belongs to [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/), which is part of the wider [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) work on exactly-once semantics for geospatial event streams.

## When to Use This Pattern

Use Redis signature caching specifically when:

- Your geospatial webhook provider does not guarantee single delivery and retries on HTTP `5xx` or timeout, producing identical GeoJSON or WKT bodies milliseconds to hours apart.
- Processing latency is dominated by downstream spatial joins, PostGIS writes, or tile cache invalidations — a sub-millisecond Redis check is worth far more here than on cheap CRUD endpoints.
- You need horizontal scalability: multiple webhook receiver pods must share deduplication state without a central lock or database row-level locking overhead.

For architectures where the same event must be deduplicated across independent microservices rather than at ingress, pair this approach with an outbox pattern; Redis alone does not span transaction boundaries.

## Flow: From HTTP Ingress to Conditional Processing

The diagram below shows how a spatial webhook travels from provider delivery through signature caching to either processing or discard.

<figure class="fig">
<svg viewBox="0 46 564 160" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Spatial webhook signature caching flow: provider delivers event, receiver normalizes payload, computes HMAC, checks Redis SET NX EX, then either processes or discards the event">
  <title>Spatial webhook signature caching flow</title>
  <desc>A left-to-right flow diagram showing a webhook provider delivering to an HTTP receiver, which normalizes the GeoJSON payload, computes an HMAC-SHA256 signature, runs SET NX EX in Redis, then branches: new events go to spatial processing, duplicates are discarded with HTTP 200.</desc>
  <rect x="0" y="46" width="564" height="160" fill="var(--fig-bg)"/>
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Provider -->
  <rect x="10" y="100" width="100" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
  <text x="60" y="118" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">Webhook</text>
  <text x="60" y="133" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">Provider</text>
  <!-- Normalize -->
  <rect x="145" y="100" width="110" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
  <text x="200" y="118" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">Normalize &amp;</text>
  <text x="200" y="133" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">HMAC-SHA256</text>
  <!-- Redis -->
  <rect x="290" y="100" width="110" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
  <text x="345" y="118" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">Redis</text>
  <text x="345" y="133" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">SET NX EX</text>
  <!-- Process -->
  <rect x="440" y="60" width="110" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
  <text x="495" y="78" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">Spatial</text>
  <text x="495" y="93" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">Processing</text>
  <!-- Discard -->
  <rect x="440" y="148" width="110" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
  <text x="495" y="166" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">Discard</text>
  <text x="495" y="181" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">HTTP 200</text>
  <!-- Arrows -->
  <line x1="110" y1="122" x2="143" y2="122" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrow)" opacity="0.6"/>
  <line x1="255" y1="122" x2="288" y2="122" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrow)" opacity="0.6"/>
  <line x1="400" y1="112" x2="438" y2="88" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrow)" opacity="0.6"/>
  <line x1="400" y1="132" x2="438" y2="162" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrow)" opacity="0.6"/>
  <!-- Labels on branch arrows -->
  <text x="415" y="100" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.75">OK</text>
  <text x="415" y="148" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.75">nil</text>
</svg>
<figcaption><b>Figure 1.</b> Spatial webhook signature caching flow</figcaption>
</figure>

## Complete Runnable Implementation

The snippet below is self-contained: normalize, sign, check, and branch in one function. The `normalize_geojson` step is critical — without it, floating-point drift in coordinate arrays causes logically identical retries to produce different signatures and bypass the cache. For a deeper look at this canonicalization problem, see [Generating Deterministic Idempotency Keys for GeoJSON Events](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/generating-deterministic-idempotency-keys-for-geojson-events/).

```python
import hashlib
import hmac
import json
import os
from typing import Any

import redis
from redis.exceptions import RedisError

# ── Configuration ────────────────────────────────────────────────────────────
REDIS_URL      = os.getenv("REDIS_URL", "redis://localhost:6379/0")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "change-me")
# Set to 20–30 % above the provider's max redelivery window.
# E.g. provider retries for 24 h → use 108 000 s (30 h).
SIGNATURE_TTL  = int(os.getenv("SIGNATURE_TTL", "108000"))

# Thread-safe connection pool; socket_timeout evicts blocked calls quickly.
_redis = redis.Redis.from_url(
    REDIS_URL,
    decode_responses=True,
    socket_timeout=2,
    socket_connect_timeout=2,
)

# ── Spatial canonicalization ─────────────────────────────────────────────────
_TRANSIENT_KEYS = frozenset({"_meta", "received_at", "request_id", "delivery_attempt"})

def _round_coords(value: Any, precision: int = 6) -> Any:
    """Recursively round floats inside GeoJSON coordinate arrays (RFC 7946
    recommends 6 decimal places ≈ 0.11 m accuracy in EPSG:4326)."""
    if isinstance(value, float):
        return round(value, precision)
    if isinstance(value, list):
        return [_round_coords(v, precision) for v in value]
    if isinstance(value, dict):
        return {k: _round_coords(v, precision) for k, v in value.items()}
    return value

def normalize_geojson(payload: dict[str, Any]) -> str:
    """Return a canonical UTF-8 string suitable for deterministic hashing.

    Strips transient provider fields, rounds coordinate floats, and
    enforces sort_keys so key insertion order cannot affect the digest.
    """
    clean = {k: v for k, v in payload.items() if k not in _TRANSIENT_KEYS}
    clean = _round_coords(clean)
    # separators=(",", ":") removes all optional whitespace
    return json.dumps(clean, sort_keys=True, separators=(",", ":"))

# ── Signature computation ────────────────────────────────────────────────────
def compute_signature(canonical: str) -> str:
    """HMAC-SHA256 over the canonical payload string."""
    return hmac.new(
        WEBHOOK_SECRET.encode(),
        canonical.encode(),
        hashlib.sha256,
    ).hexdigest()

# ── Idempotency check ────────────────────────────────────────────────────────
def is_new_spatial_event(payload: dict[str, Any]) -> bool:
    """Return True if this event is new and should be processed.

    Uses a single atomic SET NX EX round-trip — no separate GET needed.
    Fails open on RedisError so a cache outage never stalls the pipeline;
    downstream spatial DB constraints remain the last-resort safety net.
    """
    canonical = normalize_geojson(payload)
    sig       = compute_signature(canonical)
    cache_key = f"swh:sig:{sig}"   # namespace prefix avoids key collisions

    try:
        # SET returns True (key was absent, now set) or None (key existed).
        result = _redis.set(cache_key, "1", nx=True, ex=SIGNATURE_TTL)
        return result is True
    except RedisError as exc:
        # Log for alerting but do not block ingestion.
        print(f"[idempotency] Redis unavailable, failing open: {exc}")
        return True

# ── Example webhook handler (FastAPI) ────────────────────────────────────────
# from fastapi import FastAPI, Request, Response
# app = FastAPI()
#
# @app.post("/webhook/spatial")
# async def receive_spatial_event(request: Request):
#     payload = await request.json()
#     if not is_new_spatial_event(payload):
#         return Response(status_code=200, content="duplicate ignored")
#     # Hand off to your spatial processing pipeline here.
#     return {"status": "accepted"}
```

## Parameter Reference

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Signature TTL against provider retry schedule, showing the window in which a redelivery is recognised">
<title>Sizing the signature TTL against the provider's retry ladder</title>
<desc>A provider's retry schedule for one failed delivery runs at one minute, five minutes, thirty minutes, two hours and finally six hours. A signature time-to-live of one hour covers the first four attempts but expires before the six-hour attempt, so that last redelivery finds no key, is treated as novel, and the feature is written a second time — the one duplicate the cache existed to prevent, arriving at the moment everyone has stopped watching. A twenty-four hour time-to-live covers the whole ladder with headroom. The cost of the longer window is memory: at roughly one hundred bytes per key, one thousand events per second held for twenty-four hours is about 8.6 gigabytes, which is a real budget line and the reason the TTL is chosen rather than simply maximised. The rule is to set it past the provider's last scheduled retry, not past its first.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<rect x="60" y="46" width="288" height="26" fill="var(--fig-gold)" opacity="0.6"/>
<text x="204" y="40" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-gold-edge)">TTL 1 h — stops here</text>
<rect x="60" y="80" width="620" height="26" fill="var(--fig-mint)" opacity="0.55"/>
<text x="370" y="98" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">TTL 24 h — covers the whole ladder</text>
<line x1="60" y1="130" x2="700" y2="130" stroke="var(--fig-line)" stroke-width="1.3"/>
<circle cx="80" cy="130" r="4" fill="var(--fig-mint-edge)"/>
<circle cx="128" cy="130" r="4" fill="var(--fig-mint-edge)"/>
<circle cx="204" cy="130" r="4" fill="var(--fig-mint-edge)"/>
<circle cx="316" cy="130" r="4" fill="var(--fig-mint-edge)"/>
<circle cx="560" cy="130" r="5.5" fill="var(--fig-rose-edge)"/>
<text x="80" y="150" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">1 min</text>
<text x="128" y="150" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">5 min</text>
<text x="204" y="150" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">30 min</text>
<text x="316" y="150" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">2 h</text>
<text x="560" y="150" text-anchor="middle" font-size="8.5" font-weight="700" fill="var(--fig-rose-edge)">6 h</text>
<text x="560" y="166" text-anchor="middle" font-size="8.5" fill="var(--fig-rose-edge)">key already expired ⇒ duplicate write</text>
<text x="700" y="120" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">provider retry ladder</text>
<rect x="14" y="182" width="366" height="40" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="26" y="199" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Too short: the duplicate arrives last, and unwatched</text>
<text x="26" y="214" font-size="9" fill="var(--fig-ink-soft)">Exactly the redelivery the cache existed to absorb slips through.</text>
<rect x="394" y="182" width="352" height="40" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="406" y="199" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Too long: memory, not correctness</text>
<text x="406" y="214" font-size="9" fill="var(--fig-ink-soft)">~100 B/key × 1,000 ev/s × 24 h ≈ 8.6 GB. Budget it deliberately.</text>
</svg>
<figcaption><b>Figure 2.</b> Set the TTL past the provider's <em>last</em> scheduled retry, not its first. The failure mode of a short TTL is a duplicate that arrives hours later, long after anyone is looking at the deploy.</figcaption>
</figure>

| Parameter | Type | Default | Spatial constraint |
|---|---|---|---|
| `REDIS_URL` | `str` | `redis://localhost:6379/0` | Use a dedicated DB index (e.g. `/1`) to isolate signature keys from application data |
| `WEBHOOK_SECRET` | `str` | *(required)* | Minimum 32 bytes of entropy; rotate via environment variable without redeploying code |
| `SIGNATURE_TTL` | `int` (seconds) | `108000` (30 h) | Must exceed provider max redelivery window; monitor `TTL` drift with Redis keyspace notifications |
| `precision` in `_round_coords` | `int` | `6` | 6 decimals ≈ 0.11 m at EPSG:4326; raise to 7–8 for sub-centimetre survey payloads |
| `cache_key` prefix | `str` | `swh:sig:` | Namespace all signature keys so you can `SCAN MATCH swh:sig:*` for monitoring |
| `socket_timeout` | `float` (seconds) | `2` | Tune down to `0.5` in latency-sensitive ingestion paths; too low causes false-positive `RedisError` on slow networks |

## Gotchas and Spatial Edge Cases

1. **Coordinate ring orientation drift.** RFC 7946 mandates counter-clockwise winding for exterior rings, but several providers (and PostGIS `ST_AsGeoJSON`) do not enforce this. Two deliveries of the same polygon with opposite winding produce different canonical strings and different signatures. Run `shapely.geometry.shape(payload["geometry"]).buffer(0)` to normalize topology before hashing when winding consistency cannot be guaranteed.

2. **Precision loss in `float` → `str` → `float` round-trips.** If your ingress framework parses JSON as Python `float` before passing to the handler, values like `-122.4194155` may already carry IEEE-754 drift. The `_round_coords` helper fixes this, but apply it after deserialization, not before — rounding the raw string is a no-op.

3. **Mixed CRS payloads colliding after normalization.** A feature in EPSG:3857 (Web Mercator) and the same feature re-projected to EPSG:4326 (WGS84) will have very different coordinate values, so they will not collide in Redis — but they *should* be treated as duplicates if they represent the same real-world event. Always normalize to a single CRS before hashing; see [Handling Mixed CRS Payloads in Python Event Handlers](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/) for a projection pipeline.

4. **Provider-added timestamp fields in the geometry.** Some IoT and drone telemetry providers embed `"timestamp"` inside the `geometry` object (non-standard GeoJSON). Extend `_TRANSIENT_KEYS` or add a recursive filter to strip these before hashing, otherwise each delivery attempt gets a unique signature and the cache is useless.

<figure class="fig">
<svg viewBox="0 0 760 236" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Provider-added fields inside the geometry object defeating the signature cache until they are stripped">
<title>One volatile field makes the whole cache useless</title>
<desc>A drone telemetry provider embeds a timestamp inside the geometry object, which standard GeoJSON does not allow. Every redelivery of the same physical observation therefore carries a different timestamp, so the canonical string differs, the signature differs, and each of the five delivery attempts claims its own Redis key. The cache hit rate is zero, every attempt runs the full spatial pipeline, and the feature is written five times. Stripping the transient keys before canonicalisation — the delivery id, the received-at header, the request id and this non-standard nested timestamp — leaves an identical byte string across all five attempts, so one key is claimed and four attempts short-circuit. The general rule is that anything the provider regenerates per delivery has to be removed recursively, including inside the geometry object, because a single volatile field anywhere in the tree defeats the entire mechanism.</desc>
<rect x="0" y="0" width="760" height="236" fill="var(--fig-bg)"/>
<defs><marker id="rx-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-rose-edge)">Hashing the payload as received</text>
<rect x="14" y="30" width="330" height="56" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="26" y="47" font-size="8.5" font-family="monospace" fill="var(--fig-ink)">"geometry": {"type": "Point",</text>
<text x="26" y="60" font-size="8.5" font-family="monospace" fill="var(--fig-ink)">  "coordinates": [13.4, 52.52],</text>
<text x="26" y="73" font-size="8.5" font-family="monospace" fill="var(--fig-rose-edge)">  "timestamp": "…T14:02:07.418Z"}</text>
<text x="26" y="84" font-size="8" fill="var(--fig-ink-soft)">non-standard, and regenerated per delivery</text>
<line x1="348" y1="58" x2="380" y2="58" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#rx-a)"/>
<rect x="384" y="30" width="164" height="56" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="466" y="48" text-anchor="middle" font-size="9" fill="var(--fig-ink)">5 attempts → 5 signatures</text>
<text x="466" y="63" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">9f2c · 41ba · c70e · 08d5 · b332</text>
<text x="466" y="78" text-anchor="middle" font-size="8.5" fill="var(--fig-rose-edge)">hit rate 0%</text>
<line x1="552" y1="58" x2="584" y2="58" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#rx-a)"/>
<rect x="588" y="30" width="158" height="56" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="667" y="53" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink)">feature written 5×</text>
<text x="667" y="69" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">full pipeline runs every time</text>
<line x1="14" y1="104" x2="746" y2="104" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="126" font-size="10.5" font-weight="600" fill="var(--fig-mint-edge)">Stripping transient keys recursively, then hashing</text>
<rect x="14" y="136" width="330" height="56" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="26" y="153" font-size="8.5" font-family="monospace" fill="var(--fig-ink)">"geometry": {"type": "Point",</text>
<text x="26" y="166" font-size="8.5" font-family="monospace" fill="var(--fig-ink)">  "coordinates": [13.4, 52.52]}</text>
<text x="26" y="182" font-size="8" fill="var(--fig-ink-soft)">delivery_id · received_at · request_id · nested timestamp — all gone</text>
<line x1="348" y1="164" x2="380" y2="164" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#rx-a)"/>
<rect x="384" y="136" width="164" height="56" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="466" y="158" text-anchor="middle" font-size="9" fill="var(--fig-ink)">5 attempts → 1 signature</text>
<text x="466" y="176" text-anchor="middle" font-size="8.5" fill="var(--fig-mint-edge)">hit rate 80%</text>
<line x1="552" y1="164" x2="584" y2="164" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#rx-a)"/>
<rect x="588" y="136" width="158" height="56" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="667" y="159" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink)">feature written once</text>
<text x="667" y="175" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">4 attempts short-circuit</text>
<rect x="14" y="204" width="732" height="26" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="26" y="221" font-size="9.5" fill="var(--fig-ink)">The strip has to recurse: a volatile field anywhere in the tree, including inside geometry, defeats the whole mechanism.</text>
</svg>
<figcaption><b>Figure 3.</b> A zero hit rate looks like a Redis problem and is almost always a canonicalisation problem. Log a sample canonical string when the hit rate is unexpectedly low — the offending field is usually visible immediately.</figcaption>
</figure>

5. **Redis Cluster hash slot boundary for key distribution.** In Redis Cluster mode, all `swh:sig:*` keys hash to different slots based on the full key, distributing evenly. This is correct behaviour for signature caching. Do not add a hash tag (`{swh}`) unless you need multi-key transactions on the same slot — and there are none here.

6. **TTL shorter than the delivery retry window.** If `SIGNATURE_TTL` expires before the provider stops retrying, the Redis key disappears and the duplicate is processed again. Always add a buffer of at least 30 % above the provider's stated retry window, and monitor `OBJECT IDLETIME` on sample keys.

## Minimal Verification Snippet

Run this against a local Redis instance to confirm the atomic check-and-set behaves correctly for both new events and retries:

```python
import pytest
from unittest.mock import patch, MagicMock

# Isolate the module under test from a live Redis connection.
from your_module import is_new_spatial_event

SAMPLE_PAYLOAD = {
    "type": "Feature",
    "geometry": {"type": "Point", "coordinates": [-122.4194155, 37.7749295]},
    "properties": {"sensor_id": "gps-42"},
}

def _make_redis_mock(set_returns):
    mock = MagicMock()
    mock.set.side_effect = set_returns
    return mock

def test_new_event_returns_true():
    with patch("your_module._redis", _make_redis_mock([True])):
        assert is_new_spatial_event(SAMPLE_PAYLOAD) is True

def test_duplicate_event_returns_false():
    # First call claims the key; second call returns None (key already exists).
    with patch("your_module._redis", _make_redis_mock([True, None])):
        assert is_new_spatial_event(SAMPLE_PAYLOAD) is True
        assert is_new_spatial_event(SAMPLE_PAYLOAD) is False

def test_transient_fields_stripped_before_hashing():
    """Events identical except for 'received_at' must map to the same key."""
    payload_a = {**SAMPLE_PAYLOAD, "received_at": "2026-01-01T00:00:00Z"}
    payload_b = {**SAMPLE_PAYLOAD, "received_at": "2026-01-01T00:05:00Z"}
    with patch("your_module._redis", _make_redis_mock([True, None])):
        assert is_new_spatial_event(payload_a) is True
        assert is_new_spatial_event(payload_b) is False  # same spatial content

def test_redis_unavailable_fails_open():
    from redis.exceptions import RedisError
    mock = MagicMock()
    mock.set.side_effect = RedisError("connection refused")
    with patch("your_module._redis", mock):
        # Fail-open: event must be processed even when Redis is down.
        assert is_new_spatial_event(SAMPLE_PAYLOAD) is True
```

## Frequently Asked Questions

### What TTL should I set for Redis webhook signature keys?

Set `SIGNATURE_TTL` to 20–30% longer than your provider's maximum redelivery window. Most spatial webhook providers retry for 24–72 hours, so a 90,000-second (25-hour) to 259,200-second (72-hour) TTL covers the redelivery gap without holding signatures longer than necessary. Anything shorter risks the key expiring while the provider is still retrying, which lets a duplicate slip through.

### Does `SET NX EX` guarantee exactly-once processing under concurrent delivery?

Yes, for a single Redis node or a single Cluster slot. The `SET ... NX EX` operation is atomic in Redis — when N concurrent receivers race with the same signature, exactly one receives `OK` and the rest receive `nil`. The losers must discard their copy of the event. This is what makes the pattern safe even when several webhook receiver pods process the same retry storm simultaneously.

### Should I fail open or fail closed when Redis is unavailable?

Fail open (proceed with processing) for most spatial telemetry pipelines, and rely on downstream PostGIS unique constraints to absorb the rare duplicate that gets through during a cache outage. Fail closed (reject the delivery) only when duplicate writes carry financial or regulatory weight — and in that case, queue the rejected payload for later reconciliation rather than dropping it.

---

## Related

- [Cache-Backed Idempotency Checks for Geospatial Webhooks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) — parent: the full pipeline from ingestion to conditional execution
- [Generating Deterministic Idempotency Keys for GeoJSON Events](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/generating-deterministic-idempotency-keys-for-geojson-events/) — deep dive on BLAKE2b vs SHA-256 and recursive float normalization
- [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — architectural overview of exactly-once semantics for geospatial event streams
