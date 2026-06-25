---
title: "GeoJSON to Protobuf Mapping for Spatial Webhooks"
description: "Map GeoJSON webhook payloads to Protocol Buffers in Python: schema design, Pydantic validation, CRS normalization, binary serialization, and async broker dispatch with retries."
slug: "geojson-to-protobuf-mapping"
type: "cluster"
breadcrumb: "Spatial Payload Routing & Parsing › GeoJSON to Protobuf Mapping"
datePublished: "2024-11-01"
dateModified: "2026-06-25"
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
      "headline": "GeoJSON to Protobuf Mapping for Spatial Webhooks",
      "description": "A step-by-step guide to mapping GeoJSON webhook payloads to Protocol Buffers in Python — covering proto schema design, Pydantic validation, CRS normalization, binary serialization, and async broker dispatch with retries.",
      "datePublished": "2024-11-01",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://geospatialwebhook.com/" },
        { "@type": "ListItem", "position": 2, "name": "Spatial Payload Routing & Parsing", "item": "https://geospatialwebhook.com/spatial-payload-routing-parsing/" },
        { "@type": "ListItem", "position": 3, "name": "GeoJSON to Protobuf Mapping", "item": "https://geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Map GeoJSON Webhook Payloads to Protocol Buffers in Python",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Design the proto schema", "text": "Model geometry variants with oneof and coordinate arrays with repeated fields, reserving field numbers for backward compatibility." },
        { "@type": "HowToStep", "position": 2, "name": "Validate ingestion defensively", "text": "Parse raw JSON with Pydantic v2, rejecting unsupported geometry types and malformed coordinate arrays before serialization." },
        { "@type": "HowToStep", "position": 3, "name": "Normalize coordinates to EPSG:4326", "text": "Reproject any non-WGS84 input with cached pyproj transformers so the binary message lives in one canonical coordinate space." },
        { "@type": "HowToStep", "position": 4, "name": "Serialize to protobuf bytes", "text": "Convert the validated geometry into the generated protobuf message and produce a compact binary blob isolated from network I/O." },
        { "@type": "HowToStep", "position": 5, "name": "Dispatch asynchronously with retries", "text": "Publish the binary payload to the broker using exponential backoff with jitter, routing fatal data errors to a dead-letter queue." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How much smaller is protobuf than GeoJSON for spatial payloads?",
          "acceptedAnswer": { "@type": "Answer", "text": "For polygon-heavy payloads, protobuf typically reduces wire size by 60–75% versus equivalent GeoJSON, because field names are replaced by integer tags and doubles are packed as fixed-width binary rather than decimal strings. The gain is largest for dense vertex arrays and smallest for property-heavy features with long string values." }
        },
        {
          "@type": "Question",
          "name": "Should I store coordinates as double or sint32 in the proto schema?",
          "acceptedAnswer": { "@type": "Answer", "text": "Use double when you need full WGS84 precision and arbitrary input. Use scaled sint32 (degrees × 1e7, zigzag-encoded) only when you control producers and accept ~1 cm precision — it roughly halves coordinate bytes but loses precision and complicates schema evolution. Default to double unless a measured size budget forces the change." }
        },
        {
          "@type": "Question",
          "name": "How do I handle MultiPolygon and GeometryCollection in a oneof schema?",
          "acceptedAnswer": { "@type": "Answer", "text": "Add explicit MultiPolygon and MultiLineString messages as additional oneof variants rather than overloading Polygon. GeometryCollection should be a repeated Geometry field on its own message. Reserve the new field numbers ahead of time so older consumers ignore unknown variants instead of mis-parsing them." }
        },
        {
          "@type": "Question",
          "name": "What happens to protobuf consumers when I add a new geometry type?",
          "acceptedAnswer": { "@type": "Answer", "text": "proto3 consumers built from an older schema silently ignore unknown oneof branches and leave the geometry field unset, so they will not crash — but they will treat the feature as having no geometry. Version your topic or include a schema_version field so consumers can detect and route payloads they cannot fully decode." }
        }
      ]
    }
  ]
}
</script>

**Mapping GeoJSON to Protobuf means validating the incoming feature collection, normalizing every coordinate to a single canonical CRS, then encoding the result into a compact, strongly-typed binary message your event broker can move at high throughput.** This page is part of [Spatial Payload Routing & Parsing](/spatial-payload-routing-parsing/).

GeoJSON remains the de facto interchange format for spatial data because it is human-readable and supported everywhere, but its verbose JSON structure is expensive to move at scale: field names repeat on every feature, coordinates serialize as decimal strings, and a single municipal boundary can balloon to megabytes. For high-throughput, low-latency event pipelines, encoding that same geometry as Protocol Buffers cuts wire size dramatically while giving you a schema contract that consumers in any language can decode. This guide walks the full pipeline in Python — proto schema design, defensive ingestion, coordinate normalization, binary serialization, and asynchronous broker dispatch — with explicit attention to the production failure modes that bite spatial workloads.

---

## Architecture: Four Layers from Webhook to Binary Topic

The mapping pipeline sits between your webhook receiver and your message broker. Each layer has one responsibility, and keeping them isolated is what lets you scale serialization independently of network I/O and reject bad geometry before it ever touches the broker.

<svg viewBox="0 0 720 340" role="img" aria-label="Four-layer pipeline mapping a GeoJSON webhook to a protobuf topic: receiver, normalizer, serializer, broker" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:720px;height:auto;display:block;margin:1.5rem auto;">
  <title>GeoJSON to Protobuf Mapping Pipeline</title>
  <desc>Four connected boxes showing the data path: (1) Webhook Receiver validates the GeoJSON schema with Pydantic and returns 422 on bad geometry; (2) Normalizer reprojects coordinates to EPSG:4326 using cached pyproj transformers; (3) Serializer builds the generated protobuf message and produces compact binary bytes; (4) Broker publishes to a binary topic with exponential backoff retries and a dead-letter queue for fatal errors.</desc>
  <defs>
    <marker id="ptp-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <text x="20" y="34" font-size="11" fill="currentColor" opacity="0.6">Incoming GeoJSON FeatureCollection (text/json)</text>
  <rect x="20" y="120" width="148" height="120" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <text x="94" y="152" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Webhook</text>
  <text x="94" y="168" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Receiver</text>
  <text x="94" y="192" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Pydantic v2 schema</text>
  <text x="94" y="206" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Reject → 422</text>
  <text x="94" y="220" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Signature check</text>
  <rect x="204" y="120" width="148" height="120" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <text x="278" y="152" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Normalizer</text>
  <text x="278" y="178" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Reproject → EPSG:4326</text>
  <text x="278" y="192" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Cached transformers</text>
  <text x="278" y="206" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Topology repair</text>
  <text x="278" y="220" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">always_xy=True</text>
  <rect x="388" y="120" width="148" height="120" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <text x="462" y="152" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Serializer</text>
  <text x="462" y="178" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">oneof geometry</text>
  <text x="462" y="192" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">repeated coords</text>
  <text x="462" y="206" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">SerializeToString()</text>
  <text x="462" y="220" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">CPU-bound, no I/O</text>
  <rect x="572" y="120" width="148" height="120" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <text x="646" y="152" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Broker</text>
  <text x="646" y="178" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Binary topic</text>
  <text x="646" y="192" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Backoff + jitter</text>
  <text x="646" y="206" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Spatial partition key</text>
  <text x="646" y="220" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">DLQ on fatal</text>
  <line x1="168" y1="180" x2="201" y2="180" stroke="currentColor" stroke-width="1.5" opacity="0.5" marker-end="url(#ptp-arrow)"/>
  <line x1="352" y1="180" x2="385" y2="180" stroke="currentColor" stroke-width="1.5" opacity="0.5" marker-end="url(#ptp-arrow)"/>
  <line x1="536" y1="180" x2="569" y2="180" stroke="currentColor" stroke-width="1.5" opacity="0.5" marker-end="url(#ptp-arrow)"/>
  <text x="94" y="262" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.5">Layer 1</text>
  <text x="278" y="262" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.5">Layer 2</text>
  <text x="462" y="262" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.5">Layer 3</text>
  <text x="646" y="262" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.5">Layer 4</text>
  <text x="572" y="300" font-size="11" fill="currentColor" opacity="0.6" text-anchor="start">Compact protobuf bytes →</text>
  <text x="572" y="316" font-size="11" fill="currentColor" opacity="0.6" text-anchor="start">downstream consumers</text>
</svg>

**Layer 1 — Webhook Receiver:** validates the incoming GeoJSON feature collection against a strict schema, verifies the delivery signature, and returns `422 Unprocessable Entity` for malformed geometry before any encoding work happens.

**Layer 2 — Normalizer:** reprojects every coordinate to the canonical EPSG:4326 (WGS84) coordinate space using cached `pyproj` transformers, so the binary message never mixes projections.

**Layer 3 — Serializer:** maps the validated, normalized geometry onto the generated protobuf message and produces a compact binary blob. This stage is CPU-bound and is kept off the event loop's I/O path.

**Layer 4 — Broker:** publishes the binary payload to a dedicated topic using exponential backoff with jitter, partitions by geographic key, and routes fatal data errors to a dead-letter queue.

---

## Prerequisites

Before wiring up the pipeline, your environment must satisfy several baseline constraints. The most common failure point is compiler drift — your `protoc` version must match your runtime `protobuf` library, or generated stubs will mis-decode at the wire level.

- [ ] **Python 3.10+** for `match` statements and modern typing
- [ ] **Web framework:** `fastapi>=0.100.0` with `uvicorn` for the receiving endpoint, or `aiohttp` for a standalone async consumer
- [ ] **Validation:** `pydantic>=2.0` for fast schema-driven ingestion validation
- [ ] **Geospatial:** `pyproj>=3.5.0` for CRS transformation and `shapely>=2.0` for topology repair
- [ ] **Serialization:** `protobuf>=4.21.0` runtime plus `grpcio-tools` (or a standalone `protoc`) for code generation; pin both to the same major version
- [ ] **Message broker:** Kafka, RabbitMQ, NATS, or Redis Streams configured for at-least-once delivery
- [ ] **Compiler on PATH:** the `protoc` binary must be reachable and version-aligned with the runtime library

```bash
pip install fastapi uvicorn "pydantic>=2.0" "pyproj>=3.5" shapely "protobuf>=4.21" grpcio-tools
```

Payloads should conform to the [RFC 7946 GeoJSON specification](https://datatracker.ietf.org/doc/html/rfc7946), which mandates longitude-first axis ordering and warns against relying on coordinate precision beyond what your application needs. Real-world webhooks frequently deviate, so the ingestion layer must parse defensively rather than assume compliance. If your endpoint also verifies HMAC signatures, do that before parsing — the full receiver contract is covered in [Parsing GeoJSON Webhooks with FastAPI and Pydantic](/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/parsing-geojson-webhooks-with-fastapi-and-pydantic/).

---

## Step-by-Step Implementation

### Step 1 — Design the Proto Schema

Protobuf efficiency begins at the schema. GeoJSON's flexible, deeply nested structure maps poorly to flat messages, so model geometry variants with `oneof` and coordinate arrays with `repeated` fields. Number fields in a logical progression and reserve numbers for anything you remove, so older consumers stay binary-compatible.

```protobuf
syntax = "proto3";

package spatial.v1;

// Coordinate pair, canonical WGS84 (EPSG:4326): x = longitude, y = latitude.
message Point {
  double x = 1;
  double y = 2;
}

message LineString {
  repeated Point coords = 1;
}

message Polygon {
  repeated LineString rings = 1;  // ring[0] is exterior; rest are holes
}

message Geometry {
  oneof type {
    Point point = 1;
    LineString line_string = 2;
    Polygon polygon = 3;
  }
  // Reserved for future MultiPolygon / GeometryCollection variants.
  reserved 4, 5, 6;
}

message Feature {
  string id = 1;
  Geometry geometry = 2;
  map<string, string> properties = 3;
}

message FeatureCollection {
  repeated Feature features = 1;
  string source_crs = 2;     // audit metadata; payload is already EPSG:4326
  uint32 schema_version = 3;  // lets consumers detect formats they cannot decode
}
```

Compile to Python stubs, pinning the compiler to match your runtime library:

```bash
protoc --python_out=. --pyi_out=. spatial.proto
```

Never reuse a field number after deprecating it — doing so silently corrupts every consumer built against the old schema. The `reserved` keyword makes that mistake impossible to commit by accident.

### Step 2 — Validate Ingestion Defensively

Ingestion must tolerate malformed payloads without crashing the event loop. Pydantic v2 bridges raw JSON and structured Python objects with fast, schema-driven validation, rejecting unsupported geometry types and empty coordinate arrays before they reach serialization.

```python
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, field_validator

GEOMETRY_TYPES = Literal[
    "Point", "LineString", "Polygon",
    "MultiPoint", "MultiLineString", "MultiPolygon",
]

class GeoGeometry(BaseModel):
    type: GEOMETRY_TYPES
    coordinates: List[Any]

    @field_validator("coordinates")
    @classmethod
    def coordinates_not_empty(cls, v: List[Any]) -> List[Any]:
        if not v:
            raise ValueError("coordinates must not be empty")
        return v

class GeoFeature(BaseModel):
    id: Optional[str] = None
    geometry: GeoGeometry
    properties: Dict[str, Any] = Field(default_factory=dict)

class GeoFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: List[GeoFeature]
    crs_hint: Optional[str] = None  # e.g. "EPSG:32633" if the producer declares it
```

Wrap this model in your endpoint so a `ValidationError` becomes a structured `422`, not a `500`. Failed payloads should be routed to a dead-letter queue with the original body attached, never silently dropped — topological errors, self-intersecting rings, and coordinate overflow are caught earlier and in more depth by a dedicated [Geometry Validation Pipelines](/spatial-payload-routing-parsing/geometry-validation-pipelines/) stage.

### Step 3 — Normalize Coordinates to EPSG:4326

GeoJSON arrives in mixed coordinate reference systems — IoT trackers, legacy GIS exports, and third-party APIs all differ. The protobuf message assumes one canonical space, so reproject everything to EPSG:4326 (WGS84) at ingestion. Cache transformers per CRS pair: construction triggers a PROJ database lookup that is far too expensive to repeat per request, but the transformer is thread-safe once built.

```python
from functools import lru_cache
from typing import List
from pyproj import Transformer

@lru_cache(maxsize=64)
def _get_transformer(source_crs: str, target_crs: str = "EPSG:4326") -> Transformer:
    # always_xy=True forces (lon, lat) order, matching RFC 7946 axis ordering.
    return Transformer.from_crs(source_crs, target_crs, always_xy=True)

def normalize_ring(ring: List[List[float]], source_crs: str) -> List[List[float]]:
    """Reproject one ring of [lon, lat] pairs to canonical EPSG:4326."""
    if source_crs.upper() in ("EPSG:4326", "WGS84"):
        return ring
    transformer = _get_transformer(source_crs)
    return [list(transformer.transform(lon, lat)) for lon, lat in ring]
```

CRS mismatches are a leading cause of silent spatial drift, so log the `source_crs` alongside the transformed payload for auditability and record it in the message's `source_crs` field. For datum shifts, fallback transformation chains, and per-event CRS resolution in distributed consumers, see [CRS Normalization Strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/).

### Step 4 — Serialize to Protobuf Bytes

With the geometry validated and normalized, map it onto the generated protobuf message. Keep this stage free of network calls so it never blocks the event loop — it is pure CPU work and can later be offloaded to a thread or process pool.

```python
from spatial_pb2 import (
    FeatureCollection, Feature, Geometry, Point, LineString, Polygon,
)

def _build_geometry(geom: dict) -> Geometry:
    g = Geometry()
    gtype, coords = geom.get("type"), geom.get("coordinates", [])
    if gtype == "Point":
        g.point.x, g.point.y = coords[0], coords[1]
    elif gtype == "LineString":
        g.line_string.coords.extend(Point(x=c[0], y=c[1]) for c in coords)
    elif gtype == "Polygon":
        for ring in coords:
            ls = g.polygon.rings.add()
            ls.coords.extend(Point(x=c[0], y=c[1]) for c in ring)
    else:
        raise ValueError(f"Unsupported geometry type for serialization: {gtype}")
    return g

def serialize_to_protobuf(collection: GeoFeatureCollection) -> bytes:
    """Convert a validated, normalized feature collection to protobuf bytes."""
    pb = FeatureCollection(source_crs="EPSG:4326", schema_version=1)
    for feat in collection.features:
        feature = pb.features.add()
        feature.id = feat.id or ""
        # protobuf string map: coerce property values to strings deterministically
        for k, v in sorted(feat.properties.items()):
            feature.properties[k] = str(v)
        feature.geometry.CopyFrom(_build_geometry(feat.geometry.model_dump()))
    return pb.SerializeToString()
```

Sorting properties before insertion keeps the encoded map order stable, which matters if downstream stages hash the bytes for deduplication — apply an idempotency key derived from this canonical blob following [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/). When a single payload exceeds the broker's message-size limit (common with municipal boundaries or high-resolution LiDAR footprints), chunk the `features` list, assign sequence numbers, and reassemble on the consumer side rather than serializing one monolithic message.

### Step 5 — Dispatch Asynchronously with Retries

Publish the binary payload to the broker on the async path, isolating CPU-bound serialization from I/O. Wrap the publish in exponential backoff with jitter so a transient broker hiccup does not cascade into a retry storm, and partition by a geographic key so updates for the same region stay ordered.

```python
import asyncio
import random

async def publish_with_backoff(
    payload: bytes,
    topic: str,
    partition_key: str,
    producer,
    max_retries: int = 5,
    base_delay: float = 0.5,
    cap: float = 10.0,
) -> None:
    """Publish protobuf bytes with full-jitter exponential backoff."""
    for attempt in range(max_retries):
        try:
            await producer.send(topic, key=partition_key.encode(), value=payload)
            return
        except Exception as exc:  # broker timeout, connection reset, etc.
            if attempt == max_retries - 1:
                raise RuntimeError(
                    f"Publish failed after {max_retries} attempts: {exc}"
                ) from exc
            # Full jitter avoids thundering-herd retries across many workers.
            delay = random.uniform(0, min(cap, base_delay * (2 ** attempt)))
            await asyncio.sleep(delay)
```

Run serialization off the event loop so a large geometry never stalls concurrent requests:

```python
async def dispatch_feature_collection(collection, topic, producer) -> None:
    loop = asyncio.get_running_loop()
    payload = await loop.run_in_executor(None, serialize_to_protobuf, collection)
    region = collection.features[0].geometry.coordinates[0]  # crude geo key
    partition_key = f"{round(region[0], 1)}:{round(region[1], 1)}"
    await publish_with_backoff(payload, topic, partition_key, producer)
```

For very large or numerous geometries, the executor offload above is the entry point to a fuller worker pattern documented in [Async Processing for Heavy Geometries](/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/).

---

## Spatial Validation and Error Handling

Schema validation at Layer 1 catches structural problems, but two spatial checks protect correctness at the boundary between normalization and serialization.

**Topology repair before encoding.** A self-intersecting polygon or an unclosed ring is structurally valid JSON but produces a geometry that downstream spatial indexes will reject. Repair it with Shapely and fail loudly if it collapses:

```python
from shapely.geometry import shape, mapping
from shapely.validation import make_valid

def repair_geometry(geom_dict: dict) -> dict:
    geom = make_valid(shape(geom_dict))
    if geom.is_empty:
        raise ValueError("Geometry collapsed to empty after make_valid — reject")
    return mapping(geom)
```

**CRS sanity bounds.** After reprojection, every coordinate must fall within EPSG:4326 bounds. A longitude outside ±180 or a latitude outside ±90 means the declared source CRS was wrong:

```python
def assert_wgs84_bounds(coords) -> None:
    for lon, lat in coords:
        if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
            raise ValueError(f"Coordinate out of WGS84 bounds: {(lon, lat)}")
```

Both checks should surface as `422` responses (bad input), not `500` (system failure). Route the offending payload, its detected CRS, and the failure reason to a quarantine topic with the full body snapshot so a human or an automated correction job can replay it.

---

## Retry, Backoff, and Delivery Guarantees

The serialization stage is pure and synchronous — it needs no retry logic itself. The retry surface is the broker publish in Step 5. Distinguish two error classes and treat them differently:

- **Transient failures** (broker timeout, connection reset, leader election) are safe to retry. Use full-jitter exponential backoff, as shown above, with a hard attempt cap so a permanently-down broker does not pin a worker forever.
- **Fatal data errors** (unsupported geometry, out-of-bounds coordinates, schema mismatch) will never succeed on retry. Send them straight to the dead-letter queue.

Protobuf publishing converts the broker's at-least-once delivery into effectively exactly-once *processing* only when consumers deduplicate. Because a retried publish can produce a duplicate message on the topic, attach an idempotency key — derived from the canonical serialized bytes — so consumers can discard redeliveries, exactly as covered in [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/). Size any consumer-side deduplication window to exceed the broker's maximum retry window by at least 2x.

---

## Verification

The following pytest suite confirms the mapping round-trips and that the binary form is genuinely smaller than the source JSON — the whole reason for the pipeline.

```python
import json
import pytest
from spatial_pb2 import FeatureCollection
from your_module import GeoFeatureCollection, serialize_to_protobuf

SAMPLE = {
    "type": "FeatureCollection",
    "features": [
        {
            "id": "zone-7",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-73.99, 40.74], [-73.98, 40.74],
                    [-73.98, 40.75], [-73.99, 40.75], [-73.99, 40.74],
                ]],
            },
            "properties": {"name": "midtown", "level": 3},
        }
    ],
}

def test_roundtrip_preserves_coordinates():
    collection = GeoFeatureCollection(**SAMPLE)
    blob = serialize_to_protobuf(collection)
    decoded = FeatureCollection()
    decoded.ParseFromString(blob)
    ring = decoded.features[0].geometry.polygon.rings[0].coords
    assert (ring[0].x, ring[0].y) == (-73.99, 40.74)
    assert decoded.features[0].properties["name"] == "midtown"

def test_protobuf_is_smaller_than_geojson():
    collection = GeoFeatureCollection(**SAMPLE)
    blob = serialize_to_protobuf(collection)
    geojson_bytes = json.dumps(SAMPLE, separators=(",", ":")).encode()
    assert len(blob) < len(geojson_bytes)

def test_invalid_geometry_type_rejected():
    bad = {"type": "FeatureCollection", "features": [
        {"geometry": {"type": "Hexagon", "coordinates": [[0, 0]]}, "properties": {}}
    ]}
    with pytest.raises(Exception):
        GeoFeatureCollection(**bad)
```

Run with `pytest -v` after generating `spatial_pb2` and installing `pydantic`, `shapely`, and `pyproj` in a test virtualenv.

---

## Troubleshooting

<div style="overflow-x:auto">

| Symptom | Likely spatial cause | Fix |
|---|---|---|
| Consumer decodes garbage / wrong fields | `protoc` version differs from runtime `protobuf` library | Pin compiler and runtime to the same major version; regenerate stubs in CI |
| Coordinates appear swapped (lat/lon) | Transformer built without `always_xy=True` | Set `always_xy=True` on every `Transformer.from_crs` call |
| Geometry field empty on a new geometry type | proto3 consumer built from older schema ignores unknown `oneof` branch | Add the new variant, bump `schema_version`, version the topic |
| Serialized payload larger than expected | Property-heavy features with long string values | Move bulky properties out of the map; consider scaled `sint32` coords |
| Broker rejects message (too large) | Single municipal boundary or LiDAR footprint exceeds size limit | Chunk `features` with sequence numbers; reassemble on consumer |
| Coordinate out of WGS84 bounds after transform | Wrong declared source CRS | Validate bounds post-reprojection; quarantine and re-detect CRS |
| Event loop stalls under load | Serialization running on the I/O thread | Offload `serialize_to_protobuf` via `run_in_executor` |
| Duplicate features in downstream store | Retried publish created duplicate broker messages | Attach an idempotency key from the canonical bytes; deduplicate on consume |

</div>

---

## FAQ

<details class="faq">
<summary><strong>How much smaller is protobuf than GeoJSON for spatial payloads?</strong></summary>

For polygon-heavy payloads, protobuf typically reduces wire size by 60–75% versus equivalent GeoJSON. Field names are replaced by integer tags, and `double` coordinates are packed as fixed-width binary instead of variable-length decimal strings. The reduction is largest for dense vertex arrays and smallest for features dominated by long string properties, where the values themselves carry the bytes regardless of format.

</details>

<details class="faq">
<summary><strong>Should I store coordinates as double or sint32 in the proto schema?</strong></summary>

Default to `double` — it preserves full WGS84 precision and accepts arbitrary input. Scaled `sint32` (degrees × 1e7, zigzag-encoded) roughly halves coordinate bytes but caps precision at about 1 cm and complicates schema evolution, so only adopt it when you control all producers and a measured size budget forces the change. Mixing the two in one schema is a maintenance trap.

</details>

<details class="faq">
<summary><strong>How do I handle MultiPolygon and GeometryCollection in a oneof schema?</strong></summary>

Add explicit `MultiPolygon` and `MultiLineString` messages as new `oneof` variants rather than overloading `Polygon`, and model `GeometryCollection` as a message with a `repeated Geometry` field. Claim the reserved field numbers from the schema above so older consumers ignore unknown variants instead of mis-parsing them, and bump `schema_version` whenever you add one.

</details>

<details class="faq">
<summary><strong>What happens to protobuf consumers when I add a new geometry type?</strong></summary>

A proto3 consumer built from an older schema silently ignores the unknown `oneof` branch and leaves the geometry field unset, so it will not crash — but it treats the feature as having no geometry, which is its own kind of data loss. Include a `schema_version` field (or version the topic) so consumers can detect payloads they cannot fully decode and route them for reprocessing instead of dropping geometry silently.

</details>

---

## Related

- [Spatial Payload Routing & Parsing](/spatial-payload-routing-parsing/) — parent section covering ingestion, parsing, and routing of geospatial event payloads
- [Parsing GeoJSON Webhooks with FastAPI and Pydantic](/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/parsing-geojson-webhooks-with-fastapi-and-pydantic/) — the receiver-side endpoint contract, signature verification, and request lifecycle hooks
- [CRS Normalization Strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/) — reprojecting mixed-CRS payloads to a canonical EPSG:4326 space before serialization
- [Geometry Validation Pipelines](/spatial-payload-routing-parsing/geometry-validation-pipelines/) — topology checks and quarantine handling for malformed geometry
- [Async Processing for Heavy Geometries](/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) — offloading expensive serialization off the event loop with worker pools
- [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — deriving idempotency keys from the canonical serialized payload
