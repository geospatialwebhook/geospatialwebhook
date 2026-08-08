---
title: "SLOs & Alerting for Spatial Webhook Pipelines"
description: "Availability is the wrong SLO for a spatial pipeline. Define freshness and completeness objectives per geographic shard, write alert rules that survive a bursty stream, and spend the error budget deliberately."
slug: "slo-alerting-spatial-pipelines"
type: "topic"
breadcrumb: "Monitoring & Observability for Spatial Pipelines > SLOs & Alerting for Spatial Webhook Pipelines"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "SLOs & Alerting for Spatial Webhook Pipelines",
      "description": "A spatial pipeline can be fully available and entirely wrong: every endpoint returning 200 while one region's tiles are four hours stale. This topic defines freshness and completeness objectives measured per geographic shard, alert rules that survive bursty streams, and an error-budget policy that decides what to do when the objective is missed.",
      "url": "https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/",
      "datePublished": "2026-08-08",
      "dateModified": "2026-08-08",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Monitoring & Observability for Spatial Pipelines", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/"},
        {"@type": "ListItem", "position": 3, "name": "SLOs & Alerting for Spatial Webhook Pipelines", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Define and alert on SLOs for a spatial webhook pipeline",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Choose freshness and completeness as the indicators, not availability"},
        {"@type": "HowToStep", "position": 2, "name": "Measure the indicator per geographic shard and aggregate on the worst one"},
        {"@type": "HowToStep", "position": 3, "name": "Burn-rate alert on the budget rather than threshold-alert on the metric"},
        {"@type": "HowToStep", "position": 4, "name": "Write down what happens when the budget is exhausted"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why is availability the wrong SLO for a spatial pipeline?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because a spatial pipeline fails by going stale rather than by going down. Every endpoint can return 200, every consumer can be running, and one region's tiles can still be four hours behind because a single partition is saturated. Availability measures whether the system answered; freshness measures whether the answer was current, which is the property a map actually promises."}
        },
        {
          "@type": "Question",
          "name": "Should freshness be measured globally or per region?",
          "acceptedAnswer": {"@type": "Answer", "text": "Per region, and aggregated on the worst shard rather than the mean. Spatial load is geographically skewed by construction, so a single saturated partition covering a dense metropolitan area is invisible in a fleet-wide average dominated by hundreds of sparse rural shards. A global 99th-percentile freshness figure can sit comfortably inside its objective for weeks while one city is permanently out of date."}
        },
        {
          "@type": "Question",
          "name": "How do I stop a bursty spatial stream from paging constantly?",
          "acceptedAnswer": {"@type": "Answer", "text": "Alert on the rate at which the error budget is being consumed, over two windows at once. A short window makes the alert fast and a long window makes it stick, so a burst that resolves in ninety seconds never fires while a sustained regression fires within minutes. Threshold alerts on the raw metric cannot distinguish those two cases, which is why a bursty stream trains its operators to ignore the page."}
        },
        {
          "@type": "Question",
          "name": "What is a completeness objective and why does a spatial pipeline need one?",
          "acceptedAnswer": {"@type": "Answer", "text": "Completeness is the fraction of upstream mutations that reached the consumer at all, measured by reconciling counts against the source of truth rather than by counting what arrived. A pipeline that silently drops geometries failing validation is perfectly fresh and perfectly available while losing data, and no latency-based indicator can see that. Completeness is the only objective that catches loss."}
        },
        {
          "@type": "Question",
          "name": "What should the error-budget policy actually say?",
          "acceptedAnswer": {"@type": "Answer", "text": "It should name a specific consequence and an owner. The useful form is a freeze on non-urgent changes to the pipeline until the budget recovers, with the reliability work that would restore it taking priority over feature work. A policy that says the team will discuss it changes nothing; the point of writing it before the budget is spent is that the decision is made when nobody is under pressure."}
        }
      ]
    }
  ]
}
</script>

**A spatial pipeline fails by going stale, not by going down — so its objectives have to be freshness and completeness measured per geographic shard and aggregated on the worst one, because a fleet-wide average is dominated by hundreds of quiet rural partitions and cannot see the one city that is four hours behind.**

This topic sits under [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/), which covers what to measure in a geospatial event system and how. The instrumentation it depends on is in [Geo-Metrics Instrumentation](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/), and the per-shard lag signal that drives most of these alerts is defined in [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/).

---

## Prerequisites

- [ ] **Prometheus 2.40+ or an equivalent** — the recording rules below assume PromQL
- [ ] **A histogram of end-to-end freshness** — mutation time to consumer commit, labelled by shard
- [ ] **Per-shard labels on every pipeline metric** — H3 cell prefix, region code, or partition
- [ ] **A source-of-truth count to reconcile against** — the spatial database's own change count
- [ ] **Alertmanager or equivalent routing** — burn-rate alerts need two severities
- [ ] **A written error-budget policy** — the one artefact in this list that is not a config file

---

## Availability is not the property a map promises

The default web-service indicator is the ratio of successful responses to total responses. Applied to a spatial pipeline it measures the receiver — an endpoint returning 202 to a provider — and says nothing about whether the mutation that endpoint accepted ever reached a consumer.

Three failures that a 100% availability figure reports as healthy:

- A consumer group is stuck on one partition. The webhook receiver still accepts everything; the events queue behind a poison geometry and one region stops updating.
- Geometry validation is rejecting a producer's new output. Every rejection is logged, counted and discarded, and no HTTP request fails.
- A tile invalidation job silently drops zoom levels above 14. Requests succeed, tiles are served, and the ones served are old.

<figure class="fig">
<svg viewBox="0 0 760 232" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Availability, freshness and completeness scored against three failures that a spatial pipeline actually has">
<title>Three indicators against three real failures</title>
<desc>Three failure modes are scored against three candidate service level indicators. A consumer stuck on one partition leaves availability at one hundred percent because the receiver still returns 202, is caught by freshness because that region's events stop advancing, and is not caught by completeness because the events are queued rather than lost. Geometry validation rejecting a producer's output also leaves availability at one hundred percent, is invisible to freshness because the surviving events flow normally, and is caught only by completeness, which reconciles against the upstream count and sees the shortfall. A tile job dropping high zoom levels is invisible to availability and to completeness at the event level, and is caught by freshness only if freshness is measured at the tile rather than at the message. No single indicator covers the column, which is why a spatial pipeline needs freshness and completeness together and availability mainly as a coarse liveness check.</desc>
<rect x="0" y="0" width="760" height="232" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">which indicator sees which failure</text>
<text x="300" y="40" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">availability</text>
<text x="450" y="40" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">freshness</text>
<text x="600" y="40" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">completeness</text>
<rect x="14" y="50" width="278" height="52" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="26" y="68" font-size="9" font-weight="600" fill="var(--fig-ink)">consumer stuck on one partition</text>
<text x="26" y="84" font-size="8.5" fill="var(--fig-ink-soft)">receiver still returns 202 · events queue</text>
<text x="26" y="96" font-size="8.5" fill="var(--fig-ink-soft)">behind a poison geometry</text>
<rect x="300" y="50" width="130" height="52" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="312" y="80" font-size="8.5" fill="var(--fig-rose-edge)">blind — 100% green</text>
<rect x="440" y="50" width="140" height="52" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="452" y="80" font-size="8.5" fill="var(--fig-mint-edge)">catches it, per shard</text>
<rect x="590" y="50" width="156" height="52" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="602" y="74" font-size="8.5" fill="var(--fig-ink-soft)">no — queued, not lost,</text>
<text x="602" y="88" font-size="8.5" fill="var(--fig-ink-soft)">so counts still reconcile</text>
<rect x="14" y="110" width="278" height="52" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="26" y="128" font-size="9" font-weight="600" fill="var(--fig-ink)">validation rejecting a producer</text>
<text x="26" y="144" font-size="8.5" fill="var(--fig-ink-soft)">every rejection logged, counted</text>
<text x="26" y="156" font-size="8.5" fill="var(--fig-ink-soft)">and discarded · no request fails</text>
<rect x="300" y="110" width="130" height="52" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="312" y="140" font-size="8.5" fill="var(--fig-rose-edge)">blind — 100% green</text>
<rect x="440" y="110" width="140" height="52" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="452" y="134" font-size="8.5" fill="var(--fig-rose-edge)">blind — survivors</text>
<text x="452" y="148" font-size="8.5" fill="var(--fig-rose-edge)">flow normally</text>
<rect x="590" y="110" width="156" height="52" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="602" y="140" font-size="8.5" fill="var(--fig-mint-edge)">the only one that sees it</text>
<rect x="14" y="170" width="278" height="52" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="26" y="188" font-size="9" font-weight="600" fill="var(--fig-ink)">tile job dropping high zooms</text>
<text x="26" y="204" font-size="8.5" fill="var(--fig-ink-soft)">tiles are served · the ones served</text>
<text x="26" y="216" font-size="8.5" fill="var(--fig-ink-soft)">are old</text>
<rect x="300" y="170" width="130" height="52" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="312" y="200" font-size="8.5" fill="var(--fig-rose-edge)">blind — 100% green</text>
<rect x="440" y="170" width="140" height="52" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="452" y="194" font-size="8.5" fill="var(--fig-ink-soft)">only if measured at</text>
<text x="452" y="208" font-size="8.5" fill="var(--fig-ink-soft)">the tile, not the message</text>
<rect x="590" y="170" width="156" height="52" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="602" y="200" font-size="8.5" fill="var(--fig-rose-edge)">blind at event level</text>
</svg>
<figcaption><b>Figure 1.</b> No single indicator covers the column. Freshness and completeness together do; availability survives as a coarse liveness check and nothing more.</figcaption>
</figure>

---

## Architecture: four layers from event to objective

**Layer 1 — stamp.** Every event carries the time the underlying mutation happened, set by the producer at source. Freshness measured from receipt is a measurement of the consumer alone and misses everything upstream of it.

**Layer 2 — observe.** The consumer records `now − occurred_at` into a histogram at commit time, labelled by shard. Recording at parse time instead measures the wrong thing: an event parsed and then queued for nine minutes is not fresh.

**Layer 3 — aggregate.** A recording rule computes the per-shard ratio of events inside the freshness target, and a second rule takes the minimum across shards. The minimum, not the average, is the number the objective is written against.

**Layer 4 — decide.** Burn-rate rules turn the ratio into two alerts of different urgency, and the error-budget policy turns a sustained miss into a decision that was made in advance.

<figure class="fig">
<svg viewBox="0 0 760 246" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Per-shard freshness distribution showing a healthy fleet mean hiding one saturated metropolitan shard">
<title>Why the mean cannot see the city that is broken</title>
<desc>Freshness is plotted for twelve shards against a sixty-second objective. Ten rural shards sit between four and nine seconds because they carry almost no traffic. One suburban shard sits at thirty-one seconds, inside the objective. One metropolitan shard sits at four thousand seconds — over an hour stale — because it carries a third of the fleet's events on one partition. The traffic-weighted mean is dragged up but the unweighted fleet average across shards is about three hundred and forty seconds, and the median is nine, so a dashboard showing either reads as healthy. Aggregating on the worst shard reports four thousand seconds, which is both true and actionable. The distribution is not an accident of this deployment: spatial load is geographically skewed by construction, and any aggregate that averages across geography is averaging away the signal.</desc>
<rect x="0" y="0" width="760" height="246" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">end-to-end freshness by shard · objective 60 s · log scale</text>
<line x1="60" y1="150" x2="740" y2="150" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="60" y1="112" x2="740" y2="112" stroke="var(--fig-mint-edge)" stroke-width="1.2" stroke-dasharray="4 3"/>
<text x="620" y="108" font-size="8.5" fill="var(--fig-mint-edge)">objective 60 s</text>
<rect x="70" y="138" width="30" height="12" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="110" y="136" width="30" height="14" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="150" y="134" width="30" height="16" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="190" y="137" width="30" height="13" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="230" y="133" width="30" height="17" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="270" y="139" width="30" height="11" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="310" y="135" width="30" height="15" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="350" y="138" width="30" height="12" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="390" y="136" width="30" height="14" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="430" y="134" width="30" height="16" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="470" y="122" width="30" height="28" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<rect x="510" y="40" width="30" height="110" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="500" y="34" font-size="8.5" font-weight="600" fill="var(--fig-rose-edge)">4 000 s</text>
<text x="70" y="164" font-size="8" fill="var(--fig-ink-soft)">ten rural shards — 4 to 9 s</text>
<text x="464" y="164" font-size="8" fill="var(--fig-ink-soft)">suburb 31 s</text>
<text x="502" y="178" font-size="8" fill="var(--fig-rose-edge)">metro — one partition</text>
<text x="502" y="190" font-size="8" fill="var(--fig-rose-edge)">carrying a third of the fleet</text>
<rect x="14" y="200" width="732" height="38" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="217" font-size="9" fill="var(--fig-ink-soft)">median across shards: 9 s · unweighted mean: ≈ 340 s · worst shard: 4 000 s — only the third is both true and actionable.</text>
<text x="26" y="231" font-size="9" fill="var(--fig-ink-soft)">Spatial load is geographically skewed by construction, so averaging across geography averages away the signal.</text>
</svg>
<figcaption><b>Figure 2.</b> The objective has to be written against the worst shard. Written against the mean, it is satisfied by a fleet in which one city has been out of date since Tuesday.</figcaption>
</figure>

---

## Step-by-step implementation

### Step 1 — Instrument freshness at commit, labelled by shard

```python
import time
from datetime import datetime, UTC

from prometheus_client import Counter, Histogram

FRESHNESS = Histogram(
    "spatial_event_freshness_seconds",
    "Seconds between the source mutation and the consumer commit",
    labelnames=("shard", "stream"),
    # Buckets must straddle the objective, or the ratio below is unusable.
    buckets=(1, 5, 15, 30, 60, 120, 300, 900, 3600, float("inf")),
)

ACCEPTED = Counter(
    "spatial_events_accepted_total", "Events committed", ("shard", "stream")
)


def observe_commit(event: dict, shard: str, stream: str) -> None:
    """Record freshness AFTER the write, not after the parse.

    An event parsed and then queued for nine minutes is not fresh; measuring
    at parse time reports the pipeline's fastest stage as if it were the whole.
    """
    occurred = datetime.fromisoformat(event["occurred_at"]).astimezone(UTC)
    FRESHNESS.labels(shard=shard, stream=stream).observe(
        max(0.0, time.time() - occurred.timestamp())
    )
    ACCEPTED.labels(shard=shard, stream=stream).inc()
```

The bucket boundaries have to straddle the objective. A histogram whose nearest boundaries are 30 and 300 cannot answer "what fraction was under 60 seconds" at all, and the recording rule below will silently interpolate a number that means nothing.

### Step 2 — Aggregate on the worst shard, not the mean

```yaml
groups:
  - name: spatial-slo
    interval: 30s
    rules:
      # Per-shard: fraction of events delivered inside the 60 s objective.
      - record: shard:freshness_slo_ratio:rate5m
        expr: |
          sum by (shard) (
            rate(spatial_event_freshness_seconds_bucket{le="60"}[5m])
          )
          /
          sum by (shard) (
            rate(spatial_event_freshness_seconds_count[5m])
          )

      # Fleet: the WORST shard. min(), never avg() — a mean across shards is
      # dominated by hundreds of near-idle rural partitions.
      - record: fleet:freshness_slo_ratio:rate5m
        expr: min(shard:freshness_slo_ratio:rate5m)
```

Guard against the empty-shard case. A shard with no traffic in the window produces `0/0`, which is `NaN`, and `min()` over a set containing `NaN` behaves differently across Prometheus versions. Add `and on (shard) (sum by (shard) (rate(spatial_event_freshness_seconds_count[5m])) > 0.01)` to the per-shard rule so quiet shards drop out rather than poisoning the aggregate.

### Step 3 — Alert on burn rate over two windows

A threshold alert on the raw ratio cannot tell a ninety-second burst from a sustained regression, so on a bursty stream it fires constantly and is muted within a fortnight. Burn rate fixes this by asking a different question: at the current rate of consumption, how long until the whole budget is gone?

```yaml
      # 99% freshness over 30 days → a 1% budget. A 14.4x burn rate exhausts
      # it in about 50 hours; the short window makes the alert fast, the long
      # window makes it stick, and both must be burning for it to fire.
      - alert: SpatialFreshnessBudgetBurningFast
        expr: |
          (1 - fleet:freshness_slo_ratio:rate5m) > (14.4 * 0.01)
          and
          (1 - fleet:freshness_slo_ratio:rate1h) > (14.4 * 0.01)
        for: 2m
        labels: {severity: page}
        annotations:
          summary: "Freshness budget burning 14x — worst shard is behind"

      - alert: SpatialFreshnessBudgetBurningSlow
        expr: |
          (1 - fleet:freshness_slo_ratio:rate6h) > (3 * 0.01)
          and
          (1 - fleet:freshness_slo_ratio:rate1d) > (3 * 0.01)
        for: 15m
        labels: {severity: ticket}
```

The pairing is the point. The short window alone fires on every burst; the long window alone takes hours to notice a total outage. Requiring both means a burst that resolves in ninety seconds never pages, and a genuine regression pages within minutes.

### Step 4 — Add completeness, because freshness cannot see loss

Freshness only measures events that arrived. A pipeline dropping every geometry that fails validation is perfectly fresh while losing data, so the second objective reconciles against the source rather than counting what turned up.

```python
DROPPED = Counter(
    "spatial_events_dropped_total",
    "Events that entered the pipeline and did not reach a consumer",
    ("shard", "reason"),   # invalid_geometry, crs_unknown, schema_rejected …
)


async def reconcile(pool, shard: str, window_start, window_end) -> float:
    """Completeness = what the source emitted vs what we committed.

    Counting only what arrived cannot detect loss: a pipeline that drops
    every event is 100% complete against its own arrival count.
    """
    upstream = await pool.fetchval(
        """
        SELECT count(*) FROM feature_change_log
        WHERE shard = $1 AND changed_at >= $2 AND changed_at < $3
        """,
        shard, window_start, window_end,
    )
    if not upstream:
        return 1.0
    committed = await committed_count(shard, window_start, window_end)
    return committed / upstream
```

Label the drop counter with a reason. An error budget being spent entirely on `invalid_geometry` is a producer problem and points at [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/); one spent on `schema_rejected` is a versioning problem and points at [Schema Evolution & Versioning for Spatial Events](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/). Without the label, both look like the same number going down.

---

## Spatial validation and error handling

**Clamp negative freshness rather than discarding it.** Producer clocks drift, and a mutation stamped two seconds in the future yields a negative measurement that Prometheus rejects, so the event vanishes from the denominator and the ratio silently improves. The `max(0.0, …)` above keeps it counted. Track clock skew separately; if it exceeds the freshness objective, the objective is measuring the clocks.

**Do not let a shard disappear when it breaks.** If a consumer crashes hard enough to stop emitting, its series goes stale and `min()` stops seeing it — the fleet ratio improves at the exact moment one shard died. Add a companion alert on `absent()` per known shard, or the SLO reports its best number during an outage.

**Choose the shard label so it is stable.** Labelling by Kafka partition means every repartition rewrites history; labelling by H3 cell prefix or region code survives, which matters when comparing this month against last. The trade-offs are covered in [Spatial Partitioning Strategies](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/).

**Keep cardinality bounded.** One series per H3 cell at resolution 9 is millions of series. Use a coarse prefix — resolution 3 or 4 — or a named region, and accept that the shard is an operational unit rather than a geographic one.

---

## Retry, backoff and delivery guarantees

An SLO changes what the retry ladder is for. Without one, retries are tuned to maximise eventual delivery; with a freshness objective, a retry that succeeds after the objective has expired has still missed it, and the budget is spent either way.

That has a concrete consequence: **for a freshness-critical stream, a long retry ladder is worse than a short one plus a dead-letter path.** Six hours of patient backoff delivers an event that is six hours stale, consuming budget the whole time and eventually succeeding, so nothing alerts. Failing fast into a dead-letter queue spends the same budget but produces a visible artefact someone can act on, as described in [Dead-Letter Queues for Spatial Events](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/).

The budget also gives backpressure a defensible threshold. [Backpressure & Flow Control for Spatial Consumers](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/) has to decide when to shed, and "when the freshness budget for this shard is burning faster than 6x" is a better answer than a queue depth someone picked in a meeting.

---

## Verification

Test the rules, not the pipeline. A burn-rate rule with a transposed window is indistinguishable from a correct one until the day it fails to fire.

```python
import subprocess, json, textwrap


def promtool(rules: str, cases: str) -> None:
    """Run Prometheus' own unit-test harness over the alerting rules."""
    open("/tmp/rules.yml", "w").write(rules)
    open("/tmp/tests.yml", "w").write(cases)
    subprocess.run(["promtool", "test", "rules", "/tmp/tests.yml"], check=True)


def test_burst_does_not_page():
    """90 seconds of total failure must NOT fire the fast burn alert.

    This is the case a threshold alert gets wrong, and the reason operators
    learn to ignore spatial pipeline pages.
    """
    promtool(RULES, textwrap.dedent("""
        tests:
          - interval: 30s
            input_series:
              - series: 'spatial_event_freshness_seconds_bucket{le="60",shard="metro"}'
                values: '0+10x4 40+0x3 70+10x20'
              - series: 'spatial_event_freshness_seconds_count{shard="metro"}'
                values: '0+10x4 40+10x3 70+10x20'
            alert_rule_test:
              - eval_time: 4m
                alertname: SpatialFreshnessBudgetBurningFast
                exp_alerts: []
    """))
```

Then verify the aggregation choice directly, because it is the decision most likely to be quietly reverted by someone tidying a dashboard:

```python
def test_worst_shard_dominates():
    """One broken shard among fifty healthy ones must move the fleet number."""
    shards = {f"rural-{i}": 0.999 for i in range(49)}
    shards["metro"] = 0.41
    assert min(shards.values()) == 0.41
    assert sum(shards.values()) / len(shards) > 0.98   # what avg() would report
```

---

## Troubleshooting

<div class="table-scroll">

| Symptom | Likely spatial cause | Fix |
|---|---|---|
| SLO green, users report stale maps | Aggregating with `avg()` across shards | Aggregate with `min()`; alert on the worst shard |
| Freshness improves during an outage | A dead consumer stopped emitting, so its series left the aggregate | Add `absent()` alerts per known shard |
| Alerts fire on every traffic burst | Threshold alert on the raw ratio | Replace with two-window burn rate |
| Ratio is `NaN` for several shards | Quiet shards dividing by a zero rate | Gate the per-shard rule on a minimum event rate |
| Budget drains with no visible errors | Events dropped at validation, invisible to freshness | Add the completeness objective and label drops by reason |
| Freshness rises steadily overnight, recovers by morning | A nightly bulk load competing for the same partitions | Shed or schedule the bulk path; do not widen the objective |
| Freshness histogram unusable after a retune | Bucket boundaries no longer straddle the objective | Keep an explicit bucket at the objective value |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Why is availability the wrong SLO for a spatial pipeline?</strong></summary>

Because these pipelines fail by going stale rather than by going down. Every endpoint can return 200, every consumer can be running, and one region can still be four hours behind because a single partition is saturated. Availability measures whether the system answered; freshness measures whether the answer was current, which is what a map actually promises.

</details>

<details class="faq">
<summary><strong>Should freshness be measured globally or per region?</strong></summary>

Per region, aggregated on the worst shard. Spatial load is geographically skewed by construction, so one saturated metropolitan partition is invisible in an average dominated by hundreds of sparse rural shards. A global figure can sit inside its objective for weeks while one city is permanently out of date.

</details>

<details class="faq">
<summary><strong>How do I stop a bursty spatial stream from paging constantly?</strong></summary>

Alert on the rate at which the budget is being consumed, over a short and a long window simultaneously, and require both to be burning. The short window makes it fast, the long window makes it stick, and a burst that resolves in ninety seconds never fires.

</details>

<details class="faq">
<summary><strong>What is a completeness objective and why is one needed?</strong></summary>

Completeness is the fraction of upstream mutations that reached a consumer at all, measured by reconciling against the source of truth rather than by counting arrivals. A pipeline that silently drops geometries failing validation is perfectly fresh and perfectly available while losing data; completeness is the only indicator that catches it.

</details>

<details class="faq">
<summary><strong>What should the error-budget policy actually say?</strong></summary>

It should name a consequence and an owner — typically a freeze on non-urgent pipeline changes until the budget recovers, with the reliability work that would restore it taking priority. A policy that says the team will discuss it changes nothing. The point of writing it in advance is that the decision gets made when nobody is under pressure.

</details>

---

## Related

- [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/) — the section this topic belongs to
- [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/) — the per-shard signal most of these alerts are built on
- [Geo-Metrics Instrumentation](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/) — the counters and histograms the recording rules read
- [Structured Logging & Tracing for Spatial Handlers](https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/) — how to find the one shard once the alert has named it
- [Backpressure & Flow Control for Spatial Consumers](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/) — where the budget gives shedding a defensible threshold
