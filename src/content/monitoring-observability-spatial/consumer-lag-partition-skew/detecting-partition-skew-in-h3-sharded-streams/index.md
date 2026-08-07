---
title: "Detecting Partition Skew in H3-Sharded Streams"
description: "Quantify partition skew in H3-sharded Kafka streams by collecting per-partition counts, computing a coefficient of variation or Gini coefficient, and alerting via Prometheus."
slug: "detecting-partition-skew-in-h3-sharded-streams"
type: "article"
breadcrumb:
  - label: "Monitoring & Observability for Spatial Pipelines"
    url: "/monitoring-observability-spatial/"
  - label: "Consumer Lag & Partition Skew Monitoring"
    url: "/monitoring-observability-spatial/consumer-lag-partition-skew/"
  - label: "Detecting Partition Skew in H3-Sharded Streams"
    url: "/monitoring-observability-spatial/consumer-lag-partition-skew/detecting-partition-skew-in-h3-sharded-streams/"
datePublished: "2025-05-19"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Detecting Partition Skew in H3-Sharded Streams",
      "description": "Quantify partition skew in H3-sharded Kafka streams by collecting per-partition message counts, computing a coefficient of variation or Gini coefficient, and alerting via Prometheus.",
      "url": "https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/detecting-partition-skew-in-h3-sharded-streams/",
      "datePublished": "2025-05-19",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Monitoring & Observability for Spatial Pipelines", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/" },
        { "@type": "ListItem", "position": 2, "name": "Consumer Lag & Partition Skew Monitoring", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/" },
        { "@type": "ListItem", "position": 3, "name": "Detecting Partition Skew in H3-Sharded Streams", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/detecting-partition-skew-in-h3-sharded-streams/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Detect Partition Skew in an H3-Sharded Stream",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Sample per-partition counts over a window", "text": "Read the beginning and end log-end offsets for every partition of the topic at two points separated by a fixed window, and take the difference to get messages produced per partition during that window." },
        { "@type": "HowToStep", "position": 2, "name": "Compute a skew coefficient", "text": "Reduce the per-partition count vector to a single scalar: the coefficient of variation (stdev/mean) or the Gini coefficient, both of which are zero for a perfectly even distribution and grow as concentration increases." },
        { "@type": "HowToStep", "position": 3, "name": "Emit the coefficient as a Prometheus gauge", "text": "Publish the skew scalar as a labelled Prometheus gauge so it can be scraped, graphed over time, and compared against a threshold." },
        { "@type": "HowToStep", "position": 4, "name": "Alert on a sustained threshold breach", "text": "Fire an alert only when the coefficient stays above the threshold for several consecutive windows, so that transient bursts do not trigger a re-sharding decision." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should I use the coefficient of variation or the Gini coefficient for partition skew?",
          "acceptedAnswer": { "@type": "Answer", "text": "The coefficient of variation (stdev/mean) is cheap, unbounded, and reacts sharply to a single hot partition, which makes it a good alerting signal. The Gini coefficient is bounded to 0–1 and describes overall concentration more intuitively for dashboards. Emit both from the same count vector; alert on the coefficient of variation and use Gini for human-readable trend panels." }
        },
        {
          "@type": "Question",
          "name": "How do empty partitions affect the skew calculation?",
          "acceptedAnswer": { "@type": "Answer", "text": "Partitions with zero messages in the window are legitimate data points and must be included, because an unused partition is exactly the imbalance you are trying to detect. Do not filter zero-count partitions out before computing the statistic. Only guard against a total count of zero across the whole topic, which would make the mean zero and the coefficient of variation undefined." }
        },
        {
          "@type": "Question",
          "name": "What window length should I sample partition counts over?",
          "acceptedAnswer": { "@type": "Answer", "text": "Pick a window long enough to average out normal per-key bursts but short enough to still catch a developing hot spot — five to fifteen minutes suits most H3-sharded webhook streams. Windows under a minute are dominated by traffic noise and produce false skew alerts; windows over an hour hide a hot partition until it has already built up consumer lag." }
        },
        {
          "@type": "Question",
          "name": "The skew coefficient is high but consumer lag is fine — do I need to re-shard?",
          "acceptedAnswer": { "@type": "Answer", "text": "Not necessarily. Skew only becomes a problem when a hot partition's consumer cannot keep up, producing lag. Treat the skew coefficient as a leading indicator and gate any re-sharding decision on sustained lag on the hot partition. Re-sharding by changing the H3 resolution or partition count is expensive and rebalances every key, so only act when lag confirms the skew is structural." }
        }
      ]
    }
  ]
}
</script>

**To detect partition skew in an H3-sharded stream, sample per-partition message counts over a fixed window, reduce that count vector to a single scalar with the coefficient of variation (stdev / mean) or a Gini coefficient, publish it as a Prometheus gauge, and alert when it stays above a threshold for several consecutive windows.** A perfectly balanced topic scores zero; a single dominant partition pushes both coefficients toward their upper range.

This page belongs to [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/), part of the broader [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/) reference — the section covering how to see inside a running spatial webhook pipeline before it fails.

---

## When to use this pattern

Reach for a quantified skew metric when:

- You partition a Kafka topic by [H3](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/) cell (or any spatial key) and traffic is geographically uneven — dense urban cells generate far more events than rural ones, concentrating load on a handful of partitions.
- You need an early-warning signal that precedes consumer lag, so you can act before one consumer in a group falls permanently behind.
- You want a single numeric threshold you can alert on, rather than eyeballing a per-partition bar chart during an incident.

It is not the right tool when your topic is keyed randomly (round-robin producers spread load evenly by construction), or when you have only one or two partitions — with so few buckets the statistic is dominated by noise, and a direct per-partition lag alert is simpler and more honest.

---

## Why H3 sharding skews, and what to measure

Sharding by H3 cell gives you locality: every event for a given hexagon lands on the same partition, so an ordered, stateful consumer sees a coherent stream per area. That locality is exactly what creates skew. Human activity is spatially clustered, so the number of events per H3 cell follows a heavy-tailed distribution — a downtown cell at resolution 7 can carry orders of magnitude more webhooks than a suburban one. When the partition assignment maps that cell to a fixed partition, the imbalance is baked into the stream. The mechanics of that mapping are covered in [partitioning Kafka topics by H3 cell](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/partitioning-kafka-topics-by-h3-cell/); this page assumes the mapping exists and focuses on measuring its fairness.

The right thing to measure is the *shape* of the per-partition count vector, not any single partition's absolute rate. Two summary statistics do this well. The coefficient of variation, `stdev / mean`, is zero when every partition holds the same count and grows without bound as mass concentrates; it reacts sharply to a single outlier, which makes it a good alerting trigger. The Gini coefficient measures inequality on a 0–1 scale — 0 is perfect equality, 1 is total concentration in one partition — and reads more intuitively on a dashboard. Both derive from the same count vector, so compute them together.

<figure class="fig">
<svg viewBox="0 81 749 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Partition skew detection pipeline from Kafka offsets to a Prometheus alert">
  <title>Partition skew detection pipeline</title>
  <desc>A four-stage flow: Kafka partition offsets are sampled at the start and end of a window to produce a per-partition count vector, which is reduced to a coefficient of variation and Gini scalar, published as a Prometheus gauge, and compared against a threshold that fires an alert only after a sustained breach.</desc>
  <rect x="0" y="81" width="749" height="140" fill="var(--fig-bg)"/>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L8,3.5 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Box 1: Offsets -->
  <rect x="8" y="95" width="150" height="90" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="83" y="122" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Partition offsets</text>
  <text x="83" y="140" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">end − begin</text>
  <text x="83" y="155" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">over window W</text>
  <text x="83" y="205" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">SAMPLE</text>
  <line x1="158" y1="140" x2="182" y2="140" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 2: Count vector -->
  <rect x="184" y="95" width="152" height="90" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="260" y="122" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Count vector</text>
  <text x="260" y="140" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">[c0, c1, … cN]</text>
  <text x="260" y="155" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">keep zeros</text>
  <text x="260" y="205" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">REDUCE</text>
  <line x1="336" y1="140" x2="360" y2="140" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 3: Scalar -->
  <rect x="362" y="95" width="168" height="90" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="446" y="122" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Skew scalar</text>
  <text x="446" y="140" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">CoV = stdev / mean</text>
  <text x="446" y="155" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">Gini ∈ [0, 1]</text>
  <text x="446" y="205" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">GAUGE</text>
  <line x1="530" y1="140" x2="554" y2="140" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 4: Alert -->
  <rect x="556" y="95" width="180" height="90" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="646" y="122" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Threshold alert</text>
  <text x="646" y="140" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">CoV &gt; T for</text>
  <text x="646" y="155" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">k windows</text>
  <text x="646" y="205" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">SUSTAINED</text>
</svg>
<figcaption><b>Figure 1.</b> Partition skew detection pipeline</figcaption>
</figure>

---

## Complete runnable implementation

The collector below samples every partition's log-end offset twice, one window apart, differences them to get per-partition message counts, computes both skew coefficients, and exposes them as Prometheus gauges. It uses `confluent-kafka` for the admin/consumer offset reads and `prometheus_client` for the gauge. The statistics use only the standard library so the calculation is dependency-light and unit-testable in isolation.

```python
"""
Partition-skew collector for an H3-sharded Kafka topic.

Requires: confluent-kafka>=2.0, prometheus-client>=0.19
Run as a sidecar; it scrapes counts every WINDOW_SECONDS and republishes
two gauges. Point Prometheus at the /metrics port to scrape.
"""
import time
from statistics import mean, pstdev
from typing import Sequence

from confluent_kafka import Consumer, TopicPartition
from confluent_kafka.admin import AdminClient
from prometheus_client import Gauge, start_http_server


def coefficient_of_variation(counts: Sequence[int]) -> float:
    """
    Return stdev / mean of the per-partition counts (population stdev).

    Zero for a perfectly even distribution; grows without bound as load
    concentrates on fewer partitions. Empty partitions (count 0) are kept:
    an unused partition IS the imbalance we want to surface. Returns 0.0
    when the whole topic is idle, since the mean is then undefined.
    """
    if not counts:
        return 0.0
    mu = mean(counts)
    if mu == 0:
        return 0.0
    return pstdev(counts) / mu


def gini_coefficient(counts: Sequence[int]) -> float:
    """
    Return the Gini coefficient of the per-partition counts, in [0, 1].

    0.0 = every partition carries an equal share; values near 1.0 mean a
    single partition holds almost all messages. Computed with the sorted-
    rank formula, which is O(n log n) and exact for non-negative inputs.
    """
    n = len(counts)
    total = sum(counts)
    if n == 0 or total == 0:
        return 0.0
    ordered = sorted(counts)
    # Sum of (rank-weighted) values; ranks are 1..n over the sorted vector.
    weighted = sum((i + 1) * c for i, c in enumerate(ordered))
    return (2.0 * weighted) / (n * total) - (n + 1.0) / n


def partition_counts(consumer: Consumer, topic: str,
                     partitions: Sequence[int],
                     begin: dict[int, int]) -> tuple[list[int], dict[int, int]]:
    """
    Read current log-end offsets and difference them against `begin`.

    Returns (per-partition counts for this window, new begin offsets).
    The high watermark is the offset of the next message to be produced,
    so (end - begin) is the number of messages appended during the window.
    """
    counts, new_begin = [], {}
    for p in partitions:
        tp = TopicPartition(topic, p)
        _low, high = consumer.get_watermark_offsets(tp, timeout=10.0)
        prev = begin.get(p, high)      # first pass: treat window as empty
        counts.append(max(0, high - prev))
        new_begin[p] = high
    return counts, new_begin


def list_partitions(admin: AdminClient, topic: str) -> list[int]:
    """Discover the live partition ids for the topic from cluster metadata."""
    md = admin.list_topics(topic, timeout=10.0)
    if topic not in md.topics or md.topics[topic].error is not None:
        raise RuntimeError(f"topic {topic!r} not found in cluster metadata")
    return sorted(md.topics[topic].partitions.keys())


def run(bootstrap: str, topic: str, window_seconds: int = 300,
        metrics_port: int = 9109) -> None:
    admin = AdminClient({"bootstrap.servers": bootstrap})
    consumer = Consumer({
        "bootstrap.servers": bootstrap,
        "group.id": "skew-collector",      # never commits; read-only
        "enable.auto.commit": False,
    })

    cov_gauge = Gauge(
        "h3_partition_skew_cov",
        "Coefficient of variation of per-partition message counts",
        ["topic"],
    )
    gini_gauge = Gauge(
        "h3_partition_skew_gini",
        "Gini coefficient of per-partition message counts",
        ["topic"],
    )

    start_http_server(metrics_port)
    begin: dict[int, int] = {}
    while True:
        parts = list_partitions(admin, topic)
        counts, begin = partition_counts(consumer, topic, parts, begin)
        cov_gauge.labels(topic=topic).set(coefficient_of_variation(counts))
        gini_gauge.labels(topic=topic).set(gini_coefficient(counts))
        time.sleep(window_seconds)


if __name__ == "__main__":
    # Adjust bootstrap servers and topic to your cluster.
    run(bootstrap="localhost:9092", topic="spatial-events-h3")
```

The first loop iteration seeds the `begin` offsets and reports zero skew (its window is empty by definition); every subsequent iteration reports the true per-window distribution.

---

## Parameter reference

| Parameter | Type | Spatial constraint | Default |
|---|---|---|---|
| `topic` | `str` | The H3-sharded topic; partition count should be ≥ 8 for the statistic to be meaningful | — |
| `window_seconds` | `int` | 300–900 s balances burst-smoothing against detection latency; below 60 s traffic noise dominates | `300` |
| `metrics_port` | `int` | Any free port Prometheus can scrape; one collector per topic avoids gauge-label collisions | `9109` |
| `counts` | `Sequence[int]` | One entry per live partition, zeros included; length must equal the H3 partition count | — |
| Alert threshold `T` | `float` | On CoV: ~0.5 is a mild imbalance, > 1.0 is a single dominant partition; tune per topic | `1.0` |
| Sustain count `k` | `int` | Consecutive windows above `T` before alerting; filters transient hot cells | `3` |

---

## Gotchas and spatial edge cases

1. **Transient versus structural skew.** A one-off spatial burst — a stadium emptying, a storm cell crossing a dense metro — spikes the coefficient for a few windows, then subsides. Structural skew persists because the underlying H3 cell distribution is permanently uneven. Only structural skew justifies re-sharding. Gate alerts on `k` consecutive windows above the threshold so a single burst never triggers action.

2. **Empty partitions must stay in the vector.** It is tempting to drop zero-count partitions before computing statistics, but an idle partition is precisely the imbalance you are hunting. Filtering zeros makes a badly skewed topic look balanced. Keep every partition; only special-case a total count of zero (an idle topic), where the mean is undefined and both coefficients return `0.0`.

3. **Choosing the window is a latency trade-off.** Too short and normal per-key bursts read as skew, generating false pages; too long and a genuinely hot partition accumulates consumer lag before the metric moves. Five to fifteen minutes suits most webhook streams. If you also run a short lag alert, you can afford a longer skew window because lag catches the fast-moving failures.

4. **Offset gaps from compaction or retention.** On a log-compacted topic, or one whose retention deletes segments mid-window, `end - begin` overstates the count because deleted offsets still advance the high watermark. For skew *detection* this rarely matters — the relative shape is preserved — but do not treat the counts as an exact message tally. For an accurate produced-message count, prefer a compaction-free topic or read broker-side per-partition produce metrics.

5. **Re-sharding is expensive, so confirm before you act.** Changing the H3 resolution or the partition count remaps every key and forces a full consumer-group rebalance, replaying state for stateful consumers. The skew coefficient is a *leading* indicator; confirm sustained consumer lag on the hot partition before paying that cost. A high coefficient with healthy lag means your consumers are absorbing the imbalance fine.

6. **CoV is unbounded, Gini is not — do not compare them.** The two coefficients answer different questions. A CoV of 2.4 and a Gini of 0.7 can describe the same vector. Alert on one (CoV, for its sharp outlier response) and chart the other (Gini, for its 0–1 readability); never set a single threshold that mixes them.

---

## Verification

Unit-test the pure statistics against distributions with known answers — a flat vector must score zero, and a fully concentrated vector must approach the maximum. Run with `pytest`:

```python
import math
import pytest
from your_module import coefficient_of_variation, gini_coefficient


def test_even_distribution_has_zero_skew():
    """A perfectly balanced topic scores zero on both coefficients."""
    counts = [100, 100, 100, 100]
    assert coefficient_of_variation(counts) == 0.0
    assert gini_coefficient(counts) == 0.0


def test_single_hot_partition_is_maximally_skewed():
    """One partition holding all traffic pushes both metrics to their peak."""
    counts = [0, 0, 0, 400]
    # CoV of [0,0,0,x] is sqrt(n-1) = sqrt(3) for n = 4.
    assert coefficient_of_variation(counts) == pytest.approx(math.sqrt(3))
    # Gini approaches (n-1)/n = 0.75 for total concentration in one bucket.
    assert gini_coefficient(counts) == pytest.approx(0.75)


def test_empty_partitions_are_counted_not_filtered():
    """Zero-count partitions raise skew rather than being ignored."""
    balanced = gini_coefficient([50, 50, 50, 50])
    with_idle = gini_coefficient([50, 50, 50, 50, 0, 0])
    assert with_idle > balanced


def test_idle_topic_is_defined_and_zero():
    """A topic with no traffic must not divide by zero."""
    assert coefficient_of_variation([0, 0, 0]) == 0.0
    assert gini_coefficient([0, 0, 0]) == 0.0


def test_known_uneven_distribution():
    """A hand-checked vector matches the closed-form Gini value."""
    counts = [1, 2, 3, 4]           # total 10, n = 4
    # weighted = 1*1 + 2*2 + 3*3 + 4*4 = 30
    # gini = 2*30 / (4*10) - 5/4 = 1.5 - 1.25 = 0.25
    assert gini_coefficient(counts) == pytest.approx(0.25)
```

The `test_single_hot_partition_is_maximally_skewed` case is the important one: it pins both coefficients to their closed-form extremes on a known-uneven distribution, so a future refactor cannot silently break the calculation.

---

## FAQ

<details class="faq">
<summary><strong>Should I use the coefficient of variation or the Gini coefficient for partition skew?</strong></summary>

The coefficient of variation (stdev / mean) is cheap, unbounded, and reacts sharply to a single hot partition, which makes it a good alerting signal. The Gini coefficient is bounded to 0–1 and describes overall concentration more intuitively for dashboards. Emit both from the same count vector; alert on the coefficient of variation and use Gini for human-readable trend panels.

</details>

<details class="faq">
<summary><strong>How do empty partitions affect the skew calculation?</strong></summary>

Partitions with zero messages in the window are legitimate data points and must be included, because an unused partition is exactly the imbalance you are trying to detect. Do not filter zero-count partitions out before computing the statistic. Only guard against a total count of zero across the whole topic, which would make the mean zero and the coefficient of variation undefined.

</details>

<details class="faq">
<summary><strong>What window length should I sample partition counts over?</strong></summary>

Pick a window long enough to average out normal per-key bursts but short enough to still catch a developing hot spot — five to fifteen minutes suits most H3-sharded webhook streams. Windows under a minute are dominated by traffic noise and produce false skew alerts; windows over an hour hide a hot partition until it has already built up consumer lag.

</details>

<details class="faq">
<summary><strong>The skew coefficient is high but consumer lag is fine — do I need to re-shard?</strong></summary>

Not necessarily. Skew only becomes a problem when a hot partition's consumer cannot keep up, producing lag. Treat the skew coefficient as a leading indicator and gate any re-sharding decision on sustained lag on the hot partition. Re-sharding by changing the H3 resolution or partition count is expensive and rebalances every key, so only act when lag confirms the skew is structural.

</details>

---

## Related

- [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/) — the parent guide pairing this skew metric with consumer-lag tracking
- [Partitioning Kafka Topics by H3 Cell](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/partitioning-kafka-topics-by-h3-cell/) — the sharding scheme whose fairness this page measures
- [H3 vs S2 vs Quadkey for Spatial Partitioning](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/) — how the grid choice shapes the skew you will observe
