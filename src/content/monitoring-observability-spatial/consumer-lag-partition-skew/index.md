---
title: "Consumer Lag & Partition Skew Monitoring"
description: "Measure Kafka consumer lag per geographic shard, compute a partition-skew coefficient for H3-partitioned spatial streams, alert on it, and remediate hot cells."
slug: "consumer-lag-partition-skew"
type: "guide"
breadcrumb: "Monitoring & Observability for Spatial Pipelines > Consumer Lag & Partition Skew Monitoring"
datePublished: "2025-02-10"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Consumer Lag & Partition Skew Monitoring",
      "description": "How to measure Kafka consumer lag per geographic shard, compute a partition-skew coefficient for spatially-partitioned event streams, alert on both, and remediate hot H3 cells with finer resolution, sub-partitioning, and key salting.",
      "url": "https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/",
      "datePublished": "2025-02-10",
      "dateModified": "2026-07-13",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Monitoring & Observability for Spatial Pipelines", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/"},
        {"@type": "ListItem", "position": 3, "name": "Consumer Lag & Partition Skew Monitoring", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Monitor consumer lag and partition skew in spatial event streams",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Poll per-partition consumer-group lag from the broker"},
        {"@type": "HowToStep", "position": 2, "name": "Sample per-partition message rate over a fixed interval"},
        {"@type": "HowToStep", "position": 3, "name": "Compute the skew coefficient as the coefficient of variation of per-partition rate"},
        {"@type": "HowToStep", "position": 4, "name": "Attribute hot partitions back to their H3 cells"},
        {"@type": "HowToStep", "position": 5, "name": "Alert on lag and skew, then remediate the hot cells"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How is partition skew different from ordinary consumer lag?",
          "acceptedAnswer": {"@type": "Answer", "text": "Consumer lag is the backlog on a single partition: log-end-offset minus committed-offset. Partition skew is the shape of that backlog across all partitions. A pipeline can have low total lag while being badly skewed, and it can have high uniform lag with no skew at all. Lag tells you a consumer group is falling behind; skew tells you the cause is a spatial hot spot rather than an under-scaled consumer. You need both metrics because the remediation differs: uniform lag is fixed by adding consumers, while skew is fixed by changing how keys map to partitions."}
        },
        {
          "@type": "Question",
          "name": "What coefficient of variation should trigger a skew alert?",
          "acceptedAnswer": {"@type": "Answer", "text": "For a healthy, well-balanced spatial stream the coefficient of variation of per-partition message rate sits below 0.3. Values between 0.3 and 0.5 indicate mild imbalance that is usually tolerable. Above 0.5 a small number of dense urban cells are dominating throughput and specific partitions will chronically lag. Alert at a sustained CV above 0.5 held for several sample windows so you do not page on transient bursts, and treat a CV above 1.0 as a page-worthy incident because it means one partition is carrying more than the entire remaining fleet combined."}
        },
        {
          "@type": "Question",
          "name": "Does salting hot H3 cells break event ordering?",
          "acceptedAnswer": {"@type": "Answer", "text": "Yes, and that is the deliberate trade. Kafka only guarantees ordering within a single partition, so a stable per-cell key preserves the order of events for that cell. Appending a salt bucket spreads one hot cell across several partitions, which restores throughput balance but means two events for the same cell can now be processed out of order. Only salt cells that your skew monitor has actually flagged as hot, keep cold cells on their stable key, and make sure downstream consumers reconcile order with an event timestamp or sequence number rather than relying on arrival order."}
        },
        {
          "@type": "Question",
          "name": "Should I re-shard at a finer H3 resolution or sub-partition the hot cells?",
          "acceptedAnswer": {"@type": "Answer", "text": "Re-sharding the whole topic to a finer H3 resolution is the cleaner long-term fix when skew is systemic and many cells are hot, because it distributes the entire keyspace more evenly, but it is a disruptive migration that changes every key. Sub-partitioning or salting only the flagged cells is a surgical fix you can ship immediately without touching the majority of the traffic. In practice teams salt the handful of dense metros first to stop the bleeding, then plan a resolution change during a maintenance window if the underlying density gradient is permanent."}
        }
      ]
    }
  ]
}
</script>

**Consumer lag on a spatially-partitioned stream is never uniform: partitioning by H3 cell or geohash concentrates traffic on dense urban cells, so a handful of partitions fall permanently behind while rural partitions idle — and the fix is to measure lag per partition, quantify the imbalance with a skew coefficient, and rebalance the hot cells rather than blindly adding consumers.**

This topic belongs to [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/), the section covering how to instrument, measure, and alert on the health of geospatial event pipelines. Here the focus is the one failure mode that generic Kafka dashboards miss entirely: lag that is caused by the geography of your keys, not by the size of your consumer fleet.

---

## Prerequisites

Confirm your stack and your mental model before instrumenting. Check off each item:

- [ ] **Python 3.11+** — required for `statistics.fmean`, the `dict[int, int]` generic syntax, and structural pattern matching used below
- [ ] **`aiokafka` 0.10+** (or `confluent-kafka` 2.x) — async access to end offsets and consumer-group committed offsets
- [ ] **`h3` 4.x** — to attribute hot partitions back to the H3 cells that feed them (cells derived from EPSG:4326 (WGS84) latitude/longitude)
- [ ] **`prometheus-client` 0.20+** — to expose per-partition lag and the skew coefficient as scrapeable gauges
- [ ] **A keyed spatial topic** — events already partitioned by a spatial key; see the partitioning design decisions in [Broker Selection & Partitioning for Spatial Streams](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/)
- [ ] **Consumer-group access** — the monitor needs read access to the group's committed offsets, ideally a dedicated read-only principal
- [ ] **A baseline** — at least one week of normal traffic so you know what an unskewed CV looks like for your geography

---

## Architecture

The monitor is a small out-of-band loop that never joins the consumer group it observes. It reads two numbers per partition from the broker — the newest offset and the group's committed offset — turns them into a lag figure and a rate, and derives a single scalar that describes how lopsided the load is.

1. **Offset collection** — for every partition of the topic, read the log-end-offset (newest produced message) and the consumer group's committed-offset. Their difference is the per-partition lag.
2. **Rate sampling** — remember each partition's end-offset from the previous poll and divide the delta by the elapsed wall-clock time. This gives per-partition throughput in messages per second, which is what skew is actually measured over.
3. **Skew computation** — take the coefficient of variation (standard deviation ÷ mean) of the per-partition rate vector. A flat load profile yields a CV near zero; a few dominant cells push it above 0.5.
4. **Attribution and alerting** — map the hottest partitions back to their H3 cells so an on-call engineer sees "downtown Tokyo cell overloaded" instead of "partition 4 lagging," then emit gauges and fire an alert when both lag and CV cross their thresholds.

<figure class="fig">
<svg viewBox="0 0 760 258" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Per-partition throughput for a hash partitioner and a spatial partitioner, with the coefficient of variation for each">
<title>Why total throughput hides the partition that is drowning</title>
<desc>Twelve partitions carrying 12,000 events per second in total, shown twice. Under a hash partitioner every partition sits near a thousand events per second, the coefficient of variation is 0.04, and the aggregate number describes every partition accurately. Under an H3 partitioner the same total is shaped like a population map: two dense urban cells carry 3,900 and 2,700 events per second, four suburban cells carry between six hundred and nine hundred, and six rural cells carry under two hundred each. The coefficient of variation is 1.12. The mean is still exactly a thousand and the total is unchanged, so every aggregate dashboard looks identical between the two cases, while partition four is four times over a consumer's ceiling and permanently accumulating lag. Adding consumers cannot help, because a partition is claimed by exactly one consumer in a group: the thirteenth consumer sits idle while partition four keeps falling behind.</desc>
<rect x="0" y="0" width="760" height="258" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-mint-edge)">Hash partitioner — CV 0.04</text>
<line x1="60" y1="86" x2="700" y2="86" stroke="var(--fig-line)" stroke-width="1.1"/>
<rect x="66" y="56" width="38" height="30" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="118" y="54" width="38" height="32" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="170" y="57" width="38" height="29" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="222" y="55" width="38" height="31" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="274" y="56" width="38" height="30" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="326" y="57" width="38" height="29" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="378" y="55" width="38" height="31" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="430" y="56" width="38" height="30" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="482" y="57" width="38" height="29" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="534" y="55" width="38" height="31" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="586" y="56" width="38" height="30" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="638" y="57" width="38" height="29" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<text x="14" y="70" font-size="8.5" fill="var(--fig-ink-soft)">ev/s</text>
<text x="14" y="102" font-size="9" fill="var(--fig-ink-soft)">every partition ≈ 1,000 ev/s — the aggregate describes each one accurately</text>
<line x1="14" y1="116" x2="746" y2="116" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="136" font-size="10.5" font-weight="600" fill="var(--fig-rose-edge)">H3 partitioner — CV 1.12 · same 12,000 ev/s total, same mean</text>
<line x1="60" y1="212" x2="700" y2="212" stroke="var(--fig-line)" stroke-width="1.1"/>
<line x1="60" y1="182" x2="700" y2="182" stroke="var(--fig-earth-edge)" stroke-width="1.3" stroke-dasharray="5,3"/>
<text x="704" y="185" font-size="8.5" fill="var(--fig-earth-edge)">ceiling</text>
<rect x="66" y="146" width="38" height="66" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<rect x="118" y="166" width="38" height="46" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<rect x="170" y="197" width="38" height="15" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1"/>
<rect x="222" y="198" width="38" height="14" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1"/>
<rect x="274" y="200" width="38" height="12" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1"/>
<rect x="326" y="201" width="38" height="11" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1"/>
<rect x="378" y="207" width="38" height="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<rect x="430" y="208" width="38" height="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<rect x="482" y="208" width="38" height="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<rect x="534" y="209" width="38" height="3" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<rect x="586" y="209" width="38" height="3" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<rect x="638" y="210" width="38" height="2" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<text x="85" y="142" text-anchor="middle" font-size="8.5" font-weight="700" fill="var(--fig-rose-edge)">3,900</text>
<text x="137" y="162" text-anchor="middle" font-size="8.5" font-weight="700" fill="var(--fig-rose-edge)">2,700</text>
<text x="85" y="226" text-anchor="middle" font-size="8" fill="var(--fig-ink-soft)">downtown</text>
<text x="137" y="226" text-anchor="middle" font-size="8" fill="var(--fig-ink-soft)">port</text>
<text x="245" y="226" text-anchor="middle" font-size="8" fill="var(--fig-ink-soft)">suburban</text>
<text x="530" y="226" text-anchor="middle" font-size="8" fill="var(--fig-ink-soft)">rural</text>
<rect x="14" y="236" width="732" height="20" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="26" y="250" font-size="9.5" fill="var(--fig-ink)">Adding a 13th consumer changes nothing: a partition is claimed by exactly one consumer, so it idles while partition 1 keeps falling behind.</text>
</svg>
<figcaption><b>Figure 1.</b> Both rows have the same total and the same mean, so every aggregate dashboard reads identically. The coefficient of variation is the one number that separates them — which is why skew is measured over the per-partition rate vector, not over throughput.</figcaption>
</figure>

The diagram below shows a typical per-partition load profile for a stream keyed by H3 cell. The bars are message rate; the dashed line is the skew alert threshold. Three urban partitions punch through it while five rural partitions sit near the floor.

<figure class="fig">
<svg viewBox="41 0 707 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bar chart of per-partition message rate for an H3-partitioned stream, with three urban partitions exceeding a dashed skew alert threshold and five rural partitions well below it">
  <title>Per-partition load profile with a skew threshold</title>
  <desc>A vertical bar chart of eight Kafka partitions. Partitions 2, 4 and 6 carry heavy urban traffic and rise above a dashed horizontal skew alert threshold line, while partitions 0, 1, 3, 5 and 7 carry light rural traffic and stay far below it, illustrating spatial partition skew.</desc>
  <rect x="41" y="0" width="707" height="330" fill="var(--fig-bg)"/>
  <!-- Title -->
  <text x="380" y="24" text-anchor="middle" font-size="13" font-family="system-ui,sans-serif" fill="currentColor" font-weight="600">Per-partition message rate (msg/s)</text>
  <!-- Baseline axis -->
  <line x1="55" y1="280" x2="735" y2="280" stroke="currentColor" stroke-width="1.5" opacity="0.7"/>
  <!-- Skew threshold line at rate 164 -> y=132 -->
  <line x1="55" y1="132" x2="735" y2="132" stroke="currentColor" stroke-width="1.4" stroke-dasharray="6,4" opacity="0.7"/>
  <text x="735" y="126" text-anchor="end" font-size="10" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.8">skew alert threshold</text>
  <!-- Bars: hot (opacity 0.55) rise above the line; cold (opacity 0.25) stay low -->
  <!-- P0 rate 40 -->
  <rect x="72" y="244" width="52" height="36" fill="currentColor" opacity="0.25"/>
  <text x="98" y="238" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.7">40</text>
  <text x="98" y="294" text-anchor="middle" font-size="10" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.8">P0</text>
  <!-- P1 rate 55 -->
  <rect x="157" y="230" width="52" height="50" fill="currentColor" opacity="0.25"/>
  <text x="183" y="224" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.7">55</text>
  <text x="183" y="294" text-anchor="middle" font-size="10" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.8">P1</text>
  <!-- P2 rate 210 (hot) -->
  <rect x="242" y="91" width="52" height="189" fill="currentColor" opacity="0.55"/>
  <text x="268" y="85" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.85">210</text>
  <text x="268" y="294" text-anchor="middle" font-size="10" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.8">P2</text>
  <!-- P3 rate 60 -->
  <rect x="327" y="226" width="52" height="54" fill="currentColor" opacity="0.25"/>
  <text x="353" y="220" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.7">60</text>
  <text x="353" y="294" text-anchor="middle" font-size="10" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.8">P3</text>
  <!-- P4 rate 240 (hot) -->
  <rect x="412" y="64" width="52" height="216" fill="currentColor" opacity="0.55"/>
  <text x="438" y="58" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.85">240</text>
  <text x="438" y="294" text-anchor="middle" font-size="10" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.8">P4</text>
  <!-- P5 rate 35 -->
  <rect x="497" y="248" width="52" height="32" fill="currentColor" opacity="0.25"/>
  <text x="523" y="242" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.7">35</text>
  <text x="523" y="294" text-anchor="middle" font-size="10" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.8">P5</text>
  <!-- P6 rate 190 (hot) -->
  <rect x="582" y="109" width="52" height="171" fill="currentColor" opacity="0.55"/>
  <text x="608" y="103" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.85">190</text>
  <text x="608" y="294" text-anchor="middle" font-size="10" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.8">P6</text>
  <!-- P7 rate 45 -->
  <rect x="667" y="239" width="52" height="41" fill="currentColor" opacity="0.25"/>
  <text x="693" y="233" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.7">45</text>
  <text x="693" y="294" text-anchor="middle" font-size="10" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.8">P7</text>
  <!-- Legend -->
  <rect x="240" y="312" width="14" height="10" fill="currentColor" opacity="0.55"/>
  <text x="260" y="321" font-size="9" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.8">urban / hot cell</text>
  <rect x="380" y="312" width="14" height="10" fill="currentColor" opacity="0.25"/>
  <text x="400" y="321" font-size="9" font-family="system-ui,sans-serif" fill="currentColor" opacity="0.8">rural / idle</text>
</svg>
<figcaption><b>Figure 2.</b> Per-partition load profile with a skew threshold</figcaption>
</figure>

The visual asymmetry is the whole point. A generic "total lag" chart would average P2, P4 and P6 against the idle partitions and report a comfortable number while three partitions silently accumulate an unbounded backlog. The reason this happens specifically to spatial streams — and how the H3, S2 and Quadkey indexing choices change the density gradient — is covered in [Spatial Partitioning Strategies for Event Streams](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/).

---

## Step-by-Step Implementation

### Step 1 — Poll Per-Partition Consumer-Group Lag

Lag is `log-end-offset − committed-offset` per partition. Read both from the broker without joining the group, so the monitor never perturbs the consumer it observes.

```python
import asyncio
from aiokafka import AIOKafkaConsumer
from aiokafka.admin import AIOKafkaAdminClient
from aiokafka.structs import TopicPartition


async def poll_partition_lag(
    bootstrap: str, group_id: str, topic: str
) -> tuple[dict[int, int], dict[int, int]]:
    """
    Return (lag_by_partition, end_offset_by_partition) for one consumer
    group on one topic. Lag is log-end-offset minus committed-offset.
    The raw end offsets are returned as well so the caller can compute
    per-partition throughput between polls (see Step 2).
    """
    admin = AIOKafkaAdminClient(bootstrap_servers=bootstrap)
    consumer = AIOKafkaConsumer(bootstrap_servers=bootstrap, enable_auto_commit=False)
    await admin.start()
    await consumer.start()
    try:
        # Partition metadata may not be resolved on the very first call.
        partitions = consumer.partitions_for_topic(topic)
        if not partitions:
            await consumer._client.force_metadata_update()
            partitions = consumer.partitions_for_topic(topic) or set()

        tps = [TopicPartition(topic, p) for p in sorted(partitions)]

        # Newest offset per partition (the produce frontier).
        end_offsets = await consumer.end_offsets(tps)
        # Committed offset per partition for the target consumer group.
        group_offsets = await admin.list_consumer_group_offsets(group_id)

        lag: dict[int, int] = {}
        ends: dict[int, int] = {}
        for tp in tps:
            committed = group_offsets.get(tp)
            committed_offset = committed.offset if committed else 0
            end = end_offsets.get(tp, 0)
            ends[tp.partition] = end
            lag[tp.partition] = max(end - committed_offset, 0)
        return lag, ends
    finally:
        await consumer.stop()
        await admin.stop()
```

A partition absent from `group_offsets` means the group has never committed there — treat it as full lag from offset zero rather than skipping it, otherwise a brand-new hot partition hides until its first commit.

### Step 2 — Sample Per-Partition Message Rate

Skew is measured over throughput, not backlog. Two partitions can share the same lag while one is receiving ten times the traffic. Diff the end offsets between successive polls to get messages per second.

```python
import time


class PartitionRateSampler:
    """Convert successive end-offset snapshots into per-partition msg/s."""

    def __init__(self) -> None:
        self._last: dict[int, tuple[float, int]] = {}

    def update(self, end_offsets: dict[int, int]) -> dict[int, float]:
        now = time.monotonic()
        rates: dict[int, float] = {}
        for partition, offset in end_offsets.items():
            prev = self._last.get(partition)
            if prev is not None:
                prev_t, prev_offset = prev
                dt = now - prev_t
                if dt > 0:
                    # Guard against log truncation / retention resetting offsets.
                    rates[partition] = max(offset - prev_offset, 0) / dt
            self._last[partition] = (now, offset)
        return rates
```

The first `update` returns an empty dict because there is no previous snapshot to diff against. Poll on a fixed interval (30–60 s is typical) so the rate denominator is stable and the CV is comparable across windows.

### Step 3 — Compute the Skew Coefficient

The coefficient of variation — standard deviation divided by mean — is scale-free, so it stays meaningful whether the stream is doing 100 or 100,000 messages per second. That is exactly what you want from a skew metric.

```python
import statistics


def coefficient_of_variation(rates: list[float]) -> float:
    """
    CV = population stddev / mean of the per-partition rate vector.

    CV ~ 0.0  : perfectly balanced load across partitions
    CV < 0.3  : healthy for a spatial stream
    0.3 - 0.5 : mild, usually tolerable imbalance
    CV > 0.5  : a few dense cells dominate; specific partitions will lag
    CV > 1.0  : one partition carries more than the rest combined
    """
    if not rates:
        return 0.0
    mean = statistics.fmean(rates)
    if mean == 0:
        return 0.0
    stddev = statistics.pstdev(rates)
    return stddev / mean
```

Use population standard deviation (`pstdev`), not sample (`stdev`): the partition set is the entire population you care about, not a sample drawn from a larger one. The distinction matters when a topic has only a handful of partitions.

### Step 4 — Attribute Hot Partitions to H3 Cells

A lagging partition number is not actionable; the geography behind it is. Because Kafka's default partitioner is deterministic — `murmur2(key) % num_partitions` — you can replay any H3 cell through the same function and discover which partition it lands on, then rank the cells feeding each hot partition.

```python
import h3
from kafka.partitioner.default import murmur2  # kafka-python's murmur2


def partition_for_cell(cell: str, num_partitions: int) -> int:
    """
    Reproduce Kafka's default partitioner so a hot partition can be
    attributed back to the H3 cells that route to it. `cell` is an H3
    index string derived from an EPSG:4326 (WGS84) lat/lon.
    """
    key = cell.encode("utf-8")
    # toPositive(murmur2(key)) % numPartitions, matching the Java client.
    return (murmur2(key) & 0x7FFFFFFF) % num_partitions


def cells_feeding_partition(
    candidate_cells: list[str], partition: int, num_partitions: int
) -> list[str]:
    """Filter a known set of active cells down to those routing to `partition`."""
    return [
        c for c in candidate_cells
        if h3.is_valid_cell(c) and partition_for_cell(c, num_partitions) == partition
    ]
```

Feed `candidate_cells` from the distinct cells observed in the last window of events. The output turns "P4 is lagging" into "cell `8928308280fffff` (downtown Manhattan) is the dominant contributor to P4," which is what the on-call engineer needs. The mechanics of which spatial index produces the tightest density balance are compared on the [H3 vs S2 vs Quadkey for Spatial Partitioning](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/) page.

### Step 5 — Alert on Lag and Skew

Export both signals as Prometheus gauges and combine them in the alert rule. Lag alone over-pages during traffic spikes; skew alone misses a uniformly under-scaled consumer. The union of "backlog is growing" and "load is lopsided" is the precise condition that spatial rebalancing fixes.

```python
from prometheus_client import Gauge

lag_gauge = Gauge(
    "spatial_consumer_lag", "Per-partition consumer lag", ["topic", "partition"]
)
rate_gauge = Gauge(
    "spatial_partition_rate", "Per-partition msg/s", ["topic", "partition"]
)
skew_gauge = Gauge(
    "spatial_partition_skew_cv", "Coefficient of variation of per-partition rate",
    ["topic"],
)


async def monitor_loop(
    bootstrap: str, group_id: str, topic: str,
    interval_s: float = 45.0, cv_alert: float = 0.5,
) -> None:
    sampler = PartitionRateSampler()
    while True:
        lag, ends = await poll_partition_lag(bootstrap, group_id, topic)
        rates = sampler.update(ends)

        for partition, value in lag.items():
            lag_gauge.labels(topic=topic, partition=str(partition)).set(value)
        for partition, value in rates.items():
            rate_gauge.labels(topic=topic, partition=str(partition)).set(value)

        cv = coefficient_of_variation(list(rates.values()))
        skew_gauge.labels(topic=topic).set(cv)

        if cv > cv_alert and rates:
            hottest = max(rates, key=rates.get)
            print(
                f"SKEW ALERT topic={topic} cv={cv:.2f} "
                f"hottest_partition={hottest} lag={lag.get(hottest, 0)}"
            )
        await asyncio.sleep(interval_s)
```

The corresponding Prometheus rule fires only when both conditions hold, for example `spatial_partition_skew_cv > 0.5 and max(spatial_consumer_lag) > 50000` sustained over ten minutes. This same gauge naming convention plugs directly into the broader metric taxonomy described in [Geo-Specific Metrics & Instrumentation](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/).

---

## Spatial Validation and Error Handling

The monitor consumes offsets, but the correctness of its output depends on the spatial keys behind them. Validate the snapshot before you compute or alert, so a metadata glitch never fires a false skew page.

```python
from pydantic import BaseModel, field_validator


class PartitionSnapshot(BaseModel):
    """A validated single-poll view before skew is computed."""

    topic: str
    lag: dict[int, int]
    rates: dict[int, float]

    @field_validator("lag", "rates")
    @classmethod
    def no_negative_values(cls, v: dict) -> dict:
        # Negative lag or rate signals an offset reset (retention/truncation),
        # not real traffic — clamp rather than propagate a garbage CV.
        return {k: max(val, 0) for k, val in v.items()}

    def is_meaningful(self) -> bool:
        # Skip skew computation until every partition has reported a rate;
        # a partial vector produces an inflated, misleading CV.
        return bool(self.rates) and len(self.rates) == len(self.lag)
```

Three error conditions matter in production. First, an offset reset from log retention makes a delta negative — clamp it, as above, rather than letting it poison the mean. Second, a partition missing from the committed-offset map is a real state (never-committed), not an error, and must count as full lag. Third, an invalid or all-zero rate vector on the first poll must short-circuit before `coefficient_of_variation`, which is why `is_meaningful` gates the computation. Validating H3 cells with `h3.is_valid_cell` during attribution (Step 4) closes the loop: a malformed key that slipped past the producer would otherwise be silently misattributed to partition zero.

---

## Remediation: Rebalancing the Hot Cells

<figure class="fig">
<svg viewBox="0 0 760 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Three responses to a hot spatial partition and what each one actually changes">
<title>Three ways to unload a hot cell, and what each costs</title>
<desc>Partition one is carrying 3,900 events per second against a consumer ceiling of one thousand. Adding consumers does nothing at all: a partition is claimed by exactly one consumer in a group, so extra consumers sit idle and the coefficient of variation is unchanged — this is the response people reach for first and the only one that cannot work. Salting the hot cell appends a bounded suffix so its traffic spreads across four partitions at about 975 events per second each, which brings the coefficient of variation down to about 0.31 and costs per-cell ordering for that cell alone. Re-keying at a finer resolution splits the dense cell into seven children, spreading load across many partitions and lowering the coefficient of variation to about 0.28, but it changes the key for every event in the topic and is therefore a dual-write migration rather than a configuration change. The first is free and useless, the second is cheap and targeted, the third is correct and expensive.</desc>
<rect x="0" y="0" width="760" height="250" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-ink)">Partition 1 at 3,900 ev/s · ceiling 1,000 · CV 1.12</text>
<rect x="14" y="32" width="240" height="120" rx="7" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="134" y="52" text-anchor="middle" font-size="10" font-weight="600" fill="var(--fig-ink)">Add consumers</text>
<rect x="30" y="62" width="60" height="26" rx="4" fill="var(--fig-bg)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="60" y="79" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">c1 · p1</text>
<rect x="98" y="62" width="60" height="26" rx="4" fill="var(--fig-bg)" stroke="var(--fig-line-soft)" stroke-width="1.2" stroke-dasharray="3,2"/>
<text x="128" y="79" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">c13 idle</text>
<rect x="166" y="62" width="60" height="26" rx="4" fill="var(--fig-bg)" stroke="var(--fig-line-soft)" stroke-width="1.2" stroke-dasharray="3,2"/>
<text x="196" y="79" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">c14 idle</text>
<text x="30" y="108" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">CV unchanged — 1.12</text>
<text x="30" y="124" font-size="8.5" fill="var(--fig-ink-soft)">One partition, one consumer. Extra</text>
<text x="30" y="136" font-size="8.5" fill="var(--fig-ink-soft)">consumers cannot claim it.</text>
<text x="30" y="148" font-size="8.5" fill="var(--fig-rose-edge)">The instinctive fix, and the only useless one.</text>
<rect x="262" y="32" width="240" height="120" rx="7" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="382" y="52" text-anchor="middle" font-size="10" font-weight="600" fill="var(--fig-ink)">Salt the hot cell</text>
<rect x="278" y="62" width="52" height="26" rx="4" fill="var(--fig-bg)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="304" y="79" text-anchor="middle" font-size="8" fill="var(--fig-ink)">#0 · 975</text>
<rect x="336" y="62" width="52" height="26" rx="4" fill="var(--fig-bg)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="362" y="79" text-anchor="middle" font-size="8" fill="var(--fig-ink)">#1 · 975</text>
<rect x="394" y="62" width="52" height="26" rx="4" fill="var(--fig-bg)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="420" y="79" text-anchor="middle" font-size="8" fill="var(--fig-ink)">#2 · 975</text>
<rect x="452" y="62" width="38" height="26" rx="4" fill="var(--fig-bg)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="471" y="79" text-anchor="middle" font-size="8" fill="var(--fig-ink)">#3</text>
<text x="278" y="108" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">CV 1.12 → 0.31</text>
<text x="278" y="124" font-size="8.5" fill="var(--fig-ink-soft)">A config change, applied per cell.</text>
<text x="278" y="136" font-size="8.5" fill="var(--fig-ink-soft)">Costs per-cell ordering for this cell</text>
<text x="278" y="148" font-size="8.5" fill="var(--fig-ink-soft)">only — every other cell untouched.</text>
<rect x="510" y="32" width="236" height="120" rx="7" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.6"/>
<text x="628" y="52" text-anchor="middle" font-size="10" font-weight="600" fill="var(--fig-ink)">Re-key at r8</text>
<polygon points="560,62 574,70 574,86 560,94 546,86 546,70" fill="var(--fig-bg)" stroke="var(--fig-gold-edge)" stroke-width="1.1"/>
<polygon points="588,62 602,70 602,86 588,94 574,86 574,70" fill="var(--fig-bg)" stroke="var(--fig-gold-edge)" stroke-width="1.1"/>
<polygon points="616,62 630,70 630,86 616,94 602,86 602,70" fill="var(--fig-bg)" stroke="var(--fig-gold-edge)" stroke-width="1.1"/>
<polygon points="644,62 658,70 658,86 644,94 630,86 630,70" fill="var(--fig-bg)" stroke="var(--fig-gold-edge)" stroke-width="1.1"/>
<polygon points="672,62 686,70 686,86 672,94 658,86 658,70" fill="var(--fig-bg)" stroke="var(--fig-gold-edge)" stroke-width="1.1"/>
<text x="526" y="108" font-size="9" font-weight="600" fill="var(--fig-gold-edge)">CV 1.12 → 0.28</text>
<text x="526" y="124" font-size="8.5" fill="var(--fig-ink-soft)">Best load shape, but it re-keys</text>
<text x="526" y="136" font-size="8.5" fill="var(--fig-ink-soft)">every event in the topic — a</text>
<text x="526" y="148" font-size="8.5" fill="var(--fig-ink-soft)">dual-write migration, not a setting.</text>
<rect x="14" y="166" width="732" height="76" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="184" font-size="10" font-weight="600" fill="var(--fig-ink)">Reach for them in this order</text>
<text x="26" y="202" font-size="9" fill="var(--fig-ink-soft)">Salting first: it is reversible, scoped to the cells that are actually hot, and the ordering it sacrifices is ordering within one dense cell —</text>
<text x="26" y="215" font-size="9" fill="var(--fig-ink-soft)">usually a city centre where events are near-simultaneous anyway. Re-key only when several cells are hot at once, or when salting has</text>
<text x="26" y="228" font-size="9" fill="var(--fig-ink-soft)">grown to a fan-out you can no longer reason about. Never respond to a skew alert by scaling the consumer group — that reads as action</text>
<text x="26" y="238" font-size="9" fill="var(--fig-ink-soft)">while the lag keeps climbing.</text>
</svg>
<figcaption><b>Figure 3.</b> Skew is a key-space problem, so only a change to the key space fixes it. Scaling the consumer group is the reflex response and the one option that provably cannot help.</figcaption>
</figure>

Once the monitor names the hot cells, three remedies apply in increasing order of disruption.

**Salt the flagged cells.** The surgical fix: spread a single dense cell across several partitions by appending a bucket suffix to its key, while leaving cold cells on a stable key to preserve their ordering.

```python
HOT_CELLS: set[str] = {"8928308280fffff"}  # cells flagged by the skew monitor


def routing_key(cell: str, event_id: str, salt_buckets: int = 4) -> str:
    """
    For hot cells only, distribute events across `salt_buckets` synthetic
    sub-keys so one dense urban cell no longer maps to a single partition.
    Cold cells keep a stable, unsalted key to retain per-cell ordering.

    Trade-off: salted cells lose strict per-cell ordering. Downstream
    consumers must reconcile order using an event timestamp, not arrival.
    """
    if cell in HOT_CELLS:
        bucket = hash(event_id) % salt_buckets
        return f"{cell}#{bucket}"
    return cell
```

**Sub-partition at a finer H3 resolution for hot cells.** Instead of a random salt, re-key hot cells to their child cells (`h3.cell_to_children(cell, res + 1)`), which spreads load geographically and keeps neighbouring events together — useful when downstream joins are locality-sensitive.

**Re-shard the whole topic at a finer resolution.** The systemic fix when many cells are hot: raising the base H3 resolution flattens the density gradient across the entire keyspace. It is a full-topic migration that changes every key, so reserve it for a maintenance window once salting has stopped the immediate bleeding. The child page [Detecting Partition Skew in H3-Sharded Streams](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/detecting-partition-skew-in-h3-sharded-streams/) walks through choosing between these three responses with worked density numbers.

---

## Verification

Two properties must hold: the skew coefficient must be correct for known inputs, and partition attribution must be deterministic. Confirm both with pytest.

```python
import math
import pytest

from skew_monitor import (  # your module from the steps above
    coefficient_of_variation,
    partition_for_cell,
    PartitionRateSampler,
)


def test_balanced_load_has_near_zero_cv():
    # Identical rates -> zero variance -> CV of exactly 0.
    assert coefficient_of_variation([100.0, 100.0, 100.0, 100.0]) == 0.0


def test_skewed_load_exceeds_threshold():
    # Three idle partitions and one dominant one -> CV well above 0.5.
    cv = coefficient_of_variation([10.0, 10.0, 10.0, 240.0])
    assert cv > 0.5


def test_cv_is_scale_free():
    # Multiplying every rate by a constant must not change the CV.
    base = [40.0, 55.0, 210.0, 60.0]
    scaled = [r * 1000 for r in base]
    assert math.isclose(
        coefficient_of_variation(base),
        coefficient_of_variation(scaled),
        rel_tol=1e-9,
    )


def test_partition_attribution_is_deterministic():
    # The same cell must always map to the same partition (12 partitions).
    cell = "8928308280fffff"
    first = partition_for_cell(cell, 12)
    assert all(partition_for_cell(cell, 12) == first for _ in range(100))
    assert 0 <= first < 12


def test_rate_sampler_needs_two_snapshots():
    sampler = PartitionRateSampler()
    assert sampler.update({0: 1000, 1: 2000}) == {}  # first poll: no baseline
    rates = sampler.update({0: 1600, 1: 2050})        # second poll: has deltas
    assert rates[0] > rates[1]  # partition 0 grew faster
```

Run with `pytest -v`. The scale-free test is the one that catches regressions: if someone swaps the coefficient of variation for a raw standard deviation, that assertion fails immediately, because standard deviation grows with traffic volume and would trigger false skew alerts every peak hour.

---

## Troubleshooting

<div style="overflow-x:auto;">

| Symptom | Likely spatial cause | Fix |
|---------|----------------------|-----|
| Total lag looks fine but some consumers never catch up | Skew hidden by averaging; hot partitions masked by idle ones | Compute per-partition lag and the CV; stop trusting a single total-lag number |
| Skew CV spikes then recovers every evening | Diurnal traffic shifting to one metro's cells during local peak | Alert on sustained CV over several windows, not instantaneous values |
| Adding consumers does not reduce lag on the busy partition | One partition is the bottleneck; more consumers cannot split a single partition | Salt or sub-partition the hot cell so its load spans multiple partitions |
| Rate vector shows a negative value | Log retention or truncation reset the end offset below the prior snapshot | Clamp deltas to zero in the sampler; do not feed negatives into the CV |
| A hot partition maps back to "no cells" | Attribution used the wrong partition count or a stale cell list | Pass the live `num_partitions` and rebuild the candidate cell set each window |
| CV reads absurdly high right after startup | Skew computed on the first, partial rate snapshot | Gate the computation behind `is_meaningful`; require every partition to report |
| Salting a cell fixed lag but broke downstream ordering | Salt spread one cell across partitions, losing per-cell order | Reconcile order downstream by event timestamp; only salt flagged hot cells |

</div>

---

## FAQ

<details class="faq">
<summary><strong>How is partition skew different from ordinary consumer lag?</strong></summary>

Consumer lag is the backlog on a single partition: log-end-offset minus committed-offset. Partition skew is the shape of that backlog across all partitions. A pipeline can have low total lag while being badly skewed, and it can have high uniform lag with no skew at all. Lag tells you a consumer group is falling behind; skew tells you the cause is a spatial hot spot rather than an under-scaled consumer. You need both metrics because the remediation differs: uniform lag is fixed by adding consumers, while skew is fixed by changing how keys map to partitions.

</details>

<details class="faq">
<summary><strong>What coefficient of variation should trigger a skew alert?</strong></summary>

For a healthy, well-balanced spatial stream the coefficient of variation of per-partition message rate sits below 0.3. Values between 0.3 and 0.5 indicate mild imbalance that is usually tolerable. Above 0.5 a small number of dense urban cells are dominating throughput and specific partitions will chronically lag. Alert at a sustained CV above 0.5 held for several sample windows so you do not page on transient bursts, and treat a CV above 1.0 as a page-worthy incident because it means one partition is carrying more than the entire remaining fleet combined.

</details>

<details class="faq">
<summary><strong>Does salting hot H3 cells break event ordering?</strong></summary>

Yes, and that is the deliberate trade. Kafka only guarantees ordering within a single partition, so a stable per-cell key preserves the order of events for that cell. Appending a salt bucket spreads one hot cell across several partitions, which restores throughput balance but means two events for the same cell can now be processed out of order. Only salt cells that your skew monitor has actually flagged as hot, keep cold cells on their stable key, and make sure downstream consumers reconcile order with an event timestamp or sequence number rather than relying on arrival order.

</details>

<details class="faq">
<summary><strong>Should I re-shard at a finer H3 resolution or sub-partition the hot cells?</strong></summary>

Re-sharding the whole topic to a finer H3 resolution is the cleaner long-term fix when skew is systemic and many cells are hot, because it distributes the entire keyspace more evenly, but it is a disruptive migration that changes every key. Sub-partitioning or salting only the flagged cells is a surgical fix you can ship immediately without touching the majority of the traffic. In practice teams salt the handful of dense metros first to stop the bleeding, then plan a resolution change during a maintenance window if the underlying density gradient is permanent.

</details>

---

## Related

- [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/) — the parent section covering health, metrics, tracing, and alerting across geospatial event pipelines
- [Geo-Specific Metrics & Instrumentation](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/) — the metric taxonomy and Prometheus conventions the lag and skew gauges plug into
- [Detecting Partition Skew in H3-Sharded Streams](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/detecting-partition-skew-in-h3-sharded-streams/) — a focused walkthrough of choosing between salting, sub-partitioning, and re-sharding with worked density numbers
- [Broker Selection & Partitioning for Spatial Streams](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/) — the upstream partitioning decisions that determine how much skew you will see
- [Spatial Partitioning Strategies for Event Streams](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/) — how spatial keys map to partitions and why dense cells concentrate load
