---
title: "Handling Mixed CRS Payloads in Python Webhooks"
description: "Normalize webhook geometries that arrive in inconsistent coordinate reference systems: detect or infer the source CRS, transform to EPSG:4326 with pyproj, and quarantine what cannot be resolved."
slug: handling-mixed-crs-payloads-in-python-event-handlers
type: article
breadcrumb: "Mixed CRS Payloads"
datePublished: 2025-11-18
dateModified: 2026-06-25
---

**To handle mixed CRS payloads in a Python event handler, resolve a source CRS for every incoming geometry — from an explicit field, a GeoJSON `crs` member, or coordinate-magnitude inference — then transform it to a single canonical CRS (`EPSG:4326`) with a cached `pyproj.Transformer` before the payload reaches any consumer; route anything you cannot resolve to a quarantine queue instead of guessing.**

This page is a focused how-to within [CRS Normalization Strategies for Geospatial Events](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/), which sits under the broader domain of [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/). Read those for the surrounding architecture; this page resolves the single problem of reconciling many input coordinate systems inside one handler.

## When to use this pattern

Reach for an inline normalization step at the edge of your handler — rather than fixing coordinates downstream — when:

- **Your sources disagree on CRS.** IoT trackers emit `EPSG:4326`, CAD and survey exports use local projected grids (state plane, UTM zones, national grids), and SaaS integrations frequently default to web-mercator `EPSG:3857` or omit the CRS entirely.
- **Downstream consumers assume one CRS.** Spatial indexes, `PostGIS` columns with a fixed SRID, tile builders, and routing engines silently corrupt results when fed coordinates in the wrong system. Normalizing once at ingestion is cheaper than auditing every consumer.
- **You must keep an audit trail.** Quarantine-and-log beats best-effort guessing when a wrong transform would write bad geometry into a system of record that is expensive to repair.

If every source already agrees on `EPSG:4326`, skip this and validate topology only, as covered in the [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/).

## How normalization flows through the handler

The handler runs as a deterministic pipeline: resolve the source CRS, build (or reuse) a transformer keyed by the source/target EPSG pair, transform the geometry, re-validate topology after the transform, then route the clean payload onward or quarantine the failure.

<figure class="fig">
<svg viewBox="0 26 720 254" role="img" aria-label="Mixed-CRS normalization flow: resolve the source CRS, look up a cached transformer, transform to EPSG:4326, re-validate topology, then route the clean payload or quarantine unresolvable input" xmlns="http://www.w3.org/2000/svg">
  <title>Mixed-CRS normalization flow</title>
  <desc>A spatial webhook payload enters a resolver that determines its source CRS from an explicit field, a GeoJSON crs member, or coordinate-magnitude inference. A cached transformer keyed by source and target EPSG codes converts the geometry to EPSG:4326. Topology is re-validated after the transform; clean payloads are routed downstream and unresolvable CRS or invalid geometry is sent to a quarantine queue.</desc>
  <rect x="0" y="26" width="720" height="254" fill="var(--fig-bg)"/>
  <defs>
    <marker id="crsarr" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Stage boxes -->
  <rect x="14"  y="40" width="150" height="86" rx="10" fill="currentColor" opacity="0.05"/>
  <rect x="14"  y="40" width="150" height="86" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <text x="89" y="66" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.85">Resolve CRS</text>
  <text x="26" y="88"  font-size="9.5" fill="currentColor" opacity="0.7">explicit field</text>
  <text x="26" y="103" font-size="9.5" fill="currentColor" opacity="0.7">GeoJSON crs member</text>
  <text x="26" y="118" font-size="9.5" fill="currentColor" opacity="0.7">magnitude inference</text>
  <rect x="200" y="40" width="150" height="86" rx="10" fill="currentColor" opacity="0.05"/>
  <rect x="200" y="40" width="150" height="86" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <text x="275" y="66" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.85">Cached transformer</text>
  <text x="212" y="88"  font-size="9.5" fill="currentColor" opacity="0.7">key: (src, EPSG:4326)</text>
  <text x="212" y="103" font-size="9.5" fill="currentColor" opacity="0.7">always_xy=True</text>
  <text x="212" y="118" font-size="9.5" fill="currentColor" opacity="0.7">lru_cache reuse</text>
  <rect x="386" y="40" width="150" height="86" rx="10" fill="currentColor" opacity="0.05"/>
  <rect x="386" y="40" width="150" height="86" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <text x="461" y="66" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.85">Transform</text>
  <text x="398" y="88"  font-size="9.5" fill="currentColor" opacity="0.7">to EPSG:4326</text>
  <text x="398" y="103" font-size="9.5" fill="currentColor" opacity="0.7">all geometry types</text>
  <text x="398" y="118" font-size="9.5" fill="currentColor" opacity="0.7">shapely.ops.transform</text>
  <rect x="556" y="40" width="150" height="86" rx="10" fill="currentColor" opacity="0.05"/>
  <rect x="556" y="40" width="150" height="86" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <text x="631" y="66" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.85">Re-validate</text>
  <text x="568" y="88"  font-size="9.5" fill="currentColor" opacity="0.7">topology after</text>
  <text x="568" y="103" font-size="9.5" fill="currentColor" opacity="0.7">datum shift</text>
  <text x="568" y="118" font-size="9.5" fill="currentColor" opacity="0.7">make_valid if needed</text>
  <!-- top-row arrows -->
  <line x1="166" y1="83" x2="198" y2="83" stroke="currentColor" stroke-width="1.5" opacity="0.45" marker-end="url(#crsarr)"/>
  <line x1="352" y1="83" x2="384" y2="83" stroke="currentColor" stroke-width="1.5" opacity="0.45" marker-end="url(#crsarr)"/>
  <line x1="538" y1="83" x2="554" y2="83" stroke="currentColor" stroke-width="1.5" opacity="0.45" marker-end="url(#crsarr)"/>
  <!-- routing outcomes -->
  <rect x="386" y="210" width="150" height="56" rx="10" fill="currentColor" opacity="0.05"/>
  <rect x="386" y="210" width="150" height="56" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <text x="461" y="234" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor" opacity="0.85">Route downstream</text>
  <text x="461" y="252" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">broker / spatial DB</text>
  <rect x="556" y="210" width="150" height="56" rx="10" fill="currentColor" opacity="0.05"/>
  <rect x="556" y="210" width="150" height="56" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <text x="631" y="234" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor" opacity="0.85">Quarantine</text>
  <text x="631" y="252" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">DLQ + original CRS</text>
  <!-- success path -->
  <path d="M631,126 L631,168 L461,168 L461,208" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.45" marker-end="url(#crsarr)"/>
  <text x="470" y="162" font-size="9.5" fill="currentColor" opacity="0.6">valid</text>
  <!-- failure path: any stage can fall through to quarantine -->
  <path d="M631,126 L631,208" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4" stroke-dasharray="4,3" marker-end="url(#crsarr)"/>
  <text x="639" y="160" font-size="9.5" fill="currentColor" opacity="0.6">unresolved</text>
  <!-- source label -->
  <text x="89" y="156" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.55">payload in (mixed CRS)</text>
  <line x1="89" y1="128" x2="89" y2="146" stroke="currentColor" stroke-width="1" opacity="0.35" stroke-dasharray="3,2"/>
</svg>
<figcaption><b>Figure 1.</b> Mixed-CRS normalization flow</figcaption>
</figure>

## Complete runnable handler

The example below is self-contained: a `FastAPI` endpoint with `Pydantic` validation, CRS resolution with magnitude-based inference, a cached `pyproj.Transformer`, post-transform re-validation, and explicit quarantine routing. It targets `EPSG:4326` because RFC 7946 mandates WGS84 for GeoJSON output, so a canonical `EPSG:4326` payload interoperates with every standards-compliant consumer.

```python
import logging
from functools import lru_cache
from typing import Optional, Dict, Any

from fastapi import FastAPI
from pydantic import BaseModel, Field
from pyproj import Transformer, CRS
from pyproj.exceptions import CRSError
from shapely.geometry import shape, mapping
from shapely.validation import make_valid
from shapely.ops import transform as shp_transform

app = FastAPI()
logger = logging.getLogger("crs_normalizer")

TARGET_CRS = "EPSG:4326"  # RFC 7946 canonical output for GeoJSON


class SpatialPayload(BaseModel):
    geometry: Dict[str, Any]              # GeoJSON-like geometry object
    crs: Optional[str] = None            # explicit CRS, e.g. "EPSG:3857"
    metadata: Dict[str, Any] = Field(default_factory=dict)


@lru_cache(maxsize=256)
def get_transformer(source_crs: str, target_crs: str) -> Transformer:
    # Compiling a PROJ pipeline is expensive; cache by the (source, target)
    # EPSG pair so repeated payloads from the same CRS reuse one object.
    # always_xy=True forces (x=longitude, y=latitude) order — PROJ 6+ otherwise
    # honours the authority axis order and silently swaps lon/lat for EPSG:4326.
    return Transformer.from_crs(
        CRS.from_user_input(source_crs),
        CRS.from_user_input(target_crs),
        always_xy=True,
    )


def resolve_source_crs(payload: SpatialPayload) -> str:
    # 1. Explicit field wins.
    if payload.crs:
        return payload.crs
    # 2. GeoJSON 2008-style crs member (deprecated by RFC 7946 but still emitted).
    member = payload.geometry.get("crs")
    if isinstance(member, dict):
        name = member.get("properties", {}).get("name")
        if name:
            return name
    # 3. Inference: geographic longitude/latitude never exceed |180|/|90|.
    #    A coordinate magnitude in the thousands means a projected grid, so a
    #    missing CRS that looks projected must NOT be assumed to be WGS84.
    x, y = _first_coordinate(payload.geometry)
    if abs(x) > 180 or abs(y) > 90:
        raise ValueError(
            f"coordinates ({x}, {y}) look projected but no CRS was supplied"
        )
    # 4. Per RFC 7946, GeoJSON with no CRS is WGS84.
    return TARGET_CRS


def _first_coordinate(geometry: Dict[str, Any]) -> tuple[float, float]:
    coords = geometry.get("coordinates")
    while isinstance(coords, list) and coords and isinstance(coords[0], list):
        coords = coords[0]
    if not isinstance(coords, list) or len(coords) < 2:
        raise ValueError("geometry has no usable coordinates")
    return float(coords[0]), float(coords[1])


def normalize(payload: SpatialPayload) -> Dict[str, Any]:
    source_crs = resolve_source_crs(payload)
    try:
        transformer = get_transformer(source_crs, TARGET_CRS)
    except CRSError as exc:
        raise ValueError(f"unresolvable CRS '{source_crs}': {exc}") from exc

    geom = shape(payload.geometry)
    geom = shp_transform(transformer.transform, geom)

    # A datum shift can introduce or expose self-intersections; re-check here,
    # not before the transform, so validity reflects the OUTPUT geometry.
    if not geom.is_valid:
        geom = make_valid(geom)
        if not geom.is_valid:
            raise ValueError("geometry still invalid after make_valid")

    return {
        "geometry": mapping(geom),
        "crs": TARGET_CRS,
        "source_crs": source_crs,        # keep provenance for auditing
        "metadata": payload.metadata,
    }


@app.post("/ingest")
async def ingest(payload: SpatialPayload):
    try:
        normalized = normalize(payload)
    except ValueError as exc:
        logger.warning("quarantining payload: %s", exc)
        # Push to a dead-letter / quarantine topic with the original input.
        return {"status": "quarantined", "reason": str(exc),
                "original": payload.model_dump()}
    # Publish `normalized` to your broker (Kafka, SQS, Redis Streams, ...).
    return {"status": "normalized", "payload": normalized}
```

## Parameter reference

| Argument / field | Type | Spatial constraint | Default |
| --- | --- | --- | --- |
| `payload.crs` | `str` or `None` | Any `pyproj`-parseable CRS (e.g. `EPSG:3857`, `+proj=utm +zone=31`, WKT2) | `None` (then inferred) |
| `payload.geometry` | `dict` | RFC 7946 geometry object; coordinates as `[x, y]` in the source CRS | required |
| `TARGET_CRS` | `str` | Must be `EPSG:4326` for RFC 7946 GeoJSON output; change only for internal sinks | `"EPSG:4326"` |
| `always_xy` | `bool` | `True` forces `(lon, lat)` order; never omit for `EPSG:4326` round-trips | `True` |
| `get_transformer` cache | `lru_cache(maxsize=256)` | Sized to the count of distinct source EPSG codes you expect | `256` |
| `Transformer.transform` | callable | Operates on scalar/array coords; passed to `shapely.ops.transform` | — |

## Gotchas and spatial edge cases

1. **Axis-order swap on `EPSG:4326`.** PROJ 6+ honours each authority's declared axis order, which for `EPSG:4326` is latitude-then-longitude. Omitting `always_xy=True` flips your coordinates and the error is silent — points land in the wrong hemisphere. Always pass `always_xy=True` when your data is `(lon, lat)`.
2. **Inference must fail loud, not guess.** A coordinate like `(512345.0, 4781002.0)` is clearly projected, not WGS84. Defaulting a missing CRS to `EPSG:4326` would emit garbage; raise and quarantine instead.
3. **Validate topology *after* the transform.** A datum shift moves vertices by metres-to-degrees, which can introduce self-intersections that did not exist in the source CRS. Running `make_valid()` before the transform validates the wrong geometry — check the output.
4. **Precision loss on round-trips.** Reprojecting `EPSG:3857` → `EPSG:4326` → `EPSG:3857` accumulates floating-point drift. Treat the normalized `EPSG:4326` geometry as canonical and never reproject back for storage.
5. **Ring orientation is not enforced by transformation.** `pyproj` moves coordinates but does not rewind polygon rings. RFC 7946 wants exterior rings counter-clockwise; if a downstream consumer is orientation-sensitive, run `shapely.geometry.polygon.orient` after normalizing. This matters when you later derive an idempotency key, as covered in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — orientation changes the hash.
6. **CRS mismatch on merge.** When combining features from multiple sources into one collection, normalize each to `EPSG:4326` *before* the union. Merging raw geometries from different CRSes produces topologically meaningless results that no validation step can recover.

## Minimal verification snippet

Run this with `pytest` to confirm a web-mercator point lands at the correct WGS84 longitude/latitude and that an unlabelled projected coordinate is rejected rather than mangled.

```python
import math
from your_handler import normalize, SpatialPayload  # adjust import path


def test_web_mercator_point_normalizes_to_wgs84():
    # EPSG:3857 metres for roughly (lon=0, lat=0) — the origin.
    payload = SpatialPayload(
        geometry={"type": "Point", "coordinates": [0.0, 0.0]},
        crs="EPSG:3857",
    )
    out = normalize(payload)
    lon, lat = out["geometry"]["coordinates"]
    assert out["crs"] == "EPSG:4326"
    assert math.isclose(lon, 0.0, abs_tol=1e-6)
    assert math.isclose(lat, 0.0, abs_tol=1e-6)
    assert out["source_crs"] == "EPSG:3857"


def test_unlabelled_projected_coords_are_quarantined():
    payload = SpatialPayload(
        geometry={"type": "Point", "coordinates": [512345.0, 4781002.0]},
        crs=None,  # no CRS, magnitudes far exceed |180|/|90|
    )
    try:
        normalize(payload)
    except ValueError as exc:
        assert "projected" in str(exc)
    else:
        raise AssertionError("expected ValueError for unlabelled projected input")
```

## FAQ

<details class="faq">
<summary><strong>How do I infer a CRS when the payload omits one entirely?</strong></summary>
<div class="faq__body">

Use coordinate magnitude as the first signal: geographic longitude never exceeds ±180 and latitude never exceeds ±90, so any value in the hundreds or thousands indicates a projected grid such as `EPSG:3857` or a UTM zone. If the magnitude looks geographic, RFC 7946 lets you treat a missing CRS as `EPSG:4326`. If it looks projected, do not guess the specific zone — raise and quarantine, because picking the wrong UTM zone silently shifts every point by hundreds of kilometres.

</div>
</details>

<details class="faq">
<summary><strong>Why cache the Transformer instead of building one per request?</strong></summary>
<div class="faq__body">

Constructing a `pyproj.Transformer` compiles a PROJ pipeline and hits the PROJ database, which costs milliseconds per call — significant at webhook throughput. Caching by the `(source_crs, target_crs)` pair with `lru_cache` means each distinct source CRS pays that cost once. Modern `pyproj` transformers are thread-safe to call, so a cached object is safe to share across concurrent requests.

</div>
</details>

<details class="faq">
<summary><strong>Should I transform to EPSG:4326 or keep the source CRS for storage?</strong></summary>
<div class="faq__body">

Normalize to `EPSG:4326` at ingestion so every downstream consumer — broker, spatial index, tile builder — receives one predictable system, and retain the original CRS string as provenance (the `source_crs` field above). Repeatedly reprojecting back and forth accumulates floating-point drift, so treat the `EPSG:4326` output as canonical. If a sink genuinely needs the source projection, reproject from the canonical copy on demand rather than storing two divergent geometries.

</div>
</details>

<details class="faq">
<summary><strong>Why re-validate geometry after the transform rather than before?</strong></summary>
<div class="faq__body">

Reprojection moves every vertex, and a datum shift can introduce self-intersections or sliver artefacts that were not present in the source geometry. Validating before the transform certifies the wrong shape. Run `is_valid` and, if needed, `make_valid()` on the transformed output so the validity guarantee applies to exactly what you publish.

</div>
</details>

## Related

- Parent topic: [CRS Normalization Strategies for Geospatial Events](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/)
- Sibling how-to: [Parsing GeoJSON Webhooks with FastAPI and Pydantic](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/parsing-geojson-webhooks-with-fastapi-and-pydantic/)
- Domain overview: [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/)

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Handle mixed CRS payloads in a Python webhook handler",
  "description": "Resolve the source coordinate reference system for each incoming geometry, transform it to EPSG:4326 with a cached pyproj Transformer, re-validate topology, and quarantine unresolvable input.",
  "step": [
    {
      "@type": "HowToStep",
      "name": "Resolve the source CRS",
      "text": "Take an explicit crs field if present, fall back to a GeoJSON crs member, then infer from coordinate magnitude; raise if coordinates look projected but no CRS is supplied."
    },
    {
      "@type": "HowToStep",
      "name": "Build or reuse a cached transformer",
      "text": "Create a pyproj Transformer keyed by the (source, EPSG:4326) pair with always_xy=True and cache it with lru_cache so repeated source CRSes reuse one pipeline."
    },
    {
      "@type": "HowToStep",
      "name": "Transform the geometry to EPSG:4326",
      "text": "Apply the transformer through shapely.ops.transform so every geometry type is reprojected to the canonical WGS84 output mandated by RFC 7946."
    },
    {
      "@type": "HowToStep",
      "name": "Re-validate topology after the transform",
      "text": "Check is_valid on the transformed geometry and run make_valid if needed, because a datum shift can introduce self-intersections."
    },
    {
      "@type": "HowToStep",
      "name": "Route or quarantine",
      "text": "Publish the normalized payload to the broker, or send unresolvable CRS and invalid geometry to a quarantine queue with the original input attached."
    }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "How do I infer a CRS when the payload omits one entirely?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Use coordinate magnitude: geographic longitude never exceeds 180 and latitude never exceeds 90, so larger values indicate a projected grid such as EPSG:3857 or a UTM zone. If magnitudes look geographic, RFC 7946 lets you treat a missing CRS as EPSG:4326; if they look projected, raise and quarantine rather than guessing a zone."
      }
    },
    {
      "@type": "Question",
      "name": "Why cache the Transformer instead of building one per request?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Constructing a pyproj Transformer compiles a PROJ pipeline and hits the PROJ database, costing milliseconds per call. Caching by the (source_crs, target_crs) pair with lru_cache pays that cost once per distinct source CRS, and cached transformers are thread-safe to call across concurrent requests."
      }
    },
    {
      "@type": "Question",
      "name": "Should I transform to EPSG:4326 or keep the source CRS for storage?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Normalize to EPSG:4326 at ingestion so every consumer sees one system, and keep the original CRS string as provenance. Repeated reprojection accumulates floating-point drift, so treat the EPSG:4326 output as canonical and reproject from it on demand if a sink needs the source projection."
      }
    },
    {
      "@type": "Question",
      "name": "Why re-validate geometry after the transform rather than before?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Reprojection moves every vertex and a datum shift can introduce self-intersections absent from the source. Validating before the transform certifies the wrong shape, so run is_valid and make_valid on the transformed output."
      }
    }
  ]
}
</script>
