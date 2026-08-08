---
title: "Repairing Self-Intersecting Polygons Without Losing Area"
description: "make_valid and buffer(0) resolve a bowtie differently — one keeps both lobes, the other silently discards one. Measure the area change on every repair and reject the ones that lose more than a tolerance."
slug: "repairing-self-intersecting-polygons-without-losing-area"
type: "article"
breadcrumb: "Spatial Payload Routing & Parsing > Geometry Validation Pipelines > Repairing Self-Intersecting Polygons Without Losing Area"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Repairing Self-Intersecting Polygons Without Losing Area",
      "description": "Two standard repairs for a self-intersecting polygon give different answers, and one of them can discard half the shape without raising. This guide compares them, measures the area delta on every repair, and rejects repairs that lose more than a stated tolerance.",
      "url": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/repairing-self-intersecting-polygons-without-losing-area/",
      "datePublished": "2026-08-08",
      "dateModified": "2026-08-08",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Spatial Payload Routing & Parsing", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/"},
        {"@type": "ListItem", "position": 3, "name": "Geometry Validation Pipelines", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/"},
        {"@type": "ListItem", "position": 4, "name": "Repairing Self-Intersecting Polygons Without Losing Area", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/repairing-self-intersecting-polygons-without-losing-area/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Repair a self-intersecting polygon without losing area",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Classify the invalidity before choosing a repair"},
        {"@type": "HowToStep", "position": 2, "name": "Prefer make_valid, which keeps every lobe of a bowtie"},
        {"@type": "HowToStep", "position": 3, "name": "Measure the area delta and reject repairs that lose more than a tolerance"},
        {"@type": "HowToStep", "position": 4, "name": "Record the original alongside the repair, because a repair is an assertion"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is the difference between make_valid and buffer(0)?",
          "acceptedAnswer": {"@type": "Answer", "text": "On a self-intersecting bowtie, make_valid splits the shape into both lobes and returns them as a multipolygon, preserving the whole area. buffer(0) resolves the same shape by even-odd interpretation and typically returns only one lobe, discarding the other silently. Both produce a valid geometry and neither raises, so a pipeline choosing buffer(0) for brevity can lose half of every bowtie it repairs without any signal that it happened."}
        },
        {
          "@type": "Question",
          "name": "Should an invalid geometry ever be repaired automatically?",
          "acceptedAnswer": {"@type": "Answer", "text": "For small artefacts of coordinate precision, yes — a ring that self-touches by a micrometre is a rounding artefact and repairing it is uncontroversial. For a genuine bowtie or a ring wound the wrong way, a repair is an assertion about what the producer meant, and asserting it silently means nobody ever fixes the producer. Repair, but record the delta and the original, and alert when the rate or the magnitude rises."}
        },
        {
          "@type": "Question",
          "name": "Why does the area tolerance have to be relative?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because an absolute tolerance is either meaningless for a country or fatal for a building. One square metre lost from a national boundary is invisible and correct to accept; the same square metre lost from a parking bay is a large fraction of the feature. Express the tolerance as a proportion of the original area, with a small absolute floor so that a near-zero-area sliver does not divide by something close to nothing."}
        }
      ]
    }
  ]
}
</script>

**Prefer `make_valid`, which splits a bowtie into both lobes, over `buffer(0)`, which typically returns one and discards the other — then measure the relative area change on every repair and reject the ones that exceed a tolerance, because both functions return a valid geometry and neither tells you what it threw away.**

This guide sits under [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/), within [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/). It covers the repair step that topic's pipeline invokes once a geometry has been found invalid.

## When to use this pattern

- Producers emit invalid geometry occasionally, which for anything hand-digitised or machine-simplified they do.
- Downstream operations need validity — spatial joins, area calculations, tile generation all misbehave on invalid input.
- Silently changing a feature's extent is unacceptable, which for anything measured it is.

## The two repairs disagree, and only one says so

<figure class="fig">
<svg viewBox="0 0 760 236" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A bowtie polygon repaired by make_valid keeping both lobes and by buffer zero keeping one">
<title>Same input, valid output, half the area</title>
<desc>A bowtie polygon is drawn: a quadrilateral whose ring crosses itself in the middle, producing two triangular lobes of roughly equal area. It is invalid, because a polygon ring may not cross itself. make_valid resolves it by noding the ring at the crossing point and returning both lobes as a multipolygon, so the repaired geometry has the same total area as the two lobes the coordinates describe. buffer with a distance of zero resolves the same shape through an even-odd interpretation of the ring and returns a single polygon containing one lobe, discarding the other. Both results are valid. Neither function raises, warns or returns any indication that a decision was made, so a pipeline that chose buffer zero because it is shorter to type loses half of every bowtie it repairs. The loss shows up much later as an area total that is too small, or as a coverage gap in a region where one producer's digitising tool happens to produce bowties.</desc>
<rect x="0" y="0" width="760" height="236" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">a bowtie: the ring crosses itself, so the polygon is invalid</text>
<text x="40" y="42" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">input</text>
<path d="M40,60 L160,150 L40,150 L160,60 Z" fill="var(--fig-earth)" opacity="0.6" stroke="var(--fig-earth-edge)" stroke-width="1.8"/>
<circle cx="100" cy="105" r="3.5" fill="var(--fig-rose-edge)"/>
<text x="106" y="102" font-size="7.5" fill="var(--fig-rose-edge)">crossing</text>
<text x="40" y="172" font-size="8.5" fill="var(--fig-ink-soft)">two lobes, roughly equal area</text>
<text x="230" y="42" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">make_valid</text>
<path d="M230,60 L290,105 L230,150 Z" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<path d="M350,60 L290,105 L350,150 Z" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="230" y="172" font-size="8.5" fill="var(--fig-mint-edge)">MultiPolygon — both lobes kept</text>
<text x="230" y="186" font-size="8.5" fill="var(--fig-ink-soft)">total area unchanged</text>
<text x="440" y="42" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">buffer(0)</text>
<path d="M440,60 L500,105 L440,150 Z" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<path d="M560,60 L500,105 L560,150 Z" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.4" stroke-dasharray="4 3"/>
<text x="512" y="108" font-size="7.5" fill="var(--fig-rose-edge)">discarded</text>
<text x="440" y="172" font-size="8.5" fill="var(--fig-rose-edge)">Polygon — one lobe</text>
<text x="440" y="186" font-size="8.5" fill="var(--fig-rose-edge)">about half the area, silently</text>
<rect x="600" y="52" width="146" height="120" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="612" y="72" font-size="9" font-weight="600" fill="var(--fig-ink)">both are valid</text>
<text x="612" y="92" font-size="8.5" fill="var(--fig-ink-soft)">neither raises</text>
<text x="612" y="106" font-size="8.5" fill="var(--fig-ink-soft)">neither warns</text>
<text x="612" y="120" font-size="8.5" fill="var(--fig-ink-soft)">neither reports</text>
<text x="612" y="134" font-size="8.5" fill="var(--fig-ink-soft)">what it decided</text>
<text x="612" y="156" font-size="8.5" fill="var(--fig-gold-edge)">so measure it</text>
<rect x="14" y="200" width="732" height="28" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="219" font-size="9" fill="var(--fig-ink-soft)">The loss surfaces later as an area total that is too small, or a coverage gap in whichever region uses the digitising tool that produces bowties.</text>
</svg>
<figcaption><b>Figure 1.</b> Choosing <code>buffer(0)</code> because it is shorter to type is a decision about half the geometry, made without knowing it was a decision.</figcaption>
</figure>

## Complete runnable implementation

```python
from dataclasses import dataclass

from shapely.geometry import GeometryCollection, MultiPolygon, mapping, shape
from shapely.ops import unary_union
from shapely.validation import explain_validity, make_valid

# Relative, because one square metre is nothing on a country and most of a
# parking bay. The absolute floor stops a near-zero-area sliver dividing by
# something close to nothing.
MAX_RELATIVE_AREA_LOSS = 0.001          # 0.1%
ABSOLUTE_AREA_FLOOR = 1e-14             # square degrees


class UnrepairableGeometry(Exception):
    """The repair changed the feature more than a repair is allowed to."""

    def __init__(self, reason: str, relative_loss: float) -> None:
        super().__init__(f"{reason} (relative area change {relative_loss:.4%})")
        self.relative_loss = relative_loss


@dataclass(frozen=True, slots=True)
class Repair:
    geometry: dict
    was_valid: bool
    reason: str | None
    relative_area_change: float


def _polygonal(geom):
    """make_valid can return a GeometryCollection with stray lines in it.

    Keeping those produces a geometry whose area is right and whose type
    breaks the next operation that assumes polygons.
    """
    if isinstance(geom, GeometryCollection):
        parts = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        return unary_union(parts) if parts else geom
    return geom


def repair(geometry: dict,
           max_loss: float = MAX_RELATIVE_AREA_LOSS) -> Repair:
    """Repair an invalid polygon, refusing repairs that change its extent.

    A repair is an assertion about what the producer meant. Making it
    silently means nobody ever fixes the producer.
    """
    original = shape(geometry)

    if original.is_valid:
        return Repair(geometry, True, None, 0.0)

    reason = explain_validity(original)
    # make_valid, NOT buffer(0): the latter resolves a bowtie by even-odd
    # interpretation and returns one lobe.
    repaired = _polygonal(make_valid(original))

    before = original.area
    after = repaired.area
    denominator = max(before, ABSOLUTE_AREA_FLOOR)
    change = abs(after - before) / denominator

    if change > max_loss:
        raise UnrepairableGeometry(reason, change)

    if repaired.is_empty:
        raise UnrepairableGeometry(f"{reason}; repair produced an empty geometry", 1.0)

    return Repair(mapping(repaired), False, reason, change)
```

Note that `original.area` on an invalid polygon is itself unreliable — a self-intersecting ring's area is computed by the shoelace formula, which subtracts the lobe wound the other way. That is precisely why the comparison is worth making: a bowtie whose lobes are equal has an original area near zero, so almost any repair exceeds the tolerance and the geometry is rejected rather than quietly reinterpreted.

<figure class="fig">
<svg viewBox="0 0 760 214" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Three classes of invalidity and whether automatic repair is appropriate for each">
<title>Not every invalidity deserves the same answer</title>
<desc>Three kinds of invalid polygon are separated by what caused them. A ring that self-touches by a micrometre is an artefact of coordinate precision — the producer meant a simple polygon and floating-point rounding produced a degenerate touch. Repairing it changes the area by a negligible fraction and is uncontroversial; automating it is correct. A duplicate consecutive vertex or a ring not explicitly closed is a serialisation defect rather than a geometric one, again safe to repair automatically and worth counting so the producer can be told. A genuine bowtie is different in kind: the coordinates describe two lobes and there is no way to know whether the producer meant both, one, or something else entirely. Repairing it automatically asserts an answer to that question, and asserting it silently means the producer is never fixed and the assertion is never reviewed. The area-change tolerance is what separates the first two classes from the third without needing to classify them by name, because the first two barely move the area and the third moves it a great deal.</desc>
<rect x="0" y="0" width="760" height="214" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">what caused the invalidity decides whether repairing it is safe</text>
<rect x="14" y="30" width="238" height="128" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">micrometre self-touch</text>
<text x="26" y="70" font-size="8.5" fill="var(--fig-ink-soft)">a coordinate-precision artefact</text>
<text x="26" y="86" font-size="8.5" fill="var(--fig-ink-soft)">the producer meant a simple polygon</text>
<text x="26" y="106" font-size="8.5" fill="var(--fig-mint-edge)">area change: negligible</text>
<text x="26" y="126" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">repair automatically</text>
<text x="26" y="146" font-size="8.5" fill="var(--fig-ink-soft)">no decision is being made</text>
<rect x="262" y="30" width="238" height="128" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="274" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">duplicate vertex · unclosed ring</text>
<text x="274" y="70" font-size="8.5" fill="var(--fig-ink-soft)">a serialisation defect, not a</text>
<text x="274" y="82" font-size="8.5" fill="var(--fig-ink-soft)">geometric one</text>
<text x="274" y="106" font-size="8.5" fill="var(--fig-gold-edge)">area change: none</text>
<text x="274" y="126" font-size="9" font-weight="600" fill="var(--fig-gold-edge)">repair, and count it</text>
<text x="274" y="146" font-size="8.5" fill="var(--fig-ink-soft)">the producer can be told, and fixed</text>
<rect x="510" y="30" width="236" height="128" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="522" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">genuine bowtie</text>
<text x="522" y="70" font-size="8.5" fill="var(--fig-ink-soft)">the coordinates describe two lobes</text>
<text x="522" y="86" font-size="8.5" fill="var(--fig-ink-soft)">did the producer mean both? one?</text>
<text x="522" y="106" font-size="8.5" fill="var(--fig-rose-edge)">area change: large</text>
<text x="522" y="126" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">reject — do not assert an answer</text>
<text x="522" y="146" font-size="8.5" fill="var(--fig-ink-soft)">silently asserting it means nobody reviews it</text>
<rect x="14" y="170" width="732" height="34" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="189" font-size="9" fill="var(--fig-ink-soft)">The area tolerance separates these three without needing to classify them by name: the first two barely move the area and</text>
<text x="26" y="200" font-size="9" fill="var(--fig-ink-soft)">the third moves it a great deal. One threshold, and it is expressed in the units the feature is actually measured in.</text>
</svg>
<figcaption><b>Figure 2.</b> The tolerance does the classification for you, which matters because <code>explain_validity</code> returns a message rather than a category.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `MAX_RELATIVE_AREA_LOSS` | `float` | Proportion, not an absolute area — a country and a parking bay differ | `0.001` |
| `ABSOLUTE_AREA_FLOOR` | `float` | Stops a near-zero-area sliver dividing by nothing | `1e-14` |
| Repair function | — | `make_valid`; `buffer(0)` discards bowtie lobes | `make_valid` |
| `_polygonal` | call | Strips stray lines from a returned GeometryCollection | — |
| `explain_validity` | `str` | Recorded on the event, so producers can be told what they emit | — |
| Area CRS | — | Equal-area projection when the tolerance must mean square metres | — |

</div>

## Gotchas and spatial edge cases

1. **`make_valid` can change the geometry type.** A repaired polygon may come back as a MultiPolygon, or as a GeometryCollection containing polygons plus dangling lines from a degenerate spike. Code downstream that assumes `Polygon` breaks on the first repaired feature, and the stray lines have zero area so the tolerance check does not notice them — hence the explicit filter.

2. **The area of an invalid polygon is not what it looks like.** The shoelace formula subtracts area enclosed with the opposite winding, so a symmetric bowtie has an area near zero. Treating that as the "before" figure is correct here — it makes the tolerance reject the shape — but it means the reported relative change is not a physical quantity and should not be graphed as one.

3. **Areas in EPSG:4326 are in square degrees.** A relative tolerance is unaffected by that, because both sides of the ratio use the same units, which is another reason to express it relatively. If the tolerance ever needs to be absolute, reproject first as [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) describes.

4. **Ring winding order is not a validity question.** RFC 7946 specifies counter-clockwise exterior rings, but a clockwise ring is still a valid polygon to Shapely — `is_valid` returns true and nothing repairs it. Winding must be normalised separately, and it matters because some consumers interpret a reversed exterior ring as a hole.

5. **Repair before any spatial predicate, not after.** `intersects`, `contains` and `intersection` on an invalid geometry return results that are wrong rather than erroneous, so a validation stage placed after routing has already let the bad answers through.

6. **Count repairs by producer and alert on the rate.** A repair is a message about the source system, and the only way anybody acts on it is if the rate is visible per producer — see [Tracking Geometry Validation Failure Rate with Prometheus](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/tracking-geometry-validation-failure-rate-with-prometheus/).

<figure class="fig">
<svg viewBox="0 0 760 188" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="make_valid returning a GeometryCollection containing a polygon and a zero-area spike line">
<title>The repair can return something that is not a polygon</title>
<desc>A polygon with a degenerate spike — a vertex path that runs out and back along the same line — is repaired. make_valid resolves the ring correctly but the spike has no area, so it cannot be part of a polygon; the result is a GeometryCollection containing the repaired polygon and a LineString for the spike. The area is exactly right, so the tolerance check passes and the repair is accepted. Downstream, anything that assumes a Polygon or MultiPolygon now meets a collection: a spatial join may silently skip it, a tile renderer may draw the line, and a later union carries the line forward into the stored geometry where it will confuse the next area calculation. Because the stray part has zero area, no area-based check can ever detect it. Filtering the collection to its polygonal parts before returning is the only step that catches it, and it has to be explicit because both the repair and the tolerance check consider the result correct.</desc>
<rect x="0" y="0" width="760" height="188" fill="var(--fig-bg)"/>
<defs><marker id="gv3-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">a polygon with a degenerate spike</text>
<path d="M40,40 L40,110 L110,110 L110,60 L110,110 L170,110 L170,40 Z" fill="var(--fig-earth)" opacity="0.6" stroke="var(--fig-earth-edge)" stroke-width="1.6"/>
<text x="116" y="56" font-size="7.5" fill="var(--fig-rose-edge)">spike</text>
<line x1="186" y1="76" x2="216" y2="76" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#gv3-a)"/>
<text x="188" y="68" font-size="8" fill="var(--fig-ink-soft)">make_valid</text>
<rect x="240" y="34" width="200" height="86" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="252" y="54" font-size="9" font-weight="600" fill="var(--fig-ink)">GeometryCollection</text>
<text x="252" y="74" font-size="8.5" fill="var(--fig-ink-soft)">Polygon — the repaired shape</text>
<text x="252" y="90" font-size="8.5" fill="var(--fig-rose-edge)">LineString — the spike, zero area</text>
<text x="252" y="110" font-size="8.5" fill="var(--fig-ink-soft)">area is exactly right, so the tolerance passes</text>
<rect x="456" y="34" width="290" height="86" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="468" y="54" font-size="9" font-weight="600" fill="var(--fig-ink)">what it breaks downstream</text>
<text x="468" y="74" font-size="8.5" fill="var(--fig-ink-soft)">a spatial join may silently skip a collection</text>
<text x="468" y="90" font-size="8.5" fill="var(--fig-ink-soft)">a renderer may draw the line</text>
<text x="468" y="110" font-size="8.5" fill="var(--fig-rose-edge)">a later union carries it into the stored geometry</text>
<text x="14" y="146" font-size="9" fill="var(--fig-ink-soft)">The stray part has zero area, so no area-based check can detect it. Filtering to the polygonal parts is the only step that</text>
<text x="14" y="160" font-size="9" fill="var(--fig-ink-soft)">catches it — and it has to be explicit, because both the repair and the tolerance check consider this result correct.</text>
<text x="14" y="180" font-size="9" fill="var(--fig-mint-edge)">A repair that changes the geometry TYPE is a different kind of change from one that changes its extent, and needs its own guard.</text>
</svg>
<figcaption><b>Figure 3.</b> The tolerance check guards extent, not type. Both need guarding, and only one of them is obvious from the failure it prevents.</figcaption>
</figure>

## Verification

```python
import pytest
from shapely.geometry import Polygon, mapping, shape

BOWTIE = mapping(Polygon([(0, 0), (10, 10), (0, 10), (10, 0), (0, 0)]))
NICKED = mapping(Polygon([(0, 0), (0, 10), (10, 10), (10, 0),
                          (5, 1e-9), (0, 0)]))       # micrometre self-touch


def test_bowtie_is_rejected_not_halved():
    """The failure buffer(0) produces silently."""
    with pytest.raises(UnrepairableGeometry):
        repair(BOWTIE)


def test_buffer_zero_would_have_lost_a_lobe():
    """Documented in executable form, so nobody 'simplifies' the repair."""
    both = shape(mapping(shape(BOWTIE).buffer(0)))
    from shapely.validation import make_valid
    kept = make_valid(shape(BOWTIE))
    assert kept.area > both.area * 1.5


def test_precision_artefact_is_repaired_quietly():
    result = repair(NICKED)
    assert result.was_valid is False
    assert result.relative_area_change < 1e-6
    assert shape(result.geometry).is_valid


def test_valid_geometry_passes_through_unchanged():
    square = mapping(Polygon([(0, 0), (0, 1), (1, 1), (1, 0)]))
    result = repair(square)
    assert result.was_valid and result.geometry == square


def test_repair_never_returns_a_geometry_collection():
    """Stray lines have zero area, so the tolerance does not catch them."""
    spiked = mapping(Polygon([(0, 0), (0, 10), (5, 10), (5, 20),
                              (5, 10), (10, 10), (10, 0)]))
    result = repair(spiked, max_loss=1.0)
    assert shape(result.geometry).geom_type in ("Polygon", "MultiPolygon")
```

The second test asserts something about code the pipeline deliberately does not use. It is there so that the next person who replaces `make_valid` with the shorter `buffer(0)` sees the consequence in a failing test rather than in an area report six months later.

## Related

- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — the topic this guide belongs to, and where this repair sits in the pipeline
- [Tracking Geometry Validation Failure Rate with Prometheus](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/tracking-geometry-validation-failure-rate-with-prometheus/) — making the repair rate visible per producer
- [Merging Overlapping Zone Edits with Shapely](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/merging-overlapping-zone-edits-with-shapely/) — another caller of `make_valid`, and why it repairs after the booleans
- [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) — reprojecting before measuring, when the tolerance has to mean metres
