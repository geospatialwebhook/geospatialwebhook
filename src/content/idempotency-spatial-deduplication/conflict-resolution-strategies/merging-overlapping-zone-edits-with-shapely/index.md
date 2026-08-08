---
title: "Merging Overlapping Zone Edits with Shapely"
description: "Resolve two concurrent edits to the same zone by three-way merge against their common ancestor: union what each added, subtract what each removed, and refuse to merge when both changed the same ground."
slug: "merging-overlapping-zone-edits-with-shapely"
type: "article"
breadcrumb: "Idempotency & Spatial Deduplication > Conflict Resolution Strategies > Merging Overlapping Zone Edits with Shapely"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Merging Overlapping Zone Edits with Shapely",
      "description": "Taking the union of two concurrent zone edits silently restores areas that one editor deliberately removed. This guide implements a three-way geometric merge against the common ancestor, and refuses rather than guessing when both edits changed the same ground.",
      "url": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/merging-overlapping-zone-edits-with-shapely/",
      "datePublished": "2026-08-08",
      "dateModified": "2026-08-08",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Idempotency & Spatial Deduplication", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/"},
        {"@type": "ListItem", "position": 3, "name": "Conflict Resolution Strategies", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/"},
        {"@type": "ListItem", "position": 4, "name": "Merging Overlapping Zone Edits with Shapely", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/merging-overlapping-zone-edits-with-shapely/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Merge two concurrent zone edits geometrically",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Recover the common ancestor both edits branched from"},
        {"@type": "HowToStep", "position": 2, "name": "Compute what each edit added and removed relative to it"},
        {"@type": "HowToStep", "position": 3, "name": "Refuse the merge where one edit's addition meets the other's removal"},
        {"@type": "HowToStep", "position": 4, "name": "Apply both additions and both removals, then repair the result"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why is the union of two edits the wrong merge?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because a union cannot express removal. If one editor extended a zone northwards and another trimmed its southern edge, the union restores the trimmed area: the second editor's work is not merely lost but actively undone, and the result is a zone that neither editor produced and neither would approve. A union is only correct when both edits are purely additive, which is a property that has to be checked rather than assumed."}
        },
        {
          "@type": "Question",
          "name": "What is the common ancestor and where does it come from?",
          "acceptedAnswer": {"@type": "Answer", "text": "It is the version of the geometry both editors loaded before making their changes, and it has to be stored deliberately — either by keeping every version, or by keeping the geometry each edit was based on alongside the edit. Without it there is no way to distinguish an area one editor added from an area the other removed, because both appear simply as a difference between two shapes."}
        },
        {
          "@type": "Question",
          "name": "When should the merge refuse rather than produce a result?",
          "acceptedAnswer": {"@type": "Answer", "text": "When one edit's addition intersects the other's removal by more than a tolerance. That is the geometric equivalent of two people editing the same line of a file: both made a deliberate decision about the same ground and they disagree, so any automatic answer is a guess that will be wrong for one of them. Route it to a human or to an application rule that knows which editor has authority over that area."}
        }
      ]
    }
  ]
}
</script>

**Recover the version both editors branched from, compute each edit's additions and removals against it, and refuse the merge where one edit's addition meets the other's removal — a union cannot express removal, so it silently restores the area an editor deliberately trimmed and produces a zone neither of them made.**

This guide sits under [Conflict Resolution Strategies](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/), within [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/). It is the resolution step invoked when [Implementing a Version Vector for Spatial Features](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/implementing-a-version-vector-for-spatial-features/) classifies two edits as concurrent.

## When to use this pattern

- Two concurrent edits to the same polygon have been detected, and discarding one is not acceptable.
- The common ancestor is available, which means the pipeline stored it deliberately.
- The zone is a coverage area, a service region or a delivery boundary — something where the union of two extensions is meaningful. It is not appropriate for parcels, where an overlap is a legal dispute.

## Union loses the removals

<figure class="fig">
<svg viewBox="0 0 760 236" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A union of two concurrent zone edits restoring an area one editor deliberately removed">
<title>The union puts back what somebody deliberately took out</title>
<desc>A service zone is shown as the ancestor both editors loaded. Editor A extends it northwards to cover a new district. Editor B, working independently, trims the southern edge because the service no longer reaches an industrial estate down there. Taking the union of A's result and B's result produces a zone that has A's northern extension and also has the southern estate back, because a union can only ever add area. B's removal has not merely been lost — it has been reversed, and the resulting zone claims coverage the operator specifically decided not to offer. A three-way merge against the ancestor sees the additions and the removals separately: A added the north, B removed the south, the two regions do not touch, so the merged zone is the ancestor plus the north minus the south. That result is what both editors would have produced had they worked in sequence, and it is derivable only because the ancestor was kept.</desc>
<rect x="0" y="0" width="760" height="236" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one service zone · two independent edits</text>
<text x="30" y="42" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">ancestor</text>
<rect x="30" y="52" width="110" height="90" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.5"/>
<text x="176" y="42" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">A: extend north</text>
<rect x="176" y="52" width="110" height="90" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<rect x="176" y="30" width="110" height="22" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="322" y="42" font-size="9" font-weight="600" fill="var(--fig-peach-edge)">B: trim south</text>
<rect x="322" y="52" width="110" height="66" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<rect x="322" y="118" width="110" height="24" fill="var(--fig-bg)" stroke="var(--fig-peach-edge)" stroke-width="1.5" stroke-dasharray="4 3"/>
<text x="326" y="134" font-size="7.5" fill="var(--fig-peach-edge)">removed</text>
<text x="468" y="42" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">union(A, B) — wrong</text>
<rect x="468" y="52" width="110" height="90" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<rect x="468" y="30" width="110" height="22" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="472" y="134" font-size="7.5" fill="var(--fig-rose-edge)">estate is back</text>
<text x="614" y="42" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">three-way merge</text>
<rect x="614" y="52" width="110" height="66" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<rect x="614" y="30" width="110" height="22" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="618" y="134" font-size="7.5" fill="var(--fig-mint-edge)">north added, south gone</text>
<rect x="14" y="158" width="732" height="66" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.4"/>
<text x="26" y="178" font-size="9.5" font-weight="600" fill="var(--fig-ink)">A union can only add area, so it cannot represent a decision to remove one</text>
<text x="26" y="197" font-size="9" fill="var(--fig-ink-soft)">B's trim is not lost, it is reversed: the merged zone claims coverage the operator specifically decided not to offer, and it will</text>
<text x="26" y="210" font-size="9" fill="var(--fig-ink-soft)">keep claiming it until someone notices. The three-way result is what the two editors would have produced working in sequence,</text>
<text x="26" y="222" font-size="9" fill="var(--fig-mint-edge)">and it is derivable only because the ancestor was stored deliberately.</text>
</svg>
<figcaption><b>Figure 1.</b> Without the ancestor, A's addition and B's removal are both just "a difference between two shapes", and nothing can tell them apart.</figcaption>
</figure>

## Complete runnable implementation

```python
from dataclasses import dataclass

from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

# Slivers below this area are artefacts of coordinate precision rather than
# real disagreements, and must not trigger a refusal. Square degrees at
# EPSG:4326; ~1e-12 is under a square metre at mid-latitudes.
SLIVER_AREA = 1e-12


class MergeConflict(Exception):
    """Both edits made a deliberate, opposite decision about the same ground."""

    def __init__(self, overlap_area: float, region) -> None:
        super().__init__(f"contested area {overlap_area:.3e} sq deg")
        self.region = region


@dataclass(frozen=True, slots=True)
class Delta:
    added: object      # shapely geometry: in the edit, not in the ancestor
    removed: object    # in the ancestor, not in the edit


def delta(ancestor, edited) -> Delta:
    """What one edit did, expressed as an addition and a removal."""
    return Delta(added=edited.difference(ancestor),
                 removed=ancestor.difference(edited))


def three_way_merge(ancestor_geojson: dict, a_geojson: dict,
                    b_geojson: dict) -> dict:
    """Merge two concurrent zone edits against their common ancestor.

    Raises MergeConflict when one edit added ground the other removed —
    the geometric equivalent of two people editing the same line.
    """
    ancestor = make_valid(shape(ancestor_geojson))
    a, b = make_valid(shape(a_geojson)), make_valid(shape(b_geojson))

    da, db = delta(ancestor, a), delta(ancestor, b)

    # A added what B removed, or the reverse: both made a decision about the
    # same ground and they disagree. Any automatic answer is a guess.
    contested = unary_union([
        da.added.intersection(db.removed),
        db.added.intersection(da.removed),
    ])
    if not contested.is_empty and contested.area > SLIVER_AREA:
        raise MergeConflict(contested.area, mapping(contested))

    merged = unary_union([ancestor, da.added, db.added])
    merged = merged.difference(unary_union([da.removed, db.removed]))

    # Boolean operations on real-world polygons routinely produce slivers and
    # self-touching rings; repair before anything downstream validates it.
    merged = make_valid(merged)
    merged = merged.buffer(0)

    if merged.is_empty:
        raise MergeConflict(0.0, mapping(ancestor))

    return mapping(merged)
```

The order matters: additions are applied before removals, so an area that one editor added and neither removed survives, while an area removed by either is gone regardless of who added it. Reversing the order lets an addition resurrect a removal, which is the union bug in a subtler form.

<figure class="fig">
<svg viewBox="0 0 760 224" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A mergeable pair where the changed regions are disjoint, and a contested pair where they overlap">
<title>Disjoint changes merge; overlapping decisions do not</title>
<desc>Two cases are compared. In the first, editor A's addition sits in the north of the zone and editor B's removal sits in the south. The two changed regions do not intersect, so each edit's intent can be honoured in full and the merge is not a compromise but a faithful combination — this is the common case, because two people editing the same zone usually care about different parts of it. In the second, A extends the zone east across a boundary while B removes the very same strip, having decided the service does not reach it. The changed regions overlap almost entirely. There is no combination that honours both intents, because the intents are contradictory: one says this ground is covered and the other says it is not. A merge function that returns any geometry here has picked a winner without saying so, which is exactly the silent behaviour the version vector was introduced to eliminate. Raising instead pushes the decision to whoever has authority over that area, and carries the contested region in the exception so a reviewer can see precisely what is in dispute.</desc>
<rect x="0" y="0" width="760" height="224" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">disjoint changes — merge faithfully</text>
<rect x="30" y="30" width="120" height="110" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<rect x="30" y="30" width="120" height="26" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="38" y="47" font-size="7.5" fill="var(--fig-ink)">A added</text>
<rect x="30" y="114" width="120" height="26" fill="var(--fig-bg)" stroke="var(--fig-peach-edge)" stroke-width="1.5" stroke-dasharray="4 3"/>
<text x="38" y="131" font-size="7.5" fill="var(--fig-peach-edge)">B removed</text>
<text x="164" y="70" font-size="8.5" fill="var(--fig-ink-soft)">the changed regions do not intersect,</text>
<text x="164" y="84" font-size="8.5" fill="var(--fig-ink-soft)">so both intents are honoured in full</text>
<text x="164" y="104" font-size="8.5" fill="var(--fig-mint-edge)">the common case — two people editing</text>
<text x="164" y="116" font-size="8.5" fill="var(--fig-mint-edge)">one zone usually care about different parts</text>
<line x1="14" y1="152" x2="746" y2="152" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="404" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">overlapping decisions — refuse</text>
<rect x="420" y="30" width="120" height="110" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<rect x="540" y="46" width="46" height="78" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="544" y="70" font-size="7.5" fill="var(--fig-ink)">A added</text>
<rect x="544" y="50" width="46" height="78" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.8" stroke-dasharray="4 3"/>
<text x="548" y="120" font-size="7.5" fill="var(--fig-rose-edge)">B removed</text>
<text x="600" y="70" font-size="8.5" fill="var(--fig-rose-edge)">the same strip</text>
<text x="600" y="84" font-size="8.5" fill="var(--fig-rose-edge)">contradictory intents</text>
<text x="600" y="104" font-size="8.5" fill="var(--fig-ink-soft)">no combination honours both</text>
<rect x="14" y="164" width="732" height="52" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="183" font-size="9.5" font-weight="600" fill="var(--fig-ink)">A merge that returns a geometry here has picked a winner without saying so</text>
<text x="26" y="201" font-size="9" fill="var(--fig-ink-soft)">— which is the silent behaviour the version vector existed to eliminate. Raising pushes the decision to whoever has authority</text>
<text x="26" y="212" font-size="9" fill="var(--fig-ink-soft)">over that ground, and carrying the contested region in the exception lets a reviewer see exactly what is in dispute.</text>
</svg>
<figcaption><b>Figure 2.</b> The refusal is the feature. Detecting concurrency and then quietly resolving it geometrically would put the original problem back one layer down.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `SLIVER_AREA` | `float` | Square degrees; below a square metre at mid-latitudes | `1e-12` |
| Ancestor | GeoJSON | The version both editors loaded; must be stored deliberately | — |
| `make_valid` | call | On all three inputs — an invalid input makes every predicate unreliable | — |
| `buffer(0)` | call | After the booleans, to clean self-touching rings | — |
| Operation order | — | Additions **then** removals; reversing resurrects removed area | — |
| `MergeConflict.region` | GeoJSON | The contested ground, for a reviewer to look at | — |

</div>

## Gotchas and spatial edge cases

1. **A tolerance in square degrees is not a tolerance in square metres.** At 60° north a degree of longitude is half its equatorial length, so the same `SLIVER_AREA` represents half the ground. If the threshold is contractual rather than cosmetic, reproject to a local equal-area CRS before measuring, as [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) describes.

2. **`difference` between polygons with nearly-coincident edges produces slivers.** Two editors who both traced the same boundary by hand will differ by microdegrees, and every shared edge becomes a thread of area in the delta. Without the sliver threshold, every merge of hand-drawn geometry reports a conflict.

3. **`make_valid` can change the geometry type.** An invalid polygon may come back as a `GeometryCollection` containing polygons and stray lines, and `unary_union` on that keeps the lines. Filter to polygonal parts before returning, or a zero-area line ends up in the stored zone and breaks the next area calculation.

4. **A merge that empties the zone is a conflict, not a result.** If both editors removed most of the area, the intersection of what remains can be empty, and storing an empty geometry deletes the zone by arithmetic. Raising is the only safe response.

5. **This merge is for coverage areas, not for parcels.** Cadastral boundaries have legal meaning and an overlap between two of them is a dispute to be recorded, not a shape to be computed. Applying a geometric merge there produces a parcel that no register recognises.

6. **The merged geometry needs a new version vector that dominates both inputs.** Producing the shape without recording the merged lineage means the next edit rediscovers the same conflict — the failure the last test in the version-vector guide exists to catch.

## Verification

```python
import pytest
from shapely.geometry import Polygon, mapping, shape

ANCESTOR = mapping(Polygon([(0, 0), (0, 10), (10, 10), (10, 0)]))


def extended_north() -> dict:
    return mapping(Polygon([(0, 0), (0, 14), (10, 14), (10, 0)]))


def trimmed_south() -> dict:
    return mapping(Polygon([(0, 3), (0, 10), (10, 10), (10, 3)]))


def test_disjoint_changes_merge_faithfully():
    """North added, south removed — both intents survive."""
    merged = shape(three_way_merge(ANCESTOR, extended_north(), trimmed_south()))
    assert merged.bounds == (0.0, 3.0, 10.0, 14.0)


def test_union_would_have_restored_the_trimmed_area():
    """The bug this function exists to avoid, asserted explicitly."""
    naive = shape(extended_north()).union(shape(trimmed_south()))
    assert naive.bounds[1] == 0.0, "union keeps the removed southern strip"

    merged = shape(three_way_merge(ANCESTOR, extended_north(), trimmed_south()))
    assert merged.bounds[1] == 3.0


def test_contradictory_edits_refuse():
    """A added the eastern strip; B removed it."""
    a = mapping(Polygon([(0, 0), (0, 10), (14, 10), (14, 0)]))
    b = mapping(Polygon([(0, 0), (0, 10), (8, 10), (8, 0)]))
    with pytest.raises(MergeConflict):
        three_way_merge(ANCESTOR, a, b)


def test_hand_drawn_slivers_do_not_refuse():
    """Microdegree differences along a shared edge are not a conflict."""
    a = mapping(Polygon([(0, 0), (0, 10.0000001), (10, 10), (10, 0)]))
    b = mapping(Polygon([(0, 0), (0, 9.9999999), (10, 10), (10, 0)]))
    three_way_merge(ANCESTOR, a, b)      # must not raise
```

The second test is worth keeping even though it asserts something about code that is not being used: it documents the failure mode in executable form, so anyone tempted to replace the function with a one-line union sees immediately what that costs.

## Related

- [Conflict Resolution Strategies](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/) — the topic this guide belongs to
- [Implementing a Version Vector for Spatial Features](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/implementing-a-version-vector-for-spatial-features/) — how a conflict gets detected and routed here in the first place
- [Repairing Self-Intersecting Polygons Without Losing Area](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/repairing-self-intersecting-polygons-without-losing-area/) — what `make_valid` is doing, and what it costs
- [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/) — deciding whether two geometries are the same thing, rather than how to combine them
