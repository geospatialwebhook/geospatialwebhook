---
title: "Event Key Generation for Spatial Data"
description: "Generate deterministic idempotency keys from geospatial webhook payloads in Python: normalization, canonical serialization, hashing, and production failure modes."
slug: "event-key-generation-for-spatial-data"
type: "guide"
breadcrumb: "Idempotency & Spatial Deduplication › Event Key Generation for Spatial Data"
datePublished: "2024-11-01"
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
      "headline": "Event Key Generation for Spatial Data",
      "description": "A step-by-step guide to generating deterministic, collision-resistant idempotency keys from geospatial webhook payloads in Python — covering normalization, canonical serialization, hashing, and production failure modes.",
      "datePublished": "2024-11-01",
      "dateModified": "2026-06-24",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/" },
        { "@type": "ListItem", "position": 2, "name": "Idempotency & Spatial Deduplication", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/" },
        { "@type": "ListItem", "position": 3, "name": "Event Key Generation for Spatial Data", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Generate Deterministic Idempotency Keys for Spatial Webhook Payloads",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Validate and ingest the GeoJSON payload", "text": "Parse and reject malformed geometry, missing type fields, or invalid coordinate arrays before any key logic runs." },
        { "@type": "HowToStep", "position": 2, "name": "Strip non-deterministic metadata", "text": "Remove timestamps, request IDs, and delivery headers. Whitelist only the fields that represent spatial state." },
        { "@type": "HowToStep", "position": 3, "name": "Normalize geometry and control precision", "text": "Round coordinates to a fixed decimal policy, close rings, sort multi-geometry members, and validate topology with Shapely." },
        { "@type": "HowToStep", "position": 4, "name": "Serialize canonically", "text": "Produce a byte-identical JSON string with sort_keys=True, consistent separators, and UTF-8 encoding." },
        { "@type": "HowToStep", "position": 5, "name": "Hash and store the key", "text": "Apply SHA-256, truncate to 128 bits, encode as a 32-character hex string, then check against Redis before processing." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How many decimal places should I use for GPS coordinates in idempotency keys?",
          "acceptedAnswer": { "@type": "Answer", "text": "Six to seven decimal places covers sub-meter GPS accuracy. Use fewer (3–4) only for administrative boundaries or zone polygons where centimeter precision is meaningless. Document the policy and enforce it at ingestion time." }
        },
        {
          "@type": "Question",
          "name": "Can I use MD5 instead of SHA-256 for performance?",
          "acceptedAnswer": { "@type": "Answer", "text": "MD5 is faster but has known collision weaknesses and should not be used for security-sensitive key derivation. For pure deduplication where security is not a concern, truncated SHA-256 (128 bits) provides a better collision probability than MD5 at negligible extra cost — about 1 µs per key on modern hardware." }
        },
        {
          "@type": "Question",
          "name": "What happens when two geometries are topologically equivalent but have different vertex orderings?",
          "acceptedAnswer": { "@type": "Answer", "text": "They will hash to different keys. If topological equivalence matters — not just coordinate equality — compute a canonical representation such as a convex hull or simplified geometry before hashing, or layer spatial overlap deduplication on top of exact key matching." }
        },
        {
          "@type": "Question",
          "name": "How long should idempotency keys be kept in Redis?",
          "acceptedAnswer": { "@type": "Answer", "text": "Align the TTL with the maximum retry window of your upstream broker, then add a safety margin. For most webhook platforms that retry for 24–72 hours, a 96-hour TTL covers redeliveries. For Kafka consumers with large retention, persist keys to a database table partitioned by day and use Redis only for the hot-path window." }
        }
      ]
    }
  ]
}
</script>

**Deterministic event keys for spatial data are produced by normalizing geometry, serializing it canonically, and hashing the result — giving every logically identical coordinate payload the same fixed-length identifier regardless of how many times it is delivered.** This page is part of [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/).

Real-time geospatial webhooks and event streams present a core architectural problem: distinguishing legitimate duplicate deliveries from genuinely distinct spatial updates. When a mapping platform, IoT sensor network, or logistics SaaS ingests thousands of coordinate-based payloads per second, non-deterministic event identification quickly leads to duplicated writes, inconsistent spatial state, and expensive reconciliation jobs. The pipeline below solves this by transforming variable-length, floating-point-heavy geometry payloads into fixed-length, collision-resistant identifiers that survive network retries, broker redeliveries, and out-of-order processing.

---

## Architecture: Four Layers from Mutation to Key Store

The key generation pipeline sits between your webhook receiver and your processing layer. Understanding each layer before writing code prevents the most common failure modes — particularly floating-point drift and CRS confusion.

<svg viewBox="0 0 720 320" role="img" aria-label="Four-layer pipeline: webhook receiver, normalizer, hasher, Redis key store" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:720px;height:auto;display:block;margin:1.5rem auto;">
  <title>Event Key Generation Pipeline</title>
  <desc>Four connected boxes showing the data path: (1) Webhook Receiver validates schema; (2) Normalizer strips metadata, rounds coords, closes rings; (3) Hasher serializes canonically and applies SHA-256; (4) Redis Key Store performs atomic SET NX EX check before allowing processing.</desc>
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Layer boxes -->
  <rect x="20" y="110" width="140" height="100" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <text x="90" y="148" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Webhook</text>
  <text x="90" y="164" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Receiver</text>
  <text x="90" y="184" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Schema validation</text>
  <text x="90" y="198" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">400 on bad geom</text>
  <rect x="195" y="110" width="150" height="100" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <text x="270" y="148" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Normalizer</text>
  <text x="270" y="168" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Strip metadata</text>
  <text x="270" y="182" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Round coords</text>
  <text x="270" y="196" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Close rings · CRS→4326</text>
  <rect x="375" y="110" width="150" height="100" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <text x="450" y="148" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Hasher</text>
  <text x="450" y="168" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">sort_keys=True</text>
  <text x="450" y="182" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">UTF-8 canonical</text>
  <text x="450" y="196" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">SHA-256 → 32-char hex</text>
  <rect x="555" y="110" width="145" height="100" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <text x="627" y="148" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Redis Key Store</text>
  <text x="627" y="168" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">SET NX EX (atomic)</text>
  <text x="627" y="182" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Hit → discard event</text>
  <text x="627" y="196" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Miss → process + store</text>
  <!-- Arrows -->
  <line x1="160" y1="160" x2="192" y2="160" stroke="currentColor" stroke-width="1.5" opacity="0.5" marker-end="url(#arrow)"/>
  <line x1="345" y1="160" x2="372" y2="160" stroke="currentColor" stroke-width="1.5" opacity="0.5" marker-end="url(#arrow)"/>
  <line x1="525" y1="160" x2="552" y2="160" stroke="currentColor" stroke-width="1.5" opacity="0.5" marker-end="url(#arrow)"/>
  <!-- Layer labels at bottom -->
  <text x="90" y="228" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.5">Layer 1</text>
  <text x="270" y="228" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.5">Layer 2</text>
  <text x="450" y="228" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.5">Layer 3</text>
  <text x="627" y="228" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.5">Layer 4</text>
  <!-- Payload label at top -->
  <text x="20" y="95" font-size="10" fill="currentColor" opacity="0.6">Incoming GeoJSON payload</text>
  <text x="580" y="95" font-size="10" fill="currentColor" opacity="0.6">Idempotent processing</text>
</svg>

**Layer 1 — Webhook Receiver:** validates the incoming GeoJSON payload against a strict schema and returns `400 Bad Request` for malformed geometry before any key logic runs.

**Layer 2 — Normalizer:** strips all non-deterministic metadata (timestamps, delivery headers, request IDs), rounds coordinates to your documented precision policy, enforces CRS alignment to EPSG:4326 (WGS84), closes polygon rings, and repairs topology using Shapely.

**Layer 3 — Hasher:** serializes the normalized payload to a byte-identical canonical string and applies SHA-256. The first 16 bytes encode as a 32-character hex key.

**Layer 4 — Redis Key Store:** performs an atomic `SET NX EX` against the generated key. A cache hit means the event was already processed; discard it. A cache miss means it is genuinely new; process and store simultaneously. For the caching architecture in detail, see [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/).

---

## Prerequisites

Before implementing spatial idempotency keys, your ingestion pipeline must satisfy several baseline constraints. Without a strict normalization contract, identical spatial events will produce divergent keys from floating-point drift, unordered JSON properties, or implicit CRS assumptions.

- [ ] **Python 3.9+** with standard libraries (`hashlib`, `json`, `decimal`)
- [ ] **Geospatial parsing:** `shapely>=2.0` for geometry normalization and topology repair; `pyproj>=3.4` for CRS transformations
- [ ] **Payload validation:** `pydantic>=2.0` or `jsonschema>=4.0` for schema enforcement at the receiver
- [ ] **Redis client:** `redis-py>=4.5` with connection pooling for atomic key checks (`SET NX EX`)
- [ ] **Message broker / webhook infrastructure:** Kafka, RabbitMQ, AWS SNS/SQS, or HTTP endpoints configured for at-least-once delivery semantics
- [ ] **Coordinate precision policy:** a documented standard for decimal places — typically 6–7 for GPS-grade asset tracking, 3–4 for municipal boundaries or zoning polygons
- [ ] **CRS contract:** explicit handling of EPSG:4326 (WGS84) or a declared transformation pipeline before key generation; mixed CRS payloads must be caught at Layer 1, following the approach in [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/)

Adhering to the [RFC 7946 GeoJSON specification](https://datatracker.ietf.org/doc/html/rfc7946) is non-negotiable. The standard mandates consistent axis ordering (longitude first, then latitude) and warns against relying on coordinate precision beyond what your application requires. Violating either constraint guarantees key divergence across retries.

---

## Step-by-Step Implementation

### Step 1 — Validate and Ingest the Payload

Parse the incoming webhook payload against a strict GeoJSON schema using Pydantic. Return `400 Bad Request` for malformed coordinates, missing `type` fields, or invalid geometry arrays. This prevents garbage-in-garbage-out scenarios where invalid geometries silently produce inconsistent hashes.

```python
from pydantic import BaseModel, field_validator
from typing import Any, Dict, Literal, List, Union
import json

class GeoJSONGeometry(BaseModel):
    type: Literal[
        "Point", "LineString", "Polygon",
        "MultiPoint", "MultiLineString", "MultiPolygon"
    ]
    coordinates: Union[List, List[List], List[List[List]]]

    @field_validator("coordinates")
    @classmethod
    def coordinates_not_empty(cls, v):
        if not v:
            raise ValueError("coordinates must not be empty")
        return v

class SpatialEventPayload(BaseModel):
    geometry: GeoJSONGeometry
    asset_id: str | None = None
    zone_code: str | None = None
    # Do NOT include timestamps or request_ids here — they are non-deterministic

def parse_and_validate(raw_body: bytes) -> SpatialEventPayload:
    """Parse and validate a raw webhook body. Raises ValidationError on failure."""
    data = json.loads(raw_body)
    return SpatialEventPayload(**data)
```

A FastAPI or aiohttp endpoint should call `parse_and_validate` before any downstream logic and convert `ValidationError` to a `422` or `400` response.

### Step 2 — Strip Non-Deterministic Metadata

Remove timestamps, request IDs, delivery metadata, and ephemeral HTTP headers. These fields change across retries but represent no change in spatial state. Explicitly whitelist the fields that influence downstream processing; discard everything else. This step is the primary guard against key instability.

```python
WHITELISTED_PROPERTIES = frozenset({"asset_id", "zone_code"})

def extract_canonical_fields(payload: SpatialEventPayload) -> Dict[str, Any]:
    """Return only the fields that define spatial state."""
    result: Dict[str, Any] = {"geometry": payload.geometry.model_dump()}
    for field in sorted(WHITELISTED_PROPERTIES):
        value = getattr(payload, field, None)
        if value is not None:
            result[field] = value
    return result
```

The `sorted()` call on whitelist fields ensures property order is deterministic regardless of insertion order in the incoming JSON object.

### Step 3 — Normalize Geometry and Control Precision

Round all coordinates to your policy threshold, close polygon rings, and validate topology with Shapely. This step eliminates floating-point noise from GPS drift, client-side rounding differences, and intermediate serialization layers.

```python
import decimal
from typing import Any
from shapely.geometry import shape, mapping
from shapely.validation import make_valid

decimal.getcontext().prec = 12  # Avoid IEEE-754 accumulation errors

def round_coord(value: float, precision: int) -> float:
    """Round using Python Decimal to avoid IEEE-754 representation artifacts."""
    d = decimal.Decimal(str(value))
    return float(d.quantize(decimal.Decimal(f"1e-{precision}")))

def normalize_geometry(geojson_geom: Dict[str, Any], precision: int = 7) -> Dict[str, Any]:
    """
    Normalize a GeoJSON geometry object:
    - Repair topology (self-intersections, unclosed rings)
    - Round all coordinates to `precision` decimal places
    - Return a clean dict ready for canonical serialization
    """
    try:
        geom = shape(geojson_geom)
        geom = make_valid(geom)  # Repair self-intersections and unclosed rings
    except Exception as exc:
        raise ValueError(f"Geometry normalization failed: {exc}") from exc

    raw_mapping = mapping(geom)

    def _round_recursive(coords: Any) -> Any:
        if isinstance(coords, (int, float)):
            return round_coord(coords, precision)
        return [_round_recursive(c) for c in coords]

    return {
        "type": raw_mapping["type"],
        "coordinates": _round_recursive(raw_mapping["coordinates"]),
    }
```

`make_valid()` from Shapely 2.x repairs self-intersecting polygons and unclosed rings before serialization, ensuring topological equivalence. Without it, two payloads describing the same physical boundary may normalize differently depending on how the sending client closed the ring.

### Step 4 — Serialize Canonically

Produce a byte-identical JSON string with `sort_keys=True`, consistent separators, and UTF-8 encoding. This eliminates whitespace, newline variations, and property-order differences across JSON libraries and language runtimes.

```python
def canonical_bytes(fields: Dict[str, Any]) -> bytes:
    """Produce a deterministic UTF-8 byte string from a whitelist-filtered payload."""
    return json.dumps(
        fields,
        sort_keys=True,
        separators=(",", ":"),  # No spaces — byte-identical across platforms
        ensure_ascii=True,      # Prevent Unicode normalization ambiguity
    ).encode("utf-8")
```

`ensure_ascii=True` encodes all non-ASCII characters as `\uXXXX` escape sequences. This matters when geometry feature names or zone codes contain accented characters — different Unicode normalization forms (NFC vs NFD) would otherwise produce different byte sequences for the same logical string.

### Step 5 — Hash and Store the Key

Apply SHA-256 to the canonical bytes. Truncate to 16 bytes (128 bits) and encode as a 32-character hex string, then check against Redis atomically before processing.

```python
import hashlib
import redis

def generate_spatial_event_key(
    raw_body: bytes,
    precision: int = 7,
) -> str:
    """Full pipeline: validate → normalize → serialize → hash → 32-char hex key."""
    payload = parse_and_validate(raw_body)
    fields = extract_canonical_fields(payload)
    fields["geometry"] = normalize_geometry(fields["geometry"], precision)
    blob = canonical_bytes(fields)
    digest = hashlib.sha256(blob).digest()
    return digest[:16].hex()  # 128-bit truncation: ~1e-12 collision prob at 10B events/day

def process_if_new(
    raw_body: bytes,
    redis_client: redis.Redis,
    ttl_seconds: int = 345_600,  # 96 hours
) -> bool:
    """
    Return True if this event is new and was processed.
    Return False if it was already seen (duplicate delivery).
    """
    key = generate_spatial_event_key(raw_body)
    redis_key = f"spatial_event:{key}"

    # Atomic SET NX EX — avoids GET-then-SET race window
    stored = redis_client.set(redis_key, "1", nx=True, ex=ttl_seconds)
    if stored:
        # First delivery: process the event here
        return True
    # Duplicate delivery: discard silently
    return False
```

The `SET NX EX` pattern is atomic — it eliminates the race window that exists in a separate `GET` then `SET` flow, where two concurrent deliveries of the same event could both read a cache miss and both proceed to process.

---

## Spatial Validation and Error Handling

Beyond schema validation at Layer 1, two additional checks protect key correctness:

**CRS alignment before normalization.** If your system ingests data in EPSG:3857 (Web Mercator) but normalizes assuming EPSG:4326, keys will diverge across CRS boundaries. Use `pyproj` to transform all incoming geometries to WGS84 before the normalization step. For handling mixed-CRS event streams in production, the [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) guide covers batch transformation patterns.

```python
from pyproj import Transformer

_transformer_3857_to_4326 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)

def reproject_to_wgs84(lon: float, lat: float) -> tuple[float, float]:
    """Transform a Web Mercator coordinate to WGS84 (lon, lat)."""
    return _transformer_3857_to_4326.transform(lon, lat)
```

**Geometry validation after `make_valid`.** In rare cases, `make_valid()` returns an empty geometry (a degenerate polygon collapses to a point or line). Check for this explicitly:

```python
from shapely.geometry.base import BaseGeometry

def assert_geometry_non_empty(geom: BaseGeometry) -> None:
    if geom.is_empty:
        raise ValueError("Geometry collapsed to empty after validation — cannot generate key")
```

Both checks should raise exceptions that your ingestion layer converts to `422 Unprocessable Entity`, not `500 Internal Server Error`. They represent bad input, not system failures.

---

## Retry, Backoff, and Delivery Guarantees

Event key generation is a stateless, synchronous operation — it does not need retry logic itself. The retry surface is the downstream atomic key check in Redis. When Redis is unavailable, your ingestion endpoint has two safe options:

1. **Fail closed:** return `503 Service Unavailable` to the webhook sender, triggering their retry cycle. The key generation step is idempotent, so redelivering the same payload is safe.
2. **Fail open with logging:** process the event and log a warning. This risks duplicate writes but preserves availability. Only use this if downstream consumers are themselves idempotent.

For webhook senders that implement exponential backoff with jitter, a `503` response with a `Retry-After: 30` header gives Redis time to recover without overwhelming the endpoint. The [at-least-once delivery pattern for GIS webhooks](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/) covers the full retry contract from the sender's side.

At-least-once vs. exactly-once semantics matter here: the key-check pipeline converts at-least-once broker delivery into exactly-once processing without requiring distributed transactions. The tradeoff is that key TTLs define a finite deduplication window — events arriving after the TTL expires will be reprocessed. Size your TTL to exceed the maximum broker retry window by at least 2x.

---

## Verification

The following pytest suite confirms the pipeline behaves deterministically across the failure modes that most commonly cause key divergence in production:

```python
import pytest
import json
from your_module import generate_spatial_event_key

BASE_PAYLOAD = {
    "geometry": {
        "type": "Point",
        "coordinates": [-73.9857, 40.7484]
    },
    "asset_id": "vehicle-42"
}

def make_body(overrides: dict = None) -> bytes:
    payload = {**BASE_PAYLOAD, **(overrides or {})}
    return json.dumps(payload).encode("utf-8")

def test_identical_payloads_produce_same_key():
    """Core determinism: same input → same output."""
    assert generate_spatial_event_key(make_body()) == generate_spatial_event_key(make_body())

def test_floating_point_drift_is_normalized():
    """Coordinates that differ only in floating-point noise hash identically."""
    body_a = make_body({"geometry": {"type": "Point", "coordinates": [-73.9857, 40.7484]}})
    body_b = make_body({"geometry": {"type": "Point", "coordinates": [-73.98570000000001, 40.748400000000005]}})
    assert generate_spatial_event_key(body_a) == generate_spatial_event_key(body_b)

def test_different_coordinates_produce_different_keys():
    """Genuinely distinct locations hash differently."""
    body_a = make_body({"geometry": {"type": "Point", "coordinates": [-73.9857, 40.7484]}})
    body_b = make_body({"geometry": {"type": "Point", "coordinates": [-74.0060, 40.7128]}})
    assert generate_spatial_event_key(body_a) != generate_spatial_event_key(body_b)

def test_non_whitelisted_fields_are_excluded():
    """Timestamps and request IDs do not affect the key."""
    body_clean = make_body()
    body_with_meta = make_body({"timestamp": "2026-06-24T12:00:00Z", "request_id": "abc-123"})
    assert generate_spatial_event_key(body_clean) == generate_spatial_event_key(body_with_meta)

def test_invalid_geometry_raises():
    """Malformed geometry raises ValueError before hashing."""
    bad_body = json.dumps({"geometry": {"type": "Point", "coordinates": []}, "asset_id": "x"}).encode()
    with pytest.raises((ValueError, Exception)):
        generate_spatial_event_key(bad_body)
```

Run with `pytest -v` after setting up a test virtualenv with `shapely`, `pydantic`, and `pyproj` installed.

---

## Handling Edge Cases

### Floating-Point Drift Across SDKs

Different clients serialize coordinates with varying precision. A GPS tracker might emit `[-73.9857, 40.7484]`, while a web SDK sends `[-73.98570000000001, 40.748400000000005]`. The Decimal-based rounding in Step 3 handles this, but only if your precision policy is consistently enforced. Never use raw string equality or Python's `round()` built-in — `round()` uses banker's rounding and can produce different results from `Decimal.quantize()` for specific values.

### Topology vs. Coordinate Equality

Two polygons may represent the same physical boundary but differ in vertex density due to upstream simplification. If your application cares about geometric equivalence rather than exact coordinate matching, compute a spatial fingerprint using a bounding box hash or a simplified geometry representation (e.g., `geom.simplify(0.0001, preserve_topology=True)`) before hashing. For proximity-based triggers where geometries overlap but do not match exactly, layer [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/) on top of exact key matching.

### Multi-Geometry Member Ordering

A `MultiPolygon` or `MultiLineString` where constituent geometries appear in different orders across deliveries will hash differently even after coordinate normalization. Sort multi-geometry members by their bounding box centroid before serialization:

```python
from shapely.geometry import shape, mapping, MultiPolygon
from shapely.ops import unary_union

def sort_multi_geometry(geom):
    """Sort sub-geometries of a multi-type by centroid (lon, lat) for deterministic ordering."""
    if hasattr(geom, "geoms"):
        sorted_geoms = sorted(geom.geoms, key=lambda g: (g.centroid.x, g.centroid.y))
        return type(geom)(sorted_geoms)
    return geom
```

Call this after `make_valid()` and before the coordinate rounding pass.

### Out-of-Order Delivery and State Drift

Message brokers guarantee at-least-once delivery but not ordering. If Event B (a newer boundary update) arrives first and Event A (an older snapshot) arrives later, exact key matching treats them as distinct events and applies the older state. Implement a monotonic version field or event sequence number alongside the spatial key to enforce state progression — the spatial key handles deduplication, the version handles ordering.

---

## Troubleshooting

<div style="overflow-x:auto">

| Symptom | Likely spatial cause | Fix |
|---|---|---|
| Identical payloads produce different keys | Floating-point precision differs between senders | Enforce Decimal-based rounding in Step 3; log raw coordinates on key divergence |
| `make_valid()` returns empty geometry | Self-intersecting polygon collapsed to a degenerate shape | Raise `422` and alert; inspect source data pipeline for topology errors |
| Cache hit rate is unexpectedly low | Non-whitelisted fields (timestamps) leaking into key input | Audit `extract_canonical_fields`; add test for timestamp exclusion |
| Redis `SET NX EX` returns None but event was not processed | Race condition in application code around the atomic check | Ensure processing happens inside the same code block that reads the `SET` result |
| Multi-geometry payloads from same source hash differently | Member ordering varies across serializers | Add `sort_multi_geometry()` before normalization |
| Keys diverge after CRS transformation | Source data mixing EPSG:4326 and EPSG:3857 without declaration | Enforce CRS validation at Layer 1; transform all non-4326 input before normalization |
| High normalization failure rate | New geometry type entering the pipeline (e.g., `GeometryCollection`) | Update schema validation to reject or handle the new type; alert on validation failure spikes |

</div>

---

## FAQ

<details class="faq">
<summary><strong>How many decimal places should I use for GPS coordinates in idempotency keys?</strong></summary>

Six to seven decimal places covers sub-meter GPS accuracy (7 decimals ≈ 1 cm). Use fewer (3–4) only for administrative boundaries or zone polygons where centimeter precision is meaningless — over-precision in those cases causes legitimate boundary updates to hash identically when coordinates shift by less than your threshold. Document the policy and enforce it at ingestion time so all producers align.

</details>

<details class="faq">
<summary><strong>Can I use MD5 instead of SHA-256 for performance?</strong></summary>

MD5 is faster but has known collision weaknesses and should not be used for security-sensitive key derivation. For pure deduplication where security is not a concern, truncated SHA-256 (128 bits) costs approximately 1 µs per key on modern hardware — negligible compared to a Redis round-trip at 0.5–2 ms. The collision probability of truncated SHA-256 at 128 bits remains astronomically low even at 10 billion events per day, whereas MD5 provides worse collision resistance with marginal speed advantage.

</details>

<details class="faq">
<summary><strong>What happens when two geometries are topologically equivalent but have different vertex orderings?</strong></summary>

They will hash to different keys. Exact key matching is coordinate-level, not topology-level. If topological equivalence matters — e.g. two versions of the same zone boundary where one was resampled — compute a canonical representation such as a convex hull or a simplified geometry before hashing, or layer [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/) on top to catch geometrically equivalent but coordinate-different payloads.

</details>

<details class="faq">
<summary><strong>How long should idempotency keys be kept in Redis?</strong></summary>

Align the TTL with the maximum retry window of your upstream broker, then add a 2x safety margin. Most webhook platforms retry for 24–72 hours, so a 96-hour TTL covers redeliveries. For Kafka consumers with large retention windows (7–14 days), persist keys to a database table partitioned by day and use Redis only as the hot-path window. The full caching strategy, including cache stampede prevention and TTL alignment, is covered in [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/).

</details>

---

## Related

- [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — parent section covering the full deduplication strategy for geospatial event streams
- [Generating Deterministic Idempotency Keys for GeoJSON Events](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/generating-deterministic-idempotency-keys-for-geojson-events/) — focused walkthrough of GeoJSON-specific canonicalization patterns
- [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) — Redis architecture for key storage, TTL strategy, and cache stampede prevention
- [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/) — topology-aware deduplication for geometries that are equivalent but not coordinate-identical
- [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) — handling mixed-CRS payloads before they reach your key generation pipeline
