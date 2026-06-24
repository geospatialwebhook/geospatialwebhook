---
title: "Best Practices for Spatial Event Payload Schemas"
description: "Design production-grade spatial event payload schemas: WGS84 geometry, bbox pre-computation, CRS declarations, CloudEvents envelopes, and idempotency keys in Python."
slug: "best-practices-for-spatial-event-payload-schemas"
type: "long_tail"
breadcrumb:
  - label: "Core Event Fundamentals & Architecture"
    url: "/core-event-fundamentals-architecture/"
  - label: "Tile Update Event Pipelines"
    url: "/core-event-fundamentals-architecture/tile-update-event-pipelines/"
  - label: "Best Practices for Spatial Event Payload Schemas"
    url: "/core-event-fundamentals-architecture/tile-update-event-pipelines/best-practices-for-spatial-event-payload-schemas/"
datePublished: "2025-06-01"
dateModified: "2026-06-24"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Best Practices for Spatial Event Payload Schemas",
      "description": "Design production-grade spatial event payload schemas: enforce WGS84 geometry, bbox pre-computation, CRS declarations, CloudEvents envelopes, and idempotency keys for tile update pipelines in Python.",
      "datePublished": "2025-06-01",
      "dateModified": "2026-06-24",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Core Event Fundamentals & Architecture", "item": "https://geospatialwebhook.com/core-event-fundamentals-architecture/"},
        {"@type": "ListItem", "position": 2, "name": "Tile Update Event Pipelines", "item": "https://geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/"},
        {"@type": "ListItem", "position": 3, "name": "Best Practices for Spatial Event Payload Schemas", "item": "https://geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/best-practices-for-spatial-event-payload-schemas/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "How to design a spatial event payload schema",
      "step": [
        {"@type": "HowToStep", "name": "Declare an explicit CRS field (EPSG:4326)", "text": "Always include a crs string in every payload, even when the default WGS84 is assumed."},
        {"@type": "HowToStep", "name": "Pre-compute the bounding box at publish time", "text": "Embed a 4-element bbox array so consumers avoid deserializing the full geometry for spatial routing."},
        {"@type": "HowToStep", "name": "Isolate routing metadata from geometry", "text": "Place tenant_id, priority, and correlation_id outside the geometry object for sub-millisecond broker routing."},
        {"@type": "HowToStep", "name": "Wrap in a CloudEvents v1.0 envelope", "text": "Use the specversion, type, source, and id fields so infrastructure can route without parsing spatial data."},
        {"@type": "HowToStep", "name": "Validate at the ingress layer with Pydantic v2", "text": "Reject malformed payloads before they enter the message bus to prevent consumer group stalls."}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why must I include a CRS field even when using the WGS84 default?",
          "acceptedAnswer": {"@type": "Answer", "text": "Implicit CRS assumptions break whenever a second data source enters the pipeline with a different projection. Explicit EPSG codes eliminate axis-ordering ambiguity and make payloads self-describing for consumers that apply CRS transformations before geometry comparison."}
        },
        {
          "@type": "Question",
          "name": "How many decimal places should I use for GeoJSON coordinates?",
          "acceptedAnswer": {"@type": "Answer", "text": "Cap at 6–8 decimal places. Six decimals gives ~0.11 m horizontal accuracy on WGS84, which is sufficient for tile invalidation. Excess precision inflates payload size, increases network latency, and triggers false cache invalidations when floating-point noise moves coordinates by sub-millimeter amounts."}
        },
        {
          "@type": "Question",
          "name": "When should I send delta geometries instead of full feature state?",
          "acceptedAnswer": {"@type": "Answer", "text": "Use delta encoding for update operations on large polygons or multipolygons where only a single ring changes. Full-state payloads are simpler and safer for insert and delete operations, where consumers need the complete geometry to rebuild spatial indexes."}
        },
        {
          "@type": "Question",
          "name": "How do I detect duplicate spatial events from broker retries?",
          "acceptedAnswer": {"@type": "Answer", "text": "Derive a deterministic idempotency key from correlation_id + update_operation + a SHA-256 hash of the canonicalized geometry. Store this key in Redis or DynamoDB with a TTL matching your retry window. Consumers skip processing if the key already exists."}
        }
      ]
    }
  ]
}
</script>

**Spatial event payload schemas for tile update pipelines must enforce explicit CRS declarations (`EPSG:4326`), pre-computed bounding boxes, isolated routing metadata, and CloudEvents-wrapped envelopes — validated by Pydantic v2 at the ingress layer before any event reaches a message broker.** This page is part of [Tile Update Event Pipelines](/core-event-fundamentals-architecture/tile-update-event-pipelines/), which sits under [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/).

## When to apply this schema pattern

This approach is appropriate over a minimal ad-hoc JSON structure in three situations:

- You route events through a message broker (Kafka, RabbitMQ, AWS EventBridge) where infrastructure must make routing decisions without deserializing full coordinate arrays.
- Multiple downstream consumers — tile renderers, spatial analytics engines, audit logs — each need a different slice of the payload, making field isolation critical to avoid tight coupling.
- Your pipeline requires safe broker retries, meaning consumers must detect and skip duplicate events without replaying spatial index rebuilds or tile regeneration jobs.

---

<svg viewBox="0 0 720 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Spatial event payload schema: five isolated domains flowing left to right from GIS source to broker to consumers" style="width:100%;max-width:720px;height:auto;display:block;margin:1.5rem auto;">
  <title>Spatial event payload schema: five isolated domains</title>
  <desc>Diagram showing a GeoJSON feature mutation entering the ingress validator, which produces a CloudEvents envelope containing five domains — Geometry, BBox, Temporal, Routing, Precision — before delivery to the message broker and downstream consumers.</desc>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.5"/>
    </marker>
  </defs>
  <!-- GIS Source -->
  <rect x="8" y="110" width="100" height="48" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="58" y="130" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">GIS Source</text>
  <text x="58" y="148" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.55">feature edit</text>
  <!-- Arrow -->
  <line x1="109" y1="134" x2="138" y2="134" stroke="currentColor" stroke-opacity="0.4" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Ingress Validator -->
  <rect x="140" y="96" width="106" height="76" rx="6" fill="none" stroke="#c87941" stroke-opacity="0.6" stroke-width="1.5"/>
  <text x="193" y="118" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.8">Ingress</text>
  <text x="193" y="133" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.8">Validator</text>
  <text x="193" y="152" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.55">Pydantic v2</text>
  <text x="193" y="165" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.55">coord bounds</text>
  <!-- Arrow -->
  <line x1="247" y1="134" x2="276" y2="134" stroke="currentColor" stroke-opacity="0.4" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Envelope box -->
  <rect x="278" y="40" width="220" height="228" rx="8" fill="none" stroke="#7ab5a0" stroke-opacity="0.45" stroke-width="1.5" stroke-dasharray="5,3"/>
  <text x="388" y="60" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5">CloudEvents v1.0 envelope</text>
  <!-- 5 domain pills -->
  <!-- Geometry -->
  <rect x="290" y="70" width="90" height="34" rx="5" fill="#7ab5a0" fill-opacity="0.18" stroke="#7ab5a0" stroke-opacity="0.5" stroke-width="1"/>
  <text x="335" y="84" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85" font-weight="600">Geometry</text>
  <text x="335" y="97" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">type + coordinates</text>
  <!-- BBox -->
  <rect x="394" y="70" width="90" height="34" rx="5" fill="#c87941" fill-opacity="0.15" stroke="#c87941" stroke-opacity="0.5" stroke-width="1"/>
  <text x="439" y="84" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85" font-weight="600">BBox</text>
  <text x="439" y="97" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">[min_lon … max_lat]</text>
  <!-- Temporal -->
  <rect x="290" y="116" width="90" height="34" rx="5" fill="#a07ab5" fill-opacity="0.15" stroke="#a07ab5" stroke-opacity="0.5" stroke-width="1"/>
  <text x="335" y="130" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85" font-weight="600">Temporal</text>
  <text x="335" y="143" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">event_time · version</text>
  <!-- Routing -->
  <rect x="394" y="116" width="90" height="34" rx="5" fill="#7ab5a0" fill-opacity="0.18" stroke="#7ab5a0" stroke-opacity="0.5" stroke-width="1"/>
  <text x="439" y="130" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85" font-weight="600">Routing</text>
  <text x="439" y="143" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">tenant · priority · cid</text>
  <!-- Precision -->
  <rect x="342" y="162" width="90" height="34" rx="5" fill="#c87941" fill-opacity="0.15" stroke="#c87941" stroke-opacity="0.5" stroke-width="1"/>
  <text x="387" y="176" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85" font-weight="600">Precision</text>
  <text x="387" y="189" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">6–8 decimal places</text>
  <!-- CRS note -->
  <text x="388" y="240" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.45">crs: EPSG:4326 explicit on every event</text>
  <!-- Arrow out of envelope -->
  <line x1="499" y1="134" x2="528" y2="134" stroke="currentColor" stroke-opacity="0.4" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Broker -->
  <rect x="530" y="96" width="90" height="76" rx="6" fill="none" stroke="#c87941" stroke-opacity="0.6" stroke-width="1.5"/>
  <text x="575" y="126" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.8">Message</text>
  <text x="575" y="141" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.8">Broker</text>
  <text x="575" y="158" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.55">Kafka / SQS</text>
  <!-- Arrow out of broker -->
  <line x1="621" y1="134" x2="650" y2="134" stroke="currentColor" stroke-opacity="0.4" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Consumers -->
  <rect x="652" y="86" width="60" height="28" rx="5" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="1"/>
  <text x="682" y="105" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">Tile renderer</text>
  <rect x="652" y="120" width="60" height="28" rx="5" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="1"/>
  <text x="682" y="139" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">Spatial index</text>
  <rect x="652" y="154" width="60" height="28" rx="5" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="1"/>
  <text x="682" y="173" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">Audit log</text>
</svg>

## Schema anatomy: five isolated domains

Spatial event payloads break down in production when transport concerns bleed into geometric data. A resilient schema isolates five distinct domains:

1. **Geometry and projection.** Default to WGS84 (`EPSG:4326`) with explicit `[longitude, latitude]` ordering. Always include a `crs` string even when using the default, and never rely on implicit axis ordering. The [RFC 7946 GeoJSON specification](https://datatracker.ietf.org/doc/html/rfc7946) mandates longitude-first ordering to prevent coordinate inversion across parsers. For payloads mixing projections, apply [CRS normalization](/spatial-payload-routing-parsing/crs-normalization-strategies/) before serialization.

2. **Bounding box (`bbox`).** Require a fixed 4-element array `[min_lon, min_lat, max_lon, max_lat]`. Consumers use this for rapid spatial indexing, tile routing, and bounding-box intersection tests without deserializing full coordinate arrays — essential for the sub-millisecond routing decisions described in [Tile Update Event Pipelines](/core-event-fundamentals-architecture/tile-update-event-pipelines/).

3. **Temporal and versioning.** Include `event_time` (ISO 8601 UTC), `schema_version`, and `update_operation` (`insert`, `update`, `delete`). This enables idempotent replay, out-of-order event handling, and schema drift detection. Pair these fields with a deterministic idempotency key as described in [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/).

4. **Routing and context.** Keep `tenant_id`, `priority`, `source_system`, and `correlation_id` outside the `geometry` object. Message brokers can route, throttle, or drop events based on these flat keys before incurring the CPU cost of parsing nested spatial structures.

5. **Precision control.** Cap coordinate precision at 6–8 decimal places (~1–10 cm accuracy on WGS84). Excess precision inflates JSON payloads, increases network latency, and triggers unnecessary tile cache invalidations when floating-point noise shifts coordinates by sub-millimeter margins.

## Complete runnable implementation

The Pydantic v2 model below enforces strict GeoJSON validation, auto-computes fallback bounding boxes from any geometry type, and serializes to a CloudEvents v1.0 envelope. It rejects invalid payloads at the class boundary rather than letting errors propagate into consumer workers.

```python
from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import datetime, timezone
from typing import Literal, Optional
import uuid


class SpatialEventPayload(BaseModel):
    # Schema versioning — consumers gate on this before parsing geometry
    schema_version: Literal["1.0"] = "1.0"

    # Operational envelope — routable without touching geometry
    event_type: Literal["tile_update", "geometry_change", "attribute_sync"]
    update_operation: Literal["insert", "update", "delete"]
    correlation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: Optional[str] = None
    priority: int = Field(default=5, ge=1, le=10)
    source_system: Optional[str] = None

    # Geometry domain — always GeoJSON, always explicit CRS
    geometry: dict
    crs: str = Field(default="EPSG:4326")

    # Pre-computed bbox: [min_lon, min_lat, max_lon, max_lat] — 4 elements exactly
    bbox: Optional[list[float]] = Field(default=None, min_length=4, max_length=4)

    # Temporal domain — ISO 8601 UTC, mandatory
    event_time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Arbitrary attribute payload (properties, not geometry or routing)
    metadata: dict = Field(default_factory=dict)

    @field_validator("geometry")
    @classmethod
    def validate_geojson_structure(cls, v: dict) -> dict:
        valid_types = {
            "Point", "LineString", "Polygon",
            "MultiPoint", "MultiLineString", "MultiPolygon",
            "GeometryCollection",
        }
        if v.get("type") not in valid_types:
            raise ValueError(f"Invalid GeoJSON geometry type: {v.get('type')!r}")
        if "coordinates" not in v and v["type"] != "GeometryCollection":
            raise ValueError("GeoJSON object missing required 'coordinates' array")
        # Validate coordinate bounds: lon in [-180, 180], lat in [-90, 90]
        for lon, lat in cls._flatten_coordinates(v):
            if not (-180 <= lon <= 180):
                raise ValueError(f"Longitude {lon} out of WGS84 range [-180, 180]")
            if not (-90 <= lat <= 90):
                raise ValueError(f"Latitude {lat} out of WGS84 range [-90, 90]")
        return v

    @model_validator(mode="before")
    @classmethod
    def compute_bbox_if_missing(cls, data: dict) -> dict:
        """Auto-derive bbox from geometry coordinates if not supplied by producer."""
        if not data.get("bbox") and data.get("geometry"):
            coords = cls._flatten_coordinates(data["geometry"])
            if coords:
                lons = [c[0] for c in coords]
                lats = [c[1] for c in coords]
                # Round to 7 decimal places to match coordinate precision policy
                data["bbox"] = [
                    round(min(lons), 7),
                    round(min(lats), 7),
                    round(max(lons), 7),
                    round(max(lats), 7),
                ]
        return data

    @staticmethod
    def _flatten_coordinates(geom: dict) -> list[list[float]]:
        """Recursively extract all [lon, lat] pairs for bbox computation."""
        t = geom.get("type")
        c = geom.get("coordinates")
        if t == "Point":
            return [c]
        if t in {"LineString", "MultiPoint"}:
            return list(c)
        if t in {"Polygon", "MultiLineString"}:
            return [pt for ring in c for pt in ring]
        if t == "MultiPolygon":
            return [pt for poly in c for ring in poly for pt in ring]
        if t == "GeometryCollection":
            return [
                pt
                for g in geom.get("geometries", [])
                for pt in SpatialEventPayload._flatten_coordinates(g)
            ]
        return []

    def round_coordinates(self, precision: int = 7) -> "SpatialEventPayload":
        """
        Return a copy with coordinates rounded to `precision` decimal places.
        Call before to_cloudevent() to enforce the precision policy.
        """
        import json

        def round_coords(obj):
            if isinstance(obj, float):
                return round(obj, precision)
            if isinstance(obj, list):
                return [round_coords(x) for x in obj]
            if isinstance(obj, dict):
                return {k: round_coords(v) for k, v in obj.items()}
            return obj

        rounded_geom = round_coords(self.geometry)
        return self.model_copy(update={"geometry": rounded_geom})

    def to_cloudevent(self, source: str = "geospatial-ingest") -> dict:
        """
        Serialize to a CloudEvents v1.0 envelope.
        Brokers route on specversion / type / source / subject without touching 'data'.
        """
        return {
            "specversion": "1.0",
            "type": f"com.spatial.{self.event_type}",
            "source": source,
            "id": self.correlation_id,
            "time": self.event_time.isoformat(),
            "subject": self.tenant_id or "default",
            "datacontenttype": "application/json",
            "data": self.model_dump(mode="json"),
        }
```

## Parameter reference

| Field | Type | Constraint | Default |
|---|---|---|---|
| `schema_version` | `Literal["1.0"]` | Must match consumer version gate | `"1.0"` |
| `event_type` | `str` (enum) | `tile_update`, `geometry_change`, `attribute_sync` | required |
| `update_operation` | `str` (enum) | `insert`, `update`, `delete` | required |
| `correlation_id` | `str` | UUID4; used as CloudEvents `id` | auto-generated |
| `tenant_id` | `str \| None` | Routable flat key; must not be inside `geometry` | `None` |
| `priority` | `int` | 1 (highest) to 10 (lowest) | `5` |
| `geometry` | `dict` | Valid RFC 7946 GeoJSON geometry object | required |
| `crs` | `str` | Always include EPSG code, e.g. `"EPSG:4326"` | `"EPSG:4326"` |
| `bbox` | `list[float]` (4) | `[min_lon, min_lat, max_lon, max_lat]`; auto-computed if absent | auto |
| `event_time` | `datetime` | ISO 8601, timezone-aware UTC | `utcnow()` |
| `metadata` | `dict` | Feature properties; never coordinates | `{}` |

## Gotchas and spatial edge cases

1. **Coordinate axis ordering silently inverts across systems.** The RFC 7946 GeoJSON format requires `[longitude, latitude]`, but legacy WFS services and many GIS desktop exports emit `[latitude, longitude]` (EPSG geographic ordering). Always validate that the first coordinate component stays in `[-180, 180]` before accepting a payload — your `field_validator` above does this. For payloads arriving in non-WGS84 projections, apply [CRS normalization strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/) before the schema validator runs.

2. **Floating-point noise causes spurious tile invalidations.** IEEE-754 representation drift can shift a coordinate by `1e-15` degrees between serializer versions. If you hash raw coordinates for cache keys or idempotency checks without rounding first, structurally identical geometries produce different hashes. Round to 7 decimal places before serialization; this is the responsibility of `round_coordinates()` in the model above.

3. **Polygon ring orientation is not enforced by JSON parsers.** RFC 7946 requires exterior rings to be counter-clockwise and holes to be clockwise, but no standard JSON library checks this. Some spatial databases (PostGIS) silently reorient rings on insert; others (SQLite/SpatiaLite) do not. If downstream consumers compare geometries directly, mismatched orientations cause false non-equality. Use `shapely.geometry.shape(geom).normalize()` before serialization if ring orientation must be canonical.

4. **`GeometryCollection` breaks naive bbox computation.** The `coordinates` key does not exist on `GeometryCollection` — child geometries live under `geometries`. The `_flatten_coordinates` method handles this recursively, but any third-party bbox utility you call must also support it; many do not.

5. **`bbox` that does not contain the geometry's extents fails spatial routing.** If a producer manually supplies a stale `bbox` from a cached feature and then edits the geometry, the bbox may no longer enclose the new shape. The `model_validator` auto-computes bbox only when the field is absent; it does not re-validate a supplied bbox against the geometry. Add an explicit containment check in production: `assert bbox[0] <= min(lons) and bbox[2] >= max(lons)`.

6. **CloudEvents `id` must be unique per event, not per feature.** Reusing the same `correlation_id` across retries is intentional for idempotency at the consumer. However, the broker may deduplicate based on `id`, which would silently drop legitimate re-deliveries. Use the `correlation_id` as the idempotency key inside your consumer's Redis store; let the broker see unique `id` values if it performs producer-side deduplication.

## Verification snippet

This pytest confirms that bbox auto-computation, coordinate rounding, and CloudEvents envelope structure all behave correctly against a representative GeoJSON polygon:

```python
import pytest
from datetime import timezone
from your_module import SpatialEventPayload  # replace with your import path


POLYGON_PAYLOAD = {
    "event_type": "tile_update",
    "update_operation": "update",
    "geometry": {
        "type": "Polygon",
        "coordinates": [[
            [-122.41941550000001, 37.77492950000001],
            [-122.41800000000000, 37.77492950000001],
            [-122.41800000000000, 37.77350000000000],
            [-122.41941550000001, 37.77350000000000],
            [-122.41941550000001, 37.77492950000001],
        ]]
    },
    "tenant_id": "acme-maps",
    "crs": "EPSG:4326",
}


def test_bbox_auto_computed():
    event = SpatialEventPayload(**POLYGON_PAYLOAD)
    assert event.bbox is not None, "bbox must be auto-computed when absent"
    assert len(event.bbox) == 4, "bbox must be a 4-element list"
    min_lon, min_lat, max_lon, max_lat = event.bbox
    assert min_lon <= max_lon, "bbox min_lon must not exceed max_lon"
    assert min_lat <= max_lat, "bbox min_lat must not exceed max_lat"


def test_coordinate_precision_capped():
    event = SpatialEventPayload(**POLYGON_PAYLOAD).round_coordinates(precision=7)
    # After rounding, no coordinate should have more than 7 decimal places
    for lon, lat in SpatialEventPayload._flatten_coordinates(event.geometry):
        assert len(str(lon).split(".")[-1]) <= 7, f"lon {lon} exceeds 7 decimal places"
        assert len(str(lat).split(".")[-1]) <= 7, f"lat {lat} exceeds 7 decimal places"


def test_cloudevent_envelope_structure():
    event = SpatialEventPayload(**POLYGON_PAYLOAD)
    envelope = event.to_cloudevent(source="test-ingest")
    assert envelope["specversion"] == "1.0"
    assert envelope["type"] == "com.spatial.tile_update"
    assert envelope["subject"] == "acme-maps"
    assert "data" in envelope
    assert envelope["data"]["crs"] == "EPSG:4326"


def test_out_of_bounds_longitude_rejected():
    bad = dict(POLYGON_PAYLOAD)
    bad["geometry"] = {
        "type": "Point",
        "coordinates": [200.0, 37.77]  # longitude 200 is invalid
    }
    with pytest.raises(ValueError, match="Longitude"):
        SpatialEventPayload(**bad)


def test_event_time_is_utc():
    event = SpatialEventPayload(**POLYGON_PAYLOAD)
    assert event.event_time.tzinfo is not None, "event_time must be timezone-aware"
    assert event.event_time.tzinfo == timezone.utc or str(event.event_time.tzinfo) in ("+00:00", "UTC")
```

---

## Related

- [Tile Update Event Pipelines](/core-event-fundamentals-architecture/tile-update-event-pipelines/) — parent: architecture and orchestration of the full tile invalidation workflow
- [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — sibling: derive deterministic idempotency keys from the canonicalized geometry in these payloads
- [CRS Normalization Strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/) — normalize mixed-projection inputs before they reach the ingress validator
- [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/) — grandparent pillar covering the full spatial event architecture
