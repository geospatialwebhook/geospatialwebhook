---
title: "Spatial Payload Routing & Parsing"
description: "Architectural patterns and Python implementation strategies for routing, validating, and transforming geospatial webhook payloads at production scale."
slug: "spatial-payload-routing-parsing"
type: "pillar"
breadcrumb: "Spatial Payload Routing & Parsing"
datePublished: "2025-01-15"
dateModified: "2026-06-24"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Spatial Payload Routing & Parsing",
      "description": "Architectural patterns and Python implementation strategies for routing, validating, and transforming geospatial webhook payloads at production scale.",
      "datePublished": "2025-01-15",
      "dateModified": "2026-06-24",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://geospatialwebhook.com/" },
        { "@type": "ListItem", "position": 2, "name": "Spatial Payload Routing & Parsing", "item": "https://geospatialwebhook.com/spatial-payload-routing-parsing/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "How to build a spatial payload routing and parsing pipeline in Python",
      "step": [
        { "@type": "HowToStep", "name": "Accept and triage webhook payloads at the ingestion gateway" },
        { "@type": "HowToStep", "name": "Apply content-based routing using feature type and spatial extent" },
        { "@type": "HowToStep", "name": "Validate geometry topology and enforce schema contracts" },
        { "@type": "HowToStep", "name": "Normalise coordinate reference systems to a canonical CRS" },
        { "@type": "HowToStep", "name": "Serialise and emit clean events to downstream consumers" }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "When should I partition spatial events by H3 instead of S2?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "H3 is preferable when your consumers need uniform-area hexagonal cells and you are already using Uber's ecosystem tools. S2 cells are better when you need hierarchical containment queries or integration with Google infrastructure. Both outperform simple bounding-box partitioning for skewed geographic distributions."
          }
        },
        {
          "@type": "Question",
          "name": "How do I handle mixed CRS payloads in a single event stream?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Detect the CRS from explicit properties or infer it from coordinate magnitude. Transform every incoming geometry to EPSG:4326 at the normalisation layer before it reaches any downstream service. Cache the pyproj Transformer objects by (source_crs, target_crs) tuple to avoid repeated initialisation overhead."
          }
        },
        {
          "@type": "Question",
          "name": "What is the safest way to route payloads whose geometry type is unknown?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Parse the geometry type field first with a lightweight structural check before running any topological validation. Route unknown types to a quarantine topic rather than dropping them silently, so a DLQ consumer can attempt schema detection and replay."
          }
        },
        {
          "@type": "Question",
          "name": "Is GeoJSON or Protobuf better for high-frequency spatial webhook payloads?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "GeoJSON is human-readable and broadly supported but carries 3–5× the wire size of equivalent Protobuf messages for dense coordinate arrays. For payloads exceeding a few hundred features per second, the serialisation and parsing overhead of GeoJSON becomes measurable. Protobuf with a well-designed spatial schema reduces broker latency and consumer CPU at the cost of a schema registry and code-generation step."
          }
        },
        {
          "@type": "Question",
          "name": "How do I avoid duplicate spatial events reaching downstream consumers?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Generate a deterministic idempotency key from a stable hash of the geometry, source identifier, and event timestamp. Check the key against a Redis SET NX EX store at the routing layer before publishing. Duplicates are discarded before they enter the broker, keeping consumer logic simple."
          }
        }
      ]
    }
  ]
}
</script>

IoT sensors, field data collectors, satellite downlinks, and third-party GIS platforms continuously stream coordinate data, feature updates, and spatial events into backend systems. Handling this influx requires more than a standard REST endpoint — it demands a resilient, event-driven architecture where spatial payload routing and parsing acts as the central nervous system. For platform engineers, GIS backend developers, and real-time spatial application builders, mastering this layer is the difference between a brittle data pipeline and a scalable, fault-tolerant spatial mesh.

This guide covers the architectural patterns, Python implementation strategies, and operational safeguards required to route, validate, and transform spatial payloads efficiently in production.

---

## Anatomy of a Spatial Ingestion Pipeline

A spatial payload does not travel from source to consumer in a single hop. In a well-designed event-driven system, it passes through three distinct logical layers, each with a narrow, well-defined responsibility.

<svg viewBox="0 0 720 300" role="img" aria-label="Three-layer spatial ingestion pipeline: Ingestion Gateway, Routing Engine, and Parsing and Normalisation Layer" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:720px;height:auto;display:block;margin:1.5rem auto;">
  <title>Spatial Ingestion Pipeline</title>
  <desc>Diagram showing how a spatial webhook payload flows from the Ingestion Gateway through the Routing Engine into the Parsing and Normalisation Layer before reaching downstream consumers.</desc>

  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>

  <!-- Layer boxes -->
  <rect x="20"  y="60" width="160" height="180" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <rect x="280" y="60" width="160" height="180" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <rect x="540" y="60" width="160" height="180" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>

  <!-- Layer fills -->
  <rect x="20"  y="60" width="160" height="180" rx="10" fill="#e8f5e9" opacity="0.18"/>
  <rect x="280" y="60" width="160" height="180" rx="10" fill="#fce4ec" opacity="0.18"/>
  <rect x="540" y="60" width="160" height="180" rx="10" fill="#fff3e0" opacity="0.18"/>

  <!-- Layer headings -->
  <text x="100" y="90" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.85">Ingestion Gateway</text>
  <text x="360" y="90" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.85">Routing Engine</text>
  <text x="620" y="90" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.85">Parse &amp; Normalise</text>

  <!-- Bullets layer 1 -->
  <text x="35" y="118" font-size="10" fill="currentColor" opacity="0.7">• TLS termination</text>
  <text x="35" y="136" font-size="10" fill="currentColor" opacity="0.7">• Rate limiting</text>
  <text x="35" y="154" font-size="10" fill="currentColor" opacity="0.7">• Auth + HMAC</text>
  <text x="35" y="172" font-size="10" fill="currentColor" opacity="0.7">• Push to broker</text>
  <text x="35" y="190" font-size="10" fill="currentColor" opacity="0.7">• Ack immediately</text>

  <!-- Bullets layer 2 -->
  <text x="295" y="118" font-size="10" fill="currentColor" opacity="0.7">• Feature type check</text>
  <text x="295" y="136" font-size="10" fill="currentColor" opacity="0.7">• Spatial extent hash</text>
  <text x="295" y="154" font-size="10" fill="currentColor" opacity="0.7">• Priority assignment</text>
  <text x="295" y="172" font-size="10" fill="currentColor" opacity="0.7">• Partition key (H3/S2)</text>
  <text x="295" y="190" font-size="10" fill="currentColor" opacity="0.7">• Idempotency filter</text>

  <!-- Bullets layer 3 -->
  <text x="555" y="118" font-size="10" fill="currentColor" opacity="0.7">• Schema validation</text>
  <text x="555" y="136" font-size="10" fill="currentColor" opacity="0.7">• Topology check</text>
  <text x="555" y="154" font-size="10" fill="currentColor" opacity="0.7">• CRS transform</text>
  <text x="555" y="172" font-size="10" fill="currentColor" opacity="0.7">• Serialise output</text>
  <text x="555" y="190" font-size="10" fill="currentColor" opacity="0.7">• Enrich + emit</text>

  <!-- Arrows between layers -->
  <line x1="182" y1="150" x2="278" y2="150" stroke="currentColor" stroke-width="1.5" opacity="0.45" marker-end="url(#arr)"/>
  <line x1="442" y1="150" x2="538" y2="150" stroke="currentColor" stroke-width="1.5" opacity="0.45" marker-end="url(#arr)"/>

  <!-- Webhook source label -->
  <text x="100" y="268" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.55">Webhook / IoT source</text>
  <line x1="100" y1="242" x2="100" y2="255" stroke="currentColor" stroke-width="1" opacity="0.35" stroke-dasharray="3,2"/>

  <!-- Consumer label -->
  <text x="620" y="268" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.55">Downstream consumers</text>
  <line x1="620" y1="242" x2="620" y2="255" stroke="currentColor" stroke-width="1" opacity="0.35" stroke-dasharray="3,2"/>
</svg>

**Layer 1 — Ingestion Gateway.** Accepts HTTP webhook payloads, applies rate limiting, validates HMAC signatures (as detailed in [Securing Webhook Endpoints with Spatial Token Validation](/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/)), and pushes raw messages to a message broker — Apache Kafka, RabbitMQ, AWS Kinesis, or Redis Streams. The gateway acknowledges immediately and never blocks on parsing.

**Layer 2 — Routing Engine.** Inspects payload metadata and spatial attributes to determine destination queues, processing priority, and transformation requirements. This is where geographic partitioning, feature-type classification, and idempotency filtering occur.

**Layer 3 — Parsing & Normalisation.** Validates geometry, resolves coordinate reference systems (CRS), enforces schema contracts, and emits clean, standardised events to downstream services.

The challenge is the spatial nature of the data. Unlike flat JSON objects, geospatial payloads carry coordinate arrays, topology constraints, and projection metadata. A single malformed polygon or mismatched CRS can stall a synchronous worker and degrade the entire ingestion pipeline. Production systems decouple ingestion from processing so that the routing layer can triage payloads based on complexity, origin, and downstream SLAs.

---

## Architectural Patterns

### Pattern 1: Content-Based Spatial Routing

Content-based routing evaluates the internal structure of each payload rather than its HTTP headers alone.

**Feature classification** dispatches `Point` payloads to real-time tracking services, while `Polygon` and `MultiPolygon` updates route to analytics engines or tiling queues. This one decision eliminates a class of head-of-line blocking where a large complex polygon occupies a worker that should be processing lightweight point telemetry.

**Schema detection** identifies whether the payload conforms to GeoJSON (RFC 7946), Esri JSON, WKT, or a proprietary binary format, then dispatches to the appropriate deserialiser. When payloads exceed typical JSON size limits or require strict bandwidth optimisation, teams migrate to compact binary formats — the trade-offs are explored in depth in [GeoJSON to Protobuf Mapping](/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/).

**Metadata tagging** extracts timestamps, device IDs, and confidence scores to route high-fidelity sensor data to archival stores while sending low-confidence telemetry to filtering queues. Tags are extracted once at the gateway and propagated as message attributes — downstream workers never re-parse the raw payload to make routing decisions.

```python
from enum import Enum
from typing import Any

class RouteTarget(str, Enum):
    REALTIME_TRACKING = "realtime.tracking"
    ANALYTICS_BATCH   = "analytics.batch"
    TILE_INVALIDATION = "tile.invalidation"
    QUARANTINE        = "quarantine"
    DLQ               = "dlq"

def classify_payload(payload: dict[str, Any]) -> RouteTarget:
    """Route a GeoJSON feature to the appropriate broker topic."""
    geom = payload.get("geometry") or {}
    geom_type = geom.get("type", "Unknown")
    confidence = payload.get("properties", {}).get("confidence", 1.0)

    if confidence < 0.4:
        return RouteTarget.QUARANTINE
    if geom_type == "Point":
        return RouteTarget.REALTIME_TRACKING
    if geom_type in ("Polygon", "MultiPolygon"):
        # High-vertex polygons go to batch analytics; small ones trigger tile updates
        coords = geom.get("coordinates", [[[]]])
        vertex_count = sum(len(ring) for ring in coords[0]) if coords else 0
        return RouteTarget.ANALYTICS_BATCH if vertex_count > 500 else RouteTarget.TILE_INVALIDATION
    return RouteTarget.QUARANTINE
```

### Pattern 2: Spatial Partitioning with Index-Aware Dispatch

Spatial partitioning ensures that related events land in the same consumer group, preserving ordering and reducing cross-region joins. Production pipelines use spatial indexing schemes such as H3, S2, or Quadkeys rather than tenant ID alone. By hashing the centroid or bounding box of an incoming geometry, the router assigns the payload to a specific partition key. This guarantees that all updates affecting a specific tile, watershed, or administrative boundary are processed sequentially by the same worker instance, eliminating race conditions during topology updates.

```python
import h3
from shapely.geometry import shape

def spatial_partition_key(geojson_geometry: dict, resolution: int = 7) -> str:
    """
    Compute an H3 cell key at the given resolution for a GeoJSON geometry.
    Resolution 7 gives cells ~5 km² — suitable for most fleet-tracking workloads.
    """
    geom = shape(geojson_geometry)
    centroid = geom.centroid
    # h3.latlng_to_cell expects (lat, lng) — note axis order
    return h3.latlng_to_cell(centroid.y, centroid.x, resolution)
```

Partition skew — where a disproportionate share of events map to a single cell — is one of the most common production problems in geographic workloads. Monitor the distribution of partition keys and re-shard hot cells by dropping the H3 resolution one level (larger cells) or splitting at the broker level. The same ordering concern arises for tile invalidation events, which are covered in [Tile Update Event Pipelines](/core-event-fundamentals-architecture/tile-update-event-pipelines/).

### Pattern 3: Priority Routing with Multi-Path Queues

Not all spatial events carry equal urgency. Real-time asset tracking demands sub-second processing; historical boundary corrections can tolerate eventual consistency. Priority routing assigns weights based on payload metadata:

- **Hot path** — low-latency queues for live tracking, emergency response, and dynamic pricing engines.
- **Warm path** — batch-friendly queues for analytics aggregation, map tile regeneration, and ML feature extraction.
- **Cold path** — archival queues for compliance logging, long-term trend analysis, and cold-storage replication.

```python
import asyncio
from dataclasses import dataclass

@dataclass
class SpatialEvent:
    payload: dict
    sla_ms: int          # maximum acceptable processing latency in milliseconds
    event_type: str

HOT_THRESHOLD_MS  = 500
WARM_THRESHOLD_MS = 30_000

async def publish_with_priority(
    event: SpatialEvent,
    broker_client,
) -> None:
    """Publish a spatial event to the broker topic that matches its SLA."""
    if event.sla_ms <= HOT_THRESHOLD_MS:
        topic = "spatial.hot"
    elif event.sla_ms <= WARM_THRESHOLD_MS:
        topic = "spatial.warm"
    else:
        topic = "spatial.cold"

    await broker_client.publish(topic, event.payload, priority=event.sla_ms)
```

---

## Python Implementation & Serialisation

### Async Gateway with FastAPI

The ingestion gateway should be non-blocking from first byte to broker acknowledgement. FastAPI with `asyncio` handles thousands of concurrent webhook connections without thread starvation. The HTTP handler must never parse geometry — it acknowledges the request, publishes the raw bytes, and returns.

```python
import hashlib
import hmac
import json
import os

from fastapi import FastAPI, HTTPException, Request
from aiokafka import AIOKafkaProducer

app = FastAPI()
_producer: AIOKafkaProducer | None = None
WEBHOOK_SECRET = os.environ["WEBHOOK_SECRET"].encode()

@app.on_event("startup")
async def startup() -> None:
    global _producer
    _producer = AIOKafkaProducer(bootstrap_servers=os.environ["KAFKA_BROKERS"])
    await _producer.start()

@app.post("/webhook/spatial")
async def receive_spatial_event(request: Request) -> dict:
    body = await request.body()

    # Validate HMAC-SHA256 signature before touching payload content
    sig_header = request.headers.get("X-Spatial-Signature", "")
    expected = "sha256=" + hmac.new(WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig_header, expected):
        raise HTTPException(status_code=401, detail="Invalid signature")

    # Publish raw bytes — DO NOT parse geometry here
    await _producer.send_and_wait("spatial.raw", body)
    return {"status": "accepted"}
```

### Serialisation Format Trade-offs

| Format | Wire size (1 k features) | Parse time | Schema evolution | Use case |
|---|---|---|---|---|
| GeoJSON | ~2.4 MB | fast | flexible | External integrations, low frequency |
| MessagePack | ~0.9 MB | fast | flexible | Internal queues, moderate frequency |
| Protobuf | ~0.5 MB | very fast | strict (registry) | High-throughput internal pipelines |
| FlatBuffers | ~0.45 MB | near-zero copy | strict | Memory-mapped, read-heavy consumers |

GeoJSON is broadly supported and human-readable, but for payloads exceeding a few hundred features per second the serialisation overhead becomes measurable. [GeoJSON to Protobuf Mapping](/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/) covers schema design and field compression strategies that reduce broker latency without sacrificing spatial fidelity.

### Parsing Workers

Parsing workers consume from the broker and must never block the event loop on CPU-bound geometry operations. Offload heavy transformations to a process pool:

```python
import asyncio
import json
from concurrent.futures import ProcessPoolExecutor
from shapely.geometry import shape
from shapely.validation import make_valid

_executor = ProcessPoolExecutor(max_workers=4)

def _parse_geometry_sync(geom_dict: dict) -> dict:
    """Run in a subprocess — safe to block; does not hold the event loop."""
    geom = shape(geom_dict)
    if not geom.is_valid:
        geom = make_valid(geom)
    return {
        "wkt": geom.wkt,
        "bounds": geom.bounds,
        "centroid": (geom.centroid.x, geom.centroid.y),
        "area_m2": geom.area,  # only meaningful in projected CRS
    }

async def parse_geometry(geom_dict: dict) -> dict:
    """Async wrapper — returns to the event loop while the subprocess runs."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_executor, _parse_geometry_sync, geom_dict)
```

For sustained high concurrency, the patterns in [Async Processing for Heavy Geometries](/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) explore worker-pool sizing, backpressure signalling, and memory caps for large polygon sets.

---

## Spatial-Specific Concerns

### CRS Normalisation

Coordinate Reference Systems are the silent killers of spatial pipelines. A payload might arrive in EPSG:4326 (WGS84 geographic), EPSG:3857 (Web Mercator), EPSG:27700 (British National Grid), or a local engineering system. Downstream services typically expect a single canonical CRS — EPSG:4326 for global storage, EPSG:3857 for web rendering. The normalisation layer must:

1. Detect explicit `crs` properties or infer them from coordinate magnitude and axis ordering.
2. Transform coordinates using `pyproj`, caching `Transformer` objects by `(source_epsg, target_epsg)` tuple to avoid repeated initialisation.
3. Handle datum shifts, axis ordering (lat/lon vs lon/lat per EPSG convention), and precision loss gracefully.

```python
from functools import lru_cache
from pyproj import Transformer

@lru_cache(maxsize=64)
def _get_transformer(source_epsg: int, target_epsg: int) -> Transformer:
    """Cache transformers — initialisation is expensive; reuse across requests."""
    return Transformer.from_crs(
        f"EPSG:{source_epsg}",
        f"EPSG:{target_epsg}",
        always_xy=True,   # force (lon, lat) order regardless of EPSG convention
    )

def transform_coordinates(
    coords: list[list[float]],
    source_epsg: int,
    target_epsg: int = 4326,
) -> list[list[float]]:
    tf = _get_transformer(source_epsg, target_epsg)
    return [[*tf.transform(x, y)] for x, y in coords]
```

[CRS Normalization Strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/) covers fallback heuristics for payloads with missing or ambiguous CRS metadata, projection caching, and audit logging to maintain spatial integrity across mixed-source streams. When payloads carry entirely unknown projections, [Handling Mixed CRS Payloads in Python Event Handlers](/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/) provides a step-by-step detection and transformation workflow.

### Geometry Validation Before Dispatch

Geospatial payloads frequently violate implicit assumptions. Coordinates may fall outside valid bounds, rings may self-intersect, or topology rules may be broken. Validation occurs in two phases:

1. **Structural validation** — ensures required fields exist, types match, and coordinate arrays are properly nested. Use Pydantic with a typed `GeoJSONGeometry` model.
2. **Topological validation** — verifies geometric integrity using Shapely or GEOS. This catches invalid polygons, unclosed rings, and duplicate vertices before they corrupt spatial indexes.

Invalid geometries should be quarantined rather than silently dropped or propagated. The full validation pipeline, including per-tenant rule configuration, is described in [Geometry Validation Pipelines](/spatial-payload-routing-parsing/geometry-validation-pipelines/).

### Spatial Indexing Strategy

Choosing the right cell scheme for partitioning and spatial join keys depends on your query patterns:

| Scheme | Cell shape | Uniform area | Hierarchy | Best for |
|---|---|---|---|---|
| H3 | Hexagon | Yes (approx.) | Yes (15 levels) | Density grids, isochrones, fleet tracking |
| S2 | Curved quad | No | Yes (30 levels) | Containment queries, global coverage |
| Quadkey | Rectangle | No | Yes (zoom-based) | Tile systems, slippy-map integration |

For most fleet-tracking workloads, H3 at resolution 7 (~5 km² cells) provides a good balance between cardinality and granularity. Sensor routing patterns that rely on cell-based dispatch are covered in [Sensor Data Routing Patterns](/core-event-fundamentals-architecture/sensor-data-routing-patterns/).

---

## Production Hardening

### Failure Modes and Error Classification

Spatial data is inherently messy. Production systems categorise failures before deciding on a recovery path:

- **Transient errors** — network timeouts, broker unavailability, temporary resource exhaustion. These trigger exponential backoff with jitter and requeue on the same topic.
- **Permanent errors** — invalid topology that `make_valid` cannot repair, unsupported CRS, schema violations. These bypass retries and move to a Dead Letter Queue (DLQ).
- **Ambiguous errors** — payloads that pass structural validation but fail business rules (e.g., coordinates outside the expected bounding box for a regional deployment). These route to a quarantine topic for manual review or automated reconciliation.

```python
import asyncio
import random
import logging
from typing import Callable, Awaitable

logger = logging.getLogger(__name__)

class SpatialProcessingError(Exception):
    """Permanent failure — do not retry."""

async def process_with_backoff(
    fn: Callable[[], Awaitable[None]],
    max_attempts: int = 5,
    base_delay: float = 0.5,
) -> None:
    """Exponential backoff with full jitter for transient spatial pipeline errors."""
    for attempt in range(1, max_attempts + 1):
        try:
            await fn()
            return
        except SpatialProcessingError:
            raise  # permanent — let caller route to DLQ
        except Exception as exc:
            if attempt == max_attempts:
                raise
            delay = base_delay * (2 ** (attempt - 1)) * random.random()
            logger.warning("Attempt %d failed (%s); retrying in %.2fs", attempt, exc, delay)
            await asyncio.sleep(delay)
```

At-least-once delivery for spatial webhooks requires careful idempotency design, covered in [Implementing At-Least-Once Delivery for GIS Webhooks](/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/).

### Idempotency and Deduplication

Webhooks frequently deliver duplicate events due to network retries or upstream system failures. The routing layer must implement idempotency keys — typically derived from a stable hash of the geometry, source identifier, and event timestamp — and check them against a Redis-backed store before publishing downstream.

```python
import hashlib
import json
import redis.asyncio as aioredis

_redis: aioredis.Redis | None = None

async def is_duplicate(payload: dict, ttl_seconds: int = 86400) -> bool:
    """
    Return True if this payload has already been processed.
    Key expires after TTL to avoid unbounded growth.
    """
    # Hash over a stable subset — exclude mutable envelope fields
    key_data = json.dumps({
        "geometry": payload.get("geometry"),
        "source_id": payload.get("properties", {}).get("source_id"),
        "event_time": payload.get("properties", {}).get("event_time"),
    }, sort_keys=True)
    idem_key = "spatial:idem:" + hashlib.sha256(key_data.encode()).hexdigest()
    result = await _redis.set(idem_key, "1", nx=True, ex=ttl_seconds)
    return result is None  # SET NX returns None if key already existed
```

The deterministic key generation strategy used here is discussed in detail in [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/), and the Redis-backed signature cache pattern is explored in [Using Redis to Cache Spatial Webhook Signatures](/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/).

### Monitoring Metrics for Geo Workloads

Standard application metrics are necessary but not sufficient for a spatial pipeline. Instrument these additional signals:

| Metric | Type | Alert threshold |
|---|---|---|
| `spatial.crs_transform_latency_ms` | Histogram (p95/p99) | p99 > 50 ms |
| `spatial.geometry_vertex_count` | Histogram | p99 > 50 000 vertices |
| `spatial.validation_failure_rate` | Counter / rate | > 2% over 5 min |
| `spatial.partition_skew_ratio` | Gauge | Top cell > 20× median |
| `spatial.dlq_depth` | Gauge | Any growth over 60 s |
| `spatial.consumer_lag_per_h3_cell` | Gauge per cell | Lag > 10 000 messages |

Use percentiles (p95, p99) rather than averages — spatial payloads exhibit high variance driven by geometry complexity. Partition skew monitoring is particularly important: a single hot H3 cell can cause one consumer instance to fall behind while others sit idle.

### Security and Compliance

Geospatial payloads often contain sensitive location data. The ingestion gateway must validate TLS certificates, enforce IP allowlists, and strip unnecessary headers. Payload encryption at rest and in transit is mandatory for regulated industries. Coordinate masking or spatial generalisation — snapping coordinates to a coarser grid — can reduce precision for non-essential consumers while preserving analytical utility. The full security model, including HMAC validation and spatial token schemes, is covered in [Webhook Security Boundaries](/core-event-fundamentals-architecture/webhook-security-boundaries/).

---

## Frequently Asked Questions

<details class="faq">
<summary><strong>When should I partition spatial events by H3 instead of S2?</strong></summary>

H3 is preferable when your consumers need uniform-area hexagonal cells and you are already using Uber's ecosystem tools. S2 cells are better when you need hierarchical containment queries or integration with Google infrastructure. Both outperform simple bounding-box partitioning for skewed geographic distributions. For slippy-map tile workflows, Quadkeys align naturally with zoom levels and avoid the cell-boundary artefacts that hex grids introduce at low resolutions.
</details>

<details class="faq">
<summary><strong>How do I handle mixed CRS payloads in a single event stream?</strong></summary>

Detect the CRS from explicit properties or infer it from coordinate magnitude (values > 180 are almost certainly projected, not geographic). Transform every incoming geometry to EPSG:4326 at the normalisation layer before it reaches any downstream service. Cache `pyproj.Transformer` objects by `(source_epsg, target_epsg)` tuple to avoid repeated initialisation overhead. Log the original CRS alongside the transformed output for audit purposes.
</details>

<details class="faq">
<summary><strong>What is the safest way to route payloads whose geometry type is unknown?</strong></summary>

Parse the geometry type field first with a lightweight structural check before running any topological validation. Route unknown types to a quarantine topic rather than dropping them silently, so a DLQ consumer can attempt schema detection and replay. Never let an unknown geometry type propagate to a spatial index or database — invalid inserts are far more expensive to remediate than a quarantine backlog.
</details>

<details class="faq">
<summary><strong>Is GeoJSON or Protobuf better for high-frequency spatial webhook payloads?</strong></summary>

GeoJSON is human-readable and broadly supported but carries 3–5× the wire size of equivalent Protobuf messages for dense coordinate arrays. For payloads exceeding a few hundred features per second, the serialisation and parsing overhead of GeoJSON becomes measurable. Protobuf with a well-designed spatial schema reduces broker latency and consumer CPU at the cost of a schema registry and code-generation step. MessagePack is a practical middle ground — smaller than GeoJSON, no schema registry required.
</details>

<details class="faq">
<summary><strong>How do I avoid duplicate spatial events reaching downstream consumers?</strong></summary>

Generate a deterministic idempotency key from a stable hash of the geometry, source identifier, and event timestamp. Check the key against a Redis `SET NX EX` store at the routing layer before publishing. Duplicates are discarded before they enter the broker, keeping consumer logic simple. Coordinate overlap deduplication — where two near-identical geometries from different sources must be collapsed — requires a spatial join step and is addressed in [Spatial Overlap Deduplication](/idempotency-spatial-deduplication/spatial-overlap-deduplication/).
</details>

---

## Related

- [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/) — event-driven foundations, feature-change triggers, and webhook security boundaries
- [Geometry Validation Pipelines](/spatial-payload-routing-parsing/geometry-validation-pipelines/) — topology checks, Shapely-based repair, and per-tenant validation rules
- [CRS Normalization Strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/) — detecting, transforming, and auditing coordinate reference systems in event streams
- [Idempotency & Spatial Deduplication](/idempotency-spatial-deduplication/) — idempotency key design, Redis-backed signature caches, and overlap deduplication
- [Async Processing for Heavy Geometries](/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) — worker-pool patterns for CPU-bound geometry operations
