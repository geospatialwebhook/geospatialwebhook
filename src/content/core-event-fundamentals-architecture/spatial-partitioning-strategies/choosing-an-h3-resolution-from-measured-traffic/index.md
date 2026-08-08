---
title: "Choosing an H3 Resolution from Measured Traffic"
description: "Pick the H3 resolution from your own event distribution, not from a cell-size table: measure events per cell, find the resolution where the busiest cell fits one consumer, and check the cardinality you are buying."
slug: "choosing-an-h3-resolution-from-measured-traffic"
type: "article"
breadcrumb: "Core Event Fundamentals & Architecture > Spatial Partitioning Strategies > Choosing an H3 Resolution from Measured Traffic"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Choosing an H3 Resolution from Measured Traffic",
      "description": "H3 resolution is usually picked from a table of average cell sizes, which describes geometry rather than load. This guide derives the resolution from a replayed sample of real events: the busiest cell must fit inside one consumer's throughput, and the cell count must stay inside the metric and state budget.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/choosing-an-h3-resolution-from-measured-traffic/",
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
        {"@type": "ListItem", "position": 3, "name": "Spatial Partitioning Strategies", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/"},
        {"@type": "ListItem", "position": 4, "name": "Choosing an H3 Resolution from Measured Traffic", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/choosing-an-h3-resolution-from-measured-traffic/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Derive an H3 resolution from measured event traffic",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Replay a representative sample, including its busiest hour"},
        {"@type": "HowToStep", "position": 2, "name": "Count events per cell at every candidate resolution"},
        {"@type": "HowToStep", "position": 3, "name": "Find the lowest resolution whose busiest cell fits one consumer"},
        {"@type": "HowToStep", "position": 4, "name": "Check the resulting cell count against the metric and state budget"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why not pick the resolution from the average cell size table?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because the table describes geometry and the problem is load. A resolution whose cells average a square kilometre sounds appropriate for city-scale routing right up until you notice that one of those cells is a port terminal producing forty percent of the fleet's events while its neighbours produce none. The only input that predicts whether a partition will be too hot is the event distribution itself, and that is measured rather than looked up."}
        },
        {
          "@type": "Question",
          "name": "What goes wrong if the resolution is too fine?",
          "acceptedAnswer": {"@type": "Answer", "text": "Cardinality. Each resolution step multiplies the cell count by roughly seven, so moving from resolution 6 to resolution 9 turns a few thousand active cells into a few million. Every cell that appears as a metric label is a time series, every cell holding consumer state is a key, and a key space that large stops being a partitioning scheme and becomes a memory problem. Fine resolutions also fragment ordering: two events for the same asset seconds apart can land in different cells and therefore different partitions."}
        },
        {
          "@type": "Question",
          "name": "Should every stream use the same resolution?",
          "acceptedAnswer": {"@type": "Answer", "text": "No, and forcing one is a common source of skew. Vehicle telemetry, parcel edits and tile invalidations have completely different spatial distributions, so the resolution that balances one will concentrate another. Choose per stream from that stream's own measurements, and keep the resolution in the event envelope so a consumer reading several streams can tell which scheme produced a given key."}
        }
      ]
    }
  ]
}
</script>

**Replay a real sample including its busiest hour, count events per cell at every candidate resolution, and take the lowest resolution whose hottest cell still fits inside one consumer's throughput — the cell-size table describes geometry, and the thing that makes a partition too hot is the event distribution, which only your own traffic knows.**

This guide sits under [Spatial Partitioning Strategies](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/), within [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/). The comparison of the indexing schemes themselves is in [H3 vs S2 vs Quadkey for Spatial Partitioning](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/); this one assumes H3 has been chosen and asks only how fine to make it.

## When to use this pattern

- You are about to set a partition key for a new stream, or a live one is showing the consumer lag concentrated in a few partitions.
- You have at least a week of real events to replay, including whatever the stream's busiest period looks like.
- The consumer's throughput is known — events per second per instance, measured rather than assumed.

## The table answers the wrong question

<figure class="fig">
<svg viewBox="0 0 760 232" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Event counts per cell at three H3 resolutions, showing the hottest cell shrinking while cell count explodes">
<title>Two curves moving in opposite directions</title>
<desc>The same twenty-four hours of fleet telemetry is bucketed at three H3 resolutions. At resolution 6 there are about nine hundred active cells and the busiest one carries fourteen thousand events per second, which is roughly nine times what one consumer instance can handle, so that partition is permanently behind no matter how many instances are added. At resolution 7 there are about six thousand active cells and the busiest carries three thousand two hundred events per second, still about double a single consumer. At resolution 8 there are about forty thousand active cells and the busiest carries nine hundred, comfortably inside one consumer with headroom for growth. Going further to resolution 9 would bring the busiest cell down to a few hundred but push active cells past a quarter of a million, at which point per-cell metrics and per-cell consumer state become the dominant cost. The choice is the resolution where the descending curve first crosses the consumer's capacity line, and no further, because everything after that point is paid for in cardinality and buys nothing.</desc>
<rect x="0" y="0" width="760" height="232" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">same 24 hours of telemetry, bucketed at three resolutions</text>
<rect x="14" y="30" width="238" height="118" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="50" font-size="10" font-weight="600" fill="var(--fig-ink)">resolution 6</text>
<text x="26" y="70" font-size="8.5" fill="var(--fig-ink-soft)">~900 active cells</text>
<text x="26" y="86" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">busiest cell: 14 000 ev/s</text>
<text x="26" y="104" font-size="8.5" fill="var(--fig-rose-edge)">≈ 9× one consumer — permanently behind,</text>
<text x="26" y="116" font-size="8.5" fill="var(--fig-rose-edge)">and adding instances cannot help</text>
<text x="26" y="138" font-size="8.5" fill="var(--fig-ink-soft)">cheap metrics, useless balance</text>
<rect x="262" y="30" width="238" height="118" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="274" y="50" font-size="10" font-weight="600" fill="var(--fig-ink)">resolution 7</text>
<text x="274" y="70" font-size="8.5" fill="var(--fig-ink-soft)">~6 000 active cells</text>
<text x="274" y="86" font-size="9" font-weight="600" fill="var(--fig-gold-edge)">busiest cell: 3 200 ev/s</text>
<text x="274" y="104" font-size="8.5" fill="var(--fig-gold-edge)">≈ 2× one consumer — still hot</text>
<text x="274" y="138" font-size="8.5" fill="var(--fig-ink-soft)">closer, not there</text>
<rect x="510" y="30" width="236" height="118" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="522" y="50" font-size="10" font-weight="600" fill="var(--fig-ink)">resolution 8</text>
<text x="522" y="70" font-size="8.5" fill="var(--fig-ink-soft)">~40 000 active cells</text>
<text x="522" y="86" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">busiest cell: 900 ev/s</text>
<text x="522" y="104" font-size="8.5" fill="var(--fig-mint-edge)">inside one consumer, with headroom</text>
<text x="522" y="138" font-size="8.5" fill="var(--fig-ink-soft)">the first resolution that works</text>
<rect x="14" y="158" width="732" height="62" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.4"/>
<text x="26" y="177" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Why not go finer still?</text>
<text x="26" y="195" font-size="9" fill="var(--fig-ink-soft)">Resolution 9 would bring the busiest cell to a few hundred events per second and push active cells past 250 000. Each step</text>
<text x="26" y="209" font-size="9" fill="var(--fig-ink-soft)">multiplies cell count by about seven, and every cell is a metric series and a state key. Stop at the first resolution that fits.</text>
</svg>
<figcaption><b>Figure 1.</b> The busiest cell falls and the cell count rises, both roughly sevenfold per step. The answer is the first crossing, not the smallest number.</figcaption>
</figure>

## Complete runnable implementation

```python
import collections
from dataclasses import dataclass

import h3

# Measured throughput of ONE consumer instance on this workload, in events
# per second. Measure it; do not take it from a benchmark of a different mix.
CONSUMER_CAPACITY = 1_200

# Headroom for growth and for bursts. A cell at exactly capacity is a cell
# that falls behind the first time anything is slower than usual.
TARGET_UTILISATION = 0.75

# Above this, per-cell metrics and per-cell consumer state dominate.
MAX_ACTIVE_CELLS = 100_000


@dataclass(frozen=True, slots=True)
class ResolutionProfile:
    resolution: int
    active_cells: int
    hottest_cell: str
    hottest_rate: float
    p99_rate: float
    fits: bool


def profile(sample: list[tuple[float, float]], window_seconds: float,
            resolutions: range = range(4, 11)) -> list[ResolutionProfile]:
    """Bucket one sample of positions at each candidate resolution.

    `sample` must include the stream's busiest period. A quiet-Sunday sample
    produces a resolution that is correct on Sundays.
    """
    profiles = []
    for resolution in resolutions:
        counts = collections.Counter(
            h3.latlng_to_cell(lat, lon, resolution) for lat, lon in sample
        )
        rates = sorted((n / window_seconds for n in counts.values()), reverse=True)
        hottest_cell, hottest_n = counts.most_common(1)[0]
        hottest = hottest_n / window_seconds
        p99 = rates[max(0, int(len(rates) * 0.01))]

        profiles.append(ResolutionProfile(
            resolution=resolution,
            active_cells=len(counts),
            hottest_cell=hottest_cell,
            hottest_rate=hottest,
            p99_rate=p99,
            fits=(hottest <= CONSUMER_CAPACITY * TARGET_UTILISATION
                  and len(counts) <= MAX_ACTIVE_CELLS),
        ))
    return profiles


def choose(profiles: list[ResolutionProfile]) -> ResolutionProfile:
    """The COARSEST resolution that fits — finer buys nothing but cardinality."""
    for candidate in profiles:                    # ascending resolution
        if candidate.fits:
            return candidate
    raise ValueError(
        "no resolution satisfies both constraints: the hottest cell is hot at "
        "every resolution coarse enough to keep cardinality bounded — the key "
        "needs a second component, not a finer grid"
    )
```

The exception message is the important part. When no resolution works, the answer is not resolution 11; it is that geography alone cannot balance this stream, and the partition key needs something else in it.

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `CONSUMER_CAPACITY` | `int` | Events/second for **this** payload mix, measured | `1200` |
| `TARGET_UTILISATION` | `float` | Headroom for bursts; 1.0 means permanently at the edge | `0.75` |
| `MAX_ACTIVE_CELLS` | `int` | Bound from metric cardinality and per-cell state, not from H3 | `100000` |
| Sample window | seconds | Must include the busiest hour, not an average day | ≥ 7 days |
| `resolutions` | `range` | 4–10 covers city to building scale; below 4 is continental | `range(4, 11)` |
| Chosen resolution | `int` | Recorded in the event envelope, so keys are interpretable | — |

</div>

## Gotchas and spatial edge cases

1. **A hot cell that stays hot at every resolution is telling you something.** A port terminal, a stadium or a depot is a genuine point concentration: subdividing it produces smaller cells that are all in the same building, and one of them still holds the loading bay. The fix is a composite key — cell plus asset identifier hash, or cell plus event type — which trades strict geographic co-location for balance.

2. **Cells are only approximately equal in area, and the pentagons are not.** H3 has twelve pentagonal cells per resolution, which are smaller than their hexagonal neighbours and behave differently under `grid_disk`. They fall in the ocean at low resolutions, but a global stream will eventually key into one; make sure nothing assumes exactly six neighbours.

3. **Resolution changes ordering guarantees.** Events for one asset are ordered only within a partition, so a finer grid means a moving asset changes partition more often and its events lose relative order sooner. If ordering per asset matters more than balance, partition by asset and use the cell as a routing attribute instead.

4. **Measure with the events, not with the assets.** Ten thousand parked vehicles in a depot produce far more events than a hundred moving ones spread across a region, and an asset-count-based profile inverts the picture entirely.

5. **The distribution moves.** A resolution chosen against last year's traffic is a resolution chosen against last year's cities. Re-run the profile quarterly and alert when the hottest cell passes the utilisation target, which is the signal that [Migrating a Topic to a New H3 Resolution](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/migrating-a-topic-to-a-new-h3-resolution/) is due.

6. **`MAX_ACTIVE_CELLS` is about your monitoring stack, not about H3.** If cells never appear as metric labels and consumer state is not per cell, the bound can be far higher. State it explicitly, because the next person will assume it came from the library.

<figure class="fig">
<svg viewBox="0 0 760 210" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A point concentration that stays hot at every resolution, and the composite key that fixes it">
<title>When a finer grid cannot help</title>
<desc>A container terminal generates forty percent of a fleet's events from an area two hundred metres across. At resolution 8 the whole terminal is one cell. At resolution 9 it is seven cells, but six of them are water and access road while the seventh contains the loading bay, so the hottest cell is barely cooler. At resolution 11 the terminal is spread across hundreds of cells, and the loading bay is still one of them carrying most of the traffic, while the active cell count for the whole fleet has passed a million. Subdividing space cannot separate events that genuinely happen in the same place. The fix is to stop using geography alone: hashing the asset identifier into the key alongside the cell splits the terminal's traffic across as many partitions as wanted, at the cost that events from one small area are no longer co-located, which matters only if a consumer needs to reason about neighbours.</desc>
<rect x="0" y="0" width="760" height="210" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">a container terminal: 40% of fleet events from 200 metres</text>
<rect x="20" y="32" width="150" height="98" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="32" y="50" font-size="9" font-weight="600" fill="var(--fig-ink)">res 8 — one cell</text>
<circle cx="95" cy="88" r="30" fill="var(--fig-rose-edge)" opacity="0.35"/>
<text x="32" y="124" font-size="8.5" fill="var(--fig-rose-edge)">40% of the stream</text>
<rect x="182" y="32" width="150" height="98" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="194" y="50" font-size="9" font-weight="600" fill="var(--fig-ink)">res 9 — seven cells</text>
<circle cx="257" cy="88" r="12" fill="var(--fig-rose-edge)" opacity="0.5"/>
<circle cx="231" cy="76" r="12" fill="var(--fig-line-soft)" opacity="0.3"/>
<circle cx="283" cy="76" r="12" fill="var(--fig-line-soft)" opacity="0.3"/>
<circle cx="231" cy="100" r="12" fill="var(--fig-line-soft)" opacity="0.3"/>
<circle cx="283" cy="100" r="12" fill="var(--fig-line-soft)" opacity="0.3"/>
<text x="194" y="124" font-size="8.5" fill="var(--fig-rose-edge)">six are water and road; one is the bay</text>
<rect x="344" y="32" width="150" height="98" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="356" y="50" font-size="9" font-weight="600" fill="var(--fig-ink)">res 11 — hundreds</text>
<circle cx="419" cy="88" r="5" fill="var(--fig-rose-edge)" opacity="0.6"/>
<text x="356" y="112" font-size="8.5" fill="var(--fig-rose-edge)">the bay is still one cell,</text>
<text x="356" y="124" font-size="8.5" fill="var(--fig-rose-edge)">and the fleet has 1M+ cells</text>
<rect x="506" y="32" width="240" height="98" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="518" y="50" font-size="9" font-weight="600" fill="var(--fig-ink)">composite key — cell + asset hash</text>
<text x="518" y="70" font-size="8.5" fill="var(--fig-ink-soft)">splits the terminal across as many</text>
<text x="518" y="82" font-size="8.5" fill="var(--fig-ink-soft)">partitions as you want</text>
<text x="518" y="102" font-size="8.5" fill="var(--fig-mint-edge)">cost: events from one area are no longer</text>
<text x="518" y="114" font-size="8.5" fill="var(--fig-mint-edge)">co-located — only matters for neighbour logic</text>
<rect x="14" y="146" width="732" height="52" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="165" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Subdividing space cannot separate events that happen in the same place</text>
<text x="26" y="184" font-size="9" fill="var(--fig-ink-soft)">This is what the `choose()` exception means. Reading it as "try resolution 12" is the mistake; the key needs another component.</text>
</svg>
<figcaption><b>Figure 2.</b> The concentration is physical. No grid separates a loading bay from itself, which is why the profiler raises rather than returning the finest resolution it has.</figcaption>
</figure>

<figure class="fig">
<svg viewBox="0 0 760 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A resolution profile taken from a quiet sample against one taken from the busiest hour">
<title>The sample decides the resolution, so it has to be the busy one</title>
<desc>The same profiler is run over two samples of the same stream. The first is a quiet Sunday: the busiest cell at resolution 6 carries only nine hundred events per second, which already fits inside one consumer, so the profiler correctly returns resolution 6 as the coarsest resolution that works. Deployed against Monday morning, that same cell carries fourteen thousand events per second and the partition is nine times over a consumer's capacity — the recommendation was right about the data it saw and wrong about the stream. The second sample is taken across the busiest hour and returns resolution 8, which holds on Monday and is merely finer than necessary on Sunday. The asymmetry is the whole argument for sampling the peak: a resolution that is too fine costs cardinality, which is a bounded and visible cost, while one that is too coarse costs a permanently saturated partition, which is an outage that recurs every weekday morning.</desc>
<rect x="0" y="0" width="760" height="200" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">same profiler, same stream, two samples</text>
<rect x="14" y="30" width="366" height="118" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">sampled on a quiet Sunday</text>
<text x="26" y="72" font-size="8.5" fill="var(--fig-ink-soft)">busiest cell at res 6: 900 ev/s — already fits</text>
<text x="26" y="88" font-size="8.5" fill="var(--fig-ink-soft)">recommendation: resolution 6</text>
<text x="26" y="110" font-size="8.5" fill="var(--fig-rose-edge)">on Monday that cell carries 14 000 ev/s</text>
<text x="26" y="124" font-size="8.5" fill="var(--fig-rose-edge)">nine times a consumer's capacity, every weekday</text>
<text x="26" y="142" font-size="8.5" fill="var(--fig-ink-soft)">right about the data it saw, wrong about the stream</text>
<rect x="392" y="30" width="354" height="118" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="404" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">sampled across the busiest hour</text>
<text x="404" y="72" font-size="8.5" fill="var(--fig-ink-soft)">busiest cell at res 6: 14 000 ev/s — rejected</text>
<text x="404" y="88" font-size="8.5" fill="var(--fig-ink-soft)">recommendation: resolution 8</text>
<text x="404" y="110" font-size="8.5" fill="var(--fig-mint-edge)">holds on Monday</text>
<text x="404" y="124" font-size="8.5" fill="var(--fig-ink-soft)">merely finer than necessary on Sunday</text>
<rect x="14" y="158" width="732" height="34" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="177" font-size="9" fill="var(--fig-ink-soft)">The errors are not symmetric: too fine costs cardinality, which is bounded and visible. Too coarse costs a permanently</text>
<text x="26" y="188" font-size="9" fill="var(--fig-ink-soft)">saturated partition, which is an outage that recurs every weekday morning.</text>
</svg>
<figcaption><b>Figure 3.</b> Because the two errors cost differently, a sample taken at a convenient moment biases towards the expensive one.</figcaption>
</figure>

## Verification

```python
import random
import pytest


def clustered_sample(n: int = 200_000) -> list[tuple[float, float]]:
    """40% of events from a 200 m terminal, the rest spread over a city."""
    hot = [(53.5400 + random.gauss(0, 0.0008),
            9.9300 + random.gauss(0, 0.0012)) for _ in range(int(n * 0.4))]
    rest = [(53.50 + random.uniform(0, 0.12),
             9.85 + random.uniform(0, 0.25)) for _ in range(n - len(hot))]
    return hot + rest


def test_coarse_resolutions_are_rejected():
    """A hot terminal must disqualify the coarse end."""
    profiles = profile(clustered_sample(), window_seconds=3600)
    by_res = {p.resolution: p for p in profiles}
    assert not by_res[5].fits
    assert by_res[5].hottest_rate > by_res[9].hottest_rate


def test_choose_returns_the_coarsest_that_fits():
    """Not the finest — cardinality is a cost, not a bonus."""
    profiles = profile(clustered_sample(), window_seconds=3600)
    chosen = choose(profiles)
    finer = [p for p in profiles if p.resolution < chosen.resolution]
    assert all(not p.fits for p in finer)


def test_unbalanceable_stream_raises_rather_than_going_finer():
    """Every event at one point: no grid can help, and it must say so."""
    sample = [(53.5400, 9.9300)] * 100_000
    with pytest.raises(ValueError, match="second component"):
        choose(profile(sample, window_seconds=60))
```

The third test encodes the judgement the whole exercise exists to produce. A profiler that silently returns resolution 15 for a point source is worse than one that fails, because the resolution it returns will be deployed.

## Related

- [Spatial Partitioning Strategies](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/) — the topic this guide belongs to
- [Migrating a Topic to a New H3 Resolution](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/migrating-a-topic-to-a-new-h3-resolution/) — what to do when the measurement says the current resolution has aged out
- [H3 vs S2 vs Quadkey for Spatial Partitioning](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/) — choosing the scheme before choosing the resolution
- [Detecting Partition Skew in H3-Sharded Streams](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/detecting-partition-skew-in-h3-sharded-streams/) — the running measurement that says the choice has expired
