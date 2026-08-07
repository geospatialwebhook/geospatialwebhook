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
