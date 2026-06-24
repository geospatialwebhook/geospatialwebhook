---
title: "Tile Update Event Pipelines"
description: "Build production-grade tile update event pipelines in Python: ingestion, spatial validation, partition-aware routing, and broadcast with idempotent async workers."
slug: "tile-update-event-pipelines"
type: "cluster"
breadcrumb: "Core Event Fundamentals & Architecture > Tile Update Event Pipelines"
datePublished: "2024-11-01"
dateModified: "2026-06-24"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Tile Update Event Pipelines",
      "description": "Build production-grade tile update event pipelines in Python: ingestion, spatial validation, partition-aware routing, and broadcast with idempotent async workers.",
      "datePublished": "2024-11-01",
      "dateModified": "2026-06-24",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" },
      "publisher": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://geospatialwebhook.com/" },
        { "@type": "ListItem", "position": 2, "name": "Core Event Fundamentals & Architecture", "item": "https://geospatialwebhook.com/core-event-fundamentals-architecture/" },
        { "@type": "ListItem", "position": 3, "name": "Tile Update Event Pipelines", "item": "https://geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Build a Tile Update Event Pipeline in Python",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Ingestion & cryptographic verification", "text": "Authenticate and deserialize incoming webhook payloads at the edge, rejecting unsigned requests before they reach the broker." },
        { "@type": "HowToStep", "position": 2, "name": "Validation & spatial enrichment", "text": "Parse events with Pydantic, validate geometry topology with Shapely, and attach tile matrix identifiers." },
        { "@type": "HowToStep", "position": 3, "name": "Partition-aware routing", "text": "Assign each event a composite partition key (zoom:quadkey) so updates to the same tile region are always processed in order." },
        { "@type": "HowToStep", "position": 4, "name": "Async processing & broadcast", "text": "Regenerate affected tiles, invalidate CDN cache, and push a lightweight tile_updated message to WebSocket or SSE consumers." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should I partition tile update events by H3 cell or by z/x/y quadkey?",
          "acceptedAnswer": { "@type": "Answer", "text": "Use z/x/y quadkey partitioning when your downstream is a standard XYZ tile server — the key maps directly to the cache path so routing and invalidation share the same identifier. H3 is better when you also run spatial analytics alongside tile rendering, because H3 cells support hierarchical aggregation at multiple resolutions without re-indexing." }
        },
        {
          "@type": "Question",
          "name": "How do I prevent tile flickering from out-of-order event delivery?",
          "acceptedAnswer": { "@type": "Answer", "text": "Add a monotonic version field (integer sequence or millisecond timestamp) to every payload. In your consumer, skip processing when the incoming version is lower than the last persisted version for that tile. Combine this with a Redis SETNX idempotency guard so broker retries cannot overwrite a newer tile with a stale one." }
        },
        {
          "@type": "Question",
          "name": "What delivery guarantee is best for tile update events?",
          "acceptedAnswer": { "@type": "Answer", "text": "At-least-once delivery paired with idempotency checks is the standard choice. Exactly-once semantics require distributed transactions that impose latency unsuitable for real-time tile invalidation. An idempotency key derived from the upstream mutation ID makes at-least-once safe in practice." }
        },
        {
          "@type": "Question",
          "name": "How do I detect hot geographic regions that bottleneck a consumer?",
          "acceptedAnswer": { "@type": "Answer", "text": "Emit a partition_lag metric tagged with zoom level and quadkey prefix. A Kafka consumer group dashboard or Prometheus histogram will reveal which z/x/y ranges consistently lag. Remedies include sub-partitioning hot tiles at a finer quadkey depth or routing high-frequency regions to a dedicated consumer group." }
        }
      ]
    }
  ]
}
</script>

**A tile update event pipeline takes a spatial mutation — a feature edit, a sensor burst, a boundary change — and drives it through ingestion, validation, partition-aware routing, and CDN broadcast so that map clients see the updated tile within milliseconds of the source change.**

This topic is part of [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/), which covers the event modeling, delivery guarantees, and security patterns that underpin all real-time geospatial systems.

## Prerequisites

- [ ] Python 3.10+ (`asyncio`, structural pattern matching, `match`/`case`)
- [ ] `pydantic` v2, `shapely` 2.x, `pyproj` 3.x, `httpx`, `aiohttp` or FastAPI
- [ ] Apache Kafka, RabbitMQ, or AWS SQS/SNS with per-key ordering or partitioning
- [ ] A tile store accessible to workers (S3-compatible bucket, Cloudflare R2, or local MBTiles for development)
- [ ] Redis (or equivalent) for idempotency guards and consumer-lag metrics
- [ ] Familiarity with how upstream GIS services emit spatial mutations, as described in [Feature Change Triggers](/core-event-fundamentals-architecture/feature-change-triggers/)

## Architecture Blueprint

The pipeline has four sequential layers. Each layer has a single responsibility and a defined failure exit so that a bad payload cannot travel further than one stage.

<svg
  viewBox="0 0 760 220"
  xmlns="http://www.w3.org/2000/svg"
  role="img"
  aria-label="Four-stage tile update event pipeline diagram"
  style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;"
>
  <title>Four-stage tile update event pipeline</title>
  <desc>A left-to-right flow diagram showing: Webhook Source → Stage 1 Ingestion and Verification → Stage 2 Validation and Enrichment → Stage 3 Partition Router → Stage 4 Tile Worker and Broadcast. A Dead-Letter Queue branches off Stage 2.</desc>

  <!-- Source box -->
  <rect x="4" y="80" width="100" height="60" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="54" y="106" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif">Webhook</text>
  <text x="54" y="121" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif">Source</text>

  <!-- Arrow 1 -->
  <line x1="104" y1="110" x2="134" y2="110" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Stage 1 -->
  <rect x="136" y="66" width="120" height="88" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 2"/>
  <text x="196" y="90" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Stage 1</text>
  <text x="196" y="108" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">Ingestion &amp;</text>
  <text x="196" y="122" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">Verification</text>
  <text x="196" y="143" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif">(HMAC-SHA256)</text>

  <!-- Arrow 2 -->
  <line x1="256" y1="110" x2="286" y2="110" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Stage 2 -->
  <rect x="288" y="66" width="120" height="88" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 2"/>
  <text x="348" y="90" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Stage 2</text>
  <text x="348" y="108" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">Validation &amp;</text>
  <text x="348" y="122" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">Enrichment</text>
  <text x="348" y="143" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif">(Pydantic + Shapely)</text>

  <!-- DLQ branch -->
  <line x1="348" y1="154" x2="348" y2="178" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 2" marker-end="url(#arr)"/>
  <rect x="290" y="180" width="116" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 2"/>
  <text x="348" y="198" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif">Dead-Letter Queue</text>
  <text x="348" y="210" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif">(invalid payloads)</text>

  <!-- Arrow 3 -->
  <line x1="408" y1="110" x2="438" y2="110" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Stage 3 -->
  <rect x="440" y="66" width="120" height="88" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 2"/>
  <text x="500" y="90" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Stage 3</text>
  <text x="500" y="108" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">Partition</text>
  <text x="500" y="122" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">Router</text>
  <text x="500" y="143" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif">(zoom:quadkey)</text>

  <!-- Arrow 4 -->
  <line x1="560" y1="110" x2="590" y2="110" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Stage 4 -->
  <rect x="592" y="66" width="160" height="88" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 2"/>
  <text x="672" y="90" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Stage 4</text>
  <text x="672" y="108" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">Tile Worker</text>
  <text x="672" y="122" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">&amp; Broadcast</text>
  <text x="672" y="143" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif">(render → SSE/WS)</text>

  <!-- Arrowhead marker -->
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
</svg>

**Stage 1 — Ingestion & Verification:** The edge endpoint authenticates the request with HMAC-SHA256, applies TLS termination, and writes accepted payloads to a raw ingestion topic with a monotonic timestamp and an upstream-derived idempotency key. Rejected requests return `401 Unauthorized` immediately.

**Stage 2 — Validation & Spatial Enrichment:** A consumer reads from the raw topic, parses the payload with Pydantic, and validates geometry topology with `shapely.is_valid`. Bounding boxes, tile matrix set identifiers, and version stamps are computed and attached. Invalid events are written to a dead-letter queue without blocking the main stream.

**Stage 3 — Partition Router:** Enriched events are keyed by a composite `zoom:quadkey` string and routed to the appropriate partition. This guarantees strict ordering per tile region while allowing full parallelism across disjoint regions. When your architecture also ingests sensor telemetry alongside feature edits, sharing consumer groups with [Sensor Data Routing Patterns](/core-event-fundamentals-architecture/sensor-data-routing-patterns/) can co-locate spatial and temporal streams efficiently.

**Stage 4 — Tile Worker & Broadcast:** Workers pull from their assigned partition, run tile regeneration, write outputs to the tile store, and publish a lightweight `tile_updated` event containing `z`, `x`, `y`, and a content hash to a WebSocket or Server-Sent Events channel. Clients perform a targeted cache bust rather than a full map reload.

## Step-by-Step Implementation

### Step 1 — Define the Canonical Event Model

Start by locking down the payload contract. Applying [best practices for spatial event payload schemas](/core-event-fundamentals-architecture/tile-update-event-pipelines/best-practices-for-spatial-event-payload-schemas/) at ingestion time prevents projection ambiguity and bounding-box errors from propagating through all downstream stages.

```python
from pydantic import BaseModel, Field, field_validator
from typing import Literal

class TileUpdateEvent(BaseModel):
    event_id: str = Field(description="Upstream mutation ID; drives idempotency key")
    zoom: int = Field(ge=0, le=22)
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    # [min_lon, min_lat, max_lon, max_lat] — WGS84 (EPSG:4326)
    bbox: tuple[float, float, float, float]
    crs: str = Field(default="EPSG:4326")
    version: int = Field(description="Monotonic counter; used for conflict resolution")
    source: str

    @field_validator("bbox")
    @classmethod
    def bbox_must_be_valid(cls, v: tuple) -> tuple:
        min_lon, min_lat, max_lon, max_lat = v
        if min_lon >= max_lon or min_lat >= max_lat:
            raise ValueError("bbox min values must be strictly less than max values")
        if not (-180 <= min_lon <= 180 and -180 <= max_lon <= 180):
            raise ValueError("longitude out of WGS84 range")
        if not (-90 <= min_lat <= 90 and -90 <= max_lat <= 90):
            raise ValueError("latitude out of WGS84 range")
        return v
```

All coordinate references in the model default to WGS84 (EPSG:4326). If upstream sources emit mixed projections, normalize them before writing to the raw ingestion topic, as described in [CRS Normalization Strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/).

### Step 2 — Validate Geometry Topology

Schema validity is necessary but not sufficient. A polygon that is topologically invalid — self-intersecting rings, incorrect winding order — will silently corrupt spatial operations downstream.

```python
from shapely.geometry import shape
from shapely.validation import explain_validity

def validate_geometry(geojson_geom: dict) -> tuple[bool, str | None]:
    """
    Returns (True, None) when geometry is valid.
    Returns (False, reason) when invalid so callers can route to DLQ.
    """
    try:
        geom = shape(geojson_geom)
    except Exception as exc:
        return False, f"unparseable geometry: {exc}"

    if not geom.is_valid:
        return False, explain_validity(geom)

    return True, None
```

Pair this check with the approach in [Geometry Validation Pipelines](/spatial-payload-routing-parsing/geometry-validation-pipelines/) when your pipeline receives raw WKT alongside GeoJSON, as different serialization formats have distinct validity edge cases.

### Step 3 — Compute the Partition Key

Tile events must be partitioned so that all mutations to the same tile region land on the same consumer in order. A composite `zoom:quadkey` string is deterministic, human-readable in logs, and maps directly to the cache path your tile server uses.

```python
def quadkey(zoom: int, x: int, y: int) -> str:
    """Convert z/x/y to a Bing-style quadkey string."""
    key = []
    for i in range(zoom, 0, -1):
        digit = 0
        mask = 1 << (i - 1)
        if x & mask:
            digit += 1
        if y & mask:
            digit += 2
        key.append(str(digit))
    return "".join(key)

def partition_key(event: TileUpdateEvent) -> str:
    qk = quadkey(event.zoom, event.x, event.y)
    return f"{event.zoom}:{qk}"
```

For Kafka, use this string as the message key. For SQS FIFO queues, use it as the `MessageGroupId`. Downstream consumers then process each `zoom:quadkey` group sequentially without any cross-region serialization overhead.

### Step 4 — Idempotent Async Consumer

The core worker loop uses SHA-256 of the upstream `event_id` as its idempotency key, following the hashing approach described in [Generating Deterministic Idempotency Keys for GeoJSON Events](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/generating-deterministic-idempotency-keys-for-geojson-events/). The guard lives in Redis so that all worker replicas share a consistent view.

```python
import asyncio
import hashlib
import logging
from pydantic import ValidationError

# Stubs — replace with your Redis, tile renderer, and broker bindings
async def idempotency_guard_check(key: str) -> bool: ...
async def idempotency_guard_set(key: str) -> None: ...
async def regenerate_tile(zoom: int, x: int, y: int) -> str: ...  # returns content hash
async def broadcast_tile_updated(event: TileUpdateEvent, content_hash: str) -> None: ...
async def write_to_dlq(raw: dict, reason: str) -> None: ...

async def process_tile_event(raw_payload: dict) -> None:
    try:
        event = TileUpdateEvent(**raw_payload)
    except ValidationError as exc:
        logging.error("Schema validation failed: %s", exc)
        await write_to_dlq(raw_payload, str(exc))
        return

    ok, reason = validate_geometry(raw_payload.get("geometry", {})) if "geometry" in raw_payload else (True, None)
    if not ok:
        await write_to_dlq(raw_payload, f"invalid geometry: {reason}")
        return

    idem_key = hashlib.sha256(event.event_id.encode()).hexdigest()
    if await idempotency_guard_check(idem_key):
        logging.info("Duplicate skipped: event_id=%s", event.event_id)
        return

    content_hash = await regenerate_tile(event.zoom, event.x, event.y)
    await broadcast_tile_updated(event, content_hash)
    await idempotency_guard_set(idem_key)

async def run_consumer(broker_topic: str, concurrency: int = 10) -> None:
    dlq: asyncio.Queue[dict] = asyncio.Queue()
    semaphore = asyncio.Semaphore(concurrency)

    async def bounded_process(payload: dict) -> None:
        async with semaphore:
            await process_tile_event(payload)

    # Replace with your actual broker polling loop
    async for raw in poll_broker(broker_topic):  # type: ignore[name-defined]
        asyncio.create_task(bounded_process(raw))
```

Use `httpx.AsyncClient` for CDN cache-purge calls and `aiobotocore` for S3/R2 writes so that the worker loop never blocks on I/O.

## Spatial Validation & Error Handling

Four error conditions require explicit routing rather than silent discard:

1. **Signature mismatch** — Return `401` at the edge. Do not write to the broker at all.
2. **Schema validation failure** — Pydantic `ValidationError` caught in `process_tile_event`; written to the dead-letter queue with the raw payload and error detail for operator triage.
3. **Geometry topology error** — `shapely.is_valid` returns `False`; same DLQ path as schema failure, but tagged with `reason=invalid_geometry` so alerts can distinguish schema drift from bad source data.
4. **Stale version** — When `event.version` is lower than the last committed version for that tile, the event is acknowledged and discarded without triggering regeneration. This prevents older events from overwriting newer tiles during backpressure recovery.

## Retry, Backoff & Delivery Guarantees

At-least-once delivery is the correct default for tile update pipelines. Exactly-once semantics require distributed transactions that impose latency incompatible with real-time tile invalidation, and the idempotency guard already makes at-least-once safe.

For transient regeneration failures — network errors, tile renderer timeouts — apply exponential backoff with full jitter:

```python
import random
import asyncio

async def regenerate_with_backoff(
    zoom: int,
    x: int,
    y: int,
    max_attempts: int = 5,
    base_delay: float = 0.5,
) -> str:
    for attempt in range(max_attempts):
        try:
            return await regenerate_tile(zoom, x, y)
        except Exception as exc:
            if attempt == max_attempts - 1:
                raise
            delay = base_delay * (2 ** attempt) * random.uniform(0.5, 1.5)
            logging.warning(
                "Tile regeneration failed (attempt %d/%d), retrying in %.2fs: %s",
                attempt + 1, max_attempts, delay, exc,
            )
            await asyncio.sleep(delay)
    raise RuntimeError("unreachable")  # satisfies type checker
```

After `max_attempts`, write the event to the dead-letter queue. Use the [Cache-Backed Idempotency Checks](/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) pattern to ensure that a manual DLQ replay does not re-trigger completed regenerations.

## Verification

Run this smoke test against a locally running worker to confirm the full path from raw payload to broadcast:

```python
import asyncio
import pytest

@pytest.mark.asyncio
async def test_valid_event_triggers_broadcast(monkeypatch):
    processed: list[TileUpdateEvent] = []
    broadcast_calls: list[str] = []

    async def mock_regenerate(zoom, x, y):
        return "abc123"

    async def mock_broadcast(event, content_hash):
        processed.append(event)
        broadcast_calls.append(content_hash)

    async def mock_idem_check(key):
        return False  # not yet processed

    async def mock_idem_set(key):
        pass

    monkeypatch.setattr("your_module.regenerate_tile", mock_regenerate)
    monkeypatch.setattr("your_module.broadcast_tile_updated", mock_broadcast)
    monkeypatch.setattr("your_module.idempotency_guard_check", mock_idem_check)
    monkeypatch.setattr("your_module.idempotency_guard_set", mock_idem_set)

    payload = {
        "event_id": "evt-001",
        "zoom": 12,
        "x": 2048,
        "y": 1024,
        "bbox": (-74.01, 40.70, -73.97, 40.73),
        "crs": "EPSG:4326",
        "version": 1,
        "source": "parcel-edit-service",
    }
    await process_tile_event(payload)

    assert len(processed) == 1
    assert broadcast_calls == ["abc123"]

@pytest.mark.asyncio
async def test_duplicate_event_is_skipped(monkeypatch):
    regenerate_calls: list = []

    async def mock_regenerate(zoom, x, y):
        regenerate_calls.append((zoom, x, y))
        return "abc123"

    async def mock_idem_check(key):
        return True  # already processed

    monkeypatch.setattr("your_module.regenerate_tile", mock_regenerate)
    monkeypatch.setattr("your_module.idempotency_guard_check", mock_idem_check)

    payload = {
        "event_id": "evt-002",
        "zoom": 10,
        "x": 512,
        "y": 256,
        "bbox": (-74.01, 40.70, -73.97, 40.73),
        "crs": "EPSG:4326",
        "version": 3,
        "source": "parcel-edit-service",
    }
    await process_tile_event(payload)
    assert regenerate_calls == []
```

## Troubleshooting

| Symptom | Likely Spatial Cause | Fix |
|---|---|---|
| Tiles flicker between old and new state | Out-of-order delivery overwriting newer versions | Add monotonic `version` field; skip events where `incoming.version < committed.version` |
| DLQ spike after upstream schema change | New field added without default in Pydantic model | Add `Field(default=None)` for optional fields; alert on DLQ rate > 1% of throughput |
| Hot partition bottlenecking one consumer | High-edit-frequency tile region landing on a single partition | Sub-partition by appending a fractional quadkey depth or route hot tiles to a dedicated topic |
| CDN cache not clearing after broadcast | Broadcast emitted before tile write completes | Write tile to store before publishing `tile_updated`; await storage confirmation |
| Duplicate tile regeneration on broker retry | Idempotency key TTL expired in Redis before retry window | Increase Redis TTL to at least 2× the broker's retention window |
| `shapely.is_valid` rejects polygon from trusted source | Coordinate ring winding order inverted | Call `shapely.geometry.polygon.orient(geom, sign=1.0)` to normalize orientation |

## FAQ

<details class="faq">
<summary><strong>Should I partition by H3 cell or by z/x/y quadkey?</strong></summary>

Use `z/x/y` quadkey when your downstream is an XYZ tile server — the partition key maps directly to the cache path, so routing and invalidation share the same identifier. H3 is better when you also run spatial analytics alongside tile rendering, because H3 cells support hierarchical aggregation at multiple resolutions without re-indexing.

</details>

<details class="faq">
<summary><strong>How many partitions do I need?</strong></summary>

Start with one partition per planned consumer thread, then monitor consumer lag per partition. Under-partitioning creates hot shards; over-partitioning inflates metadata overhead. A working rule: re-evaluate when any single partition sustains lag above 70% of broker retention window.

</details>

<details class="faq">
<summary><strong>Can I skip the dead-letter queue for a small deployment?</strong></summary>

Only if you are comfortable losing visibility into why events fail. Even in small deployments, a DLQ is the fastest way to detect upstream schema drift before it silently corrupts tile state.

</details>

<details class="faq">
<summary><strong>How do I handle the same tile being invalidated by both a feature edit and a sensor burst simultaneously?</strong></summary>

Process both events normally. The idempotency key is derived from each event's own `event_id`, not from the tile coordinates, so two legitimate mutations from different sources produce two regeneration calls. The version guard ensures the second call overwrites the first only if it carries a higher version number.

</details>

---

## Related

- [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/) — parent section covering event modeling, delivery guarantees, and security contracts for spatial systems
- [Best Practices for Spatial Event Payload Schemas](/core-event-fundamentals-architecture/tile-update-event-pipelines/best-practices-for-spatial-event-payload-schemas/) — field definitions, CRS declarations, and bounding-box rules for tile update payloads
- [Feature Change Triggers](/core-event-fundamentals-architecture/feature-change-triggers/) — how upstream GIS services detect and emit spatial mutations that feed this pipeline
- [Sensor Data Routing Patterns](/core-event-fundamentals-architecture/sensor-data-routing-patterns/) — partition and consumer-group strategies for high-frequency telemetry streams alongside tile events
- [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — deterministic idempotency key derivation from GeoJSON feature hashes
