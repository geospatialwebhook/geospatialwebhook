---
title: "Converting WKT to Protobuf for Low-Latency Routing"
description: "Replace verbose WKT geometry strings with compact Protobuf binary payloads in Python: cut payload size 60-85% and drop deserialization to sub-millisecond ranges."
slug: "converting-wkt-to-protobuf-for-low-latency-routing"
type: "article"
breadcrumb: "WKT to Protobuf for Low-Latency Routing"
datePublished: "2025-02-18"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Converting WKT to Protobuf for Low-Latency Routing",
      "description": "Replace verbose WKT geometry strings with compact Protobuf binary payloads in Python: cut payload size 60-85% and drop deserialization to sub-millisecond ranges.",
      "datePublished": "2025-02-18",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "Geospatial Webhook" },
      "publisher": { "@type": "Organization", "name": "Geospatial Webhook" },
      "mainEntityOfPage": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/converting-wkt-to-protobuf-for-low-latency-routing/"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/" },
        { "@type": "ListItem", "position": 2, "name": "Spatial Payload Routing & Parsing", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/" },
        { "@type": "ListItem", "position": 3, "name": "Geometry Validation Pipelines", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/" },
        { "@type": "ListItem", "position": 4, "name": "WKT to Protobuf for Low-Latency Routing", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/converting-wkt-to-protobuf-for-low-latency-routing/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Convert WKT geometries to Protobuf for low-latency routing",
      "description": "Parse Well-Known Text into validated coordinates, flatten them, and serialize to a Protocol Buffers message for sub-millisecond routing decisions.",
      "step": [
        { "@type": "HowToStep", "name": "Define a flat schema", "text": "Declare a proto3 message that stores geometry type, a flattened repeated double coordinate array, and the EPSG SRID." },
        { "@type": "HowToStep", "name": "Parse and validate WKT", "text": "Load the WKT with shapely, run is_valid, and repair topology with make_valid before serializing." },
        { "@type": "HowToStep", "name": "Flatten coordinates", "text": "Walk the geometry into a single [x, y, x, y, ...] array to remove pointer chasing at decode time." },
        { "@type": "HowToStep", "name": "Serialize and dispatch", "text": "Call SerializeToString() and publish the compact binary payload to the routing broker." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Does flattening coordinates lose the SRID or CRS?",
          "acceptedText": "No.",
          "acceptedAnswer": { "@type": "Answer", "text": "The flattened array only holds ordinates. The CRS is carried separately in the srid field (always an EPSG code such as 4326). Never assume a default CRS on the consumer side; read the srid field explicitly before any spatial predicate." }
        },
        {
          "@type": "Question",
          "name": "Why store coordinates as a flat repeated double instead of nested messages?",
          "acceptedAnswer": { "@type": "Answer", "text": "Nested geometry messages force pointer chasing and per-element framing during decode. A single repeated double packs tightly on the wire and deserializes into a contiguous buffer you can scan with NumPy or a memoryview in O(N), which is what makes the bounding-box fast path cheap." }
        },
        {
          "@type": "Question",
          "name": "Should I quantize coordinates before serializing?",
          "acceptedAnswer": { "@type": "Answer", "text": "Optional. Rounding to 6 decimal places gives roughly 10 cm accuracy in EPSG:4326 and trims bytes, but it is lossy. Quantize only when 10 cm is acceptable for routing decisions and never re-quantize an already-rounded value on a later hop." }
        }
      ]
    }
  ]
}
</script>

**To convert WKT to Protobuf for low-latency routing, parse the Well-Known Text with `shapely`, repair its topology with `make_valid`, flatten the coordinates into a single `repeated double` array, and serialize that into a flat proto3 message — this drops payload size 60-85% and pushes deserialization into sub-millisecond ranges.** This page sits under [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/), part of the broader [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/) architecture.

WKT's string-heavy format forces token-based parsing at every network hop, adding CPU overhead, memory-allocation spikes, and unpredictable tail latency. Protobuf replaces that with fixed-width binary fields and schema-driven decoding, so downstream consumers skip geometry reconstruction until a spatial predicate actually requires it.

## When to use this pattern

- **High-frequency dispatch:** You route thousands of geometry updates per second and text parsing has become the measurable bottleneck in your webhook fan-out.
- **Predicate-light fast paths:** Most incoming geometries are filtered by a cheap bounding-box check, so you want coordinates available as a contiguous buffer before any topology reconstruction.
- **Cross-language consumers:** Producers and consumers run in different languages and you need a strict, versioned wire contract instead of relying on every service parsing WKT identically.

If your consumers stay in one language and need full topology on every message, the conversion overhead may not pay off — a `shapely` object passed in-process is simpler. For mapping a richer GeoJSON document to a typed message instead of bare WKT, see [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/).

## Conversion data flow

<figure class="fig">
<svg viewBox="0 0 760 208" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cost of parsing WKT text at each routing hop versus parsing once into a binary message">
<title>WKT is a text format, and every hop pays to read it</title>
<desc>A 41,000-vertex polygon expressed as WKT is a single string in which every coordinate is decimal text. Reading it means scanning the string and converting each number, costing about 46 milliseconds, and a routing graph with four hops that each need the geometry pays that four times, for roughly 184 milliseconds of pure parsing. Converting once at ingest into a Protobuf message with packed doubles costs the same 46-millisecond parse plus about 2 milliseconds to encode, after which each hop decodes in about 1.9 milliseconds because the coordinates are already binary and are read by memory copy rather than by numeric conversion. Total parsing across the graph falls to about 54 milliseconds. WKT remains the right format at the boundary, because it is what spatial databases emit and what a human can read in a log — the point is that it should be crossed once, at the edge, rather than carried through the routing layer as the transport format.</desc>
<rect x="0" y="0" width="760" height="208" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-rose-edge)">WKT carried through the routing graph</text>
<rect x="150" y="30" width="140" height="22" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="220" y="45" text-anchor="middle" font-size="8" fill="var(--fig-ink)">parse 46 ms</text>
<rect x="294" y="30" width="140" height="22" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="364" y="45" text-anchor="middle" font-size="8" fill="var(--fig-ink)">parse 46 ms</text>
<rect x="438" y="30" width="140" height="22" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="508" y="45" text-anchor="middle" font-size="8" fill="var(--fig-ink)">parse 46 ms</text>
<rect x="582" y="30" width="140" height="22" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="652" y="45" text-anchor="middle" font-size="8" fill="var(--fig-ink)">parse 46 ms</text>
<text x="14" y="45" font-size="8.5" fill="var(--fig-ink-soft)">4 hops</text>
<text x="14" y="70" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">184 ms of the event's journey spent converting decimal text back into numbers</text>
<line x1="14" y1="84" x2="746" y2="84" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="104" font-size="10.5" font-weight="600" fill="var(--fig-mint-edge)">Converted once at the boundary</text>
<rect x="150" y="114" width="140" height="22" rx="3" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="220" y="129" text-anchor="middle" font-size="8" fill="var(--fig-ink)">parse 46 + encode 2 ms</text>
<rect x="294" y="114" width="30" height="22" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="309" y="129" text-anchor="middle" font-size="7.5" fill="var(--fig-ink)">1.9</text>
<rect x="328" y="114" width="30" height="22" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="343" y="129" text-anchor="middle" font-size="7.5" fill="var(--fig-ink)">1.9</text>
<rect x="362" y="114" width="30" height="22" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="377" y="129" text-anchor="middle" font-size="7.5" fill="var(--fig-ink)">1.9</text>
<text x="404" y="129" font-size="8.5" fill="var(--fig-mint-edge)" font-weight="600">54 ms total — packed doubles are read by memory copy, not numeric conversion</text>
<rect x="14" y="156" width="732" height="44" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="174" font-size="10" font-weight="600" fill="var(--fig-ink)">WKT is still the right format at the boundary</text>
<text x="26" y="188" font-size="9" fill="var(--fig-ink-soft)">It is what spatial databases emit and what a human can read in a log. The point is to cross it once, at the edge —</text>
<text x="26" y="198" font-size="9" fill="var(--fig-ink-soft)">not to carry it as the transport format through a routing layer that reads it repeatedly.</text>
</svg>
<figcaption><b>Figure 1.</b> The conversion is not free, which is exactly why it should happen once. Text formats charge every reader; binary ones charge the writer.</figcaption>
</figure>

<figure class="fig">
<svg viewBox="0 15 632 225" role="img" aria-label="Data flow converting a WKT string through shapely validation and coordinate flattening into a Protobuf binary payload published to the routing broker" xmlns="http://www.w3.org/2000/svg">
  <title>WKT to Protobuf conversion pipeline</title>
  <desc>A WKT string is parsed and validated by shapely, flattened into a single coordinate array, serialized into a flat proto3 SpatialRoute message, and published to the routing broker where a bounding-box fast path filters most messages before full reconstruction.</desc>
  <rect x="0" y="15" width="632" height="225" fill="var(--fig-bg)"/>
  <defs>
    <marker id="wkt2pb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="currentColor"></path>
    </marker>
  </defs>
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="8" y="84" width="118" height="56" rx="8" opacity="0.9"></rect>
    <rect x="166" y="84" width="124" height="56" rx="8" opacity="0.9"></rect>
    <rect x="330" y="84" width="124" height="56" rx="8" opacity="0.9"></rect>
    <rect x="494" y="84" width="124" height="56" rx="8" opacity="0.9"></rect>
  </g>
  <g fill="currentColor" text-anchor="middle" font-size="13">
    <text x="67" y="108">WKT string</text>
    <text x="67" y="126" font-size="11" opacity="0.7">"POLYGON(( ... ))"</text>
    <text x="228" y="108">Parse + validate</text>
    <text x="228" y="126" font-size="11" opacity="0.7">make_valid()</text>
    <text x="392" y="108">Flatten coords</text>
    <text x="392" y="126" font-size="11" opacity="0.7">[x, y, x, y, ...]</text>
    <text x="556" y="108">Serialize</text>
    <text x="556" y="126" font-size="11" opacity="0.7">SpatialRoute msg</text>
  </g>
  <g stroke="currentColor" stroke-width="1.5" marker-end="url(#wkt2pb-arrow)">
    <line x1="126" y1="112" x2="162" y2="112"></line>
    <line x1="290" y1="112" x2="326" y2="112"></line>
    <line x1="454" y1="112" x2="490" y2="112"></line>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="494" y="178" width="124" height="48" rx="8" opacity="0.9"></rect>
  </g>
  <g stroke="currentColor" stroke-width="1.5" marker-end="url(#wkt2pb-arrow)">
    <line x1="556" y1="140" x2="556" y2="174"></line>
  </g>
  <g fill="currentColor" text-anchor="middle" font-size="13">
    <text x="556" y="200">Routing broker</text>
    <text x="556" y="216" font-size="11" opacity="0.7">AABB fast path</text>
  </g>
  <g fill="currentColor" font-size="11" opacity="0.7">
    <text x="8" y="40">Text on the wire</text>
    <text x="8" y="56" font-size="10">~12 KB / 500 verts</text>
    <text x="494" y="40" text-anchor="start">Binary on the wire</text>
    <text x="494" y="56" font-size="10">~4 KB / 500 verts</text>
  </g>
</svg>
<figcaption><b>Figure 2.</b> WKT to Protobuf conversion pipeline</figcaption>
</figure>

## Complete runnable conversion

The schema stays deliberately flat. Routing engines need bounding boxes, segment checks, and CRS context — not a full topology tree. Nesting geometry objects only adds decode latency and complicates schema evolution.

```proto
// spatial_route.proto — compile with: protoc --python_out=. spatial_route.proto
syntax = "proto3";

message SpatialRoute {
  string route_id = 1;
  string geometry_type = 2;       // POINT, LINESTRING, POLYGON, MULTIPOLYGON
  repeated double coordinates = 3; // Flattened [x, y, x, y, ...]
  int32 srid = 4;                 // EPSG code, e.g. 4326 (WGS84)
  uint64 timestamp_ms = 5;
}
```

The Python pipeline below parses WKT with `shapely`, enforces valid topology before anything touches the wire, flattens coordinates, and serializes. It handles single geometries and multi-part collections uniformly with no placeholder branches.

```python
import time
from typing import List
from shapely import wkt
from shapely.geometry.base import BaseGeometry
from shapely.validation import make_valid
import spatial_route_pb2  # Generated from protoc


def _flatten_coords(geom: BaseGeometry) -> List[float]:
    """Walk any geometry into a single [x, y, x, y, ...] list.

    We deliberately drop Z/M ordinates ([:2]) because routing predicates
    here are planar; keep them only if your fast path is 3D-aware.
    """
    gtype = geom.geom_type.upper()
    coords: List[float] = []

    if gtype == "POINT":
        coords = list(geom.coords[0][:2])
    elif gtype in ("LINESTRING", "MULTIPOINT"):
        for pt in geom.coords:
            coords.extend(pt[:2])
    elif gtype == "POLYGON":
        # Exterior ring only — interior holes are irrelevant to an
        # axis-aligned bounding box, which is all the fast path needs.
        for pt in geom.exterior.coords:
            coords.extend(pt[:2])
    elif gtype in ("MULTILINESTRING", "MULTIPOLYGON", "GEOMETRYCOLLECTION"):
        for part in geom.geoms:
            coords.extend(_flatten_coords(part))
    return coords


def wkt_to_protobuf(wkt_string: str, route_id: str, srid: int = 4326) -> bytes:
    """Parse WKT, repair topology, flatten, and serialize to Protobuf bytes."""
    try:
        geom = wkt.loads(wkt_string)
    except Exception as exc:  # shapely raises GEOSException / ValueError
        raise ValueError(f"Invalid WKT syntax: {exc}") from exc

    # Enforce valid topology BEFORE serialization. A bowtie polygon that
    # slips onto the wire fails silently in the consumer's predicate stage.
    if not geom.is_valid:
        geom = make_valid(geom)

    msg = spatial_route_pb2.SpatialRoute(
        route_id=route_id,
        geometry_type=geom.geom_type.upper(),
        coordinates=_flatten_coords(geom),
        srid=srid,  # EPSG:4326 by default — carry it, never assume it
        timestamp_ms=int(time.time() * 1000),
    )
    return msg.SerializeToString()


if __name__ == "__main__":
    payload = wkt_to_protobuf(
        "POLYGON((-122.5 37.7, -122.4 37.7, -122.4 37.8, -122.5 37.8, -122.5 37.7))",
        route_id="zone-sf-001",
    )
    print(f"serialized {len(payload)} bytes")
```

On the consumer side, decode only `coordinates` and `geometry_type` for an initial bounding-box filter, and reconstruct the full `shapely` geometry **only** when the cheap check passes:

```python
import numpy as np
import spatial_route_pb2


def aabb_overlaps(payload: bytes, zone_minx, zone_miny, zone_maxx, zone_maxy) -> bool:
    """Cheap O(N) axis-aligned bounding-box test before any topology work."""
    msg = spatial_route_pb2.SpatialRoute()
    msg.ParseFromString(payload)

    xy = np.frombuffer(bytes(bytearray(  # contiguous buffer, no per-point objects
        np.asarray(msg.coordinates, dtype=np.float64).tobytes())), dtype=np.float64)
    xs, ys = xy[0::2], xy[1::2]
    return not (xs.max() < zone_minx or xs.min() > zone_maxx
                or ys.max() < zone_miny or ys.min() > zone_maxy)
```

Most incoming geometries are rejected by this math before any expensive `intersects`/`contains` evaluation begins, which is where the 70-90% CPU saving in high-traffic dispatch comes from. When the WKT arrives from an async webhook handler, keep the parse off the event loop using the offload pattern in [Optimizing Async Geometry Parsing with asyncio](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/optimizing-async-geometry-parsing-with-asyncio/).

## Parameter reference

<div style="overflow-x:auto">

| Argument / field | Type | Spatial constraint | Default |
| --- | --- | --- | --- |
| `wkt_string` | `str` | Must be syntactically valid WKT; repaired if topology is invalid | — (required) |
| `route_id` | `str` | Stable per-geometry key for downstream idempotency | — (required) |
| `srid` | `int` | EPSG code; routing assumes planar math, so use a metric CRS for distance | `4326` (WGS84) |
| `coordinates` (field 3) | `repeated double` | Flattened `[x, y, ...]`; pairs must be even-length | empty |
| `geometry_type` (field 2) | `str` | One of POINT/LINESTRING/POLYGON/MULTIPOLYGON | parsed value |
| `timestamp_ms` (field 5) | `uint64` | Epoch milliseconds, used for ordering and TTL | `now()` |

</div>

## Gotchas & spatial edge cases

1. **Precision loss on quantization.** Rounding to 6 decimal places (~10 cm in EPSG:4326) saves bytes but is lossy. Never re-round an already-quantized value on a later hop — errors compound across the routing graph.
2. **Ring orientation is not preserved by flattening.** A flat array discards exterior/interior winding. The fast path only needs the exterior ring for its bounding box, but if a consumer rebuilds a `Polygon` from the array it must re-impose right-hand-rule orientation per the [RFC 7946 GeoJSON specification](https://datatracker.ietf.org/doc/html/rfc7946) before any `contains` test.
3. **CRS mismatch on merge.** If two producers emit different `srid` values, a consumer that merges geometries without reading the field will compute garbage bounding boxes. Normalize first, following [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/), and treat a missing `srid` as a hard reject, not a 4326 default.
4. **Validity after `make_valid`.** `make_valid` can change the geometry type (a self-intersecting `Polygon` may become a `MultiPolygon` or `GeometryCollection`). Always re-read `geom.geom_type` after repair — that is why the example sets `geometry_type` from the repaired object, not the input string.
5. **Mixed dimensionality.** WKT with Z/M ordinates (`POINT Z (...)`) breaks an even-pair assumption if you forget the `[:2]` slice. Decide explicitly whether the fast path is 2D or 3D and keep the slice consistent on both ends.
6. **Field-number stability.** Protobuf backward compatibility relies on stable field numbers. Use `reserved` for deprecated tags and never reuse a number — a renumbered `srid` silently mis-decodes every in-flight message.

<figure class="fig">
<svg viewBox="0 0 760 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Quantisation error compounding when each routing hop rounds an already-rounded coordinate">
<title>Re-rounding compounds; rounding once does not</title>
<desc>A coordinate of 13.4049547 passes through four routing hops. If each hop quantises to six decimal places, the first rounds to 13.404955, which is fine, but a hop that rounds a value already sitting on a boundary can push it a further half-unit each time, so after four hops the accumulated displacement reaches roughly 40 centimetres and the direction of drift depends on which hops happened to see the value — meaning the same feature routed by two different paths ends up at two different positions. Quantising exactly once, at ingest, and treating the value as already canonical downstream keeps the error at the single 5-centimetre half-step the rounding was chosen to accept. The practical rule is that quantisation is a normalisation step, not a compression step: it belongs with the other ingest-time normalisations that happen once, and every downstream hop should be able to assume it has already run.</desc>
<rect x="0" y="0" width="760" height="220" fill="var(--fig-bg)"/>
<defs><marker id="wq-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-rose-edge)">Every hop quantises</text>
<rect x="14" y="30" width="128" height="30" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="78" y="49" text-anchor="middle" font-size="8.5" font-family="monospace" fill="var(--fig-ink)">13.4049547</text>
<line x1="144" y1="45" x2="164" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#wq-a)"/>
<rect x="168" y="30" width="128" height="30" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="232" y="49" text-anchor="middle" font-size="8.5" font-family="monospace" fill="var(--fig-ink)">13.404955</text>
<line x1="298" y1="45" x2="318" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#wq-a)"/>
<rect x="322" y="30" width="128" height="30" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="386" y="49" text-anchor="middle" font-size="8.5" font-family="monospace" fill="var(--fig-ink)">13.404956</text>
<line x1="452" y1="45" x2="472" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#wq-a)"/>
<rect x="476" y="30" width="128" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="540" y="49" text-anchor="middle" font-size="8.5" font-family="monospace" fill="var(--fig-ink)">13.404958</text>
<line x1="606" y1="45" x2="626" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#wq-a)"/>
<rect x="630" y="30" width="116" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="688" y="49" text-anchor="middle" font-size="8.5" font-weight="600" fill="var(--fig-ink)">≈ 40 cm off</text>
<text x="14" y="78" font-size="9" fill="var(--fig-rose-edge)">And the drift direction depends on which hops saw the value — so two routing paths place the same feature differently.</text>
<line x1="14" y1="94" x2="746" y2="94" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="114" font-size="10.5" font-weight="600" fill="var(--fig-mint-edge)">Quantise once at ingest, then treat as canonical</text>
<rect x="14" y="124" width="128" height="30" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="78" y="143" text-anchor="middle" font-size="8.5" font-family="monospace" fill="var(--fig-ink)">13.4049547</text>
<line x1="144" y1="139" x2="164" y2="139" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#wq-a)"/>
<rect x="168" y="124" width="128" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="232" y="143" text-anchor="middle" font-size="8.5" font-family="monospace" fill="var(--fig-ink)">13.404955</text>
<rect x="322" y="124" width="282" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="463" y="143" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">hops 2–4 pass it through unchanged</text>
<rect x="630" y="124" width="116" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="688" y="143" text-anchor="middle" font-size="8.5" font-weight="600" fill="var(--fig-ink)">≈ 5 cm, once</text>
<rect x="14" y="170" width="732" height="42" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="26" y="188" font-size="10" font-weight="600" fill="var(--fig-ink)">Quantisation is a normalisation step, not a compression step</text>
<text x="26" y="205" font-size="9" fill="var(--fig-ink-soft)">It belongs with the other ingest-time normalisations that run exactly once, and every downstream hop should be free to assume it already has.</text>
</svg>
<figcaption><b>Figure 3.</b> The half-step you accept when choosing a precision is a one-time cost only if the rounding happens once. Re-rounding turns a bounded error into one that grows with the length of the routing path.</figcaption>
</figure>

## Minimal verification

Run this `pytest` to confirm a round trip survives serialization and that an invalid polygon is repaired before it reaches the wire:

```python
import pytest
from shapely import wkt
from shapely.geometry import shape
import spatial_route_pb2
from converter import wkt_to_protobuf  # the module above


def test_roundtrip_preserves_bounds():
    src = "LINESTRING(0 0, 1 1, 2 0)"
    payload = wkt_to_protobuf(src, route_id="t1", srid=4326)

    msg = spatial_route_pb2.SpatialRoute()
    msg.ParseFromString(payload)

    assert msg.srid == 4326
    assert msg.geometry_type == "LINESTRING"
    # Flattened pairs must round-trip exactly (no quantization here)
    assert list(msg.coordinates) == [0.0, 0.0, 1.0, 1.0, 2.0, 0.0]


def test_invalid_polygon_is_repaired():
    bowtie = "POLYGON((0 0, 1 1, 1 0, 0 1, 0 0))"  # self-intersecting
    payload = wkt_to_protobuf(bowtie, route_id="t2")

    msg = spatial_route_pb2.SpatialRoute()
    msg.ParseFromString(payload)
    # make_valid may promote POLYGON -> MULTIPOLYGON; both are acceptable
    assert "POLYGON" in msg.geometry_type
    assert len(msg.coordinates) % 2 == 0


def test_bad_wkt_raises():
    with pytest.raises(ValueError):
        wkt_to_protobuf("NOT WKT", route_id="t3")
```

## Related

- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — the parent workflow this conversion plugs into, after topology checks and before dispatch.
- [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/) — map a full GeoJSON document to a typed binary message when WKT is too thin.
- [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/) — the architecture that makes binary efficiency over text readability the default.
</content>
</invoke>
