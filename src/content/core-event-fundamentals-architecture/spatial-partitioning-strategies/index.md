---
title: "Spatial Partitioning Strategies for Event Streams"
description: "Partition geospatial event streams for locality and balance: compare H3, S2, Quadkey, and geohash keys, pick resolution, handle boundary-straddling geometries, and re-partition safely."
slug: "spatial-partitioning-strategies"
type: "guide"
breadcrumb: "Core Event Fundamentals & Architecture > Spatial Partitioning Strategies for Event Streams"
datePublished: "2025-02-10"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Spatial Partitioning Strategies for Event Streams",
      "description": "How to partition a geospatial event stream so related events co-locate for ordering and cache locality while load stays balanced: discrete global grid keys (H3, S2, Quadkey, geohash), resolution selection, boundary-straddling geometries, and re-partitioning.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/",
      "datePublished": "2025-02-10",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" },
      "publisher": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/" },
        { "@type": "ListItem", "position": 2, "name": "Core Event Fundamentals & Architecture", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/" },
        { "@type": "ListItem", "position": 3, "name": "Spatial Partitioning Strategies for Event Streams", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Derive a Spatial Partition Key from an Event Geometry",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Validate and normalize the geometry to EPSG:4326" },
        { "@type": "HowToStep", "position": 2, "name": "Choose a representative point (centroid or point-on-surface)" },
        { "@type": "HowToStep", "position": 3, "name": "Encode the point to a grid cell at a chosen resolution" },
        { "@type": "HowToStep", "position": 4, "name": "Map the cell to a broker partition with a stable hash" },
        { "@type": "HowToStep", "position": 5, "name": "Monitor skew and re-partition when a cell goes hot" }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should I use a geometry's centroid or a point-on-surface as the partition key?",
          "acceptedAnswer": { "@type": "Answer", "text": "Use point-on-surface (Shapely's representative_point()) for any polygon that can be concave, ring-shaped, or a MultiPolygon, because a centroid can fall outside the geometry — in a river bend, a C-shaped admin boundary, or between two disjoint islands — and land in the wrong cell. Centroid is acceptable only for small convex features where the two points resolve to the same cell at your chosen resolution." }
        },
        {
          "@type": "Question",
          "name": "How do I pick the H3 or S2 resolution for a partition key?",
          "acceptedAnswer": { "@type": "Answer", "text": "Pick the coarsest resolution whose cell count comfortably exceeds your partition count while keeping the busiest cell under a single consumer's throughput ceiling. Coarse cells give strong locality but few distinct keys and high skew risk in dense areas; fine cells spread load but scatter neighboring events across partitions and inflate key cardinality. For city-scale streams, H3 resolution 5-7 or S2 level 8-11 is a common starting band, tuned against measured per-cell event rates." }
        },
        {
          "@type": "Question",
          "name": "What happens when a feature straddles two grid cells?",
          "acceptedAnswer": { "@type": "Answer", "text": "A single partition key must be deterministic, so you cannot send one event to two partitions and keep ordering. Reduce the geometry to one representative point and derive a single cell from that point, accepting that a feature spanning a boundary is assigned by where its representative point falls. If consumers genuinely need every touched cell — for fan-out to regional caches — compute the covering set separately and use it for routing hints in the payload, never as the partition key itself." }
        },
        {
          "@type": "Question",
          "name": "Can I change the partition scheme without downtime?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes, with a dual-write cutover. Stamp every event with a scheme version, run the old and new keying side by side, and route consumers to the new topic once its offsets catch up. Never re-hash an existing topic in place: changing the key of in-flight events breaks per-cell ordering guarantees and duplicates spatial state. Treat resolution changes as a new scheme version, because a resolution-6 cell and a resolution-7 cell are different keys even for the same point." }
        }
      ]
    }
  ]
}
</script>

**Partitioning a spatial event stream well means choosing a key that pulls geographically related events onto the same partition — so they stay ordered and warm in the same cache — without letting one busy region overwhelm a single consumer.** This page sits under [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/) and covers how to turn a geometry into a partition key, how to choose grid resolution, and how to re-partition when the load shifts. Where [Sensor Data Routing Patterns](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/) decides *which consumers* an event reaches, partitioning decides *which partition* it lands on — the layer that governs ordering and locality once the broker is in the picture.

---

## Prerequisites

Before you commit to a partition key, confirm your environment and assumptions:

- [ ] **Python 3.11+** — pattern matching and modern typing for the keying helpers below
- [ ] **`h3` 4.x** — the current `h3-py` API (`latlng_to_cell`, `cell_to_parent`) used throughout
- [ ] **`shapely` 2.0+** — validity checks and `representative_point()` for boundary-safe centroids
- [ ] **A partitioned broker** — Kafka topic partitions or Redis Streams shards you can key deterministically
- [ ] **A skew baseline** — per-cell event-rate metrics so resolution choices are measured, not guessed
- [ ] **EPSG:4326 (WGS84) inputs** — all grid encoders expect latitude/longitude; reproject at ingestion
- [ ] **GeoJSON conformance** — geometries validate against [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946) before keying

---

## Why a partition key is a spatial decision

A message broker distributes events across partitions by hashing a key. Consumers scale by claiming partitions, and a broker guarantees ordering only *within* a partition. For non-spatial data the key is obvious — a user ID, an order ID. For a spatial stream the key encodes a policy: it decides whether two events that happened fifty metres apart are processed in order by the same worker, or scattered across the cluster with no ordering relationship at all.

The naive choices both fail. Keying on a raw coordinate string gives near-infinite cardinality — every event lands on an effectively random partition, destroying locality and any hope of a warm spatial cache. Keying on a coarse label like a country code collapses the whole stream onto a handful of partitions, so one busy region saturates one consumer while the rest idle. What you want sits between these extremes: a key with enough distinct values to spread load, but coarse enough that neighboring events share a value. That is exactly what a discrete global grid system provides.

A discrete global grid system (DGGS) tiles the Earth into addressable cells at a fixed resolution. Encoding a point returns a cell identifier; nearby points return the same identifier, and the number of distinct identifiers is bounded and tunable. Four families dominate in practice — [H3](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/) hexagons, S2 cells, Quadkey tiles, and plain geohash — and the full trade study of which to pick lives in the dedicated comparison, [H3 vs S2 vs Quadkey for Spatial Partitioning](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/). The short version: H3 hexagons give uniform neighbor distance (every neighbor is equidistant, which matters for radius queries and skew smoothing); S2 offers many fine levels and clean hierarchical containment; Quadkey and geohash are trivially prefix-truncatable, so you can coarsen a key by chopping characters. Admin-boundary keys (a county or postal code) and bounding-box centroid keys are the non-grid alternatives — human-meaningful but unevenly sized, which makes their skew hard to reason about.

The diagram below shows the same region under two schemes mapped onto the same three partitions: H3 hexagons on the left, an S2/Quadkey square grid on the right. The point is not that one is correct — it is that the cell-to-partition assignment is what you are actually designing.

<figure class="fig">
<svg viewBox="76 0 594 340" role="img" aria-label="A region tiled by H3 hexagons versus an S2 or Quadkey square grid, both mapped onto three broker partitions" xmlns="http://www.w3.org/2000/svg">
  <title>H3 Hex Tiling vs S2/Quadkey Grid Mapped to Partitions</title>
  <desc>The same geographic region is tiled two ways. On the left, H3 hexagons cover the region; each hex is labelled with the partition it hashes to. On the right, an S2 or Quadkey square grid covers the same region with its own cell-to-partition mapping. Both feed the same three broker partitions P0, P1, and P2 shown across the bottom.</desc>
  <rect x="76" y="0" width="594" height="340" fill="var(--fig-bg)"/>
  <defs>
    <marker id="sp-arr" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Left title -->
  <text x="180" y="24" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">H3 hexagons</text>
  <text x="180" y="39" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">uniform neighbor distance</text>
  <!-- H3 hex cluster (pointy-top hexes) -->
  <polygon points="120,70 150,53 180,70 180,104 150,121 120,104" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
  <text x="150" y="91" text-anchor="middle" font-size="9" fill="currentColor">P0</text>
  <polygon points="180,70 210,53 240,70 240,104 210,121 180,104" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
  <text x="210" y="91" text-anchor="middle" font-size="9" fill="currentColor">P1</text>
  <polygon points="150,121 180,104 210,121 210,155 180,172 150,155" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
  <text x="180" y="142" text-anchor="middle" font-size="9" fill="currentColor">P2</text>
  <polygon points="90,121 120,104 150,121 150,155 120,172 90,155" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
  <text x="120" y="142" text-anchor="middle" font-size="9" fill="currentColor">P0</text>
  <polygon points="210,121 240,104 270,121 270,155 240,172 210,155" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
  <text x="240" y="142" text-anchor="middle" font-size="9" fill="currentColor">P1</text>
  <!-- divider -->
  <line x1="380" y1="52" x2="380" y2="240" stroke="currentColor" stroke-width="1" opacity="0.25" stroke-dasharray="4,4"/>
  <!-- Right title -->
  <text x="580" y="24" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">S2 / Quadkey grid</text>
  <text x="580" y="39" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">prefix-truncatable squares</text>
  <!-- Square grid 3x3 -->
  <rect x="500" y="58" width="52" height="52" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
  <text x="526" y="88" text-anchor="middle" font-size="9" fill="currentColor">P0</text>
  <rect x="552" y="58" width="52" height="52" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
  <text x="578" y="88" text-anchor="middle" font-size="9" fill="currentColor">P1</text>
  <rect x="604" y="58" width="52" height="52" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
  <text x="630" y="88" text-anchor="middle" font-size="9" fill="currentColor">P2</text>
  <rect x="500" y="110" width="52" height="52" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
  <text x="526" y="140" text-anchor="middle" font-size="9" fill="currentColor">P1</text>
  <rect x="552" y="110" width="52" height="52" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
  <text x="578" y="140" text-anchor="middle" font-size="9" fill="currentColor">P2</text>
  <rect x="604" y="110" width="52" height="52" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
  <text x="630" y="140" text-anchor="middle" font-size="9" fill="currentColor">P0</text>
  <!-- Arrows down to partitions -->
  <line x1="180" y1="180" x2="270" y2="252" stroke="currentColor" stroke-width="1.1" marker-end="url(#sp-arr)" opacity="0.45"/>
  <line x1="580" y1="170" x2="490" y2="252" stroke="currentColor" stroke-width="1.1" marker-end="url(#sp-arr)" opacity="0.45"/>
  <!-- Partition bar -->
  <rect x="230" y="262" width="90" height="34" rx="5" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.5"/>
  <text x="275" y="283" text-anchor="middle" font-size="10" fill="currentColor">partition P0</text>
  <rect x="335" y="262" width="90" height="34" rx="5" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.5"/>
  <text x="380" y="283" text-anchor="middle" font-size="10" fill="currentColor">partition P1</text>
  <rect x="440" y="262" width="90" height="34" rx="5" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.5"/>
  <text x="485" y="283" text-anchor="middle" font-size="10" fill="currentColor">partition P2</text>
  <text x="380" y="324" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.45">cell → stable hash → partition — geospatialwebhook.com</text>
</svg>
<figcaption><b>Figure 1.</b> H3 Hex Tiling vs S2/Quadkey Grid Mapped to Partitions</figcaption>
</figure>

---

## Architecture

The keying path is a four-layer contract. Each layer hands the next a stricter, smaller object, and the partition key is fixed exactly once — at layer three — so it can never drift downstream.

1. **Normalization** — the raw GeoJSON geometry is validated and, if needed, reprojected to EPSG:4326 (WGS84). Grid encoders assume latitude/longitude degrees; feeding them EPSG:3857 (Web Mercator) metres silently produces wrong cells.
2. **Reduction to a representative point** — polygons, lines, and MultiPolygons are collapsed to a single point. This is where boundary-straddling is resolved: one point means one cell, deterministically.
3. **Cell encoding and partition mapping** — the point is encoded to a grid cell at the chosen resolution, then the cell string is hashed to a partition index. The hash, not the cell, is what the broker sees, so partition count and grid resolution stay independent.
4. **Dispatch with ordering** — the event is written to the partition with the cell recorded in its envelope. Consumers claim partitions and process each partition's events in offset order, giving per-cell ordering for free.

Only layer three may compute the key. If a downstream stage recomputes it — at a different resolution, or after a reprojection — the event can land on a different partition than its neighbors, and the ordering guarantee quietly evaporates.

---

## Step-by-step implementation

### Step 1 — Validate the geometry before touching the grid

**Purpose:** Guarantee the encoder only ever sees a valid, EPSG:4326 geometry, so cell assignment cannot be corrupted by bad topology.

An invalid geometry — a self-intersecting polygon, a `null` coordinate, a NaN — will either raise deep inside the encoder or, worse, encode a garbage point. Validate first and reject early.

```python
from shapely.geometry import shape
from shapely.validation import explain_validity

def validated_geom(geojson_geometry: dict):
    """Parse a GeoJSON geometry (RFC 7946) and return a valid Shapely object.

    Raises ValueError on empty, unparseable, or invalid input so the caller
    can quarantine the event before any cell is assigned.
    """
    try:
        geom = shape(geojson_geometry)
    except Exception as exc:                       # malformed structure
        raise ValueError(f"unparseable geometry: {exc}") from exc
    if geom.is_empty:
        raise ValueError("geometry is empty")
    if not geom.is_valid:
        # Do not silently repair a partition-key input: a repaired shape can
        # shift the representative point across a cell boundary.
        raise ValueError(f"invalid geometry: {explain_validity(geom)}")
    return geom
```

### Step 2 — Reduce any geometry to one representative point

**Purpose:** Turn a polygon, line, or MultiPolygon into the single point that will determine the cell — safely, even for concave and multi-part shapes.

A centroid is the intuitive choice, but the centroid of a C-shaped boundary or a MultiPolygon of two islands can fall in empty space between the parts, landing in a cell the feature does not even touch. Shapely's `representative_point()` is guaranteed to lie *on* the geometry.

```python
from shapely.geometry.base import BaseGeometry

def representative_latlng(geom: BaseGeometry) -> tuple[float, float]:
    """Return (lat, lng) in EPSG:4326 for the point used to derive the cell.

    - Point: itself.
    - Polygon/Line: point-on-surface, never a centroid that could fall in a hole.
    - MultiPolygon: point-on-surface of the largest part, a stable representative
      choice that stays put as smaller parts are added or removed.
    """
    if geom.geom_type == "Point":
        pt = geom
    elif geom.geom_type == "MultiPolygon":
        largest = max(geom.geoms, key=lambda g: g.area)
        pt = largest.representative_point()
    else:
        pt = geom.representative_point()
    # GeoJSON is (lng, lat); H3/S2 want (lat, lng).
    return pt.y, pt.x
```

### Step 3 — Encode the point to a cell and map it to a partition

**Purpose:** Produce the deterministic partition key that fixes both spatial locality and ordering.

Encode the representative point with `h3.latlng_to_cell` at your chosen resolution, then hash the cell string into the partition range. Keeping the hash separate from the cell lets you change partition count without re-keying, and lets you coarsen the cell (via `cell_to_parent`) without touching the broker.

```python
import hashlib
import h3

PARTITION_COUNT = 12
KEY_RESOLUTION = 6          # H3 res 6 ~ 36 km^2 cells; tune against measured skew

def partition_key(lat: float, lng: float, resolution: int = KEY_RESOLUTION) -> str:
    """Deterministic H3 cell used as the broker partition key."""
    return h3.latlng_to_cell(lat, lng, resolution)

def partition_index(cell: str, partitions: int = PARTITION_COUNT) -> int:
    """Stable cell -> partition mapping, independent of Python's salted hash()."""
    digest = hashlib.sha256(cell.encode()).digest()
    return int.from_bytes(digest[:8], "big") % partitions

def key_event(geojson_geometry: dict) -> tuple[str, int]:
    geom = validated_geom(geojson_geometry)            # Step 1
    lat, lng = representative_latlng(geom)             # Step 2
    cell = partition_key(lat, lng)                     # Step 3
    return cell, partition_index(cell)
```

### Step 4 — Dispatch with the cell recorded for ordering and re-routing

**Purpose:** Write the event to its partition and preserve the cell so consumers can order per-cell and coarsen later without re-deriving keys.

```python
import json

def build_record(geojson_geometry: dict, payload: dict) -> dict:
    cell, part = key_event(geojson_geometry)
    return {
        "partition": part,
        "key": cell,                       # H3 cell string, for per-cell ordering
        "scheme": "h3",                    # scheme + resolution stamp enables safe migration
        "resolution": KEY_RESOLUTION,
        "value": json.dumps(payload),
    }
```

---

## Spatial validation and error handling

Keying is only as trustworthy as the geometry feeding it, so validation belongs *before* the encoder, never after. Step 1 rejects empty, unparseable, and invalid geometries; the deliberate choice there is to **reject rather than repair**. A `make_valid()` repair can nudge a polygon's boundary enough to move its representative point across a cell edge, silently reassigning the event to a different partition than its true neighbors — a locality bug that never raises. Repair, if you want it, belongs in a separate validation stage whose output is re-validated, following the patterns in [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/).

CRS mistakes are the other silent killer. Every grid encoder expects EPSG:4326 (WGS84) degrees. Hand it EPSG:3857 (Web Mercator) metres and `latlng_to_cell` will not error — it will treat a coordinate like `-13627665` as a latitude, wrap it, and return a plausible-looking but entirely wrong cell. Normalize at ingestion and validate that coordinates fall in `[-90, 90]` and `[-180, 180]` before keying. A Pydantic model at the boundary makes this enforceable:

```python
from pydantic import BaseModel, field_validator

class KeyableEvent(BaseModel):
    geometry: dict          # GeoJSON geometry, RFC 7946
    crs: str = "EPSG:4326"

    @field_validator("crs")
    @classmethod
    def must_be_wgs84(cls, v: str) -> str:
        # Reproject upstream; the keyer only accepts EPSG:4326.
        if v.upper() != "EPSG:4326":
            raise ValueError("partition keying requires EPSG:4326 (WGS84)")
        return v.upper()
```

---

## Resolution, skew, and re-partitioning

Resolution is the single most consequential knob. It trades three quantities against each other: **locality** (coarser cells keep more neighbors together), **partition-key cardinality** (finer cells create more distinct keys), and **skew** (coarser cells concentrate more events per key). Pick the coarsest resolution whose distinct-cell count comfortably exceeds your partition count *and* whose busiest cell stays under one consumer's throughput ceiling. For city-scale streams that band is often H3 resolution 5-7 or the equivalent S2 level 8-11, but the only honest way to set it is against measured per-cell rates.

<figure class="fig">
<svg viewBox="0 0 760 268" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Log chart of distinct H3 cell count and busiest-cell event rate against resolution, with the workable resolution band marked">
<title>Choosing an H3 resolution: cardinality rises while per-cell load falls</title>
<desc>A logarithmic chart over H3 resolutions 3 to 10 for a 5,000 square kilometre region carrying 20,000 events per second. Distinct cell count climbs from 1 at resolution 3 to 333,000 at resolution 10, crossing the 24-partition floor between resolutions 5 and 6. The busiest cell's event rate falls from 20,000 per second to 8 per second, crossing the 400 per second consumer ceiling between resolutions 6 and 7. Only resolutions 7 and 8 satisfy both constraints at once, and that overlap is shaded as the workable band.</desc>
<rect x="0" y="0" width="760" height="268" fill="var(--fig-bg)"/>
<rect x="315" y="40" width="140" height="180" fill="var(--fig-mint)" opacity="0.55"/>
<text x="385" y="34" text-anchor="middle" font-size="10" font-weight="600" fill="var(--fig-mint-edge)">workable band</text>
<line x1="70" y1="40" x2="70" y2="220" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="70" y1="220" x2="600" y2="220" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="70" y1="190" x2="600" y2="190" stroke="var(--fig-line-soft)" stroke-width="0.7" stroke-dasharray="3,3"/>
<line x1="70" y1="130" x2="600" y2="130" stroke="var(--fig-line-soft)" stroke-width="0.7" stroke-dasharray="3,3"/>
<line x1="70" y1="70" x2="600" y2="70" stroke="var(--fig-line-soft)" stroke-width="0.7" stroke-dasharray="3,3"/>
<text x="64" y="223" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">1</text>
<text x="64" y="193" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">10</text>
<text x="64" y="163" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">100</text>
<text x="64" y="133" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">1k</text>
<text x="64" y="103" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">10k</text>
<text x="64" y="73" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">100k</text>
<text x="64" y="43" text-anchor="end" font-size="9" fill="var(--fig-ink-soft)">1M</text>
<line x1="70" y1="178.6" x2="600" y2="178.6" stroke="var(--fig-earth-edge)" stroke-width="1.3" stroke-dasharray="6,3"/>
<text x="604" y="182" font-size="9" fill="var(--fig-earth-edge)">24 partitions — key floor</text>
<line x1="70" y1="141.9" x2="600" y2="141.9" stroke="var(--fig-rose-edge)" stroke-width="1.3" stroke-dasharray="6,3"/>
<text x="604" y="145" font-size="9" fill="var(--fig-rose-edge)">400 ev/s — consumer ceiling</text>
<polyline points="70,220 140,205.7 210,181 280,155.7 350,130.4 420,105 490,79.7 560,54.3" fill="none" stroke="var(--fig-mint-edge)" stroke-width="2.2"/>
<polyline points="70,91 140,101.4 210,114.8 280,131.4 350,147.6 420,164.6 490,179.7 560,192.9" fill="none" stroke="var(--fig-peach-edge)" stroke-width="2.2"/>
<circle cx="350" cy="130.4" r="3.4" fill="var(--fig-mint-edge)"/>
<circle cx="420" cy="105" r="3.4" fill="var(--fig-mint-edge)"/>
<circle cx="350" cy="147.6" r="3.4" fill="var(--fig-peach-edge)"/>
<circle cx="420" cy="164.6" r="3.4" fill="var(--fig-peach-edge)"/>
<text x="604" y="112" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">distinct cells</text>
<text x="604" y="125" font-size="9" fill="var(--fig-ink-soft)">must exceed partitions</text>
<text x="604" y="196" font-size="9.5" font-weight="600" fill="var(--fig-peach-edge)">busiest cell, ev/s</text>
<text x="604" y="209" font-size="9" fill="var(--fig-ink-soft)">must stay under ceiling</text>
<text x="70" y="236" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">r3</text>
<text x="140" y="236" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">r4</text>
<text x="210" y="236" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">r5</text>
<text x="280" y="236" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">r6</text>
<text x="350" y="236" text-anchor="middle" font-size="9" font-weight="700" fill="var(--fig-ink)">r7</text>
<text x="420" y="236" text-anchor="middle" font-size="9" font-weight="700" fill="var(--fig-ink)">r8</text>
<text x="490" y="236" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">r9</text>
<text x="560" y="236" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">r10</text>
<text x="335" y="256" text-anchor="middle" font-size="9.5" fill="var(--fig-ink-soft)">H3 resolution — coarse to fine, for 5,000 km² carrying 20,000 ev/s</text>
</svg>
<figcaption><b>Figure 2.</b> The two constraints move in opposite directions, so the resolution you want is wherever they overlap — here r7–r8. Both curves shift with your region size and event rate, which is why the band has to be read off measured per-cell rates rather than assumed.</figcaption>
</figure>

Skew is inherent to spatial data — events cluster in cities, along roads, around sensors — so a uniform grid never yields uniform load. Two mitigations help. First, salt hot cells: append a bounded random suffix to the key for cells above a rate threshold, spreading one cell across several partitions at the cost of per-cell ordering for that cell only. Second, use a finer resolution in dense regions via a mixed-resolution scheme, keeping coarse cells where the stream is sparse. Detecting when a cell has gone hot is a monitoring problem covered in [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/); the broker-side mechanics of assigning keys to partitions are in [Broker Selection & Partitioning for Spatial Streams](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/).

<figure class="fig">
<svg viewBox="0 0 760 296" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Salting a hot H3 cell spreads it across three partitions and sacrifices ordering for that one cell only">
<title>Salting a hot cell: what it buys and what it costs</title>
<desc>Before salting, cell 8a2a1072b59ffff carries 1,400 events per second and hashes to partition 4 alone, so partition 4 is saturated while partitions 5 and 6 sit near idle, and the cell's events remain strictly ordered. After salting, the key gains a bounded suffix of 0, 1 or 2, so the same traffic spreads across partitions 4, 5 and 6 at roughly 470 events per second each. Every other cell keeps its ordering guarantee untouched; only the salted cell loses per-cell ordering, because its events now sit in three independently ordered partitions.</desc>
<rect x="0" y="0" width="760" height="296" fill="var(--fig-bg)"/>
<defs>
<marker id="sa-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
<path d="M0,0 L8,3 L0,6 Z" fill="var(--fig-line)"/>
</marker>
</defs>
<text x="14" y="20" font-size="11" font-weight="600" fill="var(--fig-rose-edge)">Before — one hot cell, one partition</text>
<rect x="14" y="32" width="176" height="46" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="102" y="50" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">8a2a1072b59ffff</text>
<text x="102" y="66" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">1,400 ev/s — city centre</text>
<line x1="192" y1="55" x2="238" y2="55" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#sa-arr)"/>
<text x="215" y="48" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">hash</text>
<rect x="242" y="30" width="120" height="22" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="302" y="45" text-anchor="middle" font-size="9" fill="var(--fig-ink)">p4 — 1,400 ev/s</text>
<rect x="242" y="56" width="120" height="22" rx="4" fill="var(--fig-earth)" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="302" y="71" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">p5 — 60 ev/s</text>
<rect x="242" y="82" width="120" height="22" rx="4" fill="var(--fig-earth)" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="302" y="97" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">p6 — 45 ev/s</text>
<rect x="378" y="30" width="16" height="22" rx="3" fill="var(--fig-rose-edge)"/>
<rect x="378" y="56" width="16" height="22" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="378" y="82" width="16" height="22" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<text x="402" y="45" font-size="9" fill="var(--fig-rose-edge)" font-weight="600">saturated — consumer lag climbs</text>
<text x="402" y="71" font-size="9" fill="var(--fig-ink-soft)">idle</text>
<text x="402" y="97" font-size="9" fill="var(--fig-ink-soft)">idle</text>
<text x="14" y="100" font-size="9" fill="var(--fig-mint-edge)" font-weight="600">ordering: intact for every cell</text>
<line x1="14" y1="124" x2="746" y2="124" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="148" font-size="11" font-weight="600" fill="var(--fig-mint-edge)">After — bounded salt on that cell only</text>
<rect x="14" y="160" width="176" height="30" rx="5" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.3"/>
<text x="102" y="179" text-anchor="middle" font-size="9.5" fill="var(--fig-ink)">8a2a1072b59ffff#0</text>
<rect x="14" y="194" width="176" height="30" rx="5" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.3"/>
<text x="102" y="213" text-anchor="middle" font-size="9.5" fill="var(--fig-ink)">8a2a1072b59ffff#1</text>
<rect x="14" y="228" width="176" height="30" rx="5" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.3"/>
<text x="102" y="247" text-anchor="middle" font-size="9.5" fill="var(--fig-ink)">8a2a1072b59ffff#2</text>
<line x1="192" y1="175" x2="238" y2="180" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#sa-arr)"/>
<line x1="192" y1="209" x2="238" y2="206" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#sa-arr)"/>
<line x1="192" y1="243" x2="238" y2="232" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#sa-arr)"/>
<rect x="242" y="170" width="120" height="22" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="302" y="185" text-anchor="middle" font-size="9" fill="var(--fig-ink)">p4 — 470 ev/s</text>
<rect x="242" y="196" width="120" height="22" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="302" y="211" text-anchor="middle" font-size="9" fill="var(--fig-ink)">p5 — 530 ev/s</text>
<rect x="242" y="222" width="120" height="22" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="302" y="237" text-anchor="middle" font-size="9" fill="var(--fig-ink)">p6 — 505 ev/s</text>
<rect x="378" y="170" width="16" height="22" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="378" y="196" width="16" height="22" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="378" y="222" width="16" height="22" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<text x="402" y="185" font-size="9" fill="var(--fig-mint-edge)" font-weight="600">all three inside the ceiling</text>
<text x="402" y="211" font-size="9" fill="var(--fig-ink-soft)">salt count bounds the fan-out</text>
<text x="402" y="237" font-size="9" fill="var(--fig-ink-soft)">at 3, not at cardinality</text>
<rect x="14" y="266" width="732" height="24" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="26" y="282" font-size="9.5" fill="var(--fig-ink)">ordering: lost for 8a2a1072b59ffff alone — its events now sit in three independently ordered partitions. Every other cell is untouched.</text>
</svg>
<figcaption><b>Figure 3.</b> Salting is a targeted trade, not a global one: you give up per-cell ordering for the handful of cells above the rate threshold and keep it everywhere else. Bound the salt — an unbounded suffix is just the high-cardinality key that destroyed locality in the first place.</figcaption>
</figure>

Re-partitioning — changing resolution, grid family, or partition count — is a migration, not an edit. Never re-hash a live topic in place: a resolution-6 cell and a resolution-7 cell are different keys for the same point, so re-keying in flight shatters per-cell ordering and duplicates state. Instead, stamp every event with a `scheme` and `resolution` version (as Step 4 does), dual-write to old and new topics during the cutover, and move consumers to the new topic only once its offsets have caught up.

```python
def coarsen_key(cell: str, target_resolution: int) -> str:
    """Roll an H3 cell up to a coarser parent without re-deriving from geometry.

    Lets a consumer group aggregate at a coarser grain than the producer keyed
    at — the basis of a zero-downtime resolution migration.
    """
    current = h3.get_resolution(cell)
    if target_resolution > current:
        raise ValueError("target must be coarser than the source cell")
    return h3.cell_to_parent(cell, target_resolution)
```

Because a boundary-straddling feature is resolved to exactly one representative point (Step 2), it always maps to exactly one cell and one partition. If a downstream consumer genuinely needs every cell a large polygon overlaps — to invalidate several regional caches, say — compute that covering set separately with `h3.polygon_to_cells` and carry it in the payload as routing hints. It must never become the partition key: a key that maps to multiple partitions cannot be ordered.

---

## Delivery and ordering

A broker orders events only within a partition, so per-cell ordering is a direct consequence of a stable cell-to-partition mapping. Keep that mapping pure — `sha256` of the cell modulo the partition count, as in Step 3, not Python's `hash()`, which is salted per process and would scatter the same cell across partitions on restart. With a stable map, at-least-once delivery is the practical target: an event is never lost, but a consumer may see a cell's events more than once after a rebalance or retry, so writes must be idempotent (keyed on a deterministic event ID). Exactly-once across a spatial cluster is rarely worth its cost. Ordering only holds *within* a cell; two events in adjacent cells that hash to different partitions have no ordering relationship, which is the correct and expected behavior.

---

## Verification

This test confirms the two properties partitioning must guarantee: nearby points share a partition (locality), and a MultiPolygon keys to a cell that actually contains its representative point (boundary safety).

```python
import h3
from shapely.geometry import shape

def test_nearby_points_share_partition():
    # Two points ~200 m apart in San Francisco (EPSG:4326).
    a = {"type": "Point", "coordinates": [-122.4194, 37.7749]}
    b = {"type": "Point", "coordinates": [-122.4174, 37.7752]}
    cell_a, part_a = key_event(a)
    cell_b, part_b = key_event(b)
    assert cell_a == cell_b            # same H3 res-6 cell
    assert part_a == part_b            # therefore same partition

def test_multipolygon_keys_to_a_contained_cell():
    mp = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[-122.42, 37.77], [-122.41, 37.77],
              [-122.41, 37.78], [-122.42, 37.78], [-122.42, 37.77]]],
            [[[-122.30, 37.80], [-122.29, 37.80],
              [-122.29, 37.81], [-122.30, 37.81], [-122.30, 37.80]]],
        ],
    }
    cell, _ = key_event(mp)
    lat, lng = h3.cell_to_latlng(cell)
    # The chosen point-on-surface must lie inside the larger part.
    largest = max(shape(mp).geoms, key=lambda g: g.area)
    assert largest.buffer(0.02).contains(shape(
        {"type": "Point", "coordinates": [lng, lat]}))
```

---

## Troubleshooting

| Symptom | Likely spatial cause | Fix |
|---|---|---|
| One partition's lag grows while others idle | Hot cell — a dense region concentrates events on one key | Salt the hot cell's key or use a finer resolution there; see partition skew monitoring |
| Neighboring events land on different partitions | Resolution too fine — adjacent points fall in different cells | Coarsen the key resolution or roll cells up with `cell_to_parent` |
| Partition assignment changes after a restart | Using Python's salted `hash()` for cell-to-partition mapping | Switch to a stable digest (`sha256`) modulo partition count |
| MultiPolygon events routed to an empty region | Centroid used as the key falls between disjoint parts | Use `representative_point()` on the largest part (Step 2) |
| Encoder returns wildly wrong cells | Geometry in EPSG:3857 (Web Mercator) fed to a lat/lng encoder | Reproject to EPSG:4326 (WGS84) at ingestion; validate coordinate ranges |
| Per-cell ordering broke after a scheme change | Topic re-keyed in place at a new resolution | Migrate via dual-write with a `scheme`/`resolution` stamp, never re-hash live |

---

## FAQ

<details class="faq">
<summary><strong>Should I use a geometry's centroid or a point-on-surface as the partition key?</strong></summary>

Use point-on-surface (Shapely's `representative_point()`) for any polygon that can be concave, ring-shaped, or a MultiPolygon, because a centroid can fall outside the geometry — in a river bend, a C-shaped admin boundary, or between two disjoint islands — and land in the wrong cell. Centroid is acceptable only for small convex features where the two points resolve to the same cell at your chosen resolution.

</details>

<details class="faq">
<summary><strong>How do I pick the H3 or S2 resolution for a partition key?</strong></summary>

Pick the coarsest resolution whose cell count comfortably exceeds your partition count while keeping the busiest cell under a single consumer's throughput ceiling. Coarse cells give strong locality but few distinct keys and high skew risk in dense areas; fine cells spread load but scatter neighboring events across partitions and inflate key cardinality. For city-scale streams, H3 resolution 5-7 or S2 level 8-11 is a common starting band, tuned against measured per-cell event rates.

</details>

<details class="faq">
<summary><strong>What happens when a feature straddles two grid cells?</strong></summary>

A single partition key must be deterministic, so you cannot send one event to two partitions and keep ordering. Reduce the geometry to one representative point and derive a single cell from that point, accepting that a feature spanning a boundary is assigned by where its representative point falls. If consumers genuinely need every touched cell — for fan-out to regional caches — compute the covering set separately and use it for routing hints in the payload, never as the partition key itself.

</details>

<details class="faq">
<summary><strong>Can I change the partition scheme without downtime?</strong></summary>

Yes, with a dual-write cutover. Stamp every event with a scheme version, run the old and new keying side by side, and route consumers to the new topic once its offsets catch up. Never re-hash an existing topic in place: changing the key of in-flight events breaks per-cell ordering guarantees and duplicates spatial state. Treat resolution changes as a new scheme version, because a resolution-6 cell and a resolution-7 cell are different keys even for the same point.

</details>

---

## Related

- [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/) — the parent section covering spatial event modeling, delivery semantics, and pipeline architecture
- [H3 vs S2 vs Quadkey for Spatial Partitioning](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/) — the head-to-head comparison of grid systems as partition keys, with cell geometry and cardinality trade-offs
- [Sensor Data Routing Patterns](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/) — how routing decides which consumers an event reaches before it is partitioned
- [Broker Selection & Partitioning for Spatial Streams](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/) — the broker-side mechanics of mapping keys to Kafka and Redis Streams partitions
- [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/) — detecting hot cells and unbalanced partitions before they cause lag
