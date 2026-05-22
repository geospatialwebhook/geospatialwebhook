# Best practices for spatial event payload schemas

**Best practices for spatial event payload schemas** require strict adherence to standardized geometry formats, explicit coordinate reference system (CRS) declarations, pre-computed bounding boxes, and deterministic temporal metadata. In production geospatial architectures, you must validate geometry at the ingress layer, decouple routing metadata from spatial coordinates, and enforce idempotent update operations. This prevents downstream tile regeneration bottlenecks, eliminates projection ambiguity, and guarantees predictable parsing across distributed consumers.

## Core Schema Architecture & Field Requirements

Spatial event payloads degrade when transport concerns bleed into geometric data. A resilient schema isolates five distinct domains:

1. **Geometry & Projection**: Default to WGS84 (`EPSG:4326`) with explicit `[longitude, latitude]` ordering. Always include a `crs` string, even when using the default, and never rely on implicit axis ordering. The [RFC 7946 GeoJSON specification](https://datatracker.ietf.org/doc/html/rfc7946) mandates this ordering to prevent coordinate inversion across parsers.
2. **Bounding Box (`bbox`)**: Require a fixed 4-element array `[min_lon, min_lat, max_lon, max_lat]`. Consumers leverage this for rapid spatial indexing, tile routing, and bounding-box intersection tests without deserializing full coordinate arrays.
3. **Temporal & Versioning**: Include `event_time` (ISO 8601 UTC), `schema_version`, and `update_operation` (`insert`, `update`, `delete`). This enables idempotent replay, out-of-order event handling, and schema drift detection.
4. **Routing & Context**: Keep `tenant_id`, `priority`, `source_system`, and `correlation_id` outside the `geometry` object. Message brokers can route, throttle, or drop events based on these flat keys before incurring the CPU cost of parsing nested spatial structures, a pattern foundational to scalable [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/).
5. **Precision Control**: Cap coordinate precision at 6–8 decimal places (~1–10 cm accuracy). Excess precision inflates JSON payloads, increases network latency, and triggers unnecessary tile cache invalidations when floating-point noise shifts coordinates by sub-millimeter margins.

## Production-Ready Python Implementation

The following Pydantic v2 model enforces strict GeoJSON validation, auto-computes fallback bounding boxes, and serializes to a CloudEvents-compatible envelope. It replaces implicit type coercion with explicit validation gates.

```python
from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import datetime, timezone
from typing import Literal, Optional
import uuid
import math

class SpatialEventPayload(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    event_type: Literal["tile_update", "geometry_change", "attribute_sync"]
    geometry: dict
    bbox: Optional[list[float]] = Field(default=None, min_length=4, max_length=4)
    crs: str = Field(default="EPSG:4326")
    event_time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    update_operation: Literal["insert", "update", "delete"]
    correlation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    metadata: dict = Field(default_factory=dict)

    @field_validator("geometry")
    @classmethod
    def validate_geojson_structure(cls, v: dict) -> dict:
        valid_types = {
            "Point", "LineString", "Polygon", "MultiPoint",
            "MultiLineString", "MultiPolygon", "GeometryCollection"
        }
        if v.get("type") not in valid_types:
            raise ValueError(f"Invalid GeoJSON type: {v.get('type')}")
        if "coordinates" not in v and v["type"] != "GeometryCollection":
            raise ValueError("GeoJSON object missing 'coordinates' array")
        return v

    @model_validator(mode="before")
    @classmethod
    def compute_bbox_if_missing(cls, data: dict) -> dict:
        if not data.get("bbox") and data.get("geometry"):
            coords = cls._flatten_coordinates(data["geometry"])
            if coords:
                lons = [c[0] for c in coords]
                lats = [c[1] for c in coords]
                data["bbox"] = [min(lons), min(lats), max(lons), max(lats)]
        return data

    @staticmethod
    def _flatten_coordinates(geom: dict) -> list[list[float]]:
        """Recursively extract coordinate pairs for bbox computation."""
        geom_type = geom.get("type")
        coords = geom.get("coordinates")
        
        if geom_type == "Point":
            return [coords]
        if geom_type in {"LineString", "MultiPoint"}:
            return coords
        if geom_type in {"Polygon", "MultiLineString"}:
            return [c for ring in coords for c in ring]
        if geom_type == "MultiPolygon":
            return [c for poly in coords for ring in poly for c in ring]
        if geom_type == "GeometryCollection":
            return [c for g in geom.get("geometries", []) for c in cls._flatten_coordinates(g)]
        return []

    def to_cloudevent(self, source: str = "geospatial-ingest") -> dict:
        """Serialize to a CloudEvents v1.0 envelope."""
        return {
            "specversion": "1.0",
            "type": f"com.spatial.{self.event_type}",
            "source": source,
            "id": self.correlation_id,
            "time": self.event_time.isoformat(),
            "datacontenttype": "application/json",
            "data": self.model_dump(mode="json")
        }
```

## Validation, Routing & Pipeline Integration

Schema validation must occur before events enter the message bus. Rejecting malformed payloads at the edge prevents poison-pill events from stalling consumer groups. Use JSON Schema or Pydantic to enforce coordinate bounds (`-180 ≤ lon ≤ 180`, `-90 ≤ lat ≤ 90`) and validate that `bbox` values strictly contain the geometry's extents.

When integrating with asynchronous brokers (Kafka, RabbitMQ, AWS EventBridge), separate the envelope from the payload. The CloudEvents specification standardizes this separation, allowing infrastructure to route based on `type`, `source`, and `subject` while leaving spatial data opaque until it reaches the processing worker. This decoupling is critical when building [Tile Update Event Pipelines](/core-event-fundamentals-architecture/tile-update-event-pipelines/), where routing decisions must execute in sub-millisecond latency windows.

Implement deterministic idempotency keys derived from `correlation_id` + `update_operation` + `geometry_hash`. Hash the geometry using a stable algorithm (e.g., SHA-256 over sorted coordinate arrays) to detect duplicate events. Consumers should maintain a short-lived idempotency store (Redis or DynamoDB with TTL) to safely retry failed deliveries without triggering redundant spatial index rebuilds.

## Performance & Cache Considerations

Spatial payloads directly impact rendering performance and storage costs. Apply these optimizations before publishing:

- **Coordinate Quantization**: Round coordinates to 7 decimal places. This reduces JSON size by ~15–20% while preserving survey-grade accuracy. Use `math.floor(val * 1e7) / 1e7` during serialization.
- **Delta Encoding for Updates**: When transmitting `update` operations, consider sending only the modified geometry rings or attribute dictionaries rather than full feature states. This minimizes network egress and reduces consumer parsing overhead.
- **Tile Routing Pre-computation**: Calculate the affected tile grid (e.g., Mapbox GL or OGC WMTS levels 0–14) at publish time. Embed `affected_tiles: ["z/x/y", ...]` in the payload to allow downstream renderers to skip spatial intersection math and directly invalidate cached raster/vector tiles.
- **Schema Evolution Strategy**: Version your payloads explicitly (`schema_version`). Use additive-only changes for minor versions and enforce strict backward compatibility for consumers reading older envelopes. Deprecate fields with a 90-day sunset window rather than breaking changes.

By enforcing strict validation, isolating routing metadata, and pre-computing spatial derivatives, your event payloads become predictable, cache-friendly, and resilient to scale. This architectural discipline eliminates projection drift, guarantees deterministic tile regeneration, and ensures your geospatial infrastructure remains responsive under high-throughput workloads.