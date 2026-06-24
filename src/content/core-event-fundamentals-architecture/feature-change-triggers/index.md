---
title: "Feature Change Triggers for Geospatial Webhooks"
description: "Detect, validate, and dispatch spatial feature change events in Python — from database CDC interception to HMAC-signed webhook delivery with retry guarantees."
slug: "feature-change-triggers"
type: "cluster"
breadcrumb: "Feature Change Triggers"
datePublished: "2024-11-01"
dateModified: "2026-06-24"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Feature Change Triggers for Geospatial Webhooks",
      "description": "Step-by-step guide to detecting, validating, and dispatching spatial feature change events in Python — from database CDC interception to HMAC-signed webhook delivery with retry guarantees.",
      "datePublished": "2024-11-01",
      "dateModified": "2026-06-24",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://geospatialwebhook.com/" },
        { "@type": "ListItem", "position": 2, "name": "Core Event Fundamentals & Architecture", "item": "https://geospatialwebhook.com/core-event-fundamentals-architecture/" },
        { "@type": "ListItem", "position": 3, "name": "Feature Change Triggers", "item": "https://geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Implement Feature Change Triggers for Geospatial Webhooks",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Intercept spatial mutations at the data layer" },
        { "@type": "HowToStep", "position": 2, "name": "Normalize and validate geometry" },
        { "@type": "HowToStep", "position": 3, "name": "Construct a CloudEvents-compliant envelope" },
        { "@type": "HowToStep", "position": 4, "name": "Route and partition spatial events" },
        { "@type": "HowToStep", "position": 5, "name": "Dispatch webhooks with delivery guarantees" },
        { "@type": "HowToStep", "position": 6, "name": "Verify end-to-end delivery" }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should I use logical replication or a polling loop to detect feature changes?",
          "acceptedAnswer": { "@type": "Answer", "text": "Prefer PostgreSQL logical replication (via pgoutput or wal2json) or Debezium CDC over polling. Polling introduces latency proportional to the interval, loads the database at scale, and misses rapid bursts of changes between poll ticks. Logical decoding emits events immediately after each committed transaction, with sub-second latency and no additional query load." }
        },
        {
          "@type": "Question",
          "name": "What is the right partitioning key for a geospatial event stream?",
          "acceptedAnswer": { "@type": "Answer", "text": "Partition by spatial tile key (H3 or Quadkey cell at an appropriate resolution) when you need geographic locality — all mutations affecting the same tile land in the same partition. Use tenant ID for multi-tenant isolation. Use feature class (parcel, road, sensor) when consumers are specialized. Avoid partitioning by raw geometry hash: the distribution is uneven in dense urban areas." }
        },
        {
          "@type": "Question",
          "name": "How large can a spatial webhook payload be before I need to chunk it?",
          "acceptedAnswer": { "@type": "Answer", "text": "Most webhook endpoints and message brokers cap messages at 256 KB–1 MB. Complex polygon boundaries or dense multilinestrings can exceed this. Simplify geometry server-side with Douglas-Peucker (shapely's .simplify()) before enveloping, or split multi-part geometries into individual events with a shared correlation ID." }
        },
        {
          "@type": "Question",
          "name": "How do I handle a CRS mismatch between the source database and my webhook consumers?",
          "acceptedAnswer": { "@type": "Answer", "text": "Establish a canonical CRS at the event boundary — EPSG:4326 for web delivery is the safest default. Convert every geometry to that CRS inside the validation step using pyproj, and stamp the crs extension field in the CloudEvents envelope. Consumers that internally use EPSG:3857 or a national grid perform their own local reprojection from the canonical form." }
        }
      ]
    }
  ]
}
</script>

**Feature change triggers are the mechanism that converts a spatial database write — a parcel edit, a route update, a sensor footprint move — into a reliable, signed webhook event delivered to downstream consumers.** This guide walks through every production layer, from CDC interception to exponential-backoff retry, with runnable Python at each step.

This topic is part of [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/), which covers the full event pipeline from spatial mutation to consumer acknowledgement.

## Prerequisites

Before implementing, confirm your stack meets these baselines:

- [ ] Python 3.10+ (structural pattern matching, native `asyncio`, strict type hints)
- [ ] Asynchronous web framework: FastAPI, Starlette, or aiohttp
- [ ] PostgreSQL/PostGIS with logical replication enabled, or a CDC connector (Debezium, pg_logical)
- [ ] Message broker: Redis Streams, Apache Kafka, or AWS SQS/SNS
- [ ] `shapely` 2.x for geometry validation and repair
- [ ] `pyproj` 3.x for CRS transformation
- [ ] `httpx` for async outbound HTTP with timeout and retry control
- [ ] `pydantic` v2 for event envelope schema enforcement

## Architecture overview

A spatial feature change moves through four layers before a consumer acknowledges receipt:

<svg viewBox="0 0 720 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Feature change trigger pipeline: PostGIS → CDC stream → validation & envelope → broker → webhook dispatcher → consumer" style="width:100%;max-width:720px;height:auto;display:block;margin:1.5rem auto;">
  <title>Feature change trigger pipeline</title>
  <desc>Four-layer pipeline showing a spatial mutation flowing from PostGIS logical replication through geometry validation and CloudEvents enveloping, into a message broker, then out through an async webhook dispatcher to a downstream consumer.</desc>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Layer boxes -->
  <rect x="10" y="70" width="120" height="80" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <text x="70" y="104" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">PostGIS</text>
  <text x="70" y="120" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif" opacity="0.75">logical replication</text>
  <text x="70" y="136" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.6">(CDC / WAL)</text>

  <line x1="130" y1="110" x2="158" y2="110" stroke="currentColor" stroke-width="1.5" opacity="0.5" marker-end="url(#arr)"/>

  <rect x="160" y="55" width="140" height="110" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <text x="230" y="89" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">Validate &amp; Envelop</text>
  <text x="230" y="107" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.75">CRS → EPSG:4326</text>
  <text x="230" y="122" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.75">topology check</text>
  <text x="230" y="137" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.75">CloudEvents wrap</text>
  <text x="230" y="152" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.6">idempotency key</text>

  <line x1="300" y1="110" x2="328" y2="110" stroke="currentColor" stroke-width="1.5" opacity="0.5" marker-end="url(#arr)"/>

  <rect x="330" y="70" width="120" height="80" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <text x="390" y="104" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">Broker</text>
  <text x="390" y="120" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif" opacity="0.75">Kafka / Redis</text>
  <text x="390" y="136" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.6">spatial partition key</text>

  <line x1="450" y1="110" x2="478" y2="110" stroke="currentColor" stroke-width="1.5" opacity="0.5" marker-end="url(#arr)"/>

  <rect x="480" y="55" width="130" height="110" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <text x="545" y="89" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">Dispatcher</text>
  <text x="545" y="107" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.75">HMAC-SHA256 sign</text>
  <text x="545" y="122" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.75">exponential backoff</text>
  <text x="545" y="137" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.75">DLQ on failure</text>
  <text x="545" y="152" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.6">→ consumer endpoint</text>

  <!-- Stage labels at top -->
  <text x="70"  y="48" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.5">1. Source</text>
  <text x="230" y="40" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.5">2. Normalise</text>
  <text x="390" y="48" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.5">3. Route</text>
  <text x="545" y="40" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif" opacity="0.5">4. Deliver</text>
</svg>

## Step-by-step implementation

### 1. Intercept spatial mutations at the data layer

Spatial databases rarely emit events in a webhook-ready format. Use PostgreSQL logical replication with the `pgoutput` plugin, or a Debezium CDC connector, to stream committed `INSERT`, `UPDATE`, and `DELETE` operations from your feature tables without polling.

Logical decoding guarantees events are emitted only after the originating transaction commits — no phantom updates from rolled-back writes. Extract four fields at minimum: primary key, old geometry (for `UPDATE`/`DELETE`), new geometry, and the operation type.

```python
import asyncpg

REPLICATION_DSN = "postgresql://user:pass@localhost/gis?replication=database"

async def stream_feature_changes(slot_name: str, publication: str):
    conn = await asyncpg.connect(dsn=REPLICATION_DSN)
    await conn.execute(
        "SELECT pg_create_logical_replication_slot($1, 'pgoutput')", slot_name
    )
    async with conn.replication(slot_name, output_plugin="pgoutput",
                                 options={"publication_names": publication}) as stream:
        async for message in stream:
            yield parse_wal_message(message)  # returns dict with op, pk, old_geom, new_geom
```

For a complete walkthrough of how this feeds into a full webhook architecture, see [How to design a geospatial webhook architecture in Python](/core-event-fundamentals-architecture/feature-change-triggers/how-to-design-a-geospatial-webhook-architecture-in-python/).

### 2. Normalize and validate geometry

Raw database geometries contain topology errors, mismatched coordinate reference systems, and floating-point noise that break downstream consumers. Enforce spatial integrity before packaging any event, using [CRS Normalization Strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/) as the authoritative reference for reprojection patterns.

The three mandatory checks are:

1. **CRS alignment** — reproject all geometries to `EPSG:4326` for web delivery (or `EPSG:3857` for tile-based systems). Always include the EPSG code in the event envelope so consumers do not have to guess.
2. **Topology validation** — verify polygon closure, absence of self-intersections, and minimum vertex counts. `shapely`'s `make_valid()` repairs most topology errors automatically; raise on the remainder.
3. **Coordinate precision reduction** — snap to 6–7 decimal places to eliminate floating-point drift across consumers and reduce payload size.

```python
from shapely.geometry import shape, mapping
from shapely.validation import explain_validity, make_valid
from shapely import set_precision
import pyproj
from functools import partial

_transformer_to_4326 = pyproj.Transformer.from_crs(
    "EPSG:3857", "EPSG:4326", always_xy=True
)

def normalize_geometry(geojson_geometry: dict, source_epsg: int = 4326) -> dict:
    """Validate, repair, reproject, and reduce precision of a GeoJSON geometry."""
    geom = shape(geojson_geometry)

    if not geom.is_valid:
        geom = make_valid(geom)
        if not geom.is_valid:
            raise ValueError(f"Irreparable topology: {explain_validity(geom)}")

    if source_epsg != 4326:
        transformer = pyproj.Transformer.from_crs(
            f"EPSG:{source_epsg}", "EPSG:4326", always_xy=True
        )
        geom = pyproj.transform(transformer.transform, geom)

    # Snap coordinates to 7 decimal places (~1 cm precision at equator)
    geom = set_precision(geom, grid_size=1e-7)
    return mapping(geom)
```

Validate the resulting GeoJSON against the [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946) schema with Pydantic before enveloping:

```python
from pydantic import BaseModel, field_validator
from typing import Literal

class GeoJSONGeometry(BaseModel):
    type: Literal["Point", "LineString", "Polygon", "MultiPolygon",
                  "MultiPoint", "MultiLineString", "GeometryCollection"]
    coordinates: list

    @field_validator("coordinates")
    @classmethod
    def coordinates_not_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("coordinates must not be empty")
        return v

class SpatialFeatureEvent(BaseModel):
    feature_id: str
    operation: Literal["INSERT", "UPDATE", "DELETE"]
    geometry: GeoJSONGeometry
    crs: str = "EPSG:4326"
    properties: dict = {}
```

### 3. Construct the event envelope

Wrap validated geometry in a [CloudEvents](https://cloudevents.io/) 1.0 envelope to ensure interoperability across heterogeneous consumers. The envelope separates routing metadata from spatial payload, making it possible to filter and forward events without deserializing geometries.

Add three spatial extension attributes: `crs` (always include the EPSG code), `bbox`, and `spatialoperation`. Generate a deterministic idempotency key from the feature ID and operation, following the approach in [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/).

```python
import uuid
import hashlib
import json
from datetime import datetime, timezone

def build_event_envelope(
    feature_event: SpatialFeatureEvent,
    source: str = "/postgis/features",
) -> dict:
    # Deterministic ID: same feature + operation + geometry hash → same UUID
    geom_hash = hashlib.sha256(
        json.dumps(feature_event.geometry.model_dump(), sort_keys=True).encode()
    ).hexdigest()[:16]
    event_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{feature_event.feature_id}:{feature_event.operation}:{geom_hash}"))

    geom_dict = feature_event.geometry.model_dump()
    coords = geom_dict.get("coordinates", [])

    return {
        "specversion": "1.0",
        "type": f"com.geospatialwebhook.feature.{feature_event.operation.lower()}",
        "source": source,
        "id": event_id,
        "time": datetime.now(timezone.utc).isoformat(),
        "datacontenttype": "application/geo+json",
        # Spatial extensions
        "crs": feature_event.crs,
        "spatialoperation": feature_event.operation,
        "data": {
            "type": "Feature",
            "geometry": geom_dict,
            "properties": {
                "feature_id": feature_event.feature_id,
                **feature_event.properties,
            },
        },
    }
```

When evolving schemas across teams, use additive-only minor changes: new optional fields are safe; renaming or removing fields requires a version bump and coordinated consumer migration. The [best practices for spatial event payload schemas](/core-event-fundamentals-architecture/tile-update-event-pipelines/best-practices-for-spatial-event-payload-schemas/) page covers versioning strategies in depth.

### 4. Route and partition spatial events

Publish the enveloped event to your message broker. Partitioning strategy determines consumer throughput and ordering guarantees. For geospatial workloads:

- **Spatial tile key (H3 or Quadkey):** All mutations affecting the same map cell land in the same partition, preserving geographic ordering and preventing tile cache stampedes during bulk boundary edits. Coordinate this with [Tile Update Event Pipelines](/core-event-fundamentals-architecture/tile-update-event-pipelines/) to avoid thundering-herd cache invalidation.
- **Tenant ID:** Guarantees multi-tenant isolation and simplifies compliance auditing without cross-contaminating event streams.
- **Feature class:** Routes parcel, road, and sensor events to specialized consumer groups with distinct processing logic.

If your architecture also handles real-time telemetry from moving assets, see [Sensor Data Routing Patterns](/core-event-fundamentals-architecture/sensor-data-routing-patterns/) before combining static feature updates with high-frequency IoT streams — partition skew becomes a real concern when event rates differ by orders of magnitude.

```python
import aiokafka
import json

async def publish_to_broker(
    envelope: dict,
    topic: str = "spatial-feature-events",
    partition_key: str | None = None,
) -> None:
    producer = aiokafka.AIOKafkaProducer(
        bootstrap_servers="localhost:9092",
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        key_serializer=lambda k: k.encode("utf-8") if k else None,
        compression_type="gzip",  # spatial payloads compress well
    )
    await producer.start()
    try:
        key = partition_key or envelope.get("data", {}).get("properties", {}).get("feature_id")
        await producer.send_and_wait(topic, value=envelope, key=key)
    finally:
        await producer.stop()
```

### 5. Dispatch webhooks with retry and delivery guarantees

The dispatcher consumes from the broker and sends HTTPS `POST` requests to subscriber endpoints. The two non-negotiable properties are HMAC-SHA256 signature on every request and exponential backoff with jitter on transient failures.

At-least-once delivery is the practical default for spatial webhooks: consumers must be idempotent (see [Cache-backed Idempotency Checks](/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) for a Redis-based implementation). Exactly-once delivery requires distributed transaction coordination that is rarely worth the complexity for spatial payloads.

```python
import asyncio
import hashlib
import hmac
import json
import httpx
import random

def sign_payload(payload: dict, secret: str) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"

async def dispatch_webhook(
    url: str,
    envelope: dict,
    secret: str,
    max_retries: int = 5,
    base_delay: float = 1.0,
) -> int:
    headers = {
        "Content-Type": "application/json",
        "X-Webhook-Signature": sign_payload(envelope, secret),
        "X-Event-Id": envelope["id"],
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
        for attempt in range(max_retries):
            try:
                resp = await client.post(url, json=envelope, headers=headers)
                resp.raise_for_status()
                return resp.status_code
            except httpx.HTTPStatusError as exc:
                if 400 <= exc.response.status_code < 500:
                    raise  # 4xx: client error, do not retry
                # 5xx: jittered exponential backoff
                delay = min(base_delay * (2 ** attempt), 60.0) + random.uniform(0, 1)
                await asyncio.sleep(delay)
            except (httpx.TimeoutException, httpx.ConnectError):
                delay = min(base_delay * (2 ** attempt), 60.0) + random.uniform(0, 1)
                await asyncio.sleep(delay)
    # Exhausted retries — caller should route to DLQ
    raise RuntimeError(f"Webhook delivery failed after {max_retries} attempts: {url}")
```

For HMAC signature verification and endpoint hardening on the receiving side, see [Securing Webhook Endpoints with Spatial Token Validation](/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/).

## Spatial validation and error handling

Beyond topology checks, handle these spatial-specific failure modes before they reach the broker:

- **Empty or null geometry on `UPDATE`:** Treat as a `DELETE` — the feature has been blanked. Log the anomaly and emit a deletion event with the last known geometry as context.
- **Coordinate ring orientation:** GeoJSON exterior rings must be counter-clockwise (RFC 7946 §3.1.6). Shapely's `orient()` corrects this silently; PostGIS may not.
- **Geometry type change:** A polygon becoming a multipolygon on `UPDATE` is a legal mutation but can break consumers that cast the geometry type. Include both the old and new geometry types in the event envelope's `spatialoperation` context.
- **Oversized payloads:** Complex boundaries often exceed broker message limits. Simplify with `shapely.simplify(tolerance=0.00001, preserve_topology=True)` and include an `simplified: true` flag in the envelope properties so consumers can request the full geometry from the source API if needed.

## Retry, backoff and delivery guarantees

| Scenario | Recommended behaviour |
|---|---|
| Consumer returns `2xx` | Acknowledge and commit broker offset |
| Consumer returns `429` with `Retry-After` | Honour the header; do not count as retry attempt |
| Consumer returns `4xx` (not 429) | Dead-letter immediately; alert operator |
| Consumer returns `5xx` | Jittered exponential backoff; DLQ after max retries |
| Network timeout | Same as `5xx` |
| Broker unavailable at publish time | WAL buffer retains CDC events; resume from replication slot |

At-least-once semantics require idempotent consumers. The `id` field in the CloudEvents envelope serves as the idempotency key. For Redis-based deduplication of inbound webhook signatures, see [Using Redis to Cache Spatial Webhook Signatures](/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/).

## Verification

Confirm the pipeline works end-to-end with an integration test that inserts a feature into a test PostGIS table and asserts a signed `POST` arrives at a local HTTP test server:

```python
import asyncio
import pytest
from aiohttp import web

received: list[dict] = []

async def mock_consumer(request: web.Request) -> web.Response:
    received.append(await request.json())
    return web.Response(status=200)

@pytest.mark.asyncio
async def test_feature_change_triggers_webhook():
    app = web.Application()
    app.router.add_post("/hook", mock_consumer)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "localhost", 9999)
    await site.start()

    # Insert a test feature into PostGIS (requires a test DB)
    await insert_test_parcel(pg_dsn="postgresql://user:pass@localhost/test_gis")

    # Allow pipeline to propagate
    await asyncio.sleep(2)

    assert len(received) == 1
    env = received[0]
    assert env["type"].startswith("com.geospatialwebhook.feature.")
    assert env["specversion"] == "1.0"
    assert env["crs"] == "EPSG:4326"
    sig = env.get("_headers", {}).get("X-Webhook-Signature", "")
    # Verify HMAC (re-sign with known secret and compare)
    expected = sign_payload(env, secret="test-secret")
    assert sig == expected

    await runner.cleanup()
```

## Troubleshooting

| Symptom | Likely spatial cause | Fix |
|---|---|---|
| Consumer receives duplicate events | Replication slot not acknowledged after dispatcher crash | Store ACK state in Redis before committing offset; use `pg_replication_slot_advance()` only after successful DLQ or delivery |
| Geometry validation failures spike after bulk import | Source data mixed CRS or self-intersecting polygons from shapefile conversion | Run `ST_IsValid` + `ST_MakeValid` at import time in PostGIS, not just at event time |
| Payload size exceeds broker limit on polygon updates | Administrative boundary revisions include full coastline precision | Apply Douglas-Peucker simplification before enveloping; store original in object storage and include a `geometry_url` field |
| Consumer lag grows during dense urban tile updates | Partition skew — too many events hitting the same H3 cell | Drop resolution by one level (e.g., H3 resolution 9 → 8) to spread load; accept slightly coarser geographic ordering |
| Webhook signature mismatch at consumer | JSON key order differs between dispatcher and consumer | Always serialize with `sort_keys=True, separators=(",", ":")` on both sides; use the raw `POST` body for HMAC, not re-serialized JSON |
| Events out of order for a single feature | Multiple broker partitions receiving updates for the same feature ID | Partition by `feature_id` hash when ordering per feature matters more than geographic locality |

## FAQ

<details class="faq">
<summary><strong>Should I use logical replication or a polling loop to detect feature changes?</strong></summary>

Prefer PostgreSQL logical replication (via `pgoutput` or `wal2json`) or Debezium CDC over polling. Polling introduces latency proportional to the interval, adds query load at scale, and misses rapid bursts of changes between ticks. Logical decoding emits events immediately after each committed transaction with sub-second latency.

</details>

<details class="faq">
<summary><strong>What is the right partitioning key for a geospatial event stream?</strong></summary>

Partition by spatial tile key (H3 or Quadkey cell at an appropriate resolution) when you need geographic locality. Use tenant ID for multi-tenant isolation. Use feature class when consumers are specialized. Avoid partitioning by raw geometry hash — distribution is uneven in dense urban areas.

</details>

<details class="faq">
<summary><strong>How large can a spatial webhook payload be before I need to chunk it?</strong></summary>

Most webhook endpoints and brokers cap messages at 256 KB–1 MB. Complex polygon boundaries or dense multilinestrings can exceed this. Simplify with `shapely`'s `.simplify()` before enveloping, or split multi-part geometries into individual events with a shared correlation ID.

</details>

<details class="faq">
<summary><strong>How do I handle a CRS mismatch between the source database and webhook consumers?</strong></summary>

Establish a canonical CRS at the event boundary — `EPSG:4326` for web delivery is the safest default. Convert every geometry to that CRS inside the validation step using `pyproj`, and stamp the `crs` extension field in the CloudEvents envelope. Consumers that internally use `EPSG:3857` or a national grid perform their own local reprojection from the canonical form.

</details>

---

## Related

- [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/) — the parent domain covering the full event-driven spatial pipeline
- [How to Design a Geospatial Webhook Architecture in Python](/core-event-fundamentals-architecture/feature-change-triggers/how-to-design-a-geospatial-webhook-architecture-in-python/) — end-to-end architecture walkthrough for this trigger pattern
- [Sensor Data Routing Patterns](/core-event-fundamentals-architecture/sensor-data-routing-patterns/) — handling high-frequency IoT streams alongside discrete feature change events
- [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — generating deterministic idempotency keys from feature geometry hashes
- [CRS Normalization Strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/) — canonical reprojection patterns for mixed-CRS spatial event streams
