---
title: "H3 vs S2 vs Quadkey for Spatial Partitioning"
description: "A definitive comparison of Uber H3, Google S2, and Bing Quadkey as partition and shard keys for geospatial event streams, with runnable Python for all three."
slug: "h3-vs-s2-vs-quadkey-for-spatial-partitioning"
type: "long_tail"
breadcrumb:
  - label: "Core Event Fundamentals & Architecture"
    url: "/core-event-fundamentals-architecture/"
  - label: "Spatial Partitioning Strategies for Event Streams"
    url: "/core-event-fundamentals-architecture/spatial-partitioning-strategies/"
  - label: "H3 vs S2 vs Quadkey for Spatial Partitioning"
    url: "/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/"
datePublished: "2025-05-01"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "H3 vs S2 vs Quadkey for Spatial Partitioning",
      "description": "A definitive comparison of Uber H3, Google S2, and Bing Quadkey as partition and shard keys for geospatial event streams, with runnable Python for all three.",
      "url": "https://geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/",
      "datePublished": "2025-05-01",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Core Event Fundamentals & Architecture", "item": "https://geospatialwebhook.com/core-event-fundamentals-architecture/" },
        { "@type": "ListItem", "position": 2, "name": "Spatial Partitioning Strategies for Event Streams", "item": "https://geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/" },
        { "@type": "ListItem", "position": 3, "name": "H3 vs S2 vs Quadkey for Spatial Partitioning", "item": "https://geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Compute a partition key with H3, S2, and Quadkey",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Normalize input to EPSG:4326", "text": "Ensure the incoming coordinate is decimal-degrees longitude/latitude in EPSG:4326 (WGS84). All three libraries assume geographic degrees, not projected metres." },
        { "@type": "HowToStep", "position": 2, "name": "Choose a resolution per system", "text": "Pick an H3 resolution, an S2 level, and a Quadkey zoom that yield a comparable cell size for your workload. The numeric values are not equivalent across systems." },
        { "@type": "HowToStep", "position": 3, "name": "Encode the point to a cell id", "text": "Call latlng_to_cell for H3, CellId.from_lat_lng(...).parent(level) for S2, and mercantile.tile(...) plus quadkey() for Quadkey." },
        { "@type": "HowToStep", "position": 4, "name": "Use the id as a partition key", "text": "Feed the string id to your broker as the message key so events in the same cell land on the same partition and preserve per-cell ordering." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Are H3 resolution, S2 level, and Quadkey zoom interchangeable numbers?",
          "acceptedAnswer": { "@type": "Answer", "text": "No. Each system defines its own hierarchy with a different base cell count and subdivision factor, so H3 resolution 9, S2 level 13, and Quadkey zoom 16 describe different cell sizes. Compare them by measured cell area or edge length, never by the integer index." }
        },
        {
          "@type": "Question",
          "name": "Which grid makes the best Kafka partition key?",
          "acceptedAnswer": { "@type": "Answer", "text": "H3 is the most common choice because its fixed-length hex string, near-uniform hexagon area, and simple neighbour traversal make load balancing and adjacency queries straightforward. S2 wins when you need range scans along a Hilbert curve; Quadkey wins when your events are already tied to slippy-map tiles." }
        },
        {
          "@type": "Question",
          "name": "Why do H3 hexagons not nest perfectly inside their parents?",
          "acceptedAnswer": { "@type": "Answer", "text": "A hexagon cannot be tiled by smaller hexagons without gaps, so H3 children only approximately cover their parent and a child can belong partly to a neighbouring parent. S2 and Quadkey use quadtrees, so their four children exactly nest inside each parent." }
        },
        {
          "@type": "Question",
          "name": "Do all three systems expect EPSG:4326 input?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes. h3, s2sphere, and mercantile all take longitude/latitude in decimal degrees on the WGS84 datum. If your payload carries EPSG:3857 (Web Mercator) or another projected CRS, reproject to EPSG:4326 before encoding or the cell id will be wrong." }
        }
      ]
    }
  ]
}
</script>

**Use H3 when you want near-uniform hexagonal cells and simple neighbour math, S2 when you need Hilbert-curve range scans and exact quadtree nesting, and Quadkey when your events are already anchored to Bing/slippy-map tiles — and never treat their resolution numbers as equivalent.** All three turn a longitude/latitude point into a short, deterministic string you can hand to a broker as a partition key, but they differ in cell shape, distortion, hierarchy, and library maturity in ways that decide which one fits your stream.

This page sits within [Spatial Partitioning Strategies for Event Streams](/core-event-fundamentals-architecture/spatial-partitioning-strategies/), part of the broader [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/) reference — it is the canonical comparison the other partitioning pages link back to.

---

## When to use this pattern

Reach for a discrete global grid as your partition key when:

- You need **locality-preserving sharding** — events physically near each other should usually land on the same partition so a consumer can maintain per-region state (geofences, running aggregates, dedup windows) without cross-partition coordination.
- You want a **stable, low-cardinality key** derived purely from geometry, so the same location always routes to the same place regardless of which producer emitted the event.
- You are choosing a broker layout and want the key format documented in [Broker Selection & Partitioning for Spatial Streams](/queue-management-retry-delivery/broker-selection-partitioning/) to be deterministic and language-agnostic.

It is **not** the right tool when your events have no meaningful location, when a single cell would concentrate the vast majority of traffic (a global grid will not fix inherent hot spots — you need a composite key), or when you require exact geometric containment rather than an approximate grid bucket.

---

## Three grids, three geometries

The core difference is the shape of the cell and the curve that orders cells. **H3** (Uber) tiles the globe with hexagons on an icosahedral projection; hexagons have uniform adjacency — every neighbour shares an edge and sits at roughly the same distance. **S2** (Google) projects the sphere onto the six faces of a cube and recursively subdivides each face into a quadtree, numbering cells along a Hilbert space-filling curve so that nearby cells have nearby 64-bit ids. **Quadkey** (Bing Maps / the slippy-map convention) subdivides the EPSG:3857 (Web Mercator) plane into a quadtree of square tiles, encoding the path from the root as a base-4 string.

<svg viewBox="0 0 760 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cell shape and hierarchy of H3, S2, and Quadkey grid systems" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>Cell shape and hierarchy of H3, S2, and Quadkey</title>
  <desc>Three side-by-side panels. The first shows H3 hexagons with a highlighted centre cell and six edge neighbours, labelled hexagonal and approximate nesting. The second shows an S2 square subdivided into four nested children traversed by a Hilbert curve. The third shows a Quadkey square subdivided into four quadrants numbered 0 to 3, labelled Web Mercator quadtree.</desc>
  <!-- H3 panel -->
  <text x="120" y="28" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">H3 — hexagonal</text>
  <polygon points="120,60 145,74 145,102 120,116 95,102 95,74" fill="none" stroke="currentColor" stroke-opacity="0.7" stroke-width="1.5"/>
  <polygon points="120,32 145,46 145,60 120,60 95,60 95,46" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.2"/>
  <polygon points="145,74 170,88 170,116 145,130 145,102" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.2"/>
  <polygon points="95,74 95,102 70,116 45,102 45,74 70,60" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.2"/>
  <text x="120" y="92" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif">cell</text>
  <text x="120" y="150" text-anchor="middle" font-size="9.5" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">6 edge neighbours</text>
  <text x="120" y="166" text-anchor="middle" font-size="9.5" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">children only approx-nest</text>
  <!-- S2 panel -->
  <text x="380" y="28" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">S2 — cube quadtree</text>
  <rect x="320" y="40" width="120" height="100" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5"/>
  <line x1="380" y1="40" x2="380" y2="140" stroke="currentColor" stroke-opacity="0.3" stroke-width="1"/>
  <line x1="320" y1="90" x2="440" y2="90" stroke="currentColor" stroke-opacity="0.3" stroke-width="1"/>
  <path d="M350,65 L410,65 L410,115 L350,115" fill="none" stroke="currentColor" stroke-opacity="0.7" stroke-width="1.5" marker-end="url(#arrs)"/>
  <text x="380" y="158" text-anchor="middle" font-size="9.5" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">4 children exact-nest</text>
  <text x="380" y="174" text-anchor="middle" font-size="9.5" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">Hilbert-curve order</text>
  <!-- Quadkey panel -->
  <text x="640" y="28" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Quadkey — tile quadtree</text>
  <rect x="580" y="40" width="120" height="100" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5"/>
  <line x1="640" y1="40" x2="640" y2="140" stroke="currentColor" stroke-opacity="0.3" stroke-width="1"/>
  <line x1="580" y1="90" x2="700" y2="90" stroke="currentColor" stroke-opacity="0.3" stroke-width="1"/>
  <text x="610" y="70" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">0</text>
  <text x="670" y="70" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">1</text>
  <text x="610" y="118" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">2</text>
  <text x="670" y="118" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">3</text>
  <text x="640" y="158" text-anchor="middle" font-size="9.5" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">base-4 path string</text>
  <text x="640" y="174" text-anchor="middle" font-size="9.5" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">EPSG:3857 plane</text>
  <defs>
    <marker id="arrs" markerWidth="8" markerHeight="8" refX="6" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L8,3.5 Z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
</svg>

Those shape choices ripple into every property that matters for partitioning. Hexagons give H3 uniform neighbour distance but forbid perfect nesting; quadtrees give S2 and Quadkey clean parent-child math but square cells whose neighbours come in two flavours (edge and corner). The Hilbert curve gives S2 excellent id locality; Quadkey's Web Mercator base gives it map-tile compatibility at the cost of severe area distortion toward the poles.

Library maturity also differs sharply and should weigh on the decision. The `h3` package is a maintained binding over Uber's C library, ships wheels for every common platform, and moved to a cleaner v4 API (`latlng_to_cell`, `grid_disk`, `cell_to_parent`) that this page targets — it is the smoothest install of the three. S2 is more fragmented: `s2sphere` is a pure-Python port that is easy to `pip install` but trails Google's C++ `s2geometry` in features and speed, while binding to the C++ library directly is powerful but heavier to build. Quadkey needs no dedicated grid library at all — `mercantile` (or `pygeotile`) provides tile math in a few small, stable functions, since the encoding is just quadtree path arithmetic on Web Mercator tiles. For a Python event pipeline that wants a well-supported, fast, batteries-included grid, H3 is the path of least resistance; reach for S2 or Quadkey when their specific properties earn the extra integration effort.

### Comparison table

| Property | H3 (Uber) | S2 (Google) | Quadkey (Bing / slippy-map) |
|---|---|---|---|
| Cell shape | Hexagon (12 pentagons globally) | Spherical quad (cube face) | Square (Web Mercator) |
| Base geometry | Icosahedron + gnomonic | Cube + quadratic transform | EPSG:3857 (Web Mercator) plane |
| Hierarchy | 16 resolutions (0–15) | 31 levels (0–30) | Zoom 1–23+ |
| Parent-child nesting | Approximate (7:1, not exact) | Exact (4:1 quadtree) | Exact (4:1 quadtree) |
| Cell-ordering curve | None built in | Hilbert curve | Z-order (implicit in string) |
| Neighbour traversal | `grid_disk` — 6 uniform neighbours | `get_edge_neighbors` — 4 edge | string arithmetic on tile x/y |
| Area uniformity | High (slight icosahedral variance) | High (small cube-face variance) | Poor (grows with latitude) |
| Native key type | 64-bit int / 15-char hex | 64-bit int / variable-length token | base-4 string (length = zoom) |
| Key length (typical) | 15 hex chars, fixed per res | 6–16 char token | equals zoom level |
| Python library | `h3` (v4) | `s2sphere` (pure-Py) / `s2geometry` | `mercantile` / `pygeotile` |
| Library maturity | Excellent, actively maintained | Good; `s2sphere` lags C++ | Good; small, stable |
| Best fit | Load-balanced hex sharding | Range scans, exact hierarchy | Tile-aligned pipelines |

---

## Complete runnable implementation

The script below encodes the **same** EPSG:4326 (WGS84) point into all three systems at comparable resolutions and prints the ids. It depends on three libraries: `pip install h3 s2sphere mercantile`. Every call is deterministic — the same input always yields the same id.

```python
"""Compute H3, S2, and Quadkey partition keys for one lon/lat point.

Install:  pip install h3 s2sphere mercantile
All three libraries assume EPSG:4326 (WGS84) decimal degrees as input.
"""
from dataclasses import dataclass

import h3            # Uber H3, v4 API
import s2sphere      # pure-Python S2 port
import mercantile    # slippy-map tile / Quadkey helpers


@dataclass(frozen=True)
class PartitionKeys:
    h3: str          # 15-char hex, fixed length for a given resolution
    s2_token: str    # compact base-16 token, variable length
    quadkey: str     # base-4 string, length == zoom


def partition_keys(
    lon: float,
    lat: float,
    h3_res: int = 9,      # H3 resolution   -> ~0.11 km2 hexagons
    s2_level: int = 13,   # S2 level        -> ~1.1 km2 cells (NOT the same size!)
    quad_zoom: int = 16,  # Quadkey zoom    -> ~460 m tiles at mid-latitudes
) -> PartitionKeys:
    """Encode one EPSG:4326 point to a cell id in each grid system.

    The resolution numbers are chosen to be *roughly* comparable in cell
    size, but they are not equivalent indices -- see the gotchas below.
    """
    # --- H3: note the argument order is (lat, lon), not (lon, lat) ---
    h3_cell = h3.latlng_to_cell(lat, lon, h3_res)

    # --- S2: build a leaf cell id, then walk up to the target level ---
    latlng = s2sphere.LatLng.from_degrees(lat, lon)
    s2_cell = s2sphere.CellId.from_lat_lng(latlng).parent(s2_level)

    # --- Quadkey: find the enclosing slippy-map tile, then encode it ---
    tile = mercantile.tile(lon, lat, quad_zoom)   # (lon, lat) order here
    quadkey = mercantile.quadkey(tile)

    return PartitionKeys(
        h3=h3_cell,
        s2_token=s2_cell.to_token(),
        quadkey=quadkey,
    )


def h3_parent_and_neighbours(cell: str) -> tuple[str, int]:
    """Show H3 hierarchy and neighbour traversal for a cell."""
    parent = h3.cell_to_parent(cell, h3.get_resolution(cell) - 1)
    ring = h3.grid_disk(cell, 1)          # centre + 6 edge neighbours
    return parent, len(ring)


if __name__ == "__main__":
    # Central Park, New York City, in EPSG:4326 (lon, lat).
    LON, LAT = -73.965355, 40.782865

    keys = partition_keys(LON, LAT)
    print("H3       :", keys.h3)          # 892a1008957ffff
    print("S2 token :", keys.s2_token)    # 89c2589c
    print("Quadkey  :", keys.quadkey)     # 0320101101302333

    parent, ring_size = h3_parent_and_neighbours(keys.h3)
    print("H3 parent:", parent)           # 882a100895fffff (res 8)
    print("H3 ring  :", ring_size, "cells (centre + 6 neighbours)")
```

Running this prints:

```text
H3       : 892a1008957ffff
S2 token : 89c2589c
Quadkey  : 0320101101302333
H3 parent: 882a100895fffff
H3 ring  : 7 cells (centre + 6 neighbours)
```

Notice how differently the ids read: H3 gives a fixed 15-character hex string, S2 a short base-16 token whose length shrinks at coarser levels, and Quadkey a base-4 string exactly as long as the zoom. Any of the three works as a broker message key, and choosing one is part of the same decision covered when [partitioning Kafka topics by grid cell](/queue-management-retry-delivery/broker-selection-partitioning/).

---

## Parameter reference

| System | Python library | Resolution parameter | Encode call | Key type |
|---|---|---|---|---|
| H3 | `h3` (v4) | `resolution` 0–15 | `h3.latlng_to_cell(lat, lon, res)` | 15-char hex string (fixed per res) |
| S2 | `s2sphere` | `level` 0–30 | `CellId.from_lat_lng(ll).parent(level)` | base-16 token (6–16 chars) or 64-bit int |
| Quadkey | `mercantile` | `zoom` 1–23+ | `mercantile.quadkey(mercantile.tile(lon, lat, zoom))` | base-4 string (length == zoom) |

Input to every encoder is longitude/latitude in decimal degrees on EPSG:4326 (WGS84). Watch the argument order: `h3.latlng_to_cell` takes `(lat, lon)`, while `mercantile.tile` and `s2sphere.LatLng.from_degrees` follow `(lon, lat)` and `(lat, lon)` respectively.

---

## Gotchas and spatial edge cases

1. **Resolution numbers are not comparable across systems.** H3 resolution 9 (~0.11 km² hexagons), S2 level 13 (~1.1 km² cells), and Quadkey zoom 16 (~460 m tiles) are all "medium neighbourhood scale" but describe cells that differ by an order of magnitude in area. Each hierarchy has a different base cell count (122 for H3, 6 for S2, 1 for Quadkey) and subdivision factor. Always calibrate by measured cell area or edge length — for example `h3.average_hexagon_area(res, unit='km^2')` — never by matching the integer index.

2. **H3 hexagons do not nest inside their parents.** Because a hexagon cannot be subdivided into smaller hexagons without gaps, an H3 child only *approximately* covers its parent, and a child cell near the boundary can overlap a neighbouring parent. If you shard at resolution 9 and roll up to resolution 8 for aggregation, expect small edge leakage. S2 and Quadkey quadtrees nest exactly (4:1), so a parent's four children tile it precisely.

3. **S2 token length is variable.** `CellId.to_token()` strips trailing zero bits, so a coarse level yields a short token (`89c259` at level 10) and level 30 yields the full 16 hex chars. If you store tokens in a fixed-width column or use string-prefix range queries, account for the variable length — pad or use the raw 64-bit `id()` instead.

4. **Quadkey distortion explodes toward the poles.** Quadkey lives on the EPSG:3857 (Web Mercator) plane, which stretches area with latitude. A zoom-16 tile is ~460 m across near the equator but far smaller in ground distance at 70° N, and Web Mercator is undefined beyond about ±85.05°. For polar or high-latitude event streams, Quadkey produces badly unbalanced partitions; prefer H3 or S2, which are computed on the sphere.

5. **Every encoder assumes EPSG:4326 input.** If your webhook payload carries EPSG:3857 (Web Mercator), a national grid, or any projected CRS, you must reproject to EPSG:4326 (WGS84) decimal degrees *before* encoding — the libraries silently treat whatever numbers you pass as degrees. Normalizing the CRS up front, as with the geometry conventions in RFC 7946 GeoJSON ([datatracker.ietf.org/doc/html/rfc7946](https://datatracker.ietf.org/doc/html/rfc7946)), keeps the cell id correct.

6. **Argument order is inconsistent between libraries.** `h3.latlng_to_cell` expects latitude first; `mercantile.tile` expects longitude first. Swapping them yields a valid-looking id for the wrong location on Earth — a bug that passes every type check. Wrap each call in a single helper (as above) so the ordering lives in exactly one place.

7. **H3 has 12 pentagons.** The icosahedral base introduces exactly twelve pentagon cells per resolution (over ocean at the default orientation). Neighbour traversal near a pentagon returns fewer than six neighbours; code that assumes a fixed ring of six must handle the pentagon case if your coverage area is near one.

---

## Verification

Determinism is the property that makes a grid cell usable as a partition key: the same point must always produce the same id. This pytest module asserts that, plus the exact ids for a known location.

```python
import h3
import s2sphere
import mercantile


def encode(lon, lat, h3_res=9, s2_level=13, quad_zoom=16):
    h3_cell = h3.latlng_to_cell(lat, lon, h3_res)
    s2_token = s2sphere.CellId.from_lat_lng(
        s2sphere.LatLng.from_degrees(lat, lon)
    ).parent(s2_level).to_token()
    quadkey = mercantile.quadkey(mercantile.tile(lon, lat, quad_zoom))
    return h3_cell, s2_token, quadkey


# Central Park, NYC — EPSG:4326.
LON, LAT = -73.965355, 40.782865


def test_ids_are_deterministic():
    assert encode(LON, LAT) == encode(LON, LAT)


def test_known_ids():
    h3_cell, s2_token, quadkey = encode(LON, LAT)
    assert h3_cell == "892a1008957ffff"
    assert s2_token == "89c2589c"
    assert quadkey == "0320101101302333"


def test_distinct_points_get_distinct_cells():
    # A point ~5 km away must fall in a different cell in all three systems.
    a = encode(LON, LAT)
    b = encode(LON + 0.06, LAT + 0.04)
    assert a[0] != b[0] and a[1] != b[1] and a[2] != b[2]


def test_key_types():
    h3_cell, s2_token, quadkey = encode(LON, LAT)
    assert len(h3_cell) == 15           # fixed-length H3 hex
    assert set(quadkey) <= set("0123")  # Quadkey is base-4
    assert len(quadkey) == 16           # length == zoom (16)
```

Run it with `pytest -q`. If `test_known_ids` fails after a library upgrade, check the release notes — the H3 v3-to-v4 rename (`geo_to_h3` became `latlng_to_cell`) is the usual culprit, and cell ids themselves are stable across versions.

---

## FAQ

<details class="faq">
<summary><strong>Are H3 resolution, S2 level, and Quadkey zoom interchangeable numbers?</strong></summary>

No. Each system defines its own hierarchy with a different base cell count and subdivision factor, so H3 resolution 9, S2 level 13, and Quadkey zoom 16 describe different cell sizes. Compare them by measured cell area or edge length, never by the integer index.

</details>

<details class="faq">
<summary><strong>Which grid makes the best Kafka partition key?</strong></summary>

H3 is the most common choice because its fixed-length hex string, near-uniform hexagon area, and simple neighbour traversal make load balancing and adjacency queries straightforward. S2 wins when you need range scans along a Hilbert curve; Quadkey wins when your events are already tied to slippy-map tiles.

</details>

<details class="faq">
<summary><strong>Why do H3 hexagons not nest perfectly inside their parents?</strong></summary>

A hexagon cannot be tiled by smaller hexagons without gaps, so H3 children only approximately cover their parent and a child can belong partly to a neighbouring parent. S2 and Quadkey use quadtrees, so their four children exactly nest inside each parent.

</details>

<details class="faq">
<summary><strong>Do all three systems expect EPSG:4326 input?</strong></summary>

Yes. `h3`, `s2sphere`, and `mercantile` all take longitude/latitude in decimal degrees on the WGS84 datum. If your payload carries EPSG:3857 (Web Mercator) or another projected CRS, reproject to EPSG:4326 before encoding or the cell id will be wrong.

</details>

---

## Related

- [Spatial Partitioning Strategies for Event Streams](/core-event-fundamentals-architecture/spatial-partitioning-strategies/) — the parent guide to choosing and sizing a grid for spatial sharding
- [Broker Selection & Partitioning for Spatial Streams](/queue-management-retry-delivery/broker-selection-partitioning/) — where these cell ids become concrete Kafka and Redis Streams partition keys
- [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/) — the reference section for designing geospatial event-driven systems in Python
