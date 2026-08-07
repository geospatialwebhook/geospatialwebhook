---
title: "CRS Normalization Strategies for Geospatial Events"
description: "Normalize mixed coordinate reference systems to a canonical EPSG:4326 projection at the webhook ingestion boundary: CRS detection, thread-safe pyproj transformer caching, topology-safe reprojection, retry handling, and verification in Python."
slug: "crs-normalization-strategies"
type: "guide"
breadcrumb: "Spatial Payload Routing & Parsing › CRS Normalization Strategies"
datePublished: "2025-02-04"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "CRS Normalization Strategies for Geospatial Events",
      "description": "Normalize mixed coordinate reference systems to a canonical EPSG:4326 projection at the webhook ingestion boundary: CRS detection, thread-safe pyproj transformer caching, topology-safe reprojection, retry handling, and verification in Python.",
      "datePublished": "2025-02-04",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/" },
        { "@type": "ListItem", "position": 2, "name": "Spatial Payload Routing & Parsing", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/" },
        { "@type": "ListItem", "position": 3, "name": "CRS Normalization Strategies", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "CRS Normalization Strategies for Geospatial Events",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Detect the source CRS and extract metadata" },
        { "@type": "HowToStep", "position": 2, "name": "Pre-transformation bounds and topology validation" },
        { "@type": "HowToStep", "position": 3, "name": "Initialize and cache thread-safe transformers" },
        { "@type": "HowToStep", "position": 4, "name": "Reproject geometry while preserving topology" },
        { "@type": "HowToStep", "position": 5, "name": "Serialize the canonical geometry for downstream routing" }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why normalize to EPSG:4326 instead of EPSG:3857?",
          "acceptedAnswer": { "@type": "Answer", "text": "EPSG:4326 (WGS 84 lat/lon) is the canonical interchange CRS mandated by RFC 7946 for GeoJSON and is the safe storage projection for spatial indexes. EPSG:3857 (Web Mercator) distorts area and distance away from the equator, so use it only as a render-time projection for tile pipelines, never as the storage canonical CRS." }
        },
        {
          "@type": "Question",
          "name": "How do I detect the CRS when the payload has no crs property?",
          "acceptedAnswer": { "@type": "Answer", "text": "Apply a fallback resolution chain: check an explicit crs or srid property, then a vendor header such as X-Source-CRS, then heuristics on the coordinate bounds — values outside the +/-180 / +/-90 range almost always indicate a projected system in meters. If none resolve, quarantine the payload to a dead-letter queue rather than guessing." }
        },
        {
          "@type": "Question",
          "name": "Why must I set always_xy=True on a pyproj Transformer?",
          "acceptedAnswer": { "@type": "Answer", "text": "PROJ 6+ honours each CRS's authority-defined axis order, which for EPSG:4326 is lat/lon. GeoJSON coordinates are lon/lat. Passing always_xy=True forces longitude-first, latitude-second ordering on both ends so coordinates do not silently swap and land features in the wrong hemisphere." }
        },
        {
          "@type": "Question",
          "name": "Should I round coordinates before or after reprojection?",
          "acceptedAnswer": { "@type": "Answer", "text": "Always round or grid-snap after reprojection, never before. Rounding source coordinates introduces error that the transform amplifies, and can collapse adjacent vertices into invalid self-touching rings. Apply precision reduction as the final step before serialization." }
        }
      ]
    }
  ]
}
</script>

**Detect the source coordinate reference system at the ingestion boundary, then reproject every incoming geometry to a single canonical `EPSG:4326` (WGS 84) projection — using cached, thread-safe `pyproj` transformers — before it touches any spatial index, routing rule, or store.**

This implementation guide is part of [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/), the section covering how GeoJSON and binary geometry payloads are ingested, classified, validated, and forwarded to spatial consumers.

---

## Prerequisites

Confirm your environment meets these baseline requirements before building a normalization stage:

- [ ] **Python 3.10+** — for `match` statement CRS dispatch and modern type hints.
- [ ] **pyproj 3.4+** — PROJ 9 bindings for CRS detection, transformer construction, and thread-safe transforms.
- [ ] **Shapely 2.0+** — GEOS 3.10+ geometry objects and `shapely.ops.transform` for whole-geometry reprojection.
- [ ] **Pydantic v2** — schema-validate the normalized output before it leaves the stage.
- [ ] **FastAPI 0.100+ or aiohttp 3.9+** — non-blocking ingestion endpoint.
- [ ] **A canonical CRS target** — `EPSG:4326` for storage and routing; `EPSG:3857` only as a downstream render projection.
- [ ] **Redis 7+ or RabbitMQ 3.12+** — optional, for buffering and a dead-letter queue for unresolvable-CRS payloads.

---

## Architecture Overview

Normalization sits between raw ingestion and any spatially aware consumer. It runs as three ordered layers: detect the source CRS, reproject through a cached transformer, then emit a canonical geometry. Anything that cannot be resolved is quarantined rather than guessed at.

<figure class="fig">
<svg viewBox="0 7 720 293" role="img" aria-label="Three-layer CRS normalization flow: detection, cached reprojection, and canonical emission, with a quarantine branch for unresolvable CRS" xmlns="http://www.w3.org/2000/svg">
  <title>CRS Normalization Data Flow</title>
  <desc>A payload enters a detection layer that reads explicit CRS metadata, vendor headers, or coordinate-bounds heuristics. Resolved payloads pass to a reprojection layer backed by a thread-safe transformer cache, then to a canonical emission layer that serializes EPSG:4326 GeoJSON. Payloads with no resolvable CRS branch to a dead-letter quarantine.</desc>
  <rect x="0" y="7" width="720" height="293" fill="var(--fig-bg)"/>
  <defs>
    <marker id="crsArrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Inbound -->
  <rect x="14" y="120" width="120" height="56" rx="6" fill="currentColor" opacity="0.08"/>
  <text x="74" y="143" text-anchor="middle" font-size="11" fill="currentColor">Raw payload</text>
  <text x="74" y="159" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">mixed CRS</text>
  <!-- Layer 1 detection -->
  <rect x="166" y="40" width="170" height="216" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"/>
  <text x="251" y="32" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" opacity="0.7">1 · Detect CRS</text>
  <rect x="181" y="58" width="140" height="40" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="251" y="74" text-anchor="middle" font-size="10" fill="currentColor">crs / srid property</text>
  <text x="251" y="88" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">explicit metadata</text>
  <rect x="181" y="108" width="140" height="40" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="251" y="124" text-anchor="middle" font-size="10" fill="currentColor">X-Source-CRS header</text>
  <text x="251" y="138" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">vendor fallback</text>
  <rect x="181" y="158" width="140" height="40" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="251" y="174" text-anchor="middle" font-size="10" fill="currentColor">bounds heuristic</text>
  <text x="251" y="188" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">&gt; 180 = projected</text>
  <rect x="181" y="208" width="140" height="36" rx="5" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="4 3" opacity="0.5"/>
  <text x="251" y="230" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">unresolved → quarantine</text>
  <!-- Layer 2 reproject -->
  <rect x="368" y="40" width="170" height="160" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"/>
  <text x="453" y="32" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" opacity="0.7">2 · Reproject</text>
  <rect x="383" y="58" width="140" height="40" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="453" y="74" text-anchor="middle" font-size="10" fill="currentColor">transformer cache</text>
  <text x="453" y="88" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">keyed src→4326</text>
  <rect x="383" y="108" width="140" height="40" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="453" y="124" text-anchor="middle" font-size="10" fill="currentColor">shapely transform</text>
  <text x="453" y="138" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">all rings, always_xy</text>
  <rect x="383" y="156" width="140" height="34" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="453" y="177" text-anchor="middle" font-size="10" fill="currentColor">precision reduce (after)</text>
  <!-- Layer 3 emit -->
  <rect x="570" y="40" width="138" height="160" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"/>
  <text x="639" y="32" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" opacity="0.7">3 · Emit</text>
  <rect x="583" y="58" width="112" height="40" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="639" y="74" text-anchor="middle" font-size="10" fill="currentColor">EPSG:4326</text>
  <text x="639" y="88" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">GeoJSON / proto</text>
  <rect x="583" y="108" width="112" height="40" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="639" y="124" text-anchor="middle" font-size="10" fill="currentColor">spatial index</text>
  <text x="639" y="138" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">+ routing rules</text>
  <!-- Quarantine -->
  <rect x="368" y="222" width="170" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="4 3" opacity="0.55"/>
  <text x="453" y="246" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">dead-letter queue</text>
  <!-- Arrows -->
  <line x1="134" y1="148" x2="163" y2="148" stroke="currentColor" stroke-width="1.4" marker-end="url(#crsArrow)" opacity="0.55"/>
  <line x1="336" y1="120" x2="365" y2="120" stroke="currentColor" stroke-width="1.4" marker-end="url(#crsArrow)" opacity="0.55"/>
  <line x1="538" y1="120" x2="567" y2="120" stroke="currentColor" stroke-width="1.4" marker-end="url(#crsArrow)" opacity="0.55"/>
  <line x1="251" y1="244" x2="251" y2="286" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.5"/>
  <line x1="251" y1="286" x2="365" y2="286" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#crsArrow)" opacity="0.5"/>
  <line x1="453" y1="262" x2="453" y2="278" stroke="currentColor" stroke-width="0" opacity="0"/>
</svg>
<figcaption><b>Figure 1.</b> CRS Normalization Data Flow</figcaption>
</figure>

**Layer 1 — Detect CRS:** Resolve the source projection from explicit GeoJSON `crs`/`srid` metadata, then a vendor header, then a coordinate-bounds heuristic. Payloads that resolve to nothing branch to quarantine instead of defaulting silently.

**Layer 2 — Reproject:** A cached `pyproj.Transformer` keyed by the source→target CRS pair reprojects the whole geometry with `shapely.ops.transform`, walking every coordinate ring. Precision reduction happens only after the transform.

**Layer 3 — Emit:** The geometry is serialized as canonical `EPSG:4326` GeoJSON (or a binary equivalent) and handed to the spatial index and routing rules with a single, predictable projection.

---

## Step-by-Step Implementation

### Step 1 — Detect the Source CRS and Extract Metadata

The first responsibility of the stage is to learn the source projection without trusting a default. Read the GeoJSON `crs` member, fall back to a `srid`/`epsg` property, then a vendor header, then a bounds heuristic. For the full fallback chain and how to keep it off the consumer thread, see [Handling mixed CRS payloads in Python event handlers](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/).

```python
from __future__ import annotations

from shapely.geometry import shape

CANONICAL_EPSG = 4326  # WGS 84 lon/lat


class CRSUnresolved(Exception):
    """Raised when no detection method can determine the source CRS."""


def detect_source_epsg(payload: dict, headers: dict[str, str] | None = None) -> int:
    """Resolve the source EPSG code from metadata, header, then geometry bounds."""
    headers = headers or {}

    # 1. Explicit GeoJSON 2008-style crs member, e.g. urn:ogc:def:crs:EPSG::32633
    crs_member = payload.get("crs", {}).get("properties", {}).get("name", "")
    if "EPSG::" in crs_member:
        return int(crs_member.rsplit("EPSG::", 1)[1])

    # 2. Vendor property or header
    for candidate in (payload.get("properties", {}).get("source_epsg"),
                      headers.get("X-Source-CRS")):
        if candidate:
            return int(str(candidate).removeprefix("EPSG:"))

    # 3. Bounds heuristic: |lon| <= 180 and |lat| <= 90 implies geographic 4326.
    geom = shape(payload["geometry"])
    minx, miny, maxx, maxy = geom.bounds
    if -180 <= minx <= 180 and -90 <= miny <= 90 and abs(maxx) <= 180 and abs(maxy) <= 90:
        return CANONICAL_EPSG

    raise CRSUnresolved(
        f"Coordinates out of geographic range (bounds={geom.bounds}); "
        "no explicit CRS supplied"
    )
```

### Step 2 — Pre-Transformation Bounds and Topology Validation

Validate before you spend CPU on a transform. Check that coordinates fall within the source CRS's declared extent and that the topology is repairable, so malformed input fails fast instead of producing silently corrupt output. This is the lightweight gate ahead of the deeper checks in [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/).

```python
from shapely.geometry.base import BaseGeometry
from shapely.validation import explain_validity, make_valid


def validate_before_transform(geom: BaseGeometry) -> BaseGeometry:
    """Reject empty geometries and repair invalid topology before reprojection."""
    if geom.is_empty:
        raise ValueError("Empty geometry cannot be normalized")

    if not geom.is_valid:
        # explain_validity surfaces the exact failing ring for DLQ triage.
        reason = explain_validity(geom)
        repaired = make_valid(geom)
        if repaired.is_empty:
            raise ValueError(f"Unrepairable geometry: {reason}")
        return repaired

    return geom
```

### Step 3 — Initialize and Cache Thread-Safe Transformers

Constructing a `pyproj.Transformer` triggers a PROJ database lookup, which is far too slow to repeat per request. `Transformer` instances are thread-safe once built, so cache them keyed by the source→target pair behind a lock with a bounded size to prevent unbounded growth in long-running workers.

```python
import threading

from pyproj import CRS, Transformer


class TransformerCache:
    """Bounded, thread-safe cache of pyproj transformers keyed by CRS pair."""

    def __init__(self, maxsize: int = 128) -> None:
        self._lock = threading.Lock()
        self._cache: dict[tuple[int, int], Transformer] = {}
        self._maxsize = maxsize

    def get(self, src_epsg: int, dst_epsg: int = CANONICAL_EPSG) -> Transformer:
        key = (src_epsg, dst_epsg)
        with self._lock:
            transformer = self._cache.get(key)
            if transformer is None:
                transformer = Transformer.from_crs(
                    CRS.from_epsg(src_epsg),
                    CRS.from_epsg(dst_epsg),
                    always_xy=True,  # force lon/lat ordering for GeoJSON
                )
                if len(self._cache) >= self._maxsize:
                    # Insertion-ordered dict (Python 3.7+): evict the oldest entry.
                    self._cache.pop(next(iter(self._cache)))
                self._cache[key] = transformer
            return transformer


TRANSFORMERS = TransformerCache()
```

### Step 4 — Reproject Geometry While Preserving Topology

Apply the cached transformer with `shapely.ops.transform`, which walks every coordinate in every ring — so `MultiPolygon` and `GeometryCollection` features are reprojected in full, not just their bounding boxes. Reduce precision only after the transform completes.

```python
from shapely.geometry import mapping
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as shapely_transform
from shapely import set_precision


def reproject_to_canonical(geom: BaseGeometry, src_epsg: int) -> BaseGeometry:
    """Reproject any geometry to EPSG:4326, snapping precision afterwards."""
    if src_epsg == CANONICAL_EPSG:
        out = geom
    else:
        transformer = TRANSFORMERS.get(src_epsg, CANONICAL_EPSG)
        out = shapely_transform(transformer.transform, geom)

    # Grid-snap AFTER reprojection (~1.1 mm at the equator); never before.
    out = set_precision(out, grid_size=1e-8)
    if not out.is_valid:
        raise ValueError("Geometry became invalid after precision reduction")
    return out


def normalize_feature(payload: dict, headers: dict[str, str] | None = None) -> dict:
    """End-to-end: detect, validate, reproject, and return a canonical Feature."""
    src_epsg = detect_source_epsg(payload, headers)
    geom = validate_before_transform(shape(payload["geometry"]))
    geom = reproject_to_canonical(geom, src_epsg)
    return {
        "type": "Feature",
        "geometry": mapping(geom),
        "properties": {
            **payload.get("properties", {}),
            "crs": "EPSG:4326",
            "source_epsg": src_epsg,
            "bbox": list(geom.bounds),
        },
    }
```

### Step 5 — Serialize the Canonical Geometry for Downstream Routing

Validate the normalized output against an explicit schema with Pydantic v2 before it leaves the stage, then serialize it for the consumer. If a downstream service needs a compact wire format, the canonical `EPSG:4326` feature feeds directly into the [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/) path without further projection.

```python
from pydantic import BaseModel, Field, model_validator

_ALLOWED = {"Point", "LineString", "Polygon", "MultiPoint",
            "MultiLineString", "MultiPolygon", "GeometryCollection"}


class CanonicalFeature(BaseModel):
    type: str = Field(pattern="^Feature$")
    geometry: dict
    properties: dict

    @model_validator(mode="after")
    def check(self) -> "CanonicalFeature":
        if self.geometry.get("type") not in _ALLOWED:
            raise ValueError(f"Unsupported geometry type: {self.geometry.get('type')}")
        if self.properties.get("crs") != "EPSG:4326":
            raise ValueError("Feature is not normalized to EPSG:4326")
        return self


def serialize_for_routing(feature: dict) -> str:
    """Validate the canonical feature and emit RFC 7946 GeoJSON for the consumer."""
    import json
    validated = CanonicalFeature.model_validate(feature)
    return json.dumps(validated.model_dump())
```

When payloads carry temporal metadata, normalize timestamps to UTC alongside the spatial projection so that spatiotemporal joins downstream are never skewed by a mixed timezone and a mixed CRS at once.

---

## Spatial Validation and Error Handling

Reprojection can turn a valid source geometry into an invalid target one — narrow slivers collapse, near-coincident vertices merge, and ring orientation can flip relative to [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946), which requires exterior rings to be counter-clockwise. Re-check validity and orientation after the transform, not only before it:

```python
from shapely.geometry import Polygon, MultiPolygon
from shapely.geometry.polygon import orient
from shapely.validation import explain_validity


def enforce_post_transform_invariants(geom):
    """Re-validate and fix ring orientation after reprojection."""
    if not geom.is_valid:
        raise ValueError(f"Invalid after transform: {explain_validity(geom)}")

    # RFC 7946 §3.1.6: exterior rings CCW, interior rings CW (sign=1.0 in Shapely).
    if isinstance(geom, Polygon):
        return orient(geom, sign=1.0)
    if isinstance(geom, MultiPolygon):
        return MultiPolygon([orient(p, sign=1.0) for p in geom.geoms])
    return geom
```

On failure, route the payload — together with the detected `source_epsg`, the validity explanation, and the raw bytes — to a dead-letter queue rather than retrying a deterministic transform that will only fail again. A geometry that is invalid after transform is a data pathology, not a transient fault. Where retries *are* warranted (transient PROJ data or database errors), they must not reprocess features already persisted, which is why normalization pairs with the [at-least-once delivery pattern](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/).

---

## Retry, Backoff, and Delivery Guarantees

Distinguish transient failures (PROJ grid-shift download timeouts, missing transformation pipelines on cold start) from permanent ones (unresolvable CRS, post-transform invalidity). Retry only the transient class, with exponential backoff and jitter:

```python
import asyncio
import random


async def normalize_with_retry(
    payload: dict,
    headers: dict[str, str] | None = None,
    max_attempts: int = 4,
    base_delay: float = 0.5,
    max_delay: float = 15.0,
) -> dict | None:
    """Retry normalization for transient errors only; quarantine the rest."""
    for attempt in range(1, max_attempts + 1):
        try:
            return await asyncio.to_thread(normalize_feature, payload, headers)
        except (CRSUnresolved, ValueError):
            # Deterministic failure — no retry will change the outcome.
            await send_to_dlq(payload, reason="permanent")
            return None
        except OSError as exc:
            # e.g. PROJ network resource fetch failed — worth a retry.
            if attempt == max_attempts:
                await send_to_dlq(payload, reason=f"transient: {exc}")
                return None
            delay = min(base_delay * 2 ** (attempt - 1), max_delay)
            await asyncio.sleep(delay + random.uniform(0, delay * 0.2))
    return None
```

**At-least-once vs exactly-once:** Reprojection itself is deterministic, so re-delivering the same payload always yields the same canonical geometry. That makes at-least-once safe for the transform, but the *write* still needs deduplication. Derive an idempotency key from the normalized geometry so a re-delivery does not duplicate rows in your spatial store, following [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) and the cache check in [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/).

---

## Verification

Confirm the round trip end to end: a UTM-projected polygon must come out as a valid `EPSG:4326` feature whose coordinates are back inside geographic range. Run this with `pytest`:

```python
import pytest
from shapely.geometry import shape

# A square ~1 km on a side in UTM Zone 33N (EPSG:32633), near Rome.
UTM_FEATURE = {
    "type": "Feature",
    "crs": {"properties": {"name": "urn:ogc:def:crs:EPSG::32633"}},
    "geometry": {
        "type": "Polygon",
        "coordinates": [[
            [290000, 4640000],
            [291000, 4640000],
            [291000, 4641000],
            [290000, 4641000],
            [290000, 4640000],
        ]],
    },
    "properties": {"name": "utm-test"},
}


def test_utm_normalizes_to_wgs84():
    result = normalize_feature(UTM_FEATURE)

    assert result["properties"]["crs"] == "EPSG:4326"
    assert result["properties"]["source_epsg"] == 32633

    geom = shape(result["geometry"])
    assert geom.is_valid

    minx, miny, maxx, maxy = geom.bounds
    # Output must be inside geographic range and near Rome (~12.5E, 41.9N).
    assert 12 < minx < 13 and 41 < miny < 42
    assert -180 <= minx <= 180 and -90 <= miny <= 90


def test_unresolvable_crs_raises():
    bad = {"type": "Feature", "geometry": {
        "type": "Point", "coordinates": [500000, 4640000]}, "properties": {}}
    with pytest.raises(CRSUnresolved):
        normalize_feature(bad)  # projected coords, no CRS declared
```

A passing run confirms three things at once: detection read the embedded EPSG code, the transformer reprojected the full ring, and the output survived post-transform validation.

---

## Troubleshooting

<div style="overflow-x:auto">

| Symptom | Likely spatial cause | Fix |
|---|---|---|
| Features land in the wrong hemisphere | Axis order swapped — lat/lon emitted instead of lon/lat | Set `always_xy=True` on every `Transformer.from_crs` call |
| Coordinates look like `[500000, 4640000]` after normalization | Source was a projected CRS (meters) treated as `EPSG:4326` | Read the `crs` member or `X-Source-CRS` header; reject payloads with no resolvable CRS |
| Geometry valid before, invalid after transform | Sliver collapse or vertex merge from projection distortion | Re-run `make_valid`/`orient` after the transform; widen `grid_size` only as a last resort |
| First request per CRS pair is slow, rest are fast | PROJ database lookup on every transformer construction | Cache transformers keyed by `(src, dst)` EPSG pair; pre-warm common pairs at startup |
| Polygons render with holes filled in | Ring orientation flipped relative to RFC 7946 after reprojection | Apply `shapely.geometry.polygon.orient(geom, sign=1.0)` post-transform |
| Memory grows in long-running workers | Unbounded transformer cache accumulating rare CRS pairs | Bound the cache `maxsize` and evict the oldest entry on overflow |
| `CRSError: Invalid projection` on cold start | Missing PROJ grid-shift files in the container image | Bundle PROJ data or set `PROJ_NETWORK=ON`; retry transient fetch failures with backoff |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Why normalize to EPSG:4326 instead of EPSG:3857?</strong></summary>
<div class="faq__body">

`EPSG:4326` (WGS 84 lat/lon) is the canonical interchange CRS mandated by [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946) for GeoJSON and the safe storage projection for spatial indexes. `EPSG:3857` (Web Mercator) distorts area and distance increasingly away from the equator, so reserve it for the render step of a tile pipeline — never as the canonical storage CRS.

</div>
</details>

<details class="faq">
<summary><strong>How do I detect the CRS when the payload has no crs property?</strong></summary>
<div class="faq__body">

Apply a fallback resolution chain: check an explicit `crs` or `srid` property, then a vendor header such as `X-Source-CRS`, then a heuristic on the coordinate bounds — values outside the ±180 / ±90 range almost always indicate a projected system measured in meters. If nothing resolves, quarantine the payload to a dead-letter queue rather than guessing. The full chain is in [Handling mixed CRS payloads in Python event handlers](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/).

</div>
</details>

<details class="faq">
<summary><strong>Why must I set always_xy=True on a pyproj Transformer?</strong></summary>
<div class="faq__body">

PROJ 6+ honours each CRS's authority-defined axis order, which for `EPSG:4326` is latitude-first. GeoJSON coordinates are longitude-first. Passing `always_xy=True` forces lon/lat ordering on both ends, so coordinates do not silently swap and place features in the wrong location.

</div>
</details>

<details class="faq">
<summary><strong>Should I round coordinates before or after reprojection?</strong></summary>
<div class="faq__body">

Always round or grid-snap *after* reprojection. Rounding source coordinates introduces error that the transform amplifies and can collapse adjacent vertices into invalid self-touching rings. Apply precision reduction with `shapely.set_precision` as the final step before serialization, then re-check validity.

</div>
</details>

---

## Related

- [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/) — parent section covering the full ingestion, validation, and routing architecture
- [Handling Mixed CRS Payloads in Python Event Handlers](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/) — the detection fallback chain in depth, without blocking the consumer thread
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — topology and schema checks that bracket the reprojection step
- [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/) — compact binary serialization for the canonical EPSG:4326 feature
- [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) — running normalization off the event loop in a process pool under load
