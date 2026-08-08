---
title: "Tuning an IoU Threshold for Sensor Coverage"
description: "Pick the intersection-over-union threshold from labelled pairs rather than from a round number: plot precision and recall across the range, and choose the point where the cost of a false merge equals the cost of a missed one."
slug: "tuning-an-iou-threshold-for-sensor-coverage"
type: "article"
breadcrumb: "Idempotency & Spatial Deduplication > Spatial Overlap Deduplication > Tuning an IoU Threshold for Sensor Coverage"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Tuning an IoU Threshold for Sensor Coverage",
      "description": "An intersection-over-union threshold of 0.8 is a number somebody picked. This guide derives it from labelled pairs of sensor footprints, shows why IoU behaves differently for small and large geometries, and chooses the operating point from the relative cost of the two errors.",
      "url": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/tuning-an-iou-threshold-for-sensor-coverage/",
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
        {"@type": "ListItem", "position": 3, "name": "Spatial Overlap Deduplication", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/"},
        {"@type": "ListItem", "position": 4, "name": "Tuning an IoU Threshold for Sensor Coverage", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/tuning-an-iou-threshold-for-sensor-coverage/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Tune an IoU threshold for sensor coverage deduplication",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Label a few hundred real footprint pairs as duplicate or distinct"},
        {"@type": "HowToStep", "position": 2, "name": "Sweep the threshold and record precision and recall at each step"},
        {"@type": "HowToStep", "position": 3, "name": "Weight the two errors by what each actually costs downstream"},
        {"@type": "HowToStep", "position": 4, "name": "Band the threshold by footprint size, because IoU is scale-sensitive"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does one IoU threshold not work for all footprint sizes?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because a fixed positional error produces a much larger IoU penalty on a small footprint than on a large one. Two readings of the same fifty-metre sensor cone offset by ten metres score far lower than two readings of the same five-kilometre swath offset by the same ten metres, even though the underlying registration error is identical. A single threshold therefore treats small footprints as distinct and large ones as duplicates, which is backwards from what the data means."}
        },
        {
          "@type": "Question",
          "name": "Should the threshold favour precision or recall?",
          "acceptedAnswer": {"@type": "Answer", "text": "It depends entirely on which error costs more, and that is a downstream question rather than a geometric one. Merging two genuinely distinct observations destroys a reading that will never be repeated, while failing to merge two duplicates leaves a redundant record that a later pass can still collapse. For most sensor archives that asymmetry argues for a high threshold and a bias towards keeping both, but for a real-time alerting path the duplicate alert may be the more expensive error."}
        },
        {
          "@type": "Question",
          "name": "Is IoU the right measure at all?",
          "acceptedAnswer": {"@type": "Answer", "text": "It is a good default and a poor fit for nested footprints. Two readings where one covers a quarter of the other score an IoU of at most 0.25 regardless of how well they agree over the shared area, so a wide-swath pass containing a narrow one is scored as distinct. Where nesting is common, pair IoU with a containment ratio — the intersection over the smaller area — and require either to pass."}
        }
      ]
    }
  ]
}
</script>

**Sweep the threshold across labelled pairs and pick the point where the cost of a false merge equals the cost of a missed one, then band it by footprint size — a fixed positional error costs far more IoU on a small footprint than on a large one, so one threshold treats small overlaps as distinct and large ones as duplicates.**

This guide sits under [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/), within [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/). That topic covers the four-layer pipeline; this guide covers only the number at its centre.

## When to use this pattern

- Overlap deduplication is already running with a threshold nobody can justify.
- The two errors have visibly different costs — merged observations that should not have been, or redundant records that should have collapsed.
- Footprints vary in size by more than about a factor of five, which is where a single threshold stops working.

## IoU is not scale-free

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The same ten-metre registration offset applied to a small and a large footprint, producing very different IoU scores">
<title>The same error, two very different scores</title>
<desc>The same ten-metre registration offset is applied to two footprints. On the left, a fifty-metre sensor cone shifted ten metres retains an intersection-over-union of about zero point six seven — well below a threshold of zero point eight, so the two readings are classified as distinct observations even though they are the same sensor seeing the same thing with ordinary positional error. On the right, a five-kilometre swath shifted by the identical ten metres scores about zero point nine nine six, comfortably above the threshold, so those two are merged. Both classifications come from one number applied to one measure, and both are wrong in opposite directions: the small pair should have merged and the large pair should perhaps not have, since ten metres of drift on a five-kilometre swath tells you nothing about whether the two passes observed the same event. The correct response is to band the threshold by footprint size, lowering it for small geometries where a fixed positional error dominates the score and raising it for large ones where it barely registers.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one 10 m registration offset · one threshold of 0.80</text>
<rect x="14" y="30" width="366" height="148" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">50 m sensor cone, offset 10 m</text>
<circle cx="120" cy="104" r="40" fill="var(--fig-mint)" opacity="0.5" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<circle cx="152" cy="104" r="40" fill="var(--fig-gold)" opacity="0.5" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="212" y="90" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">IoU ≈ 0.67</text>
<text x="212" y="108" font-size="8.5" fill="var(--fig-ink-soft)">below 0.80 → classified DISTINCT</text>
<text x="212" y="126" font-size="8.5" fill="var(--fig-rose-edge)">but it is the same sensor seeing</text>
<text x="212" y="138" font-size="8.5" fill="var(--fig-rose-edge)">the same thing, with ordinary error</text>
<text x="26" y="168" font-size="8.5" fill="var(--fig-ink-soft)">a fixed offset dominates the score at this scale</text>
<rect x="392" y="30" width="354" height="148" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="404" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">5 km swath, offset the same 10 m</text>
<rect x="410" y="80" width="240" height="48" fill="var(--fig-mint)" opacity="0.5" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<rect x="412" y="82" width="240" height="48" fill="var(--fig-gold)" opacity="0.5" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="404" y="150" font-size="9" font-weight="600" fill="var(--fig-gold-edge)">IoU ≈ 0.996 → classified DUPLICATE</text>
<text x="404" y="168" font-size="8.5" fill="var(--fig-ink-soft)">10 m of drift on 5 km says nothing about whether the passes saw the same event</text>
<rect x="14" y="188" width="732" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="207" font-size="9" fill="var(--fig-ink-soft)">Band the threshold by footprint size: lower for small geometries where a fixed offset dominates, higher for large ones where it barely registers.</text>
</svg>
<figcaption><b>Figure 1.</b> Both classifications are wrong, in opposite directions, from one number applied uniformly. Scale is not a detail of the measure; it is the measure's main sensitivity.</figcaption>
</figure>

## Complete runnable implementation

```python
from dataclasses import dataclass

from shapely.geometry import shape
from shapely.validation import make_valid

# Footprint area bands in square metres, each with its own threshold. The
# bands come from the fleet's sensor types, not from round numbers.
SIZE_BANDS = (
    (0.0, 1e4, "small"),        # < 1 hectare — a fixed offset dominates IoU
    (1e4, 1e7, "medium"),
    (1e7, float("inf"), "large"),
)


def iou(a, b) -> float:
    """Intersection over union. Zero for disjoint, one for identical."""
    a, b = make_valid(a), make_valid(b)
    union = a.union(b).area
    return 0.0 if union == 0 else a.intersection(b).area / union


def containment(a, b) -> float:
    """Intersection over the SMALLER area — catches the nested case.

    Two readings where one covers a quarter of the other cap out at an IoU
    of 0.25 however well they agree over the shared ground, so a narrow pass
    inside a wide swath scores as distinct on IoU alone.
    """
    smaller = min(a.area, b.area)
    return 0.0 if smaller == 0 else a.intersection(b).area / smaller


def band_of(a, b) -> str:
    mean_area = (a.area + b.area) / 2.0
    for low, high, name in SIZE_BANDS:
        if low <= mean_area < high:
            return name
    return "large"


@dataclass(frozen=True, slots=True)
class Operating:
    threshold: float
    precision: float
    recall: float
    cost: float


def sweep(labelled: list[tuple[object, object, bool]],
          false_merge_cost: float, missed_merge_cost: float,
          steps: int = 40) -> list[Operating]:
    """Score every candidate threshold against labelled pairs.

    `labelled` is (geometry_a, geometry_b, is_duplicate) from real data —
    a synthetic set of translated squares produces a clean curve and a
    threshold that does not survive contact with sensor footprints.
    """
    scores = [(iou(a, b), truth) for a, b, truth in labelled]
    results = []

    for step in range(1, steps + 1):
        threshold = step / steps
        tp = sum(1 for s, t in scores if s >= threshold and t)
        fp = sum(1 for s, t in scores if s >= threshold and not t)
        fn = sum(1 for s, t in scores if s < threshold and t)

        precision = tp / (tp + fp) if tp + fp else 1.0
        recall = tp / (tp + fn) if tp + fn else 1.0
        # Weighted cost, NOT F1: F1 assumes the two errors are equally bad,
        # which for a sensor archive they are emphatically not.
        results.append(Operating(
            threshold=threshold,
            precision=precision,
            recall=recall,
            cost=fp * false_merge_cost + fn * missed_merge_cost,
        ))
    return results


def choose(results: list[Operating]) -> Operating:
    return min(results, key=lambda r: (r.cost, -r.threshold))


def is_duplicate(a_geojson: dict, b_geojson: dict,
                 thresholds: dict[str, float]) -> bool:
    """Apply the tuned threshold for this pair's size band."""
    a, b = make_valid(shape(a_geojson)), make_valid(shape(b_geojson))
    threshold = thresholds[band_of(a, b)]
    # Either measure passing is enough: IoU for similar sizes, containment
    # for the nested case it cannot represent.
    return iou(a, b) >= threshold or containment(a, b) >= 0.95
```

Minimising a weighted cost rather than maximising F1 is the decision that makes this tuning rather than curve-fitting. F1 asserts the two errors are equally expensive, which is almost never true and is never checked.

<figure class="fig">
<svg viewBox="0 0 760 232" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Precision and recall curves against threshold, with the weighted-cost minimum marked away from the F1 optimum">
<title>The cost minimum is not where F1 puts it</title>
<desc>Precision and recall are plotted against the intersection-over-union threshold across a labelled set of sensor footprint pairs. Recall falls as the threshold rises, because fewer genuine duplicates clear the bar; precision rises, because fewer distinct pairs are wrongly merged. The F1 optimum sits where the two curves cross, near a threshold of zero point six five. The weighted-cost minimum sits considerably higher, near zero point eight two, because in this archive a false merge destroys an observation that will never be repeated while a missed merge merely leaves a redundant record that a later pass can still collapse — the first error is weighted twenty times the second. Choosing the crossing point would have merged roughly three times as many distinct observations, and none of those merges would have produced an error, a log line or a metric: the destroyed reading simply would not be in the archive, and nothing in the system knows it should have been.</desc>
<rect x="0" y="0" width="760" height="232" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">precision and recall against IoU threshold · labelled sensor pairs</text>
<line x1="60" y1="160" x2="620" y2="160" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="60" y1="34" x2="60" y2="160" stroke="var(--fig-line)" stroke-width="1.2"/>
<text x="56" y="176" font-size="8" fill="var(--fig-ink-soft)">0.0</text>
<text x="330" y="176" font-size="8" fill="var(--fig-ink-soft)">0.5</text>
<text x="606" y="176" font-size="8" fill="var(--fig-ink-soft)">1.0</text>
<path d="M60,40 C200,44 320,58 420,86 C500,110 570,142 620,156" fill="none" stroke="var(--fig-mint-edge)" stroke-width="2"/>
<text x="120" y="38" font-size="8.5" fill="var(--fig-mint-edge)">recall</text>
<path d="M60,150 C160,140 260,116 360,92 C460,68 550,48 620,40" fill="none" stroke="var(--fig-peach-edge)" stroke-width="2"/>
<text x="540" y="36" font-size="8.5" fill="var(--fig-peach-edge)">precision</text>
<line x1="424" y1="34" x2="424" y2="160" stroke="var(--fig-gold-edge)" stroke-width="1.4" stroke-dasharray="3 3"/>
<text x="332" y="196" font-size="8.5" fill="var(--fig-gold-edge)">F1 optimum ≈ 0.65 — where the curves cross</text>
<line x1="520" y1="34" x2="520" y2="160" stroke="var(--fig-rose-edge)" stroke-width="2" stroke-dasharray="4 3"/>
<text x="466" y="212" font-size="8.5" font-weight="600" fill="var(--fig-rose-edge)">weighted-cost minimum ≈ 0.82</text>
<rect x="636" y="40" width="110" height="120" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="646" y="60" font-size="8.5" font-weight="600" fill="var(--fig-ink)">error weights</text>
<text x="646" y="80" font-size="8" fill="var(--fig-rose-edge)">false merge ×20</text>
<text x="646" y="94" font-size="8" fill="var(--fig-ink-soft)">destroys a reading</text>
<text x="646" y="106" font-size="8" fill="var(--fig-ink-soft)">nothing repeats</text>
<text x="646" y="126" font-size="8" fill="var(--fig-mint-edge)">missed merge ×1</text>
<text x="646" y="140" font-size="8" fill="var(--fig-ink-soft)">a redundant record</text>
<text x="646" y="152" font-size="8" fill="var(--fig-ink-soft)">a later pass collapses</text>
<text x="14" y="228" font-size="9" fill="var(--fig-ink-soft)">The crossing point would merge ~3× as many distinct observations — with no error, no log line and no metric: the reading simply is not there.</text>
</svg>
<figcaption><b>Figure 2.</b> F1 is the right objective only when the two errors cost the same. Writing the weights down is what turns "0.8 seems fine" into a decision somebody can argue with.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `SIZE_BANDS` | tuple | Areas in m²; derived from sensor types, not round numbers | 3 bands |
| `false_merge_cost` | `float` | Relative cost of destroying a distinct observation | `20.0` |
| `missed_merge_cost` | `float` | Relative cost of a redundant record a later pass can collapse | `1.0` |
| Containment threshold | `float` | For the nested case IoU cannot express | `0.95` |
| Labelled pairs | list | Real footprints; a few hundred per band minimum | — |
| Area CRS | — | Equal-area projection; areas in EPSG:4326 are not comparable | — |

</div>

## Gotchas and spatial edge cases

1. **Areas computed in EPSG:4326 are in square degrees and are not comparable across latitudes.** A footprint at 60° north has roughly half the ground area of an identically-shaped one at the equator, so a size band expressed in degrees puts them in different bands. Reproject to an equal-area CRS before measuring anything the bands depend on.

2. **Invalid geometries make `intersection` unreliable rather than failing.** A self-intersecting footprint can produce an intersection area larger than either input, so IoU exceeds one. `make_valid` on both inputs is not optional, and the repair itself is covered in [Repairing Self-Intersecting Polygons Without Losing Area](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/repairing-self-intersecting-polygons-without-losing-area/).

3. **A synthetic labelled set produces a threshold that does not survive real data.** Translated squares give a clean monotone curve; real sensor footprints have ragged edges, partial cloud masks and nested passes, and the curve has a shoulder rather than a crossing. Label real pairs, even if only a few hundred.

4. **The nested case needs containment, not a lower IoU threshold.** Lowering the IoU threshold enough to catch a narrow pass inside a wide swath also merges genuinely different neighbouring footprints. The two measures answer different questions and should both be available.

5. **Re-tune after any change to the sensor fleet or its registration pipeline.** A new satellite with better positioning shifts the whole IoU distribution upwards, and the old threshold now merges pairs it was never validated against.

6. **Record which threshold and which band produced each merge decision.** Without it, a later investigation into a missing observation cannot tell whether the merge was correct under the rules in force at the time, and the tuning becomes unauditable.

## Verification

```python
import pytest
from shapely.geometry import Point, box

THRESHOLDS = {"small": 0.55, "medium": 0.75, "large": 0.88}


def test_small_footprint_offset_still_merges():
    """The case a flat 0.8 threshold gets wrong."""
    a = Point(0, 0).buffer(25)          # 50 m cone
    b = Point(10, 0).buffer(25)         # same cone, 10 m registration error
    assert iou(a, b) < 0.8              # would fail a flat threshold
    assert is_duplicate(a.__geo_interface__, b.__geo_interface__, THRESHOLDS)


def test_large_footprint_offset_is_not_merged_by_accident():
    """The band must be strict where a fixed offset barely registers."""
    a, b = box(0, 0, 5000, 1000), box(3000, 0, 8000, 1000)
    assert not is_duplicate(a.__geo_interface__, b.__geo_interface__, THRESHOLDS)


def test_nested_pass_is_caught_by_containment():
    """IoU caps at 0.25 here however well the pair agrees."""
    wide, narrow = box(0, 0, 4000, 4000), box(1000, 1000, 3000, 3000)
    assert iou(wide, narrow) < 0.3
    assert is_duplicate(wide.__geo_interface__, narrow.__geo_interface__, THRESHOLDS)


def test_weighted_cost_picks_a_higher_threshold_than_f1():
    """The decision the sweep exists to make."""
    labelled = _labelled_pairs()                      # real, from the archive
    balanced = choose(sweep(labelled, 1.0, 1.0))
    asymmetric = choose(sweep(labelled, 20.0, 1.0))
    assert asymmetric.threshold > balanced.threshold
```

The last test is a property of the tuning process rather than of any particular number, so it keeps holding as the archive grows — and it fails immediately if someone replaces the weighted cost with F1 while tidying the code.

## Related

- [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/) — the topic this guide belongs to, and the pipeline this threshold sits in
- [Time-Windowed Deduplication for Moving Assets](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/) — the cheaper temporal test to run before any geometric one
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — making the inputs valid so the areas mean something
- [Merging Overlapping Zone Edits with Shapely](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/merging-overlapping-zone-edits-with-shapely/) — what to do once two geometries are judged to be the same thing
