---
title: "Sizing a Deduplication Window from Report Intervals"
description: "Derive the window from the measured inter-arrival distribution per device class, not from the vendor's nominal interval — and check the resulting suppression rate against what the consumer actually needs."
slug: "sizing-a-dedup-window-from-report-intervals"
type: "article"
breadcrumb: "Idempotency & Spatial Deduplication > Time-Windowed Deduplication for Moving Assets > Sizing a Deduplication Window from Report Intervals"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Sizing a Deduplication Window from Report Intervals",
      "description": "A deduplication window sized from a vendor's nominal reporting interval is sized against a number no device produces. This guide measures the real inter-arrival distribution per device class, derives the window from it, and checks the resulting suppression rate against what the consumer needs.",
      "url": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/sizing-a-dedup-window-from-report-intervals/",
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
        {"@type": "ListItem", "position": 3, "name": "Time-Windowed Deduplication for Moving Assets", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/"},
        {"@type": "ListItem", "position": 4, "name": "Sizing a Deduplication Window from Report Intervals", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/sizing-a-dedup-window-from-report-intervals/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Size a deduplication window from measured report intervals",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Measure inter-arrival gaps per device class, not across the fleet"},
        {"@type": "HowToStep", "position": 2, "name": "Take a low percentile of the gap distribution, not its mean"},
        {"@type": "HowToStep", "position": 3, "name": "Check the implied suppression rate against what the consumer needs"},
        {"@type": "HowToStep", "position": 4, "name": "Re-measure on a schedule, because firmware changes the distribution"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why not use the vendor's stated reporting interval?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because devices almost never report at their nominal interval. A tracker configured for ten seconds reports at ten seconds when stationary and connected, at two seconds when its motion trigger fires, and in a burst of sixty when it reconnects after an outage. The nominal figure describes one mode of a multi-modal distribution, and a window sized against it is too wide for the burst and too narrow for the idle case."}
        },
        {
          "@type": "Question",
          "name": "Which percentile of the gap distribution should the window use?",
          "acceptedAnswer": {"@type": "Answer", "text": "A low one — around the tenth percentile of observed gaps for the class. The window is meant to collapse reports that arrive closer together than the consumer needs, so it must sit above the gaps you want to suppress and below the gaps you want to keep. Using the median suppresses about half of all normal reporting, which is usually far more than intended, and using the mean is worse still because a few multi-hour outage gaps drag it above every real interval."}
        },
        {
          "@type": "Question",
          "name": "Should each device class get its own window?",
          "acceptedAnswer": {"@type": "Answer", "text": "Yes, whenever the classes differ by more than about a factor of two. A fleet mixing ten-second vehicle trackers with fifteen-minute asset tags has no single window that is right for both: one sized for the trackers suppresses nothing from the tags, and one sized for the tags discards almost every vehicle ping. Carry the class in the envelope and look the window up per event rather than configuring one number."}
        }
      ]
    }
  ]
}
</script>

**Measure the inter-arrival distribution per device class and take a low percentile of it — the vendor's nominal interval describes one mode of a multi-modal distribution, and a window sized from the mean is dragged above every real interval by a handful of multi-hour outage gaps.**

This guide sits under [Time-Windowed Deduplication for Moving Assets](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/), within [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/). It produces the `MIN_SECONDS` threshold used by [Deduplicating Vehicle Pings in a Sliding Window](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/deduplicating-vehicle-pings-in-a-sliding-window/).

## When to use this pattern

- The window was chosen from a configuration document, a vendor datasheet or a round number, and nobody has checked it against traffic.
- The fleet is heterogeneous — different tracker models, different firmware, different power profiles.
- The suppression rate is either surprisingly low, which means the window is doing nothing, or surprisingly high, which means it is discarding data someone downstream is waiting for.

## The distribution is not a number

<figure class="fig">
<svg viewBox="0 0 760 236" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A multi-modal inter-arrival distribution for a nominally ten-second tracker, with mean and median marked">
<title>One nominal interval, four modes</title>
<desc>Inter-arrival gaps are plotted for a fleet of trackers whose datasheet says ten seconds. There are four distinct clusters. A tall spike near one to two seconds is the motion trigger firing during acceleration and cornering, which is a large share of all events. A second, taller spike sits at ten seconds, the configured idle cadence. A third cluster around thirty seconds comes from devices in power-saving mode. A long thin tail runs from several minutes to several hours and is the reconnection gaps after tunnels, garages and dead zones. The mean of this distribution lands near ninety seconds, above every mode, because the tail drags it there — a window sized on the mean suppresses nearly the entire stream. The median lands at ten seconds, which suppresses roughly half of all normal reporting. The tenth percentile lands near two seconds, which collapses the motion-trigger burst while leaving the idle cadence intact, and that is what the window is for.</desc>
<rect x="0" y="0" width="760" height="236" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">inter-arrival gaps · nominal interval 10 s · log scale</text>
<line x1="50" y1="150" x2="740" y2="150" stroke="var(--fig-line)" stroke-width="1.2"/>
<rect x="86" y="94" width="20" height="56" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.1"/>
<rect x="108" y="80" width="20" height="70" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.1"/>
<rect x="130" y="110" width="20" height="40" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.1"/>
<rect x="238" y="46" width="20" height="104" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.1"/>
<rect x="260" y="38" width="20" height="112" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.1"/>
<rect x="282" y="70" width="20" height="80" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.1"/>
<rect x="360" y="112" width="20" height="38" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.1"/>
<rect x="382" y="120" width="20" height="30" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.1"/>
<rect x="470" y="138" width="20" height="12" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.1"/>
<rect x="540" y="142" width="20" height="8" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.1"/>
<rect x="620" y="144" width="20" height="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.1"/>
<rect x="690" y="145" width="20" height="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.1"/>
<text x="80" y="166" font-size="8" fill="var(--fig-gold-edge)">1–2 s motion trigger</text>
<text x="232" y="166" font-size="8" fill="var(--fig-mint-edge)">10 s idle cadence</text>
<text x="352" y="166" font-size="8" fill="var(--fig-peach-edge)">30 s power save</text>
<text x="470" y="166" font-size="8" fill="var(--fig-ink-soft)">minutes to hours — reconnection after tunnels and garages</text>
<line x1="96" y1="30" x2="96" y2="150" stroke="var(--fig-mint-edge)" stroke-width="1.4" stroke-dasharray="3 3"/>
<text x="100" y="28" font-size="8" fill="var(--fig-mint-edge)">p10 ≈ 2 s — the window</text>
<line x1="266" y1="30" x2="266" y2="150" stroke="var(--fig-gold-edge)" stroke-width="1.4" stroke-dasharray="3 3"/>
<text x="270" y="28" font-size="8" fill="var(--fig-gold-edge)">median 10 s — suppresses half of normal reporting</text>
<line x1="430" y1="30" x2="430" y2="150" stroke="var(--fig-rose-edge)" stroke-width="1.6" stroke-dasharray="3 3"/>
<text x="434" y="44" font-size="8" fill="var(--fig-rose-edge)">mean ≈ 90 s — above every mode</text>
<rect x="14" y="182" width="732" height="44" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="26" y="200" font-size="9.5" font-weight="600" fill="var(--fig-ink)">The mean is not merely imprecise here — it is outside the data</text>
<text x="26" y="217" font-size="9" fill="var(--fig-ink-soft)">A handful of multi-hour reconnection gaps pull it above every real interval, so a window sized on it discards nearly the whole stream.</text>
</svg>
<figcaption><b>Figure 1.</b> No single number summarises this. The window is a threshold between the modes you want to collapse and the ones you want to keep, which makes it a percentile question rather than an average.</figcaption>
</figure>

## Complete runnable implementation

```python
import collections
import statistics
from dataclasses import dataclass

# The window sits above the gaps to collapse and below the gaps to keep.
# A low percentile puts it there; the median puts it in the middle of the
# idle cadence, suppressing about half of all normal reporting.
WINDOW_PERCENTILE = 10

# Reconnection bursts are not reporting cadence and must not shape the window.
BURST_FLOOR_SECONDS = 0.4
# Gaps above this are outages, and they are what drags the mean off the chart.
OUTAGE_CEILING_SECONDS = 600.0


@dataclass(frozen=True, slots=True)
class WindowRecommendation:
    device_class: str
    samples: int
    p10: float
    median: float
    mean: float
    window_seconds: float
    suppression_estimate: float


def inter_arrival_gaps(pings: list[tuple[str, float]]) -> dict[str, list[float]]:
    """Gaps per asset, then pooled per device class.

    Sorting per asset matters: pooling raw timestamps across a fleet produces
    gaps between different vehicles, which is not an interval at all.
    """
    by_asset: dict[str, list[float]] = collections.defaultdict(list)
    for asset_id, epoch in pings:
        by_asset[asset_id].append(epoch)

    gaps: list[float] = []
    for timestamps in by_asset.values():
        timestamps.sort()
        gaps += [b - a for a, b in zip(timestamps, timestamps[1:])]
    return gaps


def recommend(device_class: str, gaps: list[float]) -> WindowRecommendation:
    """Derive a window for one device class from its own gaps."""
    usable = [g for g in gaps
              if BURST_FLOOR_SECONDS <= g <= OUTAGE_CEILING_SECONDS]
    if len(usable) < 1000:
        raise ValueError(
            f"{device_class}: {len(usable)} usable gaps — too few to size a "
            "window; a recommendation from a small sample is a guess with a "
            "decimal point on it"
        )

    usable.sort()
    quantiles = statistics.quantiles(usable, n=100, method="inclusive")
    p10 = quantiles[WINDOW_PERCENTILE - 1]

    # What fraction of real reports this window would suppress. This is the
    # number to take to the consumer, because it is the one they feel.
    suppressed = sum(1 for g in usable if g < p10) / len(usable)

    return WindowRecommendation(
        device_class=device_class,
        samples=len(usable),
        p10=p10,
        median=statistics.median(usable),
        mean=statistics.fmean(usable),
        window_seconds=round(p10, 1),
        suppression_estimate=round(suppressed, 4),
    )


def window_for(device_class: str, table: dict[str, float],
               default: float = 60.0) -> float:
    """Look the window up per event; do not configure one number per fleet."""
    return table.get(device_class, default)
```

The `ValueError` on a small sample is not defensive padding. A window derived from two hundred gaps looks exactly like one derived from two million, and the difference only shows up as an unexplained change in suppression rate weeks later.

<figure class="fig">
<svg viewBox="0 0 760 214" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="One fleet-wide window applied to three device classes with very different cadences">
<title>One number cannot fit three cadences</title>
<desc>Three device classes share a pipeline: vehicle trackers reporting about every ten seconds, trailer tags reporting about every five minutes, and container seals reporting about every hour. A single fleet-wide window of sixty seconds is applied to all three. For the vehicle trackers it suppresses most reports, which may be intended. For the trailer tags it suppresses nothing at all, because their gaps are already five times the window, so the deduplication stage is pure overhead on that class. For the container seals it is even more irrelevant. Worse, tuning the single window to do something useful for the trailer tags would require raising it to several minutes, which would discard almost every vehicle ping. The classes are not close enough for a compromise to exist, so the window has to be a lookup keyed on a class carried in the event envelope — which also means a new device model arriving without a class falls back to a documented default rather than silently inheriting a number chosen for something else.</desc>
<rect x="0" y="0" width="760" height="214" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one 60 s window across three device classes</text>
<line x1="180" y1="34" x2="180" y2="160" stroke="var(--fig-rose-edge)" stroke-width="1.6" stroke-dasharray="4 3"/>
<text x="186" y="32" font-size="8.5" fill="var(--fig-rose-edge)">60 s window</text>
<text x="14" y="58" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">vehicle tracker · ~10 s</text>
<circle cx="200" cy="54" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="212" cy="54" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="224" cy="54" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="236" cy="54" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="248" cy="54" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="260" cy="54" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="290" y="58" font-size="8.5" fill="var(--fig-ink-soft)">most reports suppressed — possibly intended</text>
<text x="14" y="100" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">trailer tag · ~5 min</text>
<circle cx="200" cy="96" r="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<circle cx="380" cy="96" r="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<circle cx="560" cy="96" r="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="600" y="100" font-size="8.5" fill="var(--fig-gold-edge)">nothing suppressed — pure overhead</text>
<text x="14" y="142" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">container seal · ~1 h</text>
<circle cx="200" cy="138" r="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.2"/>
<circle cx="700" cy="138" r="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.2"/>
<text x="240" y="142" font-size="8.5" fill="var(--fig-peach-edge)">even less relevant</text>
<rect x="14" y="168" width="732" height="40" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="186" font-size="9.5" font-weight="600" fill="var(--fig-ink)">No compromise exists, so the window is a lookup keyed on a class in the envelope</text>
<text x="26" y="202" font-size="9" fill="var(--fig-ink-soft)">A new model arriving without a class then falls back to a documented default, rather than silently inheriting a number chosen for something else.</text>
</svg>
<figcaption><b>Figure 2.</b> Raising the window to help the trailer tags would discard almost every vehicle ping. The classes are too far apart for one number, which is a measurement result rather than a preference.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `WINDOW_PERCENTILE` | `int` | Low — above the burst mode, below the idle cadence | `10` |
| `BURST_FLOOR_SECONDS` | `float` | Excludes reconnection floods, which are not cadence | `0.4` |
| `OUTAGE_CEILING_SECONDS` | `float` | Excludes tunnels and garages; these are what wreck the mean | `600.0` |
| Minimum sample | `int` | Below this, raise rather than recommend | `1000` |
| Class table | `dict[str, float]` | One entry per device class differing by more than ~2× | — |
| Re-measurement | schedule | Quarterly, and after any firmware rollout | — |

</div>

## Gotchas and spatial edge cases

1. **Pool gaps per asset, never across the fleet.** Sorting every timestamp in the stream and differencing produces gaps between *different* vehicles, which for a large fleet are milliseconds apart and would recommend a window of essentially zero. The bug is easy to write and the output looks plausible.

2. **A firmware rollout changes the distribution overnight.** Devices that gain a motion trigger start producing a whole new mode, and the window sized last quarter now sits in the middle of it. Alert on a shift in the tenth percentile rather than waiting for someone to notice the suppression rate moved.

3. **The suppression estimate is what the consumer cares about, not the window.** Take "this discards 38% of reports for this class" to the team consuming the stream, because that is the number they can evaluate. A window in seconds means nothing to someone computing dwell time.

4. **Devices in a depot dominate the sample.** Parked vehicles report indefinitely and moving ones do not, so a naive sample is mostly stationary reporting. If the window is meant to govern moving assets, filter the sample by displacement first — which links this measurement to the distance threshold in the sliding window.

5. **A class with too few devices cannot be sized, only defaulted.** Rather than computing a confident-looking number from three hundred gaps, fall back to the fleet default and record that the class is unsized. The `ValueError` above is what makes that visible.

6. **The window is not the TTL.** They are independent numbers and conflating them is the failure described in [Expiring Deduplication Keys Without Losing Late Retries](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/expiring-dedup-keys-without-losing-late-retries/) — this measurement sizes only the first.

## Verification

```python
import random
import pytest


def synthetic_gaps(n: int = 50_000) -> list[float]:
    """Four modes, matching a real tracker: burst, idle, power-save, outage."""
    gaps = []
    gaps += [random.gauss(1.6, 0.4) for _ in range(int(n * 0.30))]
    gaps += [random.gauss(10.0, 1.2) for _ in range(int(n * 0.45))]
    gaps += [random.gauss(30.0, 4.0) for _ in range(int(n * 0.20))]
    gaps += [random.uniform(600, 7200) for _ in range(int(n * 0.05))]
    return [g for g in gaps if g > 0]


def test_window_sits_between_the_burst_and_idle_modes():
    rec = recommend("tracker-v3", synthetic_gaps())
    assert 0.8 < rec.window_seconds < 8.0


def test_mean_is_outside_every_mode():
    """The reason the mean must not be used."""
    rec = recommend("tracker-v3", synthetic_gaps())
    assert rec.mean > 40.0                     # above idle AND power-save
    assert rec.window_seconds < rec.median


def test_small_sample_raises_rather_than_guessing():
    with pytest.raises(ValueError, match="too few"):
        recommend("new-model", [10.0] * 50)


def test_gaps_are_computed_per_asset():
    """Two vehicles reporting alternately must not produce tiny gaps."""
    pings = []
    for i in range(100):
        pings.append(("veh-a", i * 10.0))
        pings.append(("veh-b", i * 10.0 + 0.05))   # interleaved, 50 ms apart
    gaps = inter_arrival_gaps(pings)
    assert min(gaps) > 5.0, "gaps were pooled across assets"
```

The last test is the one that catches the most common implementation mistake, and it fails loudly: a fleet-pooled computation on that input returns gaps of fifty milliseconds and would recommend a window that suppresses nothing at all.

## Related

- [Time-Windowed Deduplication for Moving Assets](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/) — the topic this guide belongs to
- [Deduplicating Vehicle Pings in a Sliding Window](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/deduplicating-vehicle-pings-in-a-sliding-window/) — where the measured window becomes a threshold
- [Expiring Deduplication Keys Without Losing Late Retries](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/expiring-dedup-keys-without-losing-late-retries/) — the other number, which this measurement does not produce
- [Choosing an H3 Resolution from Measured Traffic](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/choosing-an-h3-resolution-from-measured-traffic/) — the same measure-then-choose method applied to partitioning
