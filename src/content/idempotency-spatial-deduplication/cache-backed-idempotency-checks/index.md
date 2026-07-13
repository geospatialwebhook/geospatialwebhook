---
title: "Cache-Backed Idempotency Checks for Geospatial Webhooks"
description: "Implement Redis-backed idempotency checks for geospatial webhooks: key derivation, atomic cache operations, spatial normalization, and graceful degradation."
slug: "cache-backed-idempotency-checks"
type: "guide"
breadcrumb: "Idempotency & Spatial Deduplication > Cache-Backed Idempotency Checks"
datePublished: "2024-11-01"
dateModified: "2026-06-24"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Cache-Backed Idempotency Checks for Geospatial Webhooks",
      "description": "Step-by-step guide to implementing Redis-backed idempotency checks for geospatial webhook pipelines: key derivation, atomic cache operations, spatial normalization, and graceful degradation under real-world delivery failures.",
      "datePublished": "2024-11-01",
      "dateModified": "2026-06-24",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Idempotency & Spatial Deduplication", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/"},
        {"@type": "ListItem", "position": 3, "name": "Cache-Backed Idempotency Checks", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Implement cache-backed idempotency for geospatial webhooks",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Validate and normalise the incoming spatial payload"},
        {"@type": "HowToStep", "position": 2, "name": "Derive a deterministic idempotency key from the geometry"},
        {"@type": "HowToStep", "position": 3, "name": "Perform an atomic SET NX EX cache check"},
        {"@type": "HowToStep", "position": 4, "name": "Route to processing or short-circuit on duplicate"},
        {"@type": "HowToStep", "position": 5, "name": "Handle failures and configure fallback deduplication"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does floating-point drift break exact-match cache lookups for spatial webhooks?",
          "acceptedAnswer": {"@type": "Answer", "text": "GPS and sensor hardware encode coordinates as IEEE 754 doubles. Serialising, deserialising, and re-serialising those values through different JSON parsers or projection libraries can shift the least-significant bits even when the physical location is unchanged. Normalising to a fixed decimal precision before hashing eliminates this drift and ensures identical real-world positions produce identical cache keys."}
        },
        {
          "@type": "Question",
          "name": "What TTL should I set on idempotency keys for geospatial webhooks?",
          "acceptedAnswer": {"@type": "Answer", "text": "Match your TTL to the upstream provider's maximum retry window plus a 50% safety buffer. If your webhook provider retries for up to 48 hours, set a 72-hour TTL. For IoT telemetry streams that retry for minutes, a 15-minute TTL is sufficient and avoids unnecessarily consuming Redis memory."}
        },
        {
          "@type": "Question",
          "name": "Can I use an in-process LRU cache instead of Redis for idempotency?",
          "acceptedAnswer": {"@type": "Answer", "text": "Only in single-process deployments. The moment you run multiple webhook worker replicas, each process has its own in-process cache and duplicates flow through undetected. Redis or another distributed cache is required for horizontal scale. For multi-region deployments, consider Redis Cluster with consistent hashing."}
        },
        {
          "@type": "Question",
          "name": "What happens if the Redis connection drops mid-request?",
          "acceptedAnswer": {"@type": "Answer", "text": "Implement a fallback to a lightweight database UNIQUE constraint (e.g., a PostgreSQL unique index on event_id). Log every cache bypass as a warning metric so you can distinguish planned degradation from infrastructure failure. Never silently drop events — prefer processing a duplicate once over losing a real event."}
        }
      ]
    }
  ]
}
</script>

**A distributed cache storing a hash of each spatial payload's normalised geometry provides sub-millisecond duplicate detection across any number of webhook worker replicas, preventing double-execution of expensive spatial joins, tile regenerations, and database mutations.**

This topic is part of [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/), the broader discipline of ensuring geospatial event pipelines process every webhook exactly once regardless of upstream retry behaviour.

---

## Prerequisites

Before implementing this pattern, confirm your stack meets the following baseline. Check off each item as you verify it:

- [ ] **Python 3.10+** — required for structural pattern matching in geometry type dispatch
- [ ] **`redis-py` 5.0+** — the async client (`redis.asyncio`) is needed for FastAPI / aiohttp integration
- [ ] **`shapely` 2.0+** — used for geometry normalisation and ring-orientation enforcement
- [ ] **`pyproj` 3.6+** — required if incoming payloads may arrive in a CRS other than EPSG:4326
- [ ] **`pydantic` 2.x** — strict schema validation before any cache interaction
- [ ] **Redis 6.2+** (or Valkey / KeyDB) — `SET NX EX` atomicity and AOF/RDB persistence required
- [ ] **Webhook receiver** capable of sub-100 ms responses under concurrent load

---

## Architecture Overview

The pipeline enforces a strict order: normalise first, hash second, look up third. No spatial computation occurs until the cache confirms the event is new.

<svg viewBox="0 0 760 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cache-backed idempotency pipeline for geospatial webhooks" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>Cache-backed idempotency pipeline</title>
  <desc>Data-flow diagram showing the five stages from webhook ingestion through cache check to conditional spatial processing, with a short-circuit path for duplicates.</desc>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Stage boxes -->
  <!-- 1: Ingest -->
  <rect x="10" y="100" width="110" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="65" y="124" text-anchor="middle" font-size="11" fill="currentColor" font-family="inherit" font-weight="600">Webhook</text>
  <text x="65" y="140" text-anchor="middle" font-size="10" fill="currentColor" font-family="inherit" opacity="0.8">Ingestion</text>
  <text x="65" y="154" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.6">Schema validation</text>
  <!-- Arrow 1→2 -->
  <line x1="122" y1="130" x2="148" y2="130" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)" opacity="0.55"/>
  <!-- 2: Normalise -->
  <rect x="150" y="100" width="120" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="210" y="124" text-anchor="middle" font-size="11" fill="currentColor" font-family="inherit" font-weight="600">Spatial</text>
  <text x="210" y="140" text-anchor="middle" font-size="10" fill="currentColor" font-family="inherit" opacity="0.8">Normalisation</text>
  <text x="210" y="154" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.6">Precision · CRS · rings</text>
  <!-- Arrow 2→3 -->
  <line x1="272" y1="130" x2="298" y2="130" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)" opacity="0.55"/>
  <!-- 3: Key derive -->
  <rect x="300" y="100" width="120" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="360" y="124" text-anchor="middle" font-size="11" fill="currentColor" font-family="inherit" font-weight="600">Key</text>
  <text x="360" y="140" text-anchor="middle" font-size="10" fill="currentColor" font-family="inherit" opacity="0.8">Derivation</text>
  <text x="360" y="154" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.6">v1:sha256:…</text>
  <!-- Arrow 3→4 -->
  <line x1="422" y1="130" x2="448" y2="130" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)" opacity="0.55"/>
  <!-- 4: Cache -->
  <rect x="450" y="100" width="120" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="510" y="124" text-anchor="middle" font-size="11" fill="currentColor" font-family="inherit" font-weight="600">Redis</text>
  <text x="510" y="140" text-anchor="middle" font-size="10" fill="currentColor" font-family="inherit" opacity="0.8">SET NX EX</text>
  <text x="510" y="154" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.6">Atomic check-and-claim</text>
  <!-- Arrow 4→5 (HIT path, go to duplicate label) -->
  <line x1="510" y1="100" x2="510" y2="55" stroke="currentColor" stroke-width="1.2" marker-end="url(#arr)" opacity="0.45" stroke-dasharray="4,3"/>
  <text x="520" y="48" font-size="9" fill="currentColor" font-family="inherit" opacity="0.65">HIT → 200 OK (skip)</text>
  <!-- Arrow 4→5 (MISS path) -->
  <line x1="572" y1="130" x2="598" y2="130" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)" opacity="0.55"/>
  <text x="578" y="122" font-size="9" fill="currentColor" font-family="inherit" opacity="0.65">MISS</text>
  <!-- 5: Process -->
  <rect x="600" y="100" width="148" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="674" y="124" text-anchor="middle" font-size="11" fill="currentColor" font-family="inherit" font-weight="600">Spatial</text>
  <text x="674" y="140" text-anchor="middle" font-size="10" fill="currentColor" font-family="inherit" opacity="0.8">Processing</text>
  <text x="674" y="154" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.6">Joins · tiles · DB writes</text>
  <!-- Stage labels -->
  <text x="65" y="92" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.5">① INGEST</text>
  <text x="210" y="92" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.5">② NORMALISE</text>
  <text x="360" y="92" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.5">③ HASH</text>
  <text x="510" y="92" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.5">④ DEDUPLICATE</text>
  <text x="674" y="92" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.5">⑤ PROCESS</text>
</svg>

**Layer breakdown:**

1. **Ingestion** — Pydantic validates schema and rejects `400 Bad Request` before any cache touch.
2. **Spatial normalisation** — coordinates rounded to a fixed decimal precision, exterior rings enforced counter-clockwise, non-deterministic metadata stripped.
3. **Key derivation** — SHA-256 over normalised geometry plus a stable business identifier, prefixed with a schema version.
4. **Cache check** — Redis `SET NX EX` atomically claims the key; a hit short-circuits the response; a miss proceeds to step five.
5. **Spatial processing** — the real work: spatial joins, tile invalidation via [Tile Update Event Pipelines](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/), database mutations, and downstream dispatch.

---

## Step-by-Step Implementation

### Step 1 — Validate the Incoming Payload

Reject invalid GeoJSON before touching the idempotency layer. Early rejection prevents cache pollution from malformed events and keeps error-rate metrics clean.

```python
from pydantic import BaseModel, field_validator, model_validator
from typing import Any, Literal


class GeometryModel(BaseModel):
    type: Literal["Point", "LineString", "Polygon", "MultiPolygon",
                  "MultiLineString", "MultiPoint", "GeometryCollection"]
    coordinates: Any  # validated structurally below

    @field_validator("coordinates")
    @classmethod
    def coords_not_empty(cls, v: Any) -> Any:
        if not v:
            raise ValueError("coordinates must not be empty")
        return v


class SpatialWebhookPayload(BaseModel):
    event_id: str
    device_id: str
    # CRS defaults to EPSG:4326 (WGS 84) per RFC 7946
    crs: str = "EPSG:4326"
    geometry: GeometryModel
    event_type: str

    @model_validator(mode="after")
    def reject_unsupported_crs(self) -> "SpatialWebhookPayload":
        supported = {"EPSG:4326", "CRS84"}
        if self.crs not in supported:
            raise ValueError(
                f"CRS {self.crs!r} not supported; normalise to EPSG:4326 upstream"
            )
        return self
```

Return `422 Unprocessable Entity` (FastAPI default) or `400 Bad Request` on Pydantic validation errors. Do not propagate the error into the idempotency layer.

---

### Step 2 — Normalise the Spatial Payload

Raw sensor data carries floating-point representation drift. Two payloads encoding the same physical boundary may differ at the 12th decimal place. Normalisation collapses that drift to a stable byte representation.

```python
import json
from shapely.geometry import shape, mapping
from shapely.validation import make_valid


def normalise_geometry(raw_geometry: dict, precision: int = 7) -> dict:
    """
    Round all coordinates to `precision` decimal places (~1.1 cm at the equator
    for precision=7) and enforce CCW exterior ring orientation.
    Returns a canonical __geo_interface__ dict suitable for deterministic hashing.
    """
    geom = shape(raw_geometry)

    # Repair self-intersections introduced by coordinate rounding
    if not geom.is_valid:
        geom = make_valid(geom)

    def _round_coords(coords: list) -> list:
        if isinstance(coords[0], (int, float)):
            return [round(c, precision) for c in coords]
        return [_round_coords(ring) for ring in coords]

    raw = mapping(geom)
    rounded = {**raw, "coordinates": _round_coords(list(raw["coordinates"]))}

    # Sort keys for deterministic JSON serialisation
    return json.dumps(rounded, sort_keys=True)
```

Precision 7 gives ~1.1 cm resolution at the equator (EPSG:4326), which is sufficient for drone telemetry and parcel boundary deduplication. For sub-centimetre sensor grids, use precision 8 (~1.1 mm). The approach to normalising coordinates across mixed-CRS payloads is covered in depth in [CRS Normalisation Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/).

---

### Step 3 — Derive a Deterministic Idempotency Key

The key must encode both the geometry and a stable business identifier so that the same geometry arriving from two different sensors does not collapse into a single key.

```python
import hashlib


def derive_idempotency_key(payload: SpatialWebhookPayload) -> str:
    """
    Produces a versioned, collision-resistant key of the form:
      idem:v1:<sha256-hex>

    The version prefix (v1) allows rolling key-schema changes without
    collisions during migration windows. See the Event Key Generation
    notes below for multi-polygon identifier strategies.
    """
    normalised_geom = normalise_geometry(payload.geometry.model_dump())
    composite = f"{payload.device_id}:{payload.event_type}:{normalised_geom}"
    digest = hashlib.sha256(composite.encode("utf-8")).hexdigest()
    return f"idem:v1:{digest}"
```

Prefix with `idem:v1:` so you can scan and audit idempotency keys in Redis independently of other key namespaces. When the normalisation algorithm changes (e.g., you upgrade the precision from 7 to 8), increment to `v2` and run both versions in parallel during the migration window.

Detailed strategies for handling multi-polygon edge cases, provider-specific business identifiers, and key versioning are covered in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/).

---

### Step 4 — Atomic Cache Check and Claim

`SET NX EX` is the only safe primitive here. A naive `GET` followed by `SET` creates a race condition where two concurrent duplicate payloads both see a miss, both proceed, and the spatial computation runs twice.

```python
import redis.asyncio as aioredis
from fastapi import FastAPI, Request, Response
import logging

logger = logging.getLogger(__name__)
app = FastAPI()


async def check_and_claim(
    client: aioredis.Redis,
    key: str,
    ttl_seconds: int = 259_200,  # 72 hours: covers a 48-hour upstream retry window
) -> bool:
    """
    Atomically claim the key. Returns True if this worker is the first to
    see this event (key was absent). Returns False if the event is a duplicate
    (key was already present).
    """
    acquired = await client.set(key, "processing", nx=True, ex=ttl_seconds)
    return bool(acquired)


async def release_on_failure(client: aioredis.Redis, key: str) -> None:
    """Delete the key so legitimate retries can proceed after a processing error."""
    await client.delete(key)
    logger.warning("idempotency key released after processing failure: %s", key)


@app.post("/webhook/spatial")
async def receive_spatial_webhook(request: Request) -> Response:
    body = await request.json()

    try:
        payload = SpatialWebhookPayload.model_validate(body)
    except Exception as exc:
        return Response(content=str(exc), status_code=400)

    key = derive_idempotency_key(payload)
    redis_client: aioredis.Redis = request.app.state.redis

    is_new = await check_and_claim(redis_client, key)
    if not is_new:
        logger.info("duplicate spatial event short-circuited: %s", key)
        return Response(status_code=200, content="duplicate")

    try:
        await process_spatial_event(payload)
        return Response(status_code=202, content="accepted")
    except Exception:
        await release_on_failure(redis_client, key)
        raise
```

The `ttl_seconds=259_200` default covers a 72-hour window. Adjust downward for IoT streams with 15-minute retry windows to avoid Redis memory bloat.

---

### Step 5 — Spatial Validation and Error Handling

Geometry that passes JSON schema validation can still be topologically invalid. Validate before any spatial indexing or database write.

```python
from shapely.geometry import shape
from shapely.validation import explain_validity


def validate_topology(raw_geometry: dict) -> None:
    """
    Raise ValueError with a human-readable explanation if the geometry
    is topologically invalid (self-intersecting rings, duplicate vertices, etc.).
    Call this after normalisation, before any spatial join or DB write.
    """
    geom = shape(raw_geometry)
    if not geom.is_valid:
        reason = explain_validity(geom)
        raise ValueError(f"Invalid geometry topology: {reason}")
    if geom.is_empty:
        raise ValueError("Geometry is empty after normalisation")


async def process_spatial_event(payload: SpatialWebhookPayload) -> None:
    raw_geom = payload.geometry.model_dump()
    validate_topology(raw_geom)

    # Safe to proceed: geometry is valid and this event is confirmed new
    normalised = normalise_geometry(raw_geom)
    # ... spatial joins, tile invalidation, DB mutations
```

Topology failures after normalisation are rare but real — they commonly arise from self-intersecting polygon rings in sensor exports or from aggressive coordinate rounding on near-degenerate geometries. Treat them as `422` errors and log the geometry digest for debugging.

---

## Retry, Backoff, and Delivery Guarantees

Cache-backed idempotency shifts the delivery guarantee from at-least-once to effectively-once, but only when combined with sensible retry configuration on the consumer side.

```python
import asyncio
import random


async def dispatch_with_backoff(
    client: aioredis.Redis,
    payload: SpatialWebhookPayload,
    max_attempts: int = 5,
    base_delay: float = 0.5,
) -> None:
    """
    Retry the full pipeline (including idempotency check) with exponential
    backoff and full jitter. Because the cache key is released on failure,
    legitimate retries will re-acquire the key and re-attempt processing.
    Duplicate retries caused by the upstream provider will be filtered by
    the existing cache entry from the first successful claim.
    """
    for attempt in range(1, max_attempts + 1):
        try:
            key = derive_idempotency_key(payload)
            is_new = await check_and_claim(client, key)
            if not is_new:
                return  # upstream duplicate — already processed
            await process_spatial_event(payload)
            return
        except Exception as exc:
            if attempt == max_attempts:
                raise
            # Full jitter: randomise within [0, base * 2^attempt]
            delay = random.uniform(0, base_delay * (2 ** attempt))
            logger.warning(
                "Attempt %d/%d failed (%s); retrying in %.2fs",
                attempt, max_attempts, exc, delay,
            )
            await asyncio.sleep(delay)
```

**At-least-once vs. exactly-once tradeoffs:**

| Guarantee | Mechanism | Risk for spatial workloads |
|-----------|-----------|---------------------------|
| At-least-once | Retry on any failure, no deduplication | Duplicate spatial joins corrupt analytics; tile cache regenerated twice per event |
| Effectively-once | Cache-backed idempotency (`SET NX EX`) | Cache eviction or partition can let one duplicate through per eviction event |
| Exactly-once | Distributed transaction + two-phase commit | High latency; rarely justified for spatial ingestion pipelines |

For most geospatial webhook pipelines, effectively-once with a database-level UNIQUE constraint fallback is the right tradeoff. True exactly-once requires a distributed transaction coordinator and adds significant latency to every event.

The at-least-once delivery model and its interaction with spatial state are explored in detail in [Implementing At-Least-Once Delivery for GIS Webhooks](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/).

---

## Fallback When the Cache Is Unavailable

A Redis connection failure must not silently drop valid events. Implement a two-tier fallback: the distributed cache is the fast path, and a database UNIQUE constraint is the durable safety net that catches duplicates whenever the cache is unreachable.

<svg viewBox="0 0 720 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Two-tier idempotency fallback decision flow from Redis to a PostgreSQL unique constraint" style="width:100%;max-width:720px;height:auto;display:block;margin:1.5rem auto;">
  <title>Two-tier idempotency fallback decision flow</title>
  <desc>Decision diagram: a request first attempts an atomic Redis claim; on a Redis connection error it falls back to a PostgreSQL insert with an ON CONFLICT clause, and in both tiers a hit short-circuits as a duplicate while a miss proceeds to spatial processing.</desc>
  <defs>
    <marker id="fb-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Event in -->
  <rect x="14" y="120" width="120" height="50" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="74" y="142" text-anchor="middle" font-size="11" fill="currentColor" font-family="inherit" font-weight="600">Validated</text>
  <text x="74" y="157" text-anchor="middle" font-size="10" fill="currentColor" font-family="inherit" opacity="0.8">event</text>
  <line x1="136" y1="145" x2="166" y2="145" stroke="currentColor" stroke-width="1.5" marker-end="url(#fb-arr)" opacity="0.55"/>
  <!-- Redis tier (diamond) -->
  <polygon points="245,110 320,145 245,180 170,145" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
  <text x="245" y="142" text-anchor="middle" font-size="10" fill="currentColor" font-family="inherit" font-weight="600">Redis</text>
  <text x="245" y="156" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.75">SET NX EX?</text>
  <!-- Redis reachable: MISS -> process -->
  <line x1="320" y1="145" x2="560" y2="145" stroke="currentColor" stroke-width="1.5" marker-end="url(#fb-arr)" opacity="0.55"/>
  <text x="440" y="137" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.65">claimed (MISS) → proceed</text>
  <!-- Redis reachable: HIT -> duplicate -->
  <line x1="245" y1="110" x2="245" y2="62" stroke="currentColor" stroke-width="1.2" marker-end="url(#fb-arr)" opacity="0.45" stroke-dasharray="4,3"/>
  <text x="245" y="52" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.65">key exists (HIT) → 200 duplicate</text>
  <!-- Redis unreachable -> DB tier -->
  <line x1="245" y1="180" x2="245" y2="222" stroke="currentColor" stroke-width="1.5" marker-end="url(#fb-arr)" opacity="0.55"/>
  <text x="255" y="205" font-size="9" fill="currentColor" font-family="inherit" opacity="0.65">ConnectionError / Timeout</text>
  <!-- DB tier (diamond) -->
  <polygon points="245,222 320,255 245,288 170,255" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
  <text x="245" y="252" text-anchor="middle" font-size="10" fill="currentColor" font-family="inherit" font-weight="600">Postgres</text>
  <text x="245" y="266" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.75">ON CONFLICT?</text>
  <!-- DB inserted -> process -->
  <line x1="320" y1="255" x2="500" y2="255" stroke="currentColor" stroke-width="1.5" marker-end="url(#fb-arr)" opacity="0.55"/>
  <line x1="500" y1="255" x2="500" y2="170" stroke="currentColor" stroke-width="1.5" marker-end="url(#fb-arr)" opacity="0.55"/>
  <text x="410" y="247" text-anchor="middle" font-size="9" fill="currentColor" font-family="inherit" opacity="0.65">inserted → proceed</text>
  <!-- DB conflict -> duplicate -->
  <line x1="170" y1="255" x2="120" y2="255" stroke="currentColor" stroke-width="1.2" marker-end="url(#fb-arr)" opacity="0.45" stroke-dasharray="4,3"/>
  <text x="115" y="247" text-anchor="end" font-size="9" fill="currentColor" font-family="inherit" opacity="0.65">conflict → duplicate</text>
  <!-- Process box -->
  <rect x="560" y="120" width="146" height="50" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="633" y="142" text-anchor="middle" font-size="11" fill="currentColor" font-family="inherit" font-weight="600">Spatial</text>
  <text x="633" y="157" text-anchor="middle" font-size="10" fill="currentColor" font-family="inherit" opacity="0.8">processing</text>
</svg>

```python
from contextlib import asynccontextmanager
import asyncpg  # or your preferred async Postgres driver


async def idempotency_check_with_fallback(
    redis_client: aioredis.Redis,
    pg_pool: asyncpg.Pool,
    payload: SpatialWebhookPayload,
    ttl_seconds: int = 259_200,
) -> bool:
    """
    Primary: Redis SET NX EX.
    Fallback: PostgreSQL unique constraint on (device_id, event_digest).
    Returns True if this call should proceed with processing.
    """
    key = derive_idempotency_key(payload)

    try:
        return await check_and_claim(redis_client, key, ttl_seconds)
    except (aioredis.ConnectionError, aioredis.TimeoutError) as exc:
        logger.warning("Redis unavailable, falling back to DB idempotency: %s", exc)

    # Fallback: insert-or-ignore into the DB idempotency table
    digest = key.split(":")[-1]  # strip the version prefix
    try:
        await pg_pool.execute(
            """
            INSERT INTO spatial_event_log (device_id, event_digest, received_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (device_id, event_digest) DO NOTHING
            """,
            payload.device_id,
            digest,
        )
        return True  # optimistic: proceed if insert succeeded
    except asyncpg.UniqueViolationError:
        return False  # genuine duplicate caught by DB constraint
```

This two-tier approach is consistent with the conflict resolution patterns described in [Conflict Resolution Strategies](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/).

For near-duplicate events that pass exact-match deduplication (e.g., two sensor readings of the same boundary with minor calibration drift), the next line of defence is [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/), which uses geometric similarity scoring rather than hash equality.

---

## Verification

Confirm the pipeline end-to-end with a pytest integration test against a real (or containerised) Redis instance:

```python
import pytest
import redis.asyncio as aioredis
import asyncio


@pytest.fixture
async def redis_client():
    client = aioredis.from_url("redis://localhost:6379/15")  # test DB
    yield client
    await client.flushdb()  # clean up after each test
    await client.aclose()


SAMPLE_PAYLOAD = {
    "event_id": "evt-001",
    "device_id": "drone-42",
    "crs": "EPSG:4326",
    "event_type": "boundary_update",
    "geometry": {
        "type": "Polygon",
        "coordinates": [
            [[-0.1276, 51.5074], [-0.1277, 51.5075],
             [-0.1275, 51.5075], [-0.1276, 51.5074]]
        ],
    },
}


@pytest.mark.asyncio
async def test_first_event_is_claimed(redis_client):
    payload = SpatialWebhookPayload.model_validate(SAMPLE_PAYLOAD)
    key = derive_idempotency_key(payload)
    assert await check_and_claim(redis_client, key, ttl_seconds=60) is True


@pytest.mark.asyncio
async def test_duplicate_event_is_rejected(redis_client):
    payload = SpatialWebhookPayload.model_validate(SAMPLE_PAYLOAD)
    key = derive_idempotency_key(payload)
    await check_and_claim(redis_client, key, ttl_seconds=60)  # first claim
    assert await check_and_claim(redis_client, key, ttl_seconds=60) is False


@pytest.mark.asyncio
async def test_concurrent_duplicates_only_one_claimed(redis_client):
    payload = SpatialWebhookPayload.model_validate(SAMPLE_PAYLOAD)
    key = derive_idempotency_key(payload)

    results = await asyncio.gather(
        check_and_claim(redis_client, key, ttl_seconds=60),
        check_and_claim(redis_client, key, ttl_seconds=60),
        check_and_claim(redis_client, key, ttl_seconds=60),
    )
    assert results.count(True) == 1, "Exactly one concurrent claim should succeed"


@pytest.mark.asyncio
async def test_floating_point_drift_same_key(redis_client):
    """Payload with minor coordinate drift must produce the same cache key."""
    payload_a = dict(SAMPLE_PAYLOAD)
    payload_b = dict(SAMPLE_PAYLOAD)
    payload_b["geometry"] = {
        "type": "Polygon",
        "coordinates": [
            [[-0.12760001, 51.50740001], [-0.12770001, 51.50750001],
             [-0.12750001, 51.50750001], [-0.12760001, 51.50740001]]
        ],
    }
    key_a = derive_idempotency_key(SpatialWebhookPayload.model_validate(payload_a))
    key_b = derive_idempotency_key(SpatialWebhookPayload.model_validate(payload_b))
    assert key_a == key_b, "Sub-precision drift must not produce different keys"
```

Run with `pytest -v --asyncio-mode=auto`. The final test confirms the normalisation step is actually collapsing floating-point drift — without it, the last assertion will fail and you will have a silent deduplication gap in production.

For Redis configuration detail — including eviction policies, AOF persistence settings, and memory footprint estimates at scale — see [Using Redis to Cache Spatial Webhook Signatures](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/).

---

## Troubleshooting

<div style="overflow-x:auto;">

| Symptom | Likely spatial cause | Fix |
|---------|----------------------|-----|
| Duplicate events reaching the spatial processing step | Floating-point drift producing different keys for same geometry | Verify `normalise_geometry` rounds to consistent precision; add the drift test above |
| Cache miss rate spike after provider update | Provider changed coordinate precision or serialisation order | Re-run the normalisation audit; check whether `sort_keys=True` is applied before hashing |
| Redis memory growing faster than expected | TTL set longer than upstream retry window; full payloads accidentally cached | Store only the key + `"processing"` status string; lower TTL to match actual retry SLA |
| `make_valid` silently discards polygon vertices | Near-degenerate geometry collapses after rounding | Log the geometry digest before and after `make_valid`; alert on area-change above threshold |
| Fallback DB constraint never fires | Postgres `ON CONFLICT` clause targets wrong columns | Confirm the UNIQUE index covers `(device_id, event_digest)` exactly as the INSERT writes |
| Concurrent workers each claim the key | Using `GET` + `SET` instead of `SET NX EX` | Replace all two-step checks with a single atomic `SET NX EX` — never split the check and set |
| Key disappears before processing completes | TTL too short for slow spatial join workloads | Extend TTL or use a `KEEPTTL` refresh on processing start |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Why does floating-point drift break exact-match cache lookups for spatial webhooks?</strong></summary>

GPS and sensor hardware encode coordinates as IEEE 754 doubles. Serialising, deserialising, and re-serialising those values through different JSON parsers or projection libraries can shift the least-significant bits even when the physical location is unchanged. Normalising to a fixed decimal precision before hashing eliminates this drift and ensures identical real-world positions produce identical cache keys.

</details>

<details class="faq">
<summary><strong>What TTL should I set on idempotency keys for geospatial webhooks?</strong></summary>

Match your TTL to the upstream provider's maximum retry window plus a 50% safety buffer. If your webhook provider retries for up to 48 hours, set a 72-hour TTL. For IoT telemetry streams that retry for minutes, a 15-minute TTL is sufficient and avoids unnecessarily consuming Redis memory. Do not use `PERSIST` (no-TTL) keys: a deployment bug or schema migration can leave zombie keys that permanently block legitimate event replay.

</details>

<details class="faq">
<summary><strong>Can I use an in-process LRU cache instead of Redis for idempotency?</strong></summary>

Only in single-process deployments. The moment you run multiple webhook worker replicas, each process has its own in-process cache and duplicates flow through undetected. Redis or another distributed cache is required for horizontal scale. For multi-region deployments, consider Redis Cluster with consistent hashing to avoid hot-key concentration during regional webhook spikes.

</details>

<details class="faq">
<summary><strong>What happens if the Redis connection drops mid-request?</strong></summary>

Implement a fallback to a lightweight database UNIQUE constraint as shown above. Log every cache bypass as a warning metric so you can distinguish planned degradation from infrastructure failure. Never silently drop events — prefer processing a duplicate once over losing a real event. The at-least-once guarantee is the safer floor; the exactly-once optimisation is layered on top via cache.

</details>

---

## Related

- [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — the parent section covering the full deduplication strategy for geospatial pipelines
- [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — deterministic key derivation strategies, versioning, and multi-polygon identifier design
- [Using Redis to Cache Spatial Webhook Signatures](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/) — Redis configuration, eviction policies, and persistence settings for idempotency workloads
- [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/) — geometric similarity scoring for near-duplicate events that pass exact-match filters
- [CRS Normalisation Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) — handling mixed coordinate reference systems before spatial hashing
