---
title: "Defining a Freshness SLO for a Spatial Pipeline"
description: "Write the objective against the worst geographic shard, measure from the source mutation rather than from receipt, and derive the target from what a reader would notice — not from what the pipeline currently achieves."
slug: "defining-a-freshness-slo-for-a-spatial-pipeline"
type: "article"
breadcrumb: "Monitoring & Observability for Spatial Pipelines > SLOs & Alerting for Spatial Webhook Pipelines > Defining a Freshness SLO for a Spatial Pipeline"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Defining a Freshness SLO for a Spatial Pipeline",
      "description": "A freshness objective needs three decisions before it needs a number: where the clock starts, which shard the objective is written against, and what target a reader would actually notice. This guide makes all three explicitly and shows what each one costs when it is made by default.",
      "url": "https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/defining-a-freshness-slo-for-a-spatial-pipeline/",
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
        {"@type": "ListItem", "position": 3, "name": "SLOs & Alerting for Spatial Webhook Pipelines", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/"},
        {"@type": "ListItem", "position": 4, "name": "Defining a Freshness SLO for a Spatial Pipeline", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/defining-a-freshness-slo-for-a-spatial-pipeline/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Define a freshness SLO for a spatial pipeline",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Start the clock at the source mutation, not at receipt"},
        {"@type": "HowToStep", "position": 2, "name": "Observe at commit, so queueing is inside the measurement"},
        {"@type": "HowToStep", "position": 3, "name": "Write the objective against the worst shard"},
        {"@type": "HowToStep", "position": 4, "name": "Choose the target from what a reader notices, then check it is achievable"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Where should the freshness clock start?",
          "acceptedAnswer": {"@type": "Answer", "text": "At the moment the underlying data changed, stamped by the producer at source. Starting it when the webhook receiver accepted the event measures only the part of the pipeline you already control, and excludes the producer's own batching and retry delay — which is frequently the largest term. A pipeline whose receiver-to-consumer time is four seconds while its source-to-consumer time is nine minutes has a freshness problem that its own dashboard cannot see."}
        },
        {
          "@type": "Question",
          "name": "Should freshness be observed at parse time or at commit?",
          "acceptedAnswer": {"@type": "Answer", "text": "At commit, because everything before the write is work the reader has not benefited from yet. An event parsed quickly and then queued for nine minutes behind a heavy geometry is not fresh, and measuring at parse reports the pipeline's fastest stage as though it were the whole. The rule is that the clock stops when the data becomes visible to whoever consumes it, which for a tile pipeline is when the tile is invalidated rather than when the message was read."}
        },
        {
          "@type": "Question",
          "name": "How is the numeric target chosen?",
          "acceptedAnswer": {"@type": "Answer", "text": "From what a reader would notice, then checked against what the pipeline can achieve — in that order. Deriving the target from current performance produces an objective that is satisfied by definition and tells you nothing, and it locks in whatever the pipeline happens to do today as the standard. Start from the use: a dispatcher watching vehicles notices tens of seconds, a planner reviewing parcel edits does not notice tens of minutes. Then measure whether the target is reachable, and if it is not, say so rather than moving it."}
        }
      ]
    }
  ]
}
</script>

**Start the clock at the source mutation, stop it at commit rather than at parse, write the objective against the worst shard, and pick the target from what a reader would notice — an objective derived from current performance is satisfied by construction and tells you nothing.**

This guide sits under [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/), within [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/). That topic covers the indicator set; this one covers writing the freshness objective itself.

## When to use this pattern

- The pipeline has no objective, or one whose target nobody can explain.
- Latency dashboards look healthy while consumers report stale data, which usually means the clock starts in the wrong place.
- A new stream is being onboarded and the objective is being written before the traffic exists, which is the right time.

## Three decisions, and the clock is the first

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A source-to-consumer timeline showing which segments each candidate clock start and stop includes">
<title>Where the clock runs decides what the objective is about</title>
<desc>One feature edit is traced from source to reader across five segments: the producer batching the change for up to four minutes before sending, the network delivery taking under a second, the broker queue holding it for two minutes behind a backlog, the consumer parsing it in forty milliseconds, and the write plus tile invalidation taking three seconds. A clock started at receipt and stopped at parse covers only the fourth segment and reports forty milliseconds — a number that is accurate, meaningless, and reliably green. Started at receipt and stopped at commit it covers the broker queue and the write, reporting just over two minutes, which is better but still excludes the producer's batching. Started at the source mutation and stopped at commit it covers everything the reader waits for, reporting about six minutes. Only the third measures the property the pipeline exists to provide, and the difference between it and the first is two orders of magnitude — which is why a pipeline can have a perfect latency dashboard and stale maps at the same time.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one feature edit, from source mutation to visible in a tile</text>
<rect x="30" y="30" width="220" height="26" rx="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.3"/>
<text x="40" y="47" font-size="8" fill="var(--fig-ink)">producer batching — up to 4 min</text>
<rect x="252" y="30" width="40" height="26" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="258" y="47" font-size="7.5" fill="var(--fig-ink)">net</text>
<rect x="294" y="30" width="160" height="26" rx="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="304" y="47" font-size="8" fill="var(--fig-ink)">broker queue — 2 min</text>
<rect x="456" y="30" width="34" height="26" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="461" y="47" font-size="7.5" fill="var(--fig-ink)">parse</text>
<rect x="492" y="30" width="96" height="26" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="500" y="47" font-size="8" fill="var(--fig-ink)">write + tile — 3 s</text>
<rect x="456" y="70" width="34" height="14" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="430" y="81" font-size="8.5" fill="var(--fig-rose-edge)">receipt → parse: 40 ms · accurate, meaningless, reliably green</text>
<rect x="294" y="96" width="294" height="14" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="600" y="107" font-size="8.5" fill="var(--fig-gold-edge)">receipt → commit: 2 min</text>
<rect x="30" y="122" width="558" height="14" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="600" y="133" font-size="8.5" fill="var(--fig-mint-edge)">source → commit: ≈ 6 min</text>
<rect x="14" y="154" width="732" height="60" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.4"/>
<text x="26" y="174" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Only the third measures what the reader waits for</text>
<text x="26" y="193" font-size="9" fill="var(--fig-ink-soft)">The first and the third differ by two orders of magnitude, which is how a pipeline holds a perfect latency dashboard and stale</text>
<text x="26" y="206" font-size="9" fill="var(--fig-ink-soft)">maps at the same time. Excluding the producer's batching excludes what is often the largest term.</text>
</svg>
<figcaption><b>Figure 1.</b> Each candidate clock is a defensible measurement of something. Only one of them is a measurement of the promise the pipeline makes.</figcaption>
</figure>

## Complete runnable implementation

{% raw %}
```python
import time
from dataclasses import dataclass
from datetime import datetime, UTC

from prometheus_client import Counter, Histogram

# Buckets MUST straddle the objective, or the ratio below interpolates a
# number that means nothing. The 60 s boundary is not decorative.
FRESHNESS = Histogram(
    "spatial_event_freshness_seconds",
    "Source mutation to consumer commit",
    labelnames=("shard", "stream"),
    buckets=(1, 5, 15, 30, 60, 120, 300, 900, 3600, float("inf")),
)
CLOCK_SKEW = Counter("spatial_event_future_timestamps_total",
                     "Events stamped in the future", ("shard",))


@dataclass(frozen=True, slots=True)
class FreshnessObjective:
    stream: str
    target_seconds: float      # what a reader notices
    ratio: float               # fraction that must be inside the target
    window_days: int           # over which the ratio is evaluated
    aggregation: str = "worst-shard"


OBJECTIVES = {
    # A dispatcher watching vehicles notices tens of seconds.
    "vehicle.position": FreshnessObjective("vehicle.position", 60.0, 0.99, 30),
    # A planner reviewing parcel edits does not notice tens of minutes.
    "feature.boundary_edit": FreshnessObjective("feature.boundary_edit",
                                                900.0, 0.995, 30),
}


def observe_commit(event: dict, shard: str, stream: str) -> None:
    """Record freshness at COMMIT, from the SOURCE timestamp.

    Both halves matter: parse-time observation reports the fastest stage as
    the whole, and receipt-time origin excludes the producer's batching.
    """
    occurred = datetime.fromisoformat(event["occurred_at"]).astimezone(UTC)
    elapsed = time.time() - occurred.timestamp()

    if elapsed < 0:
        # A producer clock ahead of ours. Clamping keeps the event in the
        # denominator; discarding it would silently improve the ratio.
        CLOCK_SKEW.labels(shard=shard).inc()
        elapsed = 0.0

    FRESHNESS.labels(shard=shard, stream=stream).observe(elapsed)


def recording_rules(objective: FreshnessObjective) -> str:
    """Per-shard ratio, then the worst shard. Never avg()."""
    return f"""
- record: shard:freshness_ratio:rate5m
  expr: |
    sum by (shard) (
      rate(spatial_event_freshness_seconds_bucket{{
        le="{int(objective.target_seconds)}", stream="{objective.stream}"}}[5m])
    )
    /
    sum by (shard) (
      rate(spatial_event_freshness_seconds_count{{stream="{objective.stream}"}}[5m])
    )
    # Quiet shards divide by ~0 and produce NaN, which poisons min().
    and on (shard) (
      sum by (shard) (
        rate(spatial_event_freshness_seconds_count{{stream="{objective.stream}"}}[5m])
      ) > 0.01
    )

- record: fleet:freshness_ratio:rate5m
  expr: min(shard:freshness_ratio:rate5m)
"""


def achievable(objective: FreshnessObjective, observed_ratio: float) -> str:
    """Say plainly whether the target is reachable rather than moving it."""
    if observed_ratio >= objective.ratio:
        return "met"
    if observed_ratio >= objective.ratio - 0.02:
        return "reachable with current architecture"
    return ("not reachable — the objective is correct and the pipeline is not; "
            "record the gap rather than lowering the target")
```
{% endraw %}

The `achievable` function exists to make one specific outcome sayable. An objective that the pipeline cannot meet is uncomfortable, and the usual response is to lower it until it is green, which converts a known problem into an unknown one.

<figure class="fig">
<svg viewBox="0 0 760 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="An objective derived from current performance versus one derived from reader need">
<title>Two ways to pick a number, and only one can be missed</title>
<desc>Two approaches to choosing the freshness target are contrasted. Deriving it from current performance means measuring the ninety-ninth percentile the pipeline achieves today and writing that down as the objective. The result is green from the day it ships, cannot be missed except by a regression, and encodes whatever the pipeline happens to do — including the parts nobody designed — as the standard. It also gives the error budget no meaning, because a budget only measures distance from a target that was chosen independently. Deriving it from what a reader notices means starting with the use: a dispatcher watching vehicles reacts to tens of seconds, so sixty seconds is a defensible target whether or not the pipeline currently achieves it. That objective can be missed, which is the point — a missable objective is the only kind that carries information. If the pipeline cannot reach it, the honest response is to record the gap as a known shortfall with an owner, not to move the target until the dashboard turns green.</desc>
<rect x="0" y="0" width="760" height="220" fill="var(--fig-bg)"/>
<rect x="14" y="26" width="366" height="148" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="46" font-size="10" font-weight="600" fill="var(--fig-ink)">derived from current performance</text>
<text x="26" y="68" font-size="8.5" fill="var(--fig-ink-soft)">measure today's p99, write it down</text>
<text x="26" y="88" font-size="8.5" fill="var(--fig-rose-edge)">green from the day it ships</text>
<text x="26" y="104" font-size="8.5" fill="var(--fig-rose-edge)">can only be missed by a regression</text>
<text x="26" y="124" font-size="8.5" fill="var(--fig-ink-soft)">encodes whatever the pipeline happens to do —</text>
<text x="26" y="136" font-size="8.5" fill="var(--fig-ink-soft)">including the parts nobody designed</text>
<text x="26" y="158" font-size="8.5" fill="var(--fig-rose-edge)">the error budget measures nothing</text>
<rect x="392" y="26" width="354" height="148" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="404" y="46" font-size="10" font-weight="600" fill="var(--fig-ink)">derived from what a reader notices</text>
<text x="404" y="68" font-size="8.5" fill="var(--fig-ink-soft)">a dispatcher reacts to tens of seconds → 60 s</text>
<text x="404" y="84" font-size="8.5" fill="var(--fig-ink-soft)">a planner does not notice tens of minutes → 15 min</text>
<text x="404" y="104" font-size="8.5" fill="var(--fig-mint-edge)">can be missed — which is the point</text>
<text x="404" y="124" font-size="8.5" fill="var(--fig-ink-soft)">if the pipeline cannot reach it, record the gap</text>
<text x="404" y="136" font-size="8.5" fill="var(--fig-ink-soft)">as a known shortfall with an owner</text>
<text x="404" y="158" font-size="8.5" fill="var(--fig-mint-edge)">the budget now measures a real distance</text>
<text x="14" y="196" font-size="9" fill="var(--fig-ink-soft)">A missable objective is the only kind that carries information. Moving the target until the dashboard turns green converts a</text>
<text x="14" y="209" font-size="9" fill="var(--fig-ink-soft)">known problem into an unknown one, and the pipeline is no faster afterwards.</text>
</svg>
<figcaption><b>Figure 2.</b> The uncomfortable objective is the useful one. Its discomfort is the information.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| Clock start | — | Source mutation timestamp, set by the producer | — |
| Clock stop | — | Commit, or tile invalidation — when the reader can see it | — |
| `target_seconds` | `float` | From the use, then checked for achievability | per stream |
| `ratio` | `float` | Fraction inside the target over the window | `0.99` |
| Histogram buckets | tuple | Must include an exact boundary at the target | — |
| `aggregation` | `str` | `worst-shard`; `avg` hides a saturated metro partition | `worst-shard` |

</div>

## Gotchas and spatial edge cases

1. **Retune the buckets whenever the target moves.** A target of 60 seconds against buckets of 30 and 300 cannot be evaluated at all, and Prometheus will happily return an interpolated ratio that looks like a number. Every target change is also a bucket change, and they must ship together.

2. **A dead shard leaves the aggregate and improves it.** When a consumer stops emitting, its series goes stale and `min()` stops seeing it, so the fleet ratio rises at the moment a region went dark. Pair the objective with an `absent()` alert per known shard, or the SLO reports its best figure during an outage.

3. **Clamp future timestamps rather than dropping them.** A producer clock two seconds ahead yields a negative measurement that Prometheus rejects, removing the event from the denominator and silently improving the ratio. Clamp, count the occurrence, and if skew approaches the target the objective is measuring the clocks.

4. **The stop point differs by consumer.** For a tile pipeline the reader sees the change when the tile is invalidated, not when the message is committed to a database, and the gap between those can be minutes — see [Scoping Tile Invalidation to the Zoom Levels That Changed](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/scoping-tile-invalidation-to-the-zoom-levels-that-changed/). One stream can need two objectives if it feeds two kinds of reader.

5. **Deliberate delay spends the budget.** Debouncing, batching and windowing all trade freshness for efficiency, so their maximum wait has to fit inside the target with room left for the actual work — a five-second debounce against a sixty-second objective is comfortable, sixty seconds against sixty is not.

6. **One objective per stream, not one per pipeline.** Vehicle telemetry and cadastral edits have targets an order of magnitude apart, and a single objective covering both is either far too loose for the first or unreachable for the second.

<figure class="fig">
<svg viewBox="0 0 760 188" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Histogram bucket boundaries straddling a target versus missing it entirely">
<title>A target with no bucket is a ratio Prometheus will invent</title>
<desc>The same freshness histogram is shown with two bucket layouts against a sixty-second objective. In the first, an explicit boundary sits at sixty, so the count of observations at or below sixty seconds is a stored number and the ratio is exact. In the second, the nearest boundaries are thirty and three hundred, so no stored count corresponds to the objective; a query for the fraction under sixty seconds has to interpolate within a bucket that spans nine tenths of a decade, and it returns a number that looks like a measurement and is a guess whose error depends on how the events are distributed inside that bucket. The failure is silent in both directions: the ratio can read comfortably above the objective while the true value is below it, or the reverse. Because the target and the buckets live in different files — one in the objective definition, one in the instrumentation — a change to either alone produces this, which is why they have to ship together.</desc>
<rect x="0" y="0" width="760" height="188" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">freshness histogram against a 60-second objective</text>
<text x="14" y="42" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">boundary at the objective</text>
<line x1="200" y1="58" x2="700" y2="58" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="240" y1="50" x2="240" y2="66" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="300" y1="50" x2="300" y2="66" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="380" y1="44" x2="380" y2="72" stroke="var(--fig-mint-edge)" stroke-width="2.2"/>
<text x="360" y="40" font-size="8" fill="var(--fig-mint-edge)">60 s</text>
<line x1="480" y1="50" x2="480" y2="66" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="600" y1="50" x2="600" y2="66" stroke="var(--fig-line)" stroke-width="1.2"/>
<text x="200" y="86" font-size="8.5" fill="var(--fig-mint-edge)">the count at or below 60 s is a stored number · the ratio is exact</text>
<text x="14" y="118" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">nearest boundaries 30 and 300</text>
<line x1="200" y1="134" x2="700" y2="134" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="260" y1="126" x2="260" y2="142" stroke="var(--fig-line)" stroke-width="1.2"/>
<text x="248" y="122" font-size="8" fill="var(--fig-ink-soft)">30 s</text>
<line x1="600" y1="126" x2="600" y2="142" stroke="var(--fig-line)" stroke-width="1.2"/>
<text x="588" y="122" font-size="8" fill="var(--fig-ink-soft)">300 s</text>
<rect x="262" y="128" width="336" height="12" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<line x1="380" y1="120" x2="380" y2="148" stroke="var(--fig-rose-edge)" stroke-width="2.2" stroke-dasharray="3 3"/>
<text x="360" y="118" font-size="8" fill="var(--fig-rose-edge)">60 s</text>
<text x="200" y="162" font-size="8.5" fill="var(--fig-rose-edge)">no stored count matches the objective · the query interpolates across nine tenths of a decade</text>
<text x="14" y="182" font-size="9" fill="var(--fig-ink-soft)">Silent in both directions, and the target and the buckets live in different files — which is why they have to ship together.</text>
</svg>
<figcaption><b>Figure 3.</b> An interpolated ratio looks exactly like a measured one on a dashboard, so this failure is only ever found by checking that a boundary exists.</figcaption>
</figure>

## Verification

```python
import pytest
from datetime import datetime, timedelta, UTC

NOW = datetime(2026, 8, 8, 12, 0, tzinfo=UTC)


def test_clock_starts_at_the_source_not_receipt():
    """The measurement must include the producer's batching delay."""
    event = {"occurred_at": (NOW - timedelta(minutes=6)).isoformat(),
             "received_at": (NOW - timedelta(minutes=2)).isoformat()}
    observed = _observed_value(event, now=NOW)
    assert observed > 300, "the producer's 4-minute batching was excluded"


def test_future_timestamp_is_clamped_and_counted():
    """Dropping it would silently improve the ratio."""
    event = {"occurred_at": (NOW + timedelta(seconds=2)).isoformat()}
    before = _skew_count()
    assert _observed_value(event, now=NOW) == 0.0
    assert _skew_count() == before + 1


def test_buckets_include_an_exact_boundary_at_every_target():
    """A target with no matching bucket cannot be evaluated."""
    boundaries = {1, 5, 15, 30, 60, 120, 300, 900, 3600}
    for objective in OBJECTIVES.values():
        assert objective.target_seconds in boundaries


def test_unachievable_target_is_reported_not_lowered():
    """The uncomfortable outcome must be sayable."""
    objective = OBJECTIVES["vehicle.position"]
    verdict = achievable(objective, observed_ratio=0.86)
    assert "not reachable" in verdict and "lowering" in verdict
```

The third test is cheap and catches a real failure: it fails the moment somebody changes a target without changing the histogram, which is a two-line edit in two different files that nothing else connects.

## Related

- [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/) — the topic this guide belongs to
- [Alert Rules That Survive a Bursty Spatial Stream](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/alert-rules-that-survive-a-bursty-spatial-stream/) — turning this objective into pages that are worth answering
- [An Error-Budget Policy for Tile Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/an-error-budget-policy-for-tile-pipelines/) — deciding in advance what a missed objective causes
- [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/) — the per-shard signal that explains a missed objective
