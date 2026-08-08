---
title: "Scoping Tile Invalidation to the Zoom Levels That Changed"
description: "A one-metre vertex nudge is invisible above zoom 16, so invalidating every zoom rebuilds thousands of identical tiles. Derive the minimum zoom from the change's ground distance and invalidate only from there down."
slug: "scoping-tile-invalidation-to-the-zoom-levels-that-changed"
type: "article"
breadcrumb: "Core Event Fundamentals & Architecture > Tile Update Event Pipelines > Scoping Tile Invalidation to the Zoom Levels That Changed"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Scoping Tile Invalidation to the Zoom Levels That Changed",
      "description": "Invalidating every zoom level for every feature edit rebuilds thousands of tiles that would render identically. This guide derives the shallowest zoom at which a change is visible from its ground distance and the layer's simplification tolerance, and invalidates only from that zoom down.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/scoping-tile-invalidation-to-the-zoom-levels-that-changed/",
      "datePublished": "2026-08-08",
      "dateModified": "2026-08-08",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Core Event Fundamentals & Architecture", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/"},
        {"@type": "ListItem", "position": 3, "name": "Tile Update Event Pipelines", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/"},
        {"@type": "ListItem", "position": 4, "name": "Scoping Tile Invalidation to the Zoom Levels That Changed", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/scoping-tile-invalidation-to-the-zoom-levels-that-changed/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Scope tile invalidation to the zoom levels a change is visible at",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Measure the ground distance of the change, not its bounding box"},
        {"@type": "HowToStep", "position": 2, "name": "Convert that distance to the shallowest zoom where it exceeds a pixel"},
        {"@type": "HowToStep", "position": 3, "name": "Clamp against the layer's simplification tolerance and its own min zoom"},
        {"@type": "HowToStep", "position": 4, "name": "Invalidate from that zoom down, over the union of before and after"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How do I know which zoom a change first becomes visible at?",
          "acceptedAnswer": {"@type": "Answer", "text": "Compare the change's ground distance against the ground resolution of a pixel at each zoom. At the equator a Web Mercator pixel covers about 156 543 metres divided by two to the power of the zoom, so at zoom 14 it is roughly 9.5 metres and at zoom 18 roughly 0.6 metres. A change of one metre cannot alter a rendered pixel until the pixel is smaller than a metre, which is zoom 18 and deeper. Latitude scales this by the cosine of the latitude, so the same change becomes visible one zoom shallower at 60 degrees north."}
        },
        {
          "@type": "Question",
          "name": "Does simplification change the answer?",
          "acceptedAnswer": {"@type": "Answer", "text": "Yes, and it usually dominates. Vector tile pipelines simplify geometry per zoom, so a layer simplified to a five-metre tolerance at zoom 12 discards a two-metre vertex move entirely — the tile is byte-identical whether or not the edit happened. The visible zoom is therefore the deeper of the pixel-size answer and the simplification answer, and using only the pixel-size one still rebuilds tiles that cannot possibly differ."}
        },
        {
          "@type": "Question",
          "name": "Is it safe to skip shallow zooms if a feature was added or deleted?",
          "acceptedAnswer": {"@type": "Answer", "text": "No. Adding or removing a feature changes what is present rather than where it is, and presence is visible at every zoom the layer renders at — including ones where the geometry would be a single pixel. Treat insert and delete as full-depth invalidations and apply the zoom scoping only to updates, where the before and after geometries both exist and can be compared."}
        }
      ]
    }
  ]
}
</script>

**Derive the shallowest zoom from the change's ground distance and the layer's simplification tolerance, then invalidate only from that zoom down — a one-metre vertex nudge cannot alter a pixel until the pixel is smaller than a metre, so invalidating zoom 0 through 20 rebuilds thousands of tiles that will render byte-identical.**

This guide sits under [Tile Update Event Pipelines](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/), within [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/). It assumes the change event carries both the previous and the current geometry, as produced by [Capturing PostGIS Changes with Logical Replication](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/capturing-postgis-changes-with-logical-replication/).

## When to use this pattern

- Tile rebuilds are a measurable cost, either in compute or in the cache invalidation waves they send to clients.
- Most edits are small: attribute changes, vertex nudges, minor reshaping. If every edit moves a feature a kilometre, the scoping saves nothing.
- The tile pipeline simplifies per zoom, which is where most of the saving comes from.

## The arithmetic of a pixel

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ground resolution per pixel at several zoom levels against three edit sizes">
<title>What a pixel is worth at each zoom</title>
<desc>Ground resolution per pixel is listed for six zoom levels at the equator: about twenty-four hundred metres at zoom 6, one hundred and fifty-three metres at zoom 10, nine and a half metres at zoom 14, two and four tenths metres at zoom 16, six tenths of a metre at zoom 18, and fifteen centimetres at zoom 20. Three edits are placed against that scale. A one-metre vertex nudge is smaller than a pixel until zoom 18, so tiles at zoom 17 and shallower cannot differ. A forty-metre building extension first exceeds a pixel around zoom 12. A two-kilometre boundary correction is visible from zoom 7 downward, which is nearly the whole pyramid. Invalidating every zoom for the first case rebuilds every tile from 0 to 17 for no possible visual difference, and because the tile count per zoom quadruples with depth, most of the wasted work is concentrated in the deepest wasted level rather than spread evenly.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">metres per pixel at the equator, and what each edit can reach</text>
<text x="30" y="42" font-size="8.5" font-weight="600" fill="var(--fig-ink-soft)">z6</text>
<text x="140" y="42" font-size="8.5" font-weight="600" fill="var(--fig-ink-soft)">z10</text>
<text x="270" y="42" font-size="8.5" font-weight="600" fill="var(--fig-ink-soft)">z14</text>
<text x="400" y="42" font-size="8.5" font-weight="600" fill="var(--fig-ink-soft)">z16</text>
<text x="530" y="42" font-size="8.5" font-weight="600" fill="var(--fig-ink-soft)">z18</text>
<text x="660" y="42" font-size="8.5" font-weight="600" fill="var(--fig-ink-soft)">z20</text>
<text x="30" y="58" font-size="8.5" fill="var(--fig-ink-soft)">2 446 m</text>
<text x="140" y="58" font-size="8.5" fill="var(--fig-ink-soft)">153 m</text>
<text x="270" y="58" font-size="8.5" fill="var(--fig-ink-soft)">9.6 m</text>
<text x="400" y="58" font-size="8.5" fill="var(--fig-ink-soft)">2.4 m</text>
<text x="530" y="58" font-size="8.5" fill="var(--fig-ink-soft)">0.60 m</text>
<text x="660" y="58" font-size="8.5" fill="var(--fig-ink-soft)">0.15 m</text>
<line x1="24" y1="68" x2="740" y2="68" stroke="var(--fig-line)" stroke-width="1.2"/>
<rect x="24" y="78" width="500" height="34" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="34" y="99" font-size="8.5" fill="var(--fig-ink-soft)">1 m vertex nudge — below a pixel here; no tile can differ</text>
<rect x="528" y="78" width="212" height="34" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="538" y="99" font-size="8.5" fill="var(--fig-mint-edge)">visible from z18 down — invalidate only here</text>
<rect x="24" y="118" width="220" height="34" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="34" y="139" font-size="8.5" fill="var(--fig-ink-soft)">40 m extension — below a pixel</text>
<rect x="248" y="118" width="492" height="34" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="258" y="139" font-size="8.5" fill="var(--fig-mint-edge)">visible from about z12 down</text>
<rect x="24" y="158" width="86" height="34" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="34" y="179" font-size="8.5" fill="var(--fig-ink-soft)">2 km fix</text>
<rect x="114" y="158" width="626" height="34" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="124" y="179" font-size="8.5" fill="var(--fig-mint-edge)">visible from about z7 down — nearly the whole pyramid, and correctly so</text>
<text x="14" y="212" font-size="9" fill="var(--fig-ink-soft)">Tile count per zoom quadruples with depth, so most of the waste in the first row sits in the single deepest wasted level.</text>
</svg>
<figcaption><b>Figure 1.</b> The three rows need completely different treatment, and a pipeline invalidating 0–20 for all of them treats them identically.</figcaption>
</figure>

## Complete runnable implementation

```python
import math

import mercantile
from shapely.geometry import shape
from shapely.ops import transform

EARTH_CIRCUMFERENCE_M = 40_075_016.686
TILE_PIXELS = 512                     # 256 for classic raster tiles
MAX_ZOOM = 20

# Per-zoom simplification tolerance in metres, as configured in the tile
# pipeline. Usually the dominant term: a change below the tolerance is
# discarded during tile generation, so the tile is byte-identical.
SIMPLIFY_TOLERANCE_M = {
    z: max(0.5, 2 ** (16 - z)) for z in range(0, MAX_ZOOM + 1)
}


def metres_per_pixel(zoom: int, latitude: float) -> float:
    """Web Mercator ground resolution, corrected for latitude.

    The cosine term matters: the same edit becomes visible a zoom level
    shallower at 60 degrees north than it does at the equator.
    """
    return (EARTH_CIRCUMFERENCE_M * math.cos(math.radians(latitude))
            / (TILE_PIXELS * 2 ** zoom))


def change_magnitude_m(before: dict, after: dict, latitude: float) -> float:
    """Largest ground distance any part of the geometry moved.

    Hausdorff distance, not centroid distance: a symmetric reshaping moves
    the boundary metres while leaving the centroid exactly where it was.
    """
    a, b = shape(before), shape(after)
    degrees = a.hausdorff_distance(b)
    return degrees * (EARTH_CIRCUMFERENCE_M / 360.0) * math.cos(math.radians(latitude))


def min_visible_zoom(before: dict, after: dict, latitude: float,
                     layer_min_zoom: int = 0) -> int | None:
    """Shallowest zoom at which this change can alter a rendered tile.

    Returns None when the change is invisible everywhere — which happens more
    often than people expect, and is the case worth short-circuiting.
    """
    magnitude = change_magnitude_m(before, after, latitude)
    if magnitude == 0.0:
        return None

    for zoom in range(layer_min_zoom, MAX_ZOOM + 1):
        # Both conditions must hold: bigger than a pixel AND surviving
        # simplification. The second usually binds first.
        if (magnitude >= metres_per_pixel(zoom, latitude)
                and magnitude >= SIMPLIFY_TOLERANCE_M[zoom]):
            return zoom
    return None


def tiles_to_invalidate(event: dict, layer_min_zoom: int = 0):
    """Yield every tile that could render differently after this change."""
    action = event["action"]
    before, after = event.get("previous_geometry"), event.get("geometry")

    # Presence is visible at every zoom, so an insert or a delete is always
    # a full-depth invalidation regardless of how small the geometry is.
    if action in ("insert", "delete") or before is None or after is None:
        start = layer_min_zoom
    else:
        start = min_visible_zoom(before, after, _latitude(after), layer_min_zoom)
        if start is None:
            return

    for geometry in (g for g in (before, after) if g):
        west, south, east, north = shape(geometry).bounds
        for zoom in range(start, MAX_ZOOM + 1):
            yield from mercantile.tiles(west, south, east, north, zoom)


def _latitude(geometry: dict) -> float:
    _, south, _, north = shape(geometry).bounds
    return (south + north) / 2.0
```

Iterating over the two geometries separately rather than their union is deliberate: a feature that moved five kilometres has a combined envelope covering everything in between, most of which is untouched.

<figure class="fig">
<svg viewBox="0 0 760 214" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Tiles invalidated for a small edit under a full-depth policy versus a zoom-scoped one">
<title>Where the rebuild cost actually is</title>
<desc>A one-metre vertex nudge inside a single city block is invalidated two ways. Under a full-depth policy every zoom from zero to twenty is invalidated over the feature's bounding box, and because the number of tiles covering a fixed area quadruples with each zoom level, the total is dominated by the deepest levels — roughly ninety percent of the tiles come from the last two zooms alone, and every tile above zoom eighteen would have rendered identically. Under the zoom-scoped policy only zoom eighteen through twenty are invalidated, which is a small fraction of the tiles and, crucially, exactly the tiles that can actually differ. The saving is not the ratio of levels — three out of twenty-one — because levels are not equal in size; it is better than that at shallow zooms and worse than it sounds at deep ones, and the honest summary is that the policy removes work that provably changes nothing rather than work that is merely unlikely to matter.</desc>
<rect x="0" y="0" width="760" height="214" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one 1 m vertex nudge inside a single city block</text>
<text x="14" y="40" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">invalidate every zoom (0–20)</text>
<rect x="220" y="28" width="14" height="16" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="238" y="28" width="18" height="16" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="260" y="28" width="26" height="16" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="290" y="28" width="42" height="16" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="336" y="28" width="74" height="16" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="414" y="28" width="130" height="16" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="548" y="28" width="192" height="16" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="220" y="60" font-size="8.5" fill="var(--fig-rose-edge)">tile count per zoom quadruples with depth — the last two levels are ~90% of the work</text>
<text x="220" y="74" font-size="8.5" fill="var(--fig-rose-edge)">and every level above z18 renders byte-identical</text>
<text x="14" y="106" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">invalidate from the visible zoom down (18–20)</text>
<rect x="548" y="94" width="192" height="16" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="220" y="126" font-size="8.5" fill="var(--fig-mint-edge)">exactly the tiles that can differ · nothing that provably cannot</text>
<rect x="14" y="146" width="732" height="56" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="165" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Be honest about the saving</text>
<text x="26" y="183" font-size="9" fill="var(--fig-ink-soft)">It is not 3-in-21, because zoom levels are not equal in size. For a small edit the removed work is mostly shallow tiles, which</text>
<text x="26" y="196" font-size="9" fill="var(--fig-ink-soft)">are few but are shared by every viewer — so the cache-invalidation saving is far larger than the compute saving.</text>
</svg>
<figcaption><b>Figure 2.</b> The compute saving is modest for deep edits; the saving that matters is not re-invalidating the shallow tiles that every viewer of the region has cached.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `TILE_PIXELS` | `int` | 512 for vector tiles, 256 for classic raster; wrong value shifts every zoom by one | `512` |
| `SIMPLIFY_TOLERANCE_M` | `dict[int, float]` | Must mirror the tile generator's actual configuration | per zoom |
| `MAX_ZOOM` | `int` | The deepest zoom the pipeline generates, not the deepest the client requests | `20` |
| `layer_min_zoom` | `int` | Layers hidden above a zoom need no invalidation there | `0` |
| Distance measure | — | Hausdorff, not centroid — a symmetric reshape leaves the centroid still | — |
| Insert / delete | — | Always full depth; presence is visible at every zoom | — |

</div>

## Gotchas and spatial edge cases

1. **Centroid distance reports zero for a real change.** A polygon reshaped symmetrically — two opposite edges pushed out by ten metres each — has the same centroid and a very different outline. Hausdorff distance measures the largest displacement of any boundary point, which is what a renderer draws.

2. **`SIMPLIFY_TOLERANCE_M` has to mirror the tile generator, not approximate it.** If the generator simplifies at five metres and this table says two, the scoping skips zooms that genuinely changed, and the resulting stale tile is indistinguishable from a caching bug. Read both from the same configuration source.

3. **An attribute-only change still needs invalidation where the attribute is rendered.** Changing a road's classification moves no vertex, so `change_magnitude_m` returns zero and the function returns `None` — but the tile styles that road differently. Handle attribute changes on their own path, scoped by which zooms render the changed attribute.

4. **Latitude matters more than people expect.** At 60° north a Web Mercator pixel covers half the ground it does at the equator, so a change becomes visible one full zoom level shallower. Omitting the cosine term under-invalidates in exactly the northern cities where most editing happens.

5. **A feature that moved far should not invalidate the corridor between.** Bounding the union of before and after covers every tile in between; iterate over the two geometries separately, as the implementation does, or a vehicle depot relocation invalidates a county.

6. **Labels and halos extend beyond the geometry's bounds.** A renamed feature can change pixels in the neighbouring tile because its label overflows the tile edge. If the layer draws labels, buffer the invalidation area by the maximum label extent, which is a style property rather than a geometric one.

<figure class="fig">
<svg viewBox="0 0 760 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A feature moving far, with the union envelope covering a corridor of untouched tiles">
<title>Union the geometries, not their envelope</title>
<desc>A depot feature is relocated forty kilometres across a county. Its previous position sits in the north-west and its new one in the south-east. Taking the bounding box of the union of the two geometries produces a rectangle spanning the whole diagonal, and invalidating every tile inside that rectangle at every visible zoom touches thousands of tiles across a corridor where nothing changed at all — farmland, a river, three villages, none of which contain the feature before or after. Iterating over the two geometries separately and invalidating each one's own footprint touches only the tiles that actually held the feature and the ones that now do. The saving grows with the distance moved, which means it is largest exactly when the naive version is most expensive, and the difference is invisible in testing because a test fixture that moves a feature a few metres produces identical results either way.</desc>
<rect x="0" y="0" width="760" height="200" fill="var(--fig-bg)"/>
<g stroke="var(--fig-line-soft)" stroke-width="1" fill="none">
<rect x="30" y="30" width="340" height="140"/>
<line x1="98" y1="30" x2="98" y2="170"/><line x1="166" y1="30" x2="166" y2="170"/><line x1="234" y1="30" x2="234" y2="170"/><line x1="302" y1="30" x2="302" y2="170"/>
<line x1="30" y1="65" x2="370" y2="65"/><line x1="30" y1="100" x2="370" y2="100"/><line x1="30" y1="135" x2="370" y2="135"/>
</g>
<rect x="30" y="30" width="340" height="140" fill="var(--fig-rose)" opacity="0.45"/>
<rect x="34" y="34" width="60" height="28" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.4"/>
<rect x="306" y="138" width="60" height="28" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="36" y="188" font-size="8.5" fill="var(--fig-rose-edge)">envelope of the union — thousands of untouched tiles invalidated</text>
<rect x="404" y="30" width="342" height="140" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="416" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">iterate the two geometries separately</text>
<text x="416" y="72" font-size="8.5" fill="var(--fig-ink-soft)">invalidate the tiles the feature held, and those it now holds</text>
<text x="416" y="88" font-size="8.5" fill="var(--fig-ink-soft)">nothing in the corridor between them is touched</text>
<text x="416" y="112" font-size="8.5" fill="var(--fig-mint-edge)">the saving grows with the distance moved — largest exactly</text>
<text x="416" y="126" font-size="8.5" fill="var(--fig-mint-edge)">where the naive version is most expensive</text>
<text x="416" y="150" font-size="8.5" fill="var(--fig-ink-soft)">invisible in testing: a fixture that moves a feature a few metres</text>
<text x="416" y="162" font-size="8.5" fill="var(--fig-ink-soft)">gives identical results either way</text>
</svg>
<figcaption><b>Figure 3.</b> Zoom scoping and area scoping are independent decisions, and getting the first right while leaving the second as an envelope keeps most of the waste.</figcaption>
</figure>

## Verification

```python
import pytest
from shapely.geometry import Polygon, mapping

BLOCK = Polygon([(13.4000, 52.5200), (13.4000, 52.5210),
                 (13.4015, 52.5210), (13.4015, 52.5200)])


def nudged(metres: float) -> dict:
    """Move one vertex by roughly `metres` at this latitude."""
    delta = metres / 111_320.0
    coords = list(BLOCK.exterior.coords)
    coords[2] = (coords[2][0] + delta, coords[2][1])
    return mapping(Polygon(coords))


def test_one_metre_nudge_is_invisible_until_deep_zoom():
    z = min_visible_zoom(mapping(BLOCK), nudged(1.0), latitude=52.52)
    assert z is not None and z >= 17


def test_forty_metre_change_is_visible_much_shallower():
    z = min_visible_zoom(mapping(BLOCK), nudged(40.0), latitude=52.52)
    assert z is not None and z <= 13


def test_identical_geometry_invalidates_nothing():
    assert min_visible_zoom(mapping(BLOCK), mapping(BLOCK), latitude=52.52) is None


def test_symmetric_reshape_is_not_missed():
    """Centroid distance would report zero here."""
    coords = list(BLOCK.exterior.coords)
    d = 10.0 / 111_320.0
    coords[0] = (coords[0][0] - d, coords[0][1])
    coords[2] = (coords[2][0] + d, coords[2][1])
    reshaped = mapping(Polygon(coords))
    assert min_visible_zoom(mapping(BLOCK), reshaped, latitude=52.52) is not None


def test_insert_invalidates_every_zoom():
    event = {"action": "insert", "geometry": mapping(BLOCK), "previous_geometry": None}
    zooms = {t.z for t in tiles_to_invalidate(event)}
    assert min(zooms) == 0
```

The symmetric-reshape test is the one that fails if someone replaces the Hausdorff call with a centroid comparison for speed — a change that looks harmless, passes the other four tests, and silently stops invalidating any edit that preserves a feature's centre.

## Related

- [Tile Update Event Pipelines](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/) — the topic this guide belongs to
- [Debouncing Rapid Feature Edits](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/debouncing-rapid-feature-edits/) — collapsing the burst before any of this arithmetic runs
- [An Error-Budget Policy for Tile Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/an-error-budget-policy-for-tile-pipelines/) — deciding what to do when the rebuild queue cannot keep up anyway
- [Capturing PostGIS Changes with Logical Replication](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/capturing-postgis-changes-with-logical-replication/) — where the previous geometry this comparison needs comes from
