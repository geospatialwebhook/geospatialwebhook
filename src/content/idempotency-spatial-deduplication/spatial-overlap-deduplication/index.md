---
title: "Spatial Overlap Deduplication for Geospatial Webhooks"
description: "Suppress redundant geospatial webhook events in Python using Shapely spatial predicates, Redis caching, and configurable area overlap thresholds."
slug: "spatial-overlap-deduplication"
type: "cluster"
breadcrumb:
  - label: "Idempotency & Spatial Deduplication"
    url: "/idempotency-spatial-deduplication/"
  - label: "Spatial Overlap Deduplication"
    url: "/idempotency-spatial-deduplication/spatial-overlap-deduplication/"
datePublished: "2025-08-01"
dateModified: "2026-06-24"
schema:
  - Article
  - BreadcrumbList
  - HowTo
  - FAQPage
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Spatial Overlap Deduplication for Geospatial Webhooks",
      "description": "Implement spatial overlap deduplication in Python to suppress redundant geospatial webhook events using Shapely predicates, Redis caching, and configurable area thresholds.",
      "datePublished": "2025-08-01",
      "dateModified": "2026-06-24",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Idempotency & Spatial Deduplication", "item": "https://geospatialwebhook.com/idempotency-spatial-deduplication/"},
        {"@type": "ListItem", "position": 2, "name": "Spatial Overlap Deduplication", "item": "https://geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Implement Spatial Overlap Deduplication for Geospatial Webhooks",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Normalize Inbound Payloads", "text": "Extract geometry, validate against GeoJSON standards, and enforce a single CRS before spatial evaluation."},
        {"@type": "HowToStep", "position": 2, "name": "Generate Deterministic Spatial Keys", "text": "Derive stable grid-aligned cache keys from geometry bounding boxes combined with a temporal window."},
        {"@type": "HowToStep", "position": 3, "name": "Execute Cache-Backed Idempotency Check", "text": "Perform a Redis SET NX lookup to short-circuit processing before touching the spatial predicate engine."},
        {"@type": "HowToStep", "position": 4, "name": "Evaluate Spatial Overlap", "text": "Run Shapely intersection predicates against spatially indexed candidates to apply configurable area thresholds."},
        {"@type": "HowToStep", "position": 5, "name": "Apply Conflict Resolution Policy", "text": "Suppress, merge, or escalate events based on overlap ratio, temporal decay, and geometry complexity rules."}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does exact-hash deduplication fail for geospatial payloads?",
          "acceptedAnswer": {"@type": "Answer", "text": "Coordinate precision drift, CRS transformations, and topology normalization by GIS libraries all change the raw bytes of a geometry without changing its spatial footprint. Hash-based filters therefore treat functionally identical shapes as distinct events."}
        },
        {
          "@type": "Question",
          "name": "What overlap ratio threshold should I use in production?",
          "acceptedAnswer": {"@type": "Answer", "text": "Start at 0.85 (85% area intersection) for tight deduplication. Telemetry with GPS drift may need 0.70–0.75. Always measure false-positive suppression rates against a labelled sample before deploying a threshold to production."}
        },
        {
          "@type": "Question",
          "name": "How do I compute overlap ratios without projection errors?",
          "acceptedAnswer": {"@type": "Answer", "text": "Area calculations in EPSG:4326 (degrees squared) are not meaningful for ratio comparisons. Project both geometries to an equal-area CRS such as EPSG:6933 or a local UTM zone before computing intersection.area / new_geom.area."}
        },
        {
          "@type": "Question",
          "name": "Can I use PostGIS instead of Shapely for overlap checks?",
          "acceptedAnswer": {"@type": "Answer", "text": "Yes. ST_Intersects + ST_Area(ST_Intersection(...)) / ST_Area(...) express the same predicate and benefit from GiST index acceleration at database scale. The Python layer then only needs to interpret the boolean result rather than loading full geometry objects."}
        }
      ]
    }
  ]
}
</script>

**Spatial overlap deduplication suppresses redundant geospatial webhook events by evaluating geometric intersection and configurable area thresholds rather than exact byte-for-byte payload hashes — making it resilient to coordinate precision drift, CRS variance, and topology normalization artifacts.**

This topic is part of [Idempotency & Spatial Deduplication](/idempotency-spatial-deduplication/), which covers the full range of strategies for ensuring geospatial event pipelines process each unique spatial footprint exactly once.

---

## Prerequisites

Verify these dependencies before implementing the pattern:

- [ ] Python 3.9+ with an async-capable framework: FastAPI, Starlette, or aiohttp
- [ ] `shapely>=2.0` — vector geometry operations, spatial predicates, topology validation
- [ ] `pyproj>=3.4` — coordinate reference system transformations
- [ ] `pydantic>=2.0` — payload schema validation with GeoJSON model support
- [ ] `redis[asyncio]>=4.5` — sub-millisecond cache lookups with atomic SET NX support
- [ ] Redis 6.2+ (or compatible store) with TTL management enabled
- [ ] A message broker (Kafka, RabbitMQ, or AWS SQS) to decouple ingestion from evaluation workers
- [ ] All inbound webhook sources documented with their native CRS (EPSG code)

---

## Why Exact-Hash Deduplication Fails for Spatial Payloads

Standard idempotency patterns rely on deterministic identifiers: request IDs, transaction hashes, or exact payload checksums. Geospatial data systematically violates these assumptions through four mechanisms:

**Floating-point precision drift.** A polygon serialized to 6 decimal places in one system may arrive at 8 decimal places after a CRS transformation, breaking exact string matches while representing the same physical boundary.

**CRS mismatch.** Inbound payloads commonly mix EPSG:4326 (WGS 84), EPSG:3857 (Web Mercator), and local projected systems. Identical physical areas yield completely different coordinate arrays depending on projection. Normalizing coordinates to a canonical CRS — as detailed in [CRS Normalization Strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/) — is a prerequisite for any comparison.

**Topology normalization.** GIS libraries automatically close rings, reorder vertices, or snap coordinates to grid tolerances. Two payloads representing the same delivery zone or sensor coverage area rarely produce identical JSON bytes.

**Temporal overlap.** Mobile telemetry and IoT pings frequently report overlapping bounding boxes as devices move or sensors aggregate readings over sliding windows, producing streams of near-identical geometries that differ only in sub-metre vertex positions.

Hash-based filters either drop legitimate updates or let duplicates through. Spatial predicate evaluation is resilient to these variances because it asks whether two geometries occupy the same footprint, not whether their byte representations match.

---

## Architecture: Four-Layer Deduplication Pipeline

The pipeline separates concerns across four layers to keep expensive spatial computation off the hot path.

<svg viewBox="0 0 720 380" role="img" aria-label="Four-layer spatial overlap deduplication pipeline diagram" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:720px;height:auto;display:block;margin:1.5rem auto;">
  <title>Spatial Overlap Deduplication Pipeline</title>
  <desc>Data flows from webhook ingress through payload normalisation, cache lookup, spatial predicate evaluation, and finally to the downstream event processor or duplicate suppressor.</desc>

  <!-- Background -->
  <rect width="720" height="380" fill="none"/>

  <!-- Layer boxes -->
  <!-- Layer 1: Ingress -->
  <rect x="20" y="30" width="140" height="64" rx="8" fill="#f9c8b0" stroke="#c07050" stroke-width="1.5"/>
  <text x="90" y="55" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="#5a3020">Layer 1</text>
  <text x="90" y="71" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#5a3020">Webhook Ingress</text>
  <text x="90" y="85" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#7a4030">(FastAPI endpoint)</text>

  <!-- Arrow 1→2 -->
  <line x1="160" y1="62" x2="196" y2="62" stroke="#888" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Layer 2: Normalisation -->
  <rect x="196" y="30" width="148" height="64" rx="8" fill="#b8e8d0" stroke="#4a9a70" stroke-width="1.5"/>
  <text x="270" y="55" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="#1a5a38">Layer 2</text>
  <text x="270" y="71" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#1a5a38">Payload Normalisation</text>
  <text x="270" y="85" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#2a7a50">(CRS → EPSG:4326)</text>

  <!-- Arrow 2→3 -->
  <line x1="344" y1="62" x2="380" y2="62" stroke="#888" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Layer 3: Cache check -->
  <rect x="380" y="30" width="148" height="64" rx="8" fill="#e8d8b0" stroke="#9a7830" stroke-width="1.5"/>
  <text x="454" y="55" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="#5a3a10">Layer 3</text>
  <text x="454" y="71" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#5a3a10">Cache Lookup</text>
  <text x="454" y="85" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#7a5a20">(Redis SET NX)</text>

  <!-- Arrow 3→4 -->
  <line x1="528" y1="62" x2="564" y2="62" stroke="#888" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Layer 4: Predicate -->
  <rect x="564" y="30" width="136" height="64" rx="8" fill="#f9c8b0" stroke="#c07050" stroke-width="1.5"/>
  <text x="632" y="55" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="#5a3020">Layer 4</text>
  <text x="632" y="71" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#5a3020">Spatial Predicate</text>
  <text x="632" y="85" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#7a4030">(Shapely STRtree)</text>

  <!-- Outcome lines from Layer 3 -->
  <!-- Cache HIT → suppress -->
  <line x1="454" y1="94" x2="454" y2="160" stroke="#c07050" stroke-width="1.5" stroke-dasharray="5,3"/>
  <rect x="374" y="160" width="160" height="40" rx="6" fill="#fce8e0" stroke="#c07050" stroke-width="1.2"/>
  <text x="454" y="176" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#c07050">Cache HIT → suppress</text>
  <text x="454" y="191" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#c07050">return 200 (idempotent)</text>

  <!-- Outcome lines from Layer 4 -->
  <!-- Overlap above threshold → suppress -->
  <line x1="632" y1="94" x2="632" y2="160" stroke="#9a7830" stroke-width="1.5" stroke-dasharray="5,3"/>
  <rect x="552" y="160" width="160" height="40" rx="6" fill="#faf0d8" stroke="#9a7830" stroke-width="1.2"/>
  <text x="632" y="176" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#9a7830">Overlap ≥ threshold</text>
  <text x="632" y="191" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#9a7830">→ suppress + log audit</text>

  <!-- Downstream: new event -->
  <rect x="196" y="280" width="340" height="48" rx="8" fill="#b8e8d0" stroke="#4a9a70" stroke-width="1.5"/>
  <text x="366" y="300" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="#1a5a38">Downstream Processor</text>
  <text x="366" y="317" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#2a7a50">Cache MISS + overlap below threshold → publish unique event</text>

  <!-- Arrows to downstream -->
  <line x1="454" y1="200" x2="366" y2="280" stroke="#4a9a70" stroke-width="1.5" marker-end="url(#arr2)"/>
  <line x1="632" y1="200" x2="460" y2="280" stroke="#4a9a70" stroke-width="1.5" marker-end="url(#arr2)"/>

  <!-- Arrow markers -->
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#888"/>
    </marker>
    <marker id="arr2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#4a9a70"/>
    </marker>
  </defs>
</svg>

**Layer 1 — Webhook ingress:** FastAPI or aiohttp receives the raw POST and immediately validates the HTTP signature (see [Securing Webhook Endpoints with Spatial Token Validation](/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/)). The raw body is enqueued for async processing without blocking the HTTP response.

**Layer 2 — Payload normalisation:** Extract the GeoJSON geometry, validate topology with `shapely.validation.make_valid`, and reproject to a canonical CRS (EPSG:4326) before any comparison. This step also validates the payload schema via Pydantic to reject malformed geometry types early.

**Layer 3 — Cache-backed fast path:** Generate a grid-aligned spatial key and issue an atomic Redis SET NX. On a cache hit, the event is a known duplicate: return 200 immediately, no predicate evaluation needed. This layer typically eliminates 60–80 % of retry traffic before geometry is loaded.

**Layer 4 — Spatial predicate evaluation:** For cache misses, load candidate geometries from a recent event store (spatial index or PostGIS query) and evaluate overlap with Shapely predicates. Events whose intersection area exceeds the configured threshold are suppressed and logged to an audit trail; those below it are novel and forwarded to the downstream processor.

---

## Step-by-Step Implementation

### 1. Validate and Normalise Inbound Payloads

Webhook sources rarely emit uniform geometry. Before any comparison, enforce a single CRS, close polygon rings, and repair invalid topology. This is the same normalisation foundation described in [Geometry Validation Pipelines](/spatial-payload-routing-parsing/geometry-validation-pipelines/).

```python
from shapely.geometry import shape
from shapely.ops import transform
from shapely.validation import make_valid
import pyproj
from pydantic import BaseModel, field_validator
from typing import Any

class SpatialWebhookPayload(BaseModel):
    event_id: str
    source_crs: str = "EPSG:4326"
    geometry: dict[str, Any]

    @field_validator("geometry")
    @classmethod
    def geometry_must_be_valid_geojson(cls, v: dict) -> dict:
        allowed = {"Point", "MultiPoint", "LineString", "MultiLineString",
                   "Polygon", "MultiPolygon", "GeometryCollection"}
        if v.get("type") not in allowed:
            raise ValueError(f"Unsupported geometry type: {v.get('type')}")
        return v


TARGET_CRS = "EPSG:4326"


def normalize_geometry(payload: SpatialWebhookPayload):
    """
    Return a valid Shapely geometry normalised to EPSG:4326.
    Projects from the payload's declared source CRS when needed.
    """
    geom = shape(payload.geometry)

    # Repair self-intersections and unclosed rings before any predicate
    if not geom.is_valid:
        geom = make_valid(geom)

    if payload.source_crs != TARGET_CRS:
        transformer = pyproj.Transformer.from_crs(
            payload.source_crs, TARGET_CRS, always_xy=True
        )
        geom = transform(transformer.transform, geom)

    return geom
```

Always call `make_valid` before storing or comparing; Shapely 2.x raises `TopologicalError` on predicates against invalid geometries rather than silently returning incorrect results.

### 2. Generate a Grid-Aligned Spatial Cache Key

Raw coordinate strings are unsuitable as cache keys because floating-point variance produces distinct strings for the same physical location. Round the bounding box centroid to a fixed grid precision and combine it with a temporal window bucket. This approach aligns with the broader key-derivation patterns in [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/).

```python
import hashlib
from datetime import datetime, timezone

# Spatial grid precision in decimal degrees.
# Precision 4 = ~11 m grid cell; precision 3 = ~111 m grid cell.
GRID_PRECISION = 4
# Temporal window width in minutes (events within the same window share a bucket).
WINDOW_MINUTES = 60


def spatial_cache_key(geom, event_time: datetime | None = None) -> str:
    """
    Derive a deterministic cache key from a geometry's centroid grid cell
    and an hourly time bucket.
    """
    if event_time is None:
        event_time = datetime.now(tz=timezone.utc)

    centroid = geom.centroid
    grid_lat = round(centroid.y, GRID_PRECISION)
    grid_lon = round(centroid.x, GRID_PRECISION)
    # Bucket by hour (or subdivide by WINDOW_MINUTES for sub-hour windows)
    bucket = event_time.strftime("%Y%m%dT%H")

    raw = f"{grid_lat}:{grid_lon}:{bucket}"
    return "sodp:" + hashlib.sha256(raw.encode()).hexdigest()[:20]
```

Grid-aligned keys ensure that geometries falling in the same spatial cell and time window share a cache namespace, enabling fast overlap lookup without scanning the full event history.

### 3. Cache-Backed Fast-Path Check

Perform a Redis SET NX before loading any geometry objects. The vast majority of webhook retries are caught here, keeping the spatial predicate engine off the critical path. The implementation mirrors the atomic locking approach described in [Cache-Backed Idempotency Checks](/idempotency-spatial-deduplication/cache-backed-idempotency-checks/).

```python
import redis.asyncio as aioredis

CACHE_TTL_SECONDS = 3600  # 1-hour deduplication window


async def is_duplicate_via_cache(
    client: aioredis.Redis,
    key: str,
) -> bool:
    """
    Atomically claim the cache key.
    Returns True  → key already existed  → event is a duplicate.
    Returns False → key was absent       → event may be novel (proceed to predicate).
    """
    # SET key value NX EX ttl — atomic; no race between GET and SET
    acquired = await client.set(key, "1", nx=True, ex=CACHE_TTL_SECONDS)
    return not bool(acquired)
```

Use `nx=True` (SET NX) rather than a GET + SET sequence to prevent a TOCTOU race where two concurrent retries both pass the cache check and both reach the expensive predicate layer.

### 4. Spatial Predicate Evaluation with Area Threshold

For cache misses, retrieve candidate geometries from the recent event store and evaluate overlap with Shapely. Use an R-tree (`STRtree`) to avoid pairwise O(n²) comparisons — the R-tree filters candidates to those whose bounding boxes intersect before the exact predicate runs.

```python
from shapely.strtree import STRtree
from shapely.geometry.base import BaseGeometry
import pyproj
from shapely.ops import transform as shp_transform

# Minimum fractional area overlap to treat two geometries as duplicates.
OVERLAP_THRESHOLD = 0.85

# Project to equal-area CRS for meaningful area ratios.
# EPSG:6933 covers the full globe; swap for a local UTM zone for higher accuracy.
_AREA_CRS_TRANSFORMER = pyproj.Transformer.from_crs(
    "EPSG:4326", "EPSG:6933", always_xy=True
)


def _project_for_area(geom: BaseGeometry) -> BaseGeometry:
    return shp_transform(_AREA_CRS_TRANSFORMER.transform, geom)


def is_duplicate_via_overlap(
    new_geom: BaseGeometry,
    candidates: list[BaseGeometry],
) -> bool:
    """
    Return True if any candidate overlaps new_geom by >= OVERLAP_THRESHOLD.
    All geometries must be in EPSG:4326; area comparison projects to EPSG:6933.
    """
    if not candidates:
        return False

    tree = STRtree(candidates)
    # R-tree pre-filter: only intersecting bounding boxes proceed to exact check
    hits = tree.query(new_geom, predicate="intersects")

    new_geom_area = _project_for_area(new_geom).area
    if new_geom_area == 0:
        # Point or line — fall back to exact-contains check
        return any(candidates[i].contains(new_geom) for i in hits)

    for idx in hits:
        candidate = candidates[idx]
        intersection = new_geom.intersection(candidate)
        if intersection.is_empty:
            continue
        overlap_ratio = _project_for_area(intersection).area / new_geom_area
        if overlap_ratio >= OVERLAP_THRESHOLD:
            return True

    return False
```

Never compute area ratios in EPSG:4326 — degree-squared values are not proportional to real-world area, particularly at latitudes above 45°. Always project to an equal-area CRS first.

### 5. Compose the Full Async Pipeline

Wire the layers together in a FastAPI endpoint. The webhook receiver returns 200 immediately after accepting the event; the deduplication logic runs in a background task.

```python
from fastapi import FastAPI, Request, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
import redis.asyncio as aioredis
from contextlib import asynccontextmanager
import json

app = FastAPI()
redis_client: aioredis.Redis | None = None

@asynccontextmanager
async def lifespan(app_: FastAPI):
    global redis_client
    redis_client = aioredis.from_url("redis://localhost:6379", decode_responses=True)
    yield
    await redis_client.aclose()

app = FastAPI(lifespan=lifespan)

# In production, load recent event geometries from a PostGIS query or
# a shared in-memory spatial index refreshed by a background worker.
recent_geometries: list = []


async def process_spatial_event(raw_body: bytes) -> None:
    payload_dict = json.loads(raw_body)
    try:
        payload = SpatialWebhookPayload(**payload_dict)
    except Exception as exc:
        # Schema validation failure — route to DLQ
        print(f"[DLQ] invalid payload: {exc}")
        return

    geom = normalize_geometry(payload)
    key = spatial_cache_key(geom)

    if await is_duplicate_via_cache(redis_client, key):
        print(f"[DEDUP] cache hit: {key}")
        return

    if is_duplicate_via_overlap(geom, recent_geometries):
        print(f"[DEDUP] overlap threshold exceeded for event {payload.event_id}")
        # Persist audit record: original event_id, overlap ratio, canonical event ref
        return

    # Novel event — forward to downstream processor
    recent_geometries.append(geom)  # update in-memory index
    print(f"[PUBLISH] forwarding unique event {payload.event_id}")


@app.post("/webhook/spatial")
async def receive_spatial_event(request: Request, background_tasks: BackgroundTasks):
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty body")
    background_tasks.add_task(process_spatial_event, body)
    return JSONResponse({"status": "accepted"}, status_code=200)
```

---

## Spatial Validation and Error Handling

Wrap the normalisation step in explicit error handling to prevent a single malformed payload from stalling the pipeline:

```python
from shapely.errors import TopologicalError, GEOSException

async def safe_normalize(payload: SpatialWebhookPayload):
    try:
        return normalize_geometry(payload)
    except (TopologicalError, GEOSException, ValueError) as exc:
        # Route to dead-letter queue with original payload and error context
        print(f"[DLQ] geometry error for event {payload.event_id}: {exc}")
        return None
```

Apply Pydantic validation at the HTTP boundary (as shown in `SpatialWebhookPayload`) and a second topology check inside the worker after normalisation. This two-stage approach catches both malformed JSON and geometrically invalid shapes that pass JSON schema validation.

For [async processing of heavy geometries](/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/), offload normalisation of complex multi-polygon payloads to a dedicated worker pool to prevent a large geometry from monopolising the async event loop.

---

## Retry, Backoff, and Delivery Guarantees

The spatial deduplication layer is designed for **at-least-once delivery** from the broker side combined with **exactly-once processing** enforced by the cache. At high throughput, a few edge cases require explicit handling:

```python
import asyncio
import random

MAX_RETRIES = 4
BASE_DELAY_SECONDS = 0.25


async def publish_with_backoff(event_id: str, payload: dict) -> None:
    """
    Retry forwarding a novel event to the downstream processor with
    exponential backoff and full jitter to avoid retry storms.
    """
    for attempt in range(MAX_RETRIES):
        try:
            # Replace with your broker client (aiokafka, aio-pika, etc.)
            await downstream_publish(event_id, payload)
            return
        except Exception as exc:
            if attempt == MAX_RETRIES - 1:
                print(f"[DLQ] exhausted retries for {event_id}: {exc}")
                await send_to_dlq(event_id, payload, reason=str(exc))
                return
            delay = BASE_DELAY_SECONDS * (2 ** attempt) * random.random()
            await asyncio.sleep(delay)


async def downstream_publish(event_id: str, payload: dict) -> None:
    # Placeholder for aiokafka / aio-pika / SQS publish call
    pass


async def send_to_dlq(event_id: str, payload: dict, reason: str) -> None:
    # Persist to append-only DLQ with geometry snapshot and reason code
    pass
```

**At-least-once vs. exactly-once tradeoffs:** The Redis SET NX provides exactly-once semantics within the cache TTL window. Events that arrive after TTL expiry are treated as novel — intentional, because a geometry change 25 hours later likely represents a genuine spatial update. For stricter exactly-once guarantees across longer windows, persist the spatial key to a durable store (PostgreSQL with a GiST index on the geometry column) rather than relying solely on Redis TTL.

---

## Conflict Resolution and Tolerance Thresholds

Spatial overlap evaluation introduces edge cases that require explicit, documented resolution policies:

**Partial overlaps below threshold:** Events whose intersection falls below `OVERLAP_THRESHOLD` are treated as distinct spatial updates even if they share significant area. Keep the threshold configurable per event source type — GPS tracks need a lower threshold (0.70–0.75) than static delivery zone polygons (0.90+).

**Multi-polygon payloads:** Normalise complex geometries using `shapely.ops.unary_union` before evaluation. Fragmented multi-part geometries can produce misleading overlap ratios when evaluated part-by-part.

**Temporal decay:** Sliding-window deduplication prevents over-suppression. An event overlapping with a 48-hour-old geometry may represent a legitimate state change. Set TTL values that reflect the expected update frequency for each event source.

**Area calculations in geographic CRS:** Ratios computed in EPSG:4326 are mathematically invalid — always project to EPSG:6933 or a local UTM zone before `intersection.area / new_geom.area`. Document the CRS used in your runbooks so threshold values can be recalibrated consistently.

---

## Verification

Run this test harness after deployment to confirm the pipeline correctly classifies overlapping and non-overlapping events:

```python
import asyncio
import pytest
from shapely.geometry import Polygon, mapping

# A base polygon covering a 0.01° × 0.01° cell
BASE = Polygon([(0, 0), (0.01, 0), (0.01, 0.01), (0, 0.01), (0, 0)])
# 90 % overlap — should be suppressed
NEAR_DUPE = Polygon([(0.001, 0.001), (0.011, 0.001), (0.011, 0.011), (0.001, 0.011), (0.001, 0.001)])
# Distant polygon — should be forwarded
DISTANT = Polygon([(1, 1), (1.01, 1), (1.01, 1.01), (1, 1.01), (1, 1)])


@pytest.mark.asyncio
async def test_overlap_suppression():
    """Events with >= 85 % area overlap are classified as duplicates."""
    result = is_duplicate_via_overlap(NEAR_DUPE, [BASE])
    assert result is True, "Near-duplicate polygon should be suppressed"


@pytest.mark.asyncio
async def test_distant_event_passes():
    """Events with no spatial intersection are classified as novel."""
    result = is_duplicate_via_overlap(DISTANT, [BASE])
    assert result is False, "Distant polygon should be forwarded"


@pytest.mark.asyncio
async def test_cache_deduplication(monkeypatch):
    """Second call with the same key returns duplicate=True."""
    seen = {}

    async def fake_set(key, val, *, nx, ex):
        if key in seen:
            return None  # NX fails — key exists
        seen[key] = val
        return True

    class FakeRedis:
        set = fake_set

    client = FakeRedis()
    key = "sodp:test-key-abc123"
    first = await is_duplicate_via_cache(client, key)
    second = await is_duplicate_via_cache(client, key)
    assert first is False, "First call should not be a duplicate"
    assert second is True, "Second call with same key should be a duplicate"
```

---

## Troubleshooting

<div style="overflow-x:auto;">

| Symptom | Likely Spatial Cause | Fix |
|---|---|---|
| Identical events pass through deduplication | Grid precision too coarse; centroids hash to different buckets | Increase `GRID_PRECISION` from 3 to 4–5; verify centroid calculation on the normalised geometry, not the raw input |
| Legitimate updates suppressed | Overlap threshold too high for the source's GPS jitter | Lower `OVERLAP_THRESHOLD` per source type; add a temporal decay check before suppression |
| Area overlap ratios always 0 | Geometries in different CRS; intersection produces empty geometry | Confirm all geometries are reprojected to EPSG:4326 before predicate; call `make_valid` post-transform |
| `TopologicalError` on `.intersection()` | Invalid topology not caught at ingress | Call `make_valid(geom)` inside `normalize_geometry`; add a post-transform validity assertion |
| Redis memory grows unbounded | TTL not applied; key namespace collision | Ensure `ex=CACHE_TTL_SECONDS` is passed to every SET; prefix keys with `sodp:` to isolate the namespace |
| STRtree queries slow at scale | Candidates list rebuilt per request | Build the R-tree once per worker, refresh on a background schedule, and pass it as a shared dependency |
| Duplicate events in audit log | Cache TTL expired before retry arrived | Increase TTL or switch to a durable store (PostgreSQL) for long-window deduplication requirements |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Why does exact-hash deduplication fail for geospatial payloads?</strong></summary>

Coordinate precision drift, CRS transformations, and automatic topology normalization by GIS libraries all change the raw bytes of a geometry without changing its spatial footprint. A polygon serialised at 6-decimal precision by one source may arrive at 8 decimal places after a reprojection step in a middleware layer, producing a completely different SHA-256 hash despite representing the same physical boundary. Hash-based filters therefore treat functionally identical shapes as distinct events, either duplicating processing or (if used as deduplication keys for suppression) blocking legitimate updates.

</details>

<details class="faq">
<summary><strong>What overlap threshold should I use in production?</strong></summary>

Start at 0.85 (85 % area intersection) and measure false-positive suppression rates against a labelled sample of your real event stream before promoting to production. IoT telemetry with GPS drift typically needs a lower threshold — 0.70 to 0.75 — while static administrative boundary updates can safely use 0.90 or higher. Store the threshold in configuration, not code, so it can be tuned per event source without a deployment.

</details>

<details class="faq">
<summary><strong>How do I avoid incorrect area ratios?</strong></summary>

Always project both geometries to an equal-area CRS — EPSG:6933 (World Equal Area) covers the full globe; a local UTM zone gives higher accuracy within a constrained region — before computing `intersection.area / new_geom.area`. In EPSG:4326, the unit is degrees squared, which is not proportional to real-world area and produces ratios that vary by latitude. A 0.85 threshold applied in geographic coordinates could suppress events in equatorial regions while allowing duplicates at polar latitudes.

</details>

<details class="faq">
<summary><strong>Can I use PostGIS instead of Shapely for the overlap check?</strong></summary>

Yes. `ST_Intersects(geom_a, geom_b)` combined with `ST_Area(ST_Intersection(geom_a, geom_b)) / ST_Area(geom_a)` expresses the same predicate inside the database, where a GiST index on the geometry column accelerates the spatial filter automatically. The Python layer then only needs to interpret the boolean result. PostGIS is the right choice when candidates are already stored in PostgreSQL and you want to avoid loading full geometry objects into Python memory for every evaluation.

</details>

---

## Related

- [Idempotency & Spatial Deduplication](/idempotency-spatial-deduplication/) — parent section covering the full idempotency strategy for geospatial event pipelines
- [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — deterministic idempotency key derivation from GeoJSON feature hashes
- [Cache-Backed Idempotency Checks](/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) — Redis data structures, atomic SET NX patterns, and cache invalidation strategies
- [CRS Normalization Strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/) — normalising mixed-CRS payloads to a canonical projection before comparison
- [Geometry Validation Pipelines](/spatial-payload-routing-parsing/geometry-validation-pipelines/) — topology checks, ring orientation enforcement, and GeoJSON schema validation
