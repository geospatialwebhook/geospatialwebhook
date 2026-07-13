---
title: "Conflict Resolution Strategies for Geospatial Webhooks"
description: "Resolve competing spatial state updates in GIS pipelines: LWW, semantic merge, distributed locking, and backoff patterns with runnable Python code."
slug: "conflict-resolution-strategies"
type: "guide"
breadcrumb: "Idempotency & Spatial Deduplication > Conflict Resolution Strategies"
datePublished: "2024-11-01"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Conflict Resolution Strategies for Geospatial Webhook Systems",
      "description": "Step-by-step guide to detecting and resolving competing spatial state updates in event-driven GIS pipelines — covering LWW, semantic merge, distributed locking, and backoff patterns with runnable Python code.",
      "datePublished": "2024-11-01",
      "dateModified": "2026-06-25",
      "author": {"@type": "Organization", "name": "GeoSpatialWebhook"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Idempotency & Spatial Deduplication", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/"},
        {"@type": "ListItem", "position": 3, "name": "Conflict Resolution Strategies", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "How to Resolve Conflicting Spatial Webhook Payloads",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Normalize payload CRS and validate geometry"},
        {"@type": "HowToStep", "position": 2, "name": "Gate on idempotency key before conflict evaluation"},
        {"@type": "HowToStep", "position": 3, "name": "Retrieve current state and compute spatial overlap"},
        {"@type": "HowToStep", "position": 4, "name": "Apply resolution policy (LWW or semantic merge)"},
        {"@type": "HowToStep", "position": 5, "name": "Acquire distributed lock and commit atomically"},
        {"@type": "HowToStep", "position": 6, "name": "Release lock, update cache, emit audit event"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "When should I use last-write-wins vs semantic merge for spatial conflicts?",
          "acceptedAnswer": {"@type": "Answer", "text": "Use last-write-wins for high-throughput sensor telemetry where recent observations supersede older ones and occasional data loss is acceptable. Use semantic merge for cadastral, regulatory, or collaborative editing scenarios where every geometry edit carries independent authority and must be preserved — for example, unioning parcel boundary updates from two concurrent field surveyors."}
        },
        {
          "@type": "Question",
          "name": "How do I prevent deadlocks when locking features under high concurrency?",
          "acceptedAnswer": {"@type": "Answer", "text": "Always set a hard TTL on every distributed lock (SET NX EX in Redis) and wrap lock release in a finally block. Use exponential backoff with jitter on acquisition retries rather than tight polling, and set a maximum retry budget before returning HTTP 429 to the webhook provider."}
        },
        {
          "@type": "Question",
          "name": "What causes false-positive spatial conflicts in webhook pipelines?",
          "acceptedAnswer": {"@type": "Answer", "text": "The two most common causes are floating-point drift between CRS projections (two representations of the same geometry in EPSG:4326 vs EPSG:3857 that differ after reprojection) and geometry self-intersections that Shapely's intersection test resolves differently before and after make_valid(). Always normalize to a single CRS and call make_valid() before any topology check."}
        },
        {
          "@type": "Question",
          "name": "How do I route irreconcilable spatial conflicts to a dead-letter queue?",
          "acceptedAnswer": {"@type": "Answer", "text": "Catch resolution exceptions or detect conflicting attribute schemas in the handler and publish the raw payload plus diagnostic metadata to a dedicated DLQ topic (Redis Stream, SQS, or Kafka). Include the feature ID, both timestamps, and the resolution strategy attempted so operators can replay with corrected logic without re-fetching from the webhook provider."}
        }
      ]
    }
  ]
}
</script>

**When two webhook deliveries target the same geospatial feature simultaneously, a deterministic resolution policy prevents topology corruption, duplicate vertices, and cascading state divergence across downstream consumers.**

This page is part of [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/), the section covering how to guarantee exactly-once spatial state changes in event-driven GIS pipelines.

---

## Prerequisites

Before wiring up a conflict resolution layer, verify the following are in place:

- [ ] Python 3.10+ with `asyncio` support
- [ ] `shapely>=2.0` and `pyproj>=3.5` installed
- [ ] `fastapi` and `redis[asyncio]` (or `valkey`) available in the service
- [ ] A running Redis or Valkey instance reachable from all webhook handler nodes
- [ ] Idempotency key generation already applied, following the approach in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/)
- [ ] Exact-duplicate filtering in place via [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) so only genuinely divergent updates reach the resolution engine
- [ ] A primary spatial datastore (PostGIS, SpatiaLite, or equivalent) accessible from handlers

---

## Pipeline Architecture

The diagram below shows the four-layer path from raw webhook delivery to committed spatial state. Each layer has a single responsibility so failures are isolated and the pipeline remains resumable.

<svg viewBox="0 0 760 470" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Four-layer conflict resolution pipeline from webhook ingestion to spatial state commit, with duplicate short-circuit, dead-letter branch, and the three resolution policies" style="width:100%;max-width:760px;height:auto;font-family:inherit;display:block;margin:1.5rem auto;">
  <title>Conflict Resolution Pipeline</title>
  <desc>Four numbered layers laid out left to right: Ingestion and Normalization, Idempotency Gate, Spatial Conflict Evaluation, and Atomic Commit, connected by arrows. The Idempotency Gate short-circuits exact duplicates with a 200 OK; the Conflict Evaluation layer branches irreconcilable updates to a dead-letter queue. A lower panel compares the three resolution policies: last-write-wins, semantic merge, and manual review.</desc>
  <defs>
    <marker id="crs-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Layer 1 -->
  <rect x="20" y="24" width="160" height="92" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <text x="100" y="46" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Layer 1</text>
  <text x="100" y="63" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Ingestion &amp;</text>
  <text x="100" y="77" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Normalization</text>
  <line x1="40" y1="86" x2="160" y2="86" stroke="currentColor" stroke-width="0.75" opacity="0.25"/>
  <text x="100" y="100" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">CRS &#8594; EPSG:4326</text>
  <text x="100" y="112" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">make_valid()</text>
  <!-- Layer 2 -->
  <rect x="220" y="24" width="160" height="92" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <text x="300" y="46" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Layer 2</text>
  <text x="300" y="63" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Idempotency</text>
  <text x="300" y="77" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Gate</text>
  <line x1="240" y1="86" x2="360" y2="86" stroke="currentColor" stroke-width="0.75" opacity="0.25"/>
  <text x="300" y="100" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">SET NX EX</text>
  <text x="300" y="112" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">cache lookup</text>
  <!-- Layer 3 -->
  <rect x="420" y="24" width="160" height="92" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <text x="500" y="46" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Layer 3</text>
  <text x="500" y="63" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Spatial Conflict</text>
  <text x="500" y="77" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Evaluation</text>
  <line x1="440" y1="86" x2="560" y2="86" stroke="currentColor" stroke-width="0.75" opacity="0.25"/>
  <text x="500" y="100" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">overlap + policy</text>
  <text x="500" y="112" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">LWW / merge</text>
  <!-- Layer 4 -->
  <rect x="620" y="24" width="120" height="92" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <text x="680" y="46" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Layer 4</text>
  <text x="680" y="63" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Atomic</text>
  <text x="680" y="77" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Commit</text>
  <line x1="636" y1="86" x2="724" y2="86" stroke="currentColor" stroke-width="0.75" opacity="0.25"/>
  <text x="680" y="100" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">lock &#8594; write</text>
  <text x="680" y="112" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">audit &#8594; unlock</text>
  <!-- Arrows between layers -->
  <line x1="182" y1="70" x2="216" y2="70" stroke="currentColor" stroke-width="1.5" marker-end="url(#crs-arrow)" opacity="0.6"/>
  <line x1="382" y1="70" x2="416" y2="70" stroke="currentColor" stroke-width="1.5" marker-end="url(#crs-arrow)" opacity="0.6"/>
  <line x1="582" y1="70" x2="616" y2="70" stroke="currentColor" stroke-width="1.5" marker-end="url(#crs-arrow)" opacity="0.6"/>
  <!-- Duplicate short-circuit from Gate -->
  <line x1="300" y1="116" x2="300" y2="166" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#crs-arrow)" opacity="0.55"/>
  <rect x="216" y="166" width="168" height="48" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.35"/>
  <text x="300" y="188" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">Duplicate detected</text>
  <text x="300" y="203" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">&#8594; 200 OK, discard</text>
  <!-- DLQ branch from Layer 3 -->
  <line x1="500" y1="116" x2="500" y2="166" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#crs-arrow)" opacity="0.55"/>
  <rect x="416" y="166" width="168" height="48" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.35"/>
  <text x="500" y="188" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">Irreconcilable</text>
  <text x="500" y="203" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">&#8594; Dead-Letter Queue</text>
  <!-- Resolution strategies panel -->
  <rect x="20" y="262" width="720" height="184" rx="8" fill="none" stroke="currentColor" stroke-width="1" opacity="0.25"/>
  <text x="380" y="286" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.85">Resolution Policies (Layer 3)</text>
  <rect x="44" y="304" width="208" height="122" rx="6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <text x="148" y="328" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-weight="700">Last-Write-Wins</text>
  <text x="148" y="350" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">Compare timestamps;</text>
  <text x="148" y="365" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">higher ts wins</text>
  <text x="148" y="386" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">Fast, may lose</text>
  <text x="148" y="401" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">a concurrent edit</text>
  <text x="148" y="418" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.55">Best for telemetry</text>
  <rect x="276" y="304" width="208" height="122" rx="6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <text x="380" y="328" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-weight="700">Semantic Merge</text>
  <text x="380" y="350" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">Union / clip</text>
  <text x="380" y="365" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">geometries;</text>
  <text x="380" y="386" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">version vector</text>
  <text x="380" y="401" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">required</text>
  <text x="380" y="418" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.55">Safe, higher CPU cost</text>
  <rect x="508" y="304" width="208" height="122" rx="6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <text x="612" y="328" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-weight="700">Manual Review</text>
  <text x="612" y="350" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">Route to DLQ;</text>
  <text x="612" y="365" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">operator resolves</text>
  <text x="612" y="386" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">Preserves every</text>
  <text x="612" y="401" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">edit for replay</text>
  <text x="612" y="418" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.55">For regulatory data</text>
</svg>

The pipeline has four numbered layers:

1. **Ingestion and normalization** — parse GeoJSON, enforce a single CRS (EPSG:4326), strip provider-specific metadata, and repair geometry topology.
2. **Idempotency gate** — check the distributed cache; discard exact duplicates before any database read.
3. **Spatial conflict evaluation** — fetch current state, compute overlap, and apply a resolution policy.
4. **Atomic commit** — acquire a feature-level lock, write the resolved geometry, release the lock, and emit an audit event.

---

## Step-by-Step Implementation

### Step 1 — Payload Normalization and CRS Enforcement

Parse the incoming payload and convert all coordinates to EPSG:4326 before any spatial operation. Mixed CRS payloads are one of the primary causes of false-positive conflict detections; normalizing geometries to a canonical projection, as covered in [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/), eliminates this class of error entirely.

```python
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.validation import make_valid
from typing import Any

_transformer_cache: dict[str, Transformer] = {}

def _get_transformer(source_epsg: int) -> Transformer:
    key = f"{source_epsg}:4326"
    if key not in _transformer_cache:
        _transformer_cache[key] = Transformer.from_crs(
            source_epsg, 4326, always_xy=True
        )
    return _transformer_cache[key]

def normalize_geometry(geom_dict: dict[str, Any], source_epsg: int = 4326) -> dict[str, Any]:
    """Return a valid GeoJSON geometry dict in EPSG:4326."""
    geom = make_valid(shape(geom_dict))
    if source_epsg != 4326:
        transformer = _get_transformer(source_epsg)
        # shapely.ops.transform applies the projection coordinate-wise
        from shapely.ops import transform as shapely_transform
        geom = make_valid(shapely_transform(transformer.transform, geom))
    return mapping(geom)
```

### Step 2 — Idempotency Gate

Before touching the database, check whether the event key already exists in the distributed cache. This gate, which builds on [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/), ensures only genuinely new state transitions enter the resolution pipeline. Register a short TTL immediately on first sight to block concurrent duplicates arriving within milliseconds of each other.

```python
import hashlib
import json
from redis.asyncio import Redis

async def is_duplicate(redis: Redis, payload: dict[str, Any]) -> bool:
    """Return True if this event was already processed."""
    # Sort keys for a stable hash across providers that reorder JSON fields
    event_key = hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode()
    ).hexdigest()
    idem_key = f"idem:{event_key}"
    # SET NX returns None if key exists, "OK" if newly set
    registered = await redis.set(idem_key, "1", nx=True, ex=300)
    return registered is None  # None means the key was already present
```

### Step 3 — State Retrieval and Spatial Overlap Analysis

Retrieve the current persisted geometry for the feature from your primary datastore. Use a bounding-box pre-filter before computing the full intersection — this is a significant performance optimization for large polygon geometries and mirrors the spatial indexing approach discussed in [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/).

```python
from shapely.geometry import shape
from shapely.validation import make_valid

def compute_overlap(
    current_geom_dict: dict[str, Any],
    incoming_geom_dict: dict[str, Any]
) -> bool:
    """Return True when the two geometries share area — trigger resolution."""
    current = make_valid(shape(current_geom_dict))
    incoming = make_valid(shape(incoming_geom_dict))
    # Bounding-box envelope check is O(1); skip full intersection if boxes miss
    if not current.envelope.intersects(incoming.envelope):
        return False
    return current.intersects(incoming)
```

If the geometries are disjoint, apply the incoming update directly — there is no spatial conflict.

### Step 4 — Resolution Policy

Two policies cover the majority of real-world cases. Choose based on data semantics, not on convenience.

**Last-write-wins (LWW)** is appropriate for sensor telemetry, vehicle tracking, or any domain where a more-recent observation supersedes older ones. Compare `updated_at` timestamps or monotonic `version` integers. LWW is fast but can silently discard a concurrent edit if two writes land within the same clock tick — acceptable for ephemeral spatial telemetry, unacceptable for authoritative cadastral records.

**Semantic merge** preserves both edits by computing a spatial union (for additive changes such as expanding a zone boundary) or a difference/clip (for subtractive changes such as shrinking a service area). It requires a version vector to detect concurrency and is more expensive, but it guarantees no data loss.

```python
from shapely.geometry import shape, mapping
from shapely.validation import make_valid

def resolve_conflict(
    current_geom_dict: dict[str, Any],
    current_ts: float,
    incoming_geom_dict: dict[str, Any],
    incoming_ts: float,
    strategy: str = "lww",
) -> dict[str, Any]:
    """
    Resolve a spatial conflict between two geometry versions.

    strategy: "lww" (last-write-wins) or "merge" (spatial union).
    Returns the winning GeoJSON geometry dict.
    """
    current = make_valid(shape(current_geom_dict))
    incoming = make_valid(shape(incoming_geom_dict))

    if strategy == "merge":
        # Union preserves both edits — use for additive / collaborative domains
        merged = make_valid(current.union(incoming))
        return mapping(merged)

    # Default: last-write-wins on timestamp
    if incoming_ts >= current_ts:
        return incoming_geom_dict
    return current_geom_dict
```

### Step 5 — Distributed Locking and Atomic Commit

Acquire a per-feature lock before writing to the database. Without this, two concurrent handlers can both pass the idempotency gate (the first write hasn't committed yet when the second checks) and produce conflicting writes. The `SET NX EX` Redis primitive is atomic and self-expiring, eliminating orphaned locks on handler crashes.

```python
import asyncio
from redis.asyncio import Redis

async def acquire_lock(redis: Redis, feature_id: str, ttl_seconds: int = 10) -> bool:
    """Attempt atomic lock acquisition. Returns False if already locked."""
    lock_key = f"lock:feature:{feature_id}"
    result = await redis.set(lock_key, "1", nx=True, ex=ttl_seconds)
    return result is not None

async def release_lock(redis: Redis, feature_id: str) -> None:
    await redis.delete(f"lock:feature:{feature_id}")
```

### Step 6 — Full Handler Integration

The complete FastAPI endpoint wires all five steps together. The `finally` block guarantees lock release even if `commit_to_db` raises an unhandled exception.

```python
import asyncio
from fastapi import FastAPI, HTTPException, Request
from redis.asyncio import Redis

app = FastAPI()
redis_client = Redis.from_url("redis://localhost:6379/0", decode_responses=True)

@app.post("/webhooks/spatial-update")
async def handle_spatial_webhook(request: Request):
    payload: dict = await request.json()
    feature_id: str = payload["feature_id"]

    # Step 1: normalize CRS to EPSG:4326
    payload["geometry"] = normalize_geometry(
        payload["geometry"],
        source_epsg=payload.get("crs_epsg", 4326)
    )

    # Step 2: idempotency gate
    if await is_duplicate(redis_client, payload):
        return {"status": "duplicate_acknowledged"}

    # Step 3: check for spatial overlap with current persisted state
    current_state = await fetch_from_db(feature_id)  # returns {"geometry": ..., "updated_at": ...}
    has_conflict = compute_overlap(current_state["geometry"], payload["geometry"])

    if not has_conflict:
        # Disjoint update — no resolution required
        await commit_to_db(feature_id, payload["geometry"], payload["updated_at"])
        return {"status": "applied_no_conflict"}

    # Step 4: apply resolution policy
    resolved_geom = resolve_conflict(
        current_state["geometry"],
        current_state["updated_at"],
        payload["geometry"],
        payload["updated_at"],
        strategy=payload.get("resolution_hint", "lww"),
    )

    # Step 5: acquire lock before writing
    locked = await acquire_lock(redis_client, feature_id)
    if not locked:
        raise HTTPException(status_code=429, detail="Feature locked — retry later")

    try:
        await commit_to_db(feature_id, resolved_geom, payload["updated_at"])
        await emit_audit_event(feature_id, payload, current_state, resolved_geom)
    finally:
        await release_lock(redis_client, feature_id)

    return {"status": "resolved_and_committed"}
```

---

## Spatial Validation and Error Handling

Geometry errors surface in two places: at ingestion (malformed provider payloads) and at resolution time (operations that produce degenerate results such as empty intersections or self-touching rings).

```python
from pydantic import BaseModel, field_validator
from shapely.geometry import shape
from shapely.validation import make_valid, explain_validity

class SpatialWebhookPayload(BaseModel):
    feature_id: str
    geometry: dict
    updated_at: float
    crs_epsg: int = 4326
    resolution_hint: str = "lww"

    @field_validator("geometry")
    @classmethod
    def geometry_must_be_valid_geojson(cls, v: dict) -> dict:
        allowed = {"Point", "LineString", "Polygon", "MultiPolygon",
                   "MultiPoint", "MultiLineString", "GeometryCollection"}
        if v.get("type") not in allowed:
            raise ValueError(f"Unknown geometry type: {v.get('type')}")
        try:
            geom = shape(v)
        except Exception as exc:
            raise ValueError(f"Cannot parse geometry: {exc}") from exc
        if not geom.is_valid:
            explanation = explain_validity(geom)
            # Attempt auto-repair; raise only if repair fails
            repaired = make_valid(geom)
            if not repaired.is_valid:
                raise ValueError(f"Geometry invalid and unrepairable: {explanation}")
        return v
```

Use Pydantic's `field_validator` to validate geometry types and repair topology at the boundary of the service, keeping resolution logic free of defensive guards. When `make_valid()` cannot produce a valid geometry (extremely rare, usually caused by coordinate overflow), log the failure with the raw payload and route to a dead-letter queue rather than returning HTTP 500.

---

## Retry, Backoff, and Delivery Guarantees

When lock acquisition fails because another handler is processing the same feature, the correct response is to signal the webhook provider to retry — not to queue the event internally, which masks the contention.

```python
import asyncio
import random

async def acquire_lock_with_backoff(
    redis: Redis,
    feature_id: str,
    max_attempts: int = 5,
    base_delay_ms: int = 50,
    ttl_seconds: int = 10,
) -> bool:
    """
    Exponential backoff with full jitter for distributed lock acquisition.
    Returns True if the lock was acquired within max_attempts.
    """
    for attempt in range(max_attempts):
        if await acquire_lock(redis, feature_id, ttl_seconds):
            return True
        # Full jitter: sleep between 0 and 2^attempt * base_delay_ms
        ceiling_ms = (2 ** attempt) * base_delay_ms
        delay_s = random.uniform(0, ceiling_ms) / 1000.0
        await asyncio.sleep(delay_s)
    return False
```

**At-least-once vs exactly-once:** Most webhook providers guarantee at-least-once delivery. The idempotency gate at Step 2 converts at-least-once into effectively-once for exact payload duplicates. For genuine concurrent edits (same feature, different payloads), the distributed lock serializes writes — ensuring each edit is processed in isolation even if the delivery order was not guaranteed.

Return HTTP `429 Too Many Requests` with a `Retry-After: 2` header when the lock cannot be acquired. Do not queue the payload inside the handler; that would silently accumulate backpressure and break the `Retry-After` contract with the provider.

---

## Verification

The following integration test confirms the core resolution path without a live database — it mocks `fetch_from_db` and `commit_to_db` to isolate the conflict logic.

```python
import asyncio
import pytest
from unittest.mock import AsyncMock, patch
from shapely.geometry import mapping
from shapely.geometry import Polygon

# Two overlapping squares in EPSG:4326
CURRENT_GEOM = mapping(Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]))
INCOMING_GEOM = mapping(Polygon([(0.5, 0.5), (1.5, 0.5), (1.5, 1.5), (0.5, 1.5)]))

def test_overlap_detected():
    from your_module import compute_overlap
    assert compute_overlap(CURRENT_GEOM, INCOMING_GEOM) is True

def test_lww_incoming_wins():
    from your_module import resolve_conflict
    result = resolve_conflict(CURRENT_GEOM, 1000.0, INCOMING_GEOM, 1001.0, strategy="lww")
    assert result == INCOMING_GEOM

def test_lww_current_wins():
    from your_module import resolve_conflict
    result = resolve_conflict(CURRENT_GEOM, 1002.0, INCOMING_GEOM, 1001.0, strategy="lww")
    assert result == CURRENT_GEOM

def test_merge_union_contains_both():
    from your_module import resolve_conflict
    from shapely.geometry import shape
    result = resolve_conflict(CURRENT_GEOM, 1000.0, INCOMING_GEOM, 1001.0, strategy="merge")
    merged = shape(result)
    assert shape(CURRENT_GEOM).within(merged)
    assert shape(INCOMING_GEOM).within(merged)

@pytest.mark.asyncio
async def test_duplicate_is_short_circuited(redis_mock):
    from your_module import is_duplicate
    payload = {"feature_id": "f1", "geometry": INCOMING_GEOM, "updated_at": 1000.0}
    # First call should register the key
    assert await is_duplicate(redis_mock, payload) is False
    # Second call with same payload should detect duplicate
    assert await is_duplicate(redis_mock, payload) is True
```

Run the tests with `pytest -v` — all four assertions should pass without network access.

---

## Troubleshooting

<div style="overflow-x:auto">

| Symptom | Likely Spatial Cause | Fix |
|---|---|---|
| Resolution engine produces more conflicts than expected | CRS mismatch — EPSG:3857 vs EPSG:4326 geometries appear spatially overlapping after reprojection drift | Enforce a single CRS in Layer 1 normalization before any `intersects()` call |
| `TopologyException` raised during `union()` or `intersection()` | Input geometries have self-intersections or duplicate vertices | Call `make_valid()` on both operands before any spatial operation |
| Lock TTL expires mid-write under PostGIS contention | Geometry write to PostGIS takes longer than `ttl_seconds` | Increase lock TTL or move geometry validation out of the critical section |
| High `conflict_rate` metric after a provider upgrade | Provider changed payload field order, invalidating stable `sort_keys` hash | Log both the raw and normalized hash; confirm JSON serialization is deterministic across provider versions |
| Dead-letter queue growing rapidly | Resolution strategy (`lww` or `merge`) produces geometries that fail schema validation on commit | Add a post-resolution `make_valid()` check and log the feature ID + both input geometries for manual inspection |
| HTTP 429 storms from the webhook provider | Lock contention is too high — multiple handlers competing for the same features | Shard lock namespaces by H3 cell or geographic bounding box to reduce per-lock contention |

</div>

---

## FAQ

<details class="faq">
<summary><strong>When should I use last-write-wins vs semantic merge?</strong></summary>

Use last-write-wins for high-throughput sensor telemetry where recent observations supersede older ones and occasional data loss is acceptable. Use semantic merge for cadastral, regulatory, or collaborative editing scenarios where every geometry edit carries independent authority and must be preserved — for example, unioning parcel boundary updates from two concurrent field surveyors.

</details>

<details class="faq">
<summary><strong>How do I prevent deadlocks under high concurrency?</strong></summary>

Always set a hard TTL on every distributed lock (`SET NX EX` in Redis) and wrap lock release in a `finally` block. Use exponential backoff with full jitter on acquisition retries rather than tight-polling, and set a maximum retry budget before returning HTTP 429 to the webhook provider. Never hold the lock across a network call you do not control.

</details>

<details class="faq">
<summary><strong>What causes false-positive spatial conflicts?</strong></summary>

The two most common causes are floating-point drift between CRS projections (two representations of the same geometry in EPSG:4326 vs EPSG:3857 that differ after reprojection) and geometry self-intersections that Shapely's `intersection` test resolves differently before and after `make_valid()`. Always normalize to a single CRS and call `make_valid()` before any topology check.

</details>

<details class="faq">
<summary><strong>How do I route irreconcilable conflicts to a dead-letter queue?</strong></summary>

Catch resolution exceptions or detect conflicting attribute schemas in the handler and publish the raw payload plus diagnostic metadata to a dedicated DLQ topic (Redis Stream, SQS, or Kafka). Include the feature ID, both timestamps, and the resolution strategy attempted so operators can replay with corrected logic without re-fetching the event from the webhook provider.

</details>

---

## Operational Considerations

**Partitioned locking:** Instead of a flat `lock:feature:<id>` namespace, shard by geographic region — for example, prefix by H3 cell at resolution 5. This reduces contention when high-velocity events cluster spatially (a common pattern in sensor grids and fleet tracking) while preserving per-feature serialization within each shard.

**Observability metrics:** Instrument `conflict_rate` (conflicts per 1,000 events), `lock_wait_time_ms` (P95 latency to acquire a feature lock), `resolution_strategy_distribution` (LWW vs merge vs DLQ ratio), and `geometry_repair_count` (calls to `make_valid()` that changed the geometry). These four metrics are the primary indicators of data quality and pipeline health. The [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) page covers `geometry_repair_count` instrumentation in depth.

**Audit trail:** Every resolved conflict should emit an immutable event containing the incoming payload, current state, the chosen resolution strategy, and the resulting geometry. This enables deterministic replay and compliance auditing without re-querying the webhook provider. Route these events to the same message broker used for [Feature Change Triggers](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/) so the audit stream is co-located with the primary event stream.

**Circuit breaker:** If the Redis cluster is unreachable, do not silently fail open. Return HTTP 503 with a `Retry-After` header rather than processing the event without an idempotency gate or lock, which would make conflict resolution semantics undefined for the duration of the outage.

---

## Related

- [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — parent section covering the full consistency guarantee stack for geospatial webhooks
- [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — deterministic fingerprinting of GeoJSON payloads before conflict evaluation
- [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) — Redis-based duplicate filtering that feeds the gate in Layer 2
- [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/) — bounding-box and geometry intersection strategies for near-duplicate filtering
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — topology repair and CRS alignment patterns that underpin normalization in Layer 1
