---
title: "A Grafana Dashboard for Geospatial Webhook Health"
description: "Build a Grafana dashboard for geospatial webhook health with PromQL for ingestion rate, geometry validation failures, dedup hit ratio, consumer lag, DLQ depth and P95 latency."
slug: "a-grafana-dashboard-for-geospatial-webhook-health"
type: "article"
breadcrumb:
  - label: "Monitoring & Observability for Spatial Pipelines"
    url: "/monitoring-observability-spatial/"
  - label: "Geo-Specific Metrics & Instrumentation"
    url: "/monitoring-observability-spatial/geo-metrics-instrumentation/"
  - label: "A Grafana Dashboard for Geospatial Webhook Health"
    url: "/monitoring-observability-spatial/geo-metrics-instrumentation/a-grafana-dashboard-for-geospatial-webhook-health/"
datePublished: "2025-05-01"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "A Grafana Dashboard for Geospatial Webhook Health",
      "description": "Build a Grafana dashboard for geospatial webhook health with PromQL for ingestion rate, geometry validation failures, dedup hit ratio, per-partition consumer lag, DLQ depth and P95 stage latency.",
      "url": "https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/a-grafana-dashboard-for-geospatial-webhook-health/",
      "datePublished": "2025-05-01",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Monitoring & Observability for Spatial Pipelines", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/" },
        { "@type": "ListItem", "position": 2, "name": "Geo-Specific Metrics & Instrumentation", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/" },
        { "@type": "ListItem", "position": 3, "name": "A Grafana Dashboard for Geospatial Webhook Health", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/a-grafana-dashboard-for-geospatial-webhook-health/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Build a Grafana health dashboard for a geospatial webhook pipeline",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Instrument the six golden metrics", "text": "Expose ingestion counters, geometry validation counters, dedup lookup counters, a DLQ depth gauge, and a stage-latency histogram from your Python consumer with prometheus_client." },
        { "@type": "HowToStep", "position": 2, "name": "Write PromQL per panel", "text": "Use rate() over counters for throughput and ratios, histogram_quantile for P95 latency, and gauge queries for DLQ depth and per-partition consumer lag." },
        { "@type": "HowToStep", "position": 3, "name": "Lay out the panels", "text": "Arrange ingestion rate, validation failure rate, dedup hit ratio, consumer lag & skew, DLQ depth, and P95 stage latency into a single-screen grid keyed to the pipeline stages." },
        { "@type": "HowToStep", "position": 4, "name": "Validate PromQL against Prometheus", "text": "Query the /api/v1/query endpoint with curl for each expression before wiring it into Grafana, confirming a non-empty result vector and sane values." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What time window should I use for rate() in these panels?",
          "acceptedAnswer": { "@type": "Answer", "text": "Use a window of at least 4x the scrape interval so every range has two or more samples; with a 15s scrape, 1m is the practical floor and 5m is a stable default. Match the window to the panel: short (1m) for reactive throughput graphs, longer (5m) for ratios and alert rules to damp noise. Never let the window fall below the scrape interval or rate() returns empty." }
        },
        {
          "@type": "Question",
          "name": "Should consumer lag be a counter or a gauge in Grafana?",
          "acceptedAnswer": { "@type": "Answer", "text": "Consumer lag is a gauge: it is the current difference between the log-end offset and the committed offset per partition, which rises and falls. Never wrap it in rate(). Reserve rate() for monotonic counters like events ingested or validation failures. Mixing the two — for example rate() over a lag gauge — produces meaningless negative spikes whenever lag drops." }
        },
        {
          "@type": "Question",
          "name": "How do I stop the validation failure panel alert from flapping?",
          "acceptedAnswer": { "@type": "Answer", "text": "Add a `for:` duration (5–10m) to the alert rule so a transient spike must persist before firing, widen the rate() window to 5m to smooth the ratio, and gate the ratio on a minimum request volume so a single failure against near-zero traffic cannot cross the threshold. Together these remove the vast majority of false pages." }
        },
        {
          "@type": "Question",
          "name": "Why does my dedup hit ratio panel show values above 1 or NaN?",
          "acceptedAnswer": { "@type": "Answer", "text": "NaN comes from dividing by a zero-traffic denominator when no lookups occurred in the window; wrap the expression so it only evaluates when the denominator is non-zero, or display it as a stat panel that renders no-data cleanly. Values above 1 mean your numerator label selector overlaps the denominator or double-counts — ensure hits are a strict subset of total lookups sharing an identical label set." }
        }
      ]
    }
  ]
}
</script>

**A useful geospatial webhook health dashboard is six panels wide: ingestion rate, geometry validation failure rate, dedup hit ratio, per-partition consumer lag and skew, DLQ depth, and P95 stage latency — each backed by a single PromQL expression and, where it matters, a matching alert rule.** Build it from counters and one histogram exposed by your consumer, and you can read the pipeline's health in one screen.

This page sits within [Geo-Specific Metrics & Instrumentation](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/), part of the broader [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/) section — the reference for seeing inside a spatial event pipeline in production.

---

## When to use this pattern

Reach for a single consolidated dashboard when:

- You run a geospatial webhook pipeline (ingest → validate → dedup → process → publish) and need one screen an on-call engineer can scan in ten seconds to answer "is it healthy?".
- Your metrics already flow to Prometheus (directly via `prometheus_client`, or through an exporter such as `kafka-exporter`) and you want purpose-built panels rather than a generic host dashboard.
- You need the PromQL and alert thresholds captured as reviewable code, not clicked together in the UI and lost.

It is not the right tool when you are chasing a single distributed request across services — that is a tracing problem, better served by spans than by dashboard panels. Use metrics to detect that something is wrong and traces to find where.

---

## What each panel tells you

The six panels map one-to-one onto the pipeline stages, so a red panel points at the failing stage. Throughput and failure ratios come from `rate()` over monotonic counters; DLQ depth and consumer lag are instantaneous gauges; latency is a histogram reduced to its 95th percentile. The mock below shows the layout that keeps the causal chain readable left-to-right, top-to-bottom.

<figure class="fig">
<svg viewBox="6 2 747 338" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Grafana dashboard layout for geospatial webhook health with six panels">
  <title>Geospatial webhook health dashboard layout</title>
  <desc>A six-panel grid mock. Top row: ingestion rate, geometry validation failure percent, dedup hit ratio. Bottom row: consumer lag by partition, DLQ depth, P95 stage latency. Each panel is a labelled rectangle representing a Grafana time-series or stat panel.</desc>
  <rect x="6" y="2" width="747" height="338" fill="var(--fig-bg)"/>
  <text x="20" y="30" font-size="13" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Geospatial Webhook Health</text>
  <text x="740" y="30" text-anchor="end" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">last 6h · 15s scrape</text>
  <!-- Row 1 -->
  <rect x="20" y="48" width="226" height="130" rx="8" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="133" y="72" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Ingestion Rate</text>
  <text x="133" y="88" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">events / s · time series</text>
  <polyline points="40,150 70,140 100,145 130,120 160,128 190,108 226,116" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5"/>
  <rect x="260" y="48" width="226" height="130" rx="8" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="373" y="72" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Validation Failure %</text>
  <text x="373" y="88" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">ratio · gauge + threshold</text>
  <text x="373" y="140" text-anchor="middle" font-size="22" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">0.4%</text>
  <rect x="500" y="48" width="240" height="130" rx="8" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="620" y="72" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Dedup Hit Ratio</text>
  <text x="620" y="88" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">ratio · stat</text>
  <text x="620" y="140" text-anchor="middle" font-size="22" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">12.7%</text>
  <!-- Row 2 -->
  <rect x="20" y="196" width="226" height="130" rx="8" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="133" y="220" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Consumer Lag / Partition</text>
  <text x="133" y="236" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">messages · bar gauge</text>
  <rect x="45" y="280" width="20" height="30" fill="currentColor" fill-opacity="0.4"/>
  <rect x="80" y="266" width="20" height="44" fill="currentColor" fill-opacity="0.4"/>
  <rect x="115" y="290" width="20" height="20" fill="currentColor" fill-opacity="0.4"/>
  <rect x="150" y="252" width="20" height="58" fill="currentColor" fill-opacity="0.4"/>
  <rect x="185" y="284" width="20" height="26" fill="currentColor" fill-opacity="0.4"/>
  <rect x="260" y="196" width="226" height="130" rx="8" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="373" y="220" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">DLQ Depth</text>
  <text x="373" y="236" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">messages · stat + sparkline</text>
  <text x="373" y="288" text-anchor="middle" font-size="22" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">3</text>
  <rect x="500" y="196" width="240" height="130" rx="8" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="620" y="220" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">P95 Stage Latency</text>
  <text x="620" y="236" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">seconds · time series by stage</text>
  <polyline points="520,300 560,292 600,296 640,278 680,286 720,270" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5"/>
</svg>
<figcaption><b>Figure 1.</b> Geospatial webhook health dashboard layout</figcaption>
</figure>

---

## The PromQL behind each panel

Every expression below assumes the metric names emitted by the exporter in the next section. Windows use 5m as a stable default; tune per the gotchas.

Ingestion rate (events per second, broken out by upstream source):

```text
sum by (source) (rate(webhook_events_ingested_total[5m]))
```

Geometry validation failure rate as a fraction of all validations — the numerator counts failures, the denominator all attempts, both over the same window. This is the panel that pairs with [Tracking Geometry Validation Failure Rate with Prometheus](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/tracking-geometry-validation-failure-rate-with-prometheus/):

```text
sum(rate(geometry_validation_failures_total[5m]))
/
sum(rate(geometry_validations_total[5m]))
```

Dedup hit ratio — the share of lookups that matched an existing idempotency key. A sudden climb usually means an upstream is replaying; a drop to zero can mean the dedup store is unreachable:

```text
sum(rate(dedup_lookups_total{result="hit"}[5m]))
/
sum(rate(dedup_lookups_total[5m]))
```

Per-partition consumer lag, plus a skew figure. Lag is a gauge exported by `kafka-exporter`; skew is the spread of lag across partitions, which surfaces the hot-shard problem that [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/) covers in depth:

```text
# Per-partition lag (bar gauge, one series per partition)
max by (partition) (kafka_consumergroup_lag{consumergroup="geo-webhook"})

# Skew: how far the worst partition is above the mean
max(kafka_consumergroup_lag{consumergroup="geo-webhook"})
-
avg(kafka_consumergroup_lag{consumergroup="geo-webhook"})
```

DLQ depth is a plain gauge — never wrap it in `rate()`:

```text
sum(webhook_dlq_depth)
```

P95 latency per pipeline stage, computed from the histogram's `_bucket` series. Keep `le` and `stage` in the `by` clause or `histogram_quantile` returns nothing:

```text
histogram_quantile(
  0.95,
  sum by (le, stage) (rate(webhook_stage_latency_seconds_bucket[5m]))
)
```

### A minimal Grafana panel definition

Panels are just JSON inside the dashboard model. Below is a trimmed time-series panel for the ingestion rate query — enough to import and expand:

{% raw %}
```json
{
  "type": "timeseries",
  "title": "Ingestion Rate",
  "gridPos": { "h": 8, "w": 8, "x": 0, "y": 0 },
  "datasource": { "type": "prometheus", "uid": "${DS_PROM}" },
  "fieldConfig": {
    "defaults": { "unit": "reqps", "custom": { "drawStyle": "line", "fillOpacity": 10 } }
  },
  "targets": [
    {
      "refId": "A",
      "expr": "sum by (source) (rate(webhook_events_ingested_total[5m]))",
      "legendFormat": "{{source}}"
    }
  ]
}
```
{% endraw %}

---

## Complete runnable implementation

The panels are only as good as the metrics feeding them. This self-contained exporter defines every series the dashboard queries and starts an HTTP endpoint Prometheus can scrape. Coordinates are assumed normalized to EPSG:4326 (WGS84) upstream; the labels stay low-cardinality on purpose (see the gotchas).

```python
import time
from prometheus_client import Counter, Gauge, Histogram, start_http_server

# --- Throughput and quality counters (monotonic; queried with rate()) ---
INGESTED = Counter(
    "webhook_events_ingested_total",
    "GeoJSON webhook events accepted at the ingress edge.",
    ["source"],                      # keep to a small, known set of upstreams
)
VALIDATIONS = Counter(
    "geometry_validations_total",
    "Total geometry validation attempts (denominator for failure rate).",
)
VALIDATION_FAILURES = Counter(
    "geometry_validation_failures_total",
    "Geometry validations that failed (self-intersection, bad ring, null geom).",
    ["reason"],                      # e.g. self_intersection, unclosed_ring
)
DEDUP_LOOKUPS = Counter(
    "dedup_lookups_total",
    "Idempotency-key lookups against the dedup store.",
    ["result"],                      # hit | miss
)

# --- Instantaneous gauges (never wrap in rate()) ---
DLQ_DEPTH = Gauge(
    "webhook_dlq_depth",
    "Current number of messages parked in the spatial dead-letter queue.",
)

# --- Latency histogram (one P95 per stage) ---
STAGE_LATENCY = Histogram(
    "webhook_stage_latency_seconds",
    "Wall-clock seconds spent in each pipeline stage.",
    ["stage"],                       # ingest | validate | dedup | process | publish
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)


def handle_event(event: dict, source: str) -> None:
    """Instrumented pipeline: each stage records into the metrics above."""
    INGESTED.labels(source=source).inc()

    with STAGE_LATENCY.labels(stage="validate").time():
        VALIDATIONS.inc()
        if not _is_valid_geometry(event.get("geometry")):
            VALIDATION_FAILURES.labels(reason="self_intersection").inc()
            return

    with STAGE_LATENCY.labels(stage="dedup").time():
        result = "hit" if _seen_before(event) else "miss"
        DEDUP_LOOKUPS.labels(result=result).inc()
        if result == "hit":
            return

    with STAGE_LATENCY.labels(stage="process").time():
        _process(event)


def _is_valid_geometry(geom) -> bool:
    # Placeholder for shapely validity + RFC 7946 structural checks.
    return geom is not None


def _seen_before(event: dict) -> bool:
    return False  # Placeholder for the idempotency-store lookup.


def _process(event: dict) -> None:
    time.sleep(0.01)  # Stand-in for real spatial work.


if __name__ == "__main__":
    # Prometheus scrapes http://<host>:8000/metrics
    start_http_server(8000)
    DLQ_DEPTH.set(0)  # A background job should keep this in sync with the DLQ.
    while True:
        handle_event(
            {"geometry": {"type": "Point", "coordinates": [-73.965355, 40.782865]}},
            source="fleet-tracker",
        )
        time.sleep(0.2)
```

---

## Parameter reference

Each panel, its query, and the alert worth attaching. Thresholds are starting points — calibrate against your own baseline.

<div style="overflow-x:auto;">

| Panel | PromQL (core expression) | Alert condition |
|---|---|---|
| Ingestion rate | `sum by (source) (rate(webhook_events_ingested_total[5m]))` | Fire if total drops below a floor for 10m (silent upstream) |
| Validation failure % | `sum(rate(geometry_validation_failures_total[5m])) / sum(rate(geometry_validations_total[5m]))` | `> 0.02` for 10m, gated on volume `> 1 req/s` |
| Dedup hit ratio | `sum(rate(dedup_lookups_total{result="hit"}[5m])) / sum(rate(dedup_lookups_total[5m]))` | `> 0.5` sustained (replay storm) or `== 0` (store down) |
| Consumer lag / partition | `max by (partition) (kafka_consumergroup_lag{consumergroup="geo-webhook"})` | Any partition `> 10000` for 5m |
| Partition skew | `max(kafka_consumergroup_lag{...}) - avg(kafka_consumergroup_lag{...})` | Skew `> 5000` (hot H3 shard) |
| DLQ depth | `sum(webhook_dlq_depth)` | `> 0` for 15m, or rising for 30m |
| P95 stage latency | `histogram_quantile(0.95, sum by (le, stage) (rate(webhook_stage_latency_seconds_bucket[5m])))` | `> 0.5s` on any stage for 10m |

</div>

---

## Gotchas and spatial edge cases

1. **`rate()` windows must span multiple scrape intervals.** With a 15s scrape, a `[15s]` or `[30s]` window frequently sees one or zero samples and returns empty, leaving blank panels. Use at least `4×` the scrape interval — `1m` minimum, `5m` for anything feeding an alert so a single scrape gap cannot flip the value.

2. **Never mix counters and gauges under the same function.** `rate()` belongs on monotonic counters (`_total`); wrapping it around a gauge such as `kafka_consumergroup_lag` or `webhook_dlq_depth` yields negative garbage the moment the value falls. Conversely, graphing a raw counter without `rate()` shows an ever-climbing line that means nothing.

<figure class="fig">
<svg viewBox="0 0 760 214" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="rate applied to a gauge and a raw counter graphed without rate, showing what each panel actually displays">
<title>Two panels that render fine and mean nothing</title>
<desc>Two mismatches between instrument type and PromQL function. Applying rate to a gauge such as consumer group lag: while lag climbs from zero to forty thousand the panel shows a plausible positive line, but the moment the backlog starts draining the gauge falls, rate reads the decrease as a counter reset, and the panel returns to near zero — so the graph goes quiet exactly when recovery begins and looks worst while the queue is merely filling. Graphing a raw counter without rate: the dead-letter total climbs monotonically forever, so the panel is a rising line whose slope carries all the information and whose height carries none, and a threshold on it fires once and then stays fired for the life of the process. The fix in both directions is to match the function to the instrument — rate on counters, the raw series on gauges — which is why the instrument type has to be chosen before the panel is written.</desc>
<rect x="0" y="0" width="760" height="214" fill="var(--fig-bg)"/>
<rect x="14" y="26" width="352" height="132" rx="7" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="46" font-size="10" font-weight="600" fill="var(--fig-ink)">rate(consumergroup_lag[5m]) — a gauge</text>
<polyline points="34,130 74,118 114,102 154,84 194,70 214,66 234,132 274,134 314,133 350,134" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2"/>
<line x1="214" y1="56" x2="214" y2="140" stroke="var(--fig-ink-soft)" stroke-width="1" stroke-dasharray="3,2"/>
<text x="220" y="60" font-size="8" fill="var(--fig-ink-soft)">backlog starts draining</text>
<text x="26" y="152" font-size="8.5" fill="var(--fig-rose-edge)">Goes quiet exactly when recovery begins.</text>
<rect x="386" y="26" width="360" height="132" rx="7" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="398" y="46" font-size="10" font-weight="600" fill="var(--fig-ink)">webhook_dlq_total — a counter, ungraphed by rate</text>
<polyline points="406,134 456,126 506,116 556,104 606,90 656,74 726,56" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2"/>
<line x1="398" y1="100" x2="738" y2="100" stroke="var(--fig-earth-edge)" stroke-width="1.2" stroke-dasharray="5,3"/>
<text x="738" y="114" text-anchor="end" font-size="8" fill="var(--fig-earth-edge)">threshold — crossed once, fired forever</text>
<text x="398" y="152" font-size="8.5" fill="var(--fig-rose-edge)">The slope carries the information; the height carries none.</text>
<rect x="14" y="172" width="732" height="34" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="26" y="189" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Both panels render without error and both are wrong, which is why neither is caught by looking at the dashboard.</text>
<text x="26" y="202" font-size="9" fill="var(--fig-ink-soft)">rate() belongs on _total counters; a gauge is graphed raw. Decide the instrument type first — the panel expression follows from it.</text>
</svg>
<figcaption><b>Figure 2.</b> Neither of these produces an error, a gap, or a suspicious shape — they produce a confident line that answers a different question. The mismatch is only visible if you know which instrument the metric is.</figcaption>
</figure>

3. **Alert flapping around the validation threshold.** A ratio computed over near-zero traffic swings wildly — one failure against three validations is 33%. Gate the alert on a minimum request rate and add a `for: 10m` clause so the condition must hold before paging. This is the single biggest source of false alarms on spatial pipelines with bursty upstreams.

<figure class="fig">
<svg viewBox="0 0 760 246" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A validation failure ratio computed over low traffic swinging wildly, and the same ratio gated by a minimum rate and a for clause">
<title>A ratio over near-zero traffic is mostly noise</title>
<desc>The validation failure ratio during an overnight lull when the pipeline is handling three to six events per minute. A single failure against three validations is thirty-three percent, against six is seventeen, and against none the expression returns no data — so the raw ratio swings between zero and fifty percent for hours and crosses a ten percent alert threshold eleven times overnight, none of which represent a real change in failure behaviour. Gating the same expression on a minimum request rate of one per second suppresses every one of those crossings, because the lull never reaches the floor. Adding a for clause of ten minutes then requires the condition to hold continuously before paging, so the alert survives a genuine incident at 07:40 when traffic returns and the ratio holds at twenty-two percent, and fires once, nine minutes in. The two gates address different failures: the rate floor removes statistical noise from small denominators, the for clause removes brief real spikes that resolve themselves.</desc>
<rect x="0" y="0" width="760" height="246" fill="var(--fig-bg)"/>
<line x1="70" y1="26" x2="70" y2="140" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="70" y1="140" x2="700" y2="140" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="70" y1="112" x2="700" y2="112" stroke="var(--fig-earth-edge)" stroke-width="1.3" stroke-dasharray="6,3"/>
<text x="704" y="115" font-size="8.5" fill="var(--fig-earth-edge)">10%</text>
<text x="64" y="143" text-anchor="end" font-size="8.5" fill="var(--fig-ink-soft)">0</text>
<text x="64" y="115" text-anchor="end" font-size="8.5" fill="var(--fig-ink-soft)">10%</text>
<text x="64" y="59" text-anchor="end" font-size="8.5" fill="var(--fig-ink-soft)">30%</text>
<text x="64" y="31" text-anchor="end" font-size="8.5" fill="var(--fig-ink-soft)">50%</text>
<rect x="70" y="26" width="380" height="114" fill="var(--fig-earth)" opacity="0.3"/>
<text x="260" y="20" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">overnight lull — 3 to 6 events/min</text>
<polyline points="80,140 110,54 140,140 170,86 200,140 230,28 260,140 290,96 320,140 350,60 380,140 410,90 440,140 470,138 500,139 530,66 560,64 590,62 620,65 650,63 690,64" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="460" y="158" font-size="8.5" fill="var(--fig-ink-soft)">07:40 — traffic returns, ratio holds at 22%</text>
<circle cx="530" cy="66" r="4" fill="var(--fig-mint-edge)"/>
<rect x="14" y="172" width="238" height="66" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="26" y="190" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Raw ratio</text>
<text x="26" y="207" font-size="9" fill="var(--fig-ink-soft)">1 failure of 3 = 33%. Of 0 = no data.</text>
<text x="26" y="220" font-size="9" fill="var(--fig-rose-edge)">11 threshold crossings overnight,</text>
<text x="26" y="232" font-size="9" fill="var(--fig-rose-edge)">none of them real.</text>
<rect x="260" y="172" width="238" height="66" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="272" y="190" font-size="9.5" font-weight="600" fill="var(--fig-ink)">+ minimum rate ≥ 1/s</text>
<text x="272" y="207" font-size="9" fill="var(--fig-ink-soft)">The lull never reaches the floor, so</text>
<text x="272" y="220" font-size="9" fill="var(--fig-ink-soft)">every overnight crossing disappears.</text>
<text x="272" y="232" font-size="9" fill="var(--fig-gold-edge)">Removes small-denominator noise.</text>
<rect x="506" y="172" width="240" height="66" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="518" y="190" font-size="9.5" font-weight="600" fill="var(--fig-ink)">+ for: 10m</text>
<text x="518" y="207" font-size="9" fill="var(--fig-ink-soft)">Condition must hold continuously.</text>
<text x="518" y="220" font-size="9" fill="var(--fig-ink-soft)">Fires once, 9 min into the 07:40</text>
<text x="518" y="232" font-size="9" fill="var(--fig-mint-edge)">incident. Removes brief real spikes.</text>
</svg>
<figcaption><b>Figure 3.</b> The two gates fix different problems and you need both: the rate floor discards ratios whose denominator is too small to mean anything, the <code>for</code> clause discards real but self-resolving spikes.</figcaption>
</figure>

4. **Cardinality in dashboard variables and labels.** A template variable populated from `label_values(h3_cell)` can enumerate thousands of H3 cells, and a `reason` or `source` label with unbounded values explodes series count and slows every query. Keep dashboard-facing labels to small, known sets; push high-cardinality geospatial identifiers into logs or traces, not metric labels.

5. **`histogram_quantile` needs `le` in the grouping.** Dropping the `le` label from the inner `sum by (...)` produces an empty or nonsensical quantile. Always include both `le` and your split dimension (`stage`), and remember the result is an interpolation across bucket boundaries — pick buckets that straddle your SLO.

6. **Ratios divide by zero into NaN.** When no lookups happen in a window, the dedup or failure ratio denominator is zero and Grafana renders NaN or a blank. Use a stat panel with an explicit no-data mapping, or guard the denominator, rather than letting a NaN masquerade as an outage.

---

## Verification

Before wiring an expression into Grafana, confirm it returns a sane vector straight from Prometheus. The HTTP API accepts a URL-encoded `query` parameter and returns JSON — no Grafana required:

```bash
# Instant query: does the validation failure ratio evaluate at all?
curl -s "http://localhost:9090/api/v1/query" \
  --data-urlencode 'query=sum(rate(geometry_validation_failures_total[5m])) / sum(rate(geometry_validations_total[5m]))' \
  | python -m json.tool
```

A healthy response has `"status": "success"` and a non-empty `data.result` array; each entry carries a `value` of `[timestamp, "stringified-float"]`. An empty `result` usually means the window is shorter than the scrape interval or the metric name is wrong. Check that the P95 query resolves per stage:

```bash
curl -s "http://localhost:9090/api/v1/query" \
  --data-urlencode 'query=histogram_quantile(0.95, sum by (le, stage) (rate(webhook_stage_latency_seconds_bucket[5m])))' \
  | python -m json.tool
```

You should see one result element per `stage` label. If a stage is missing, its histogram is not being observed — trace it back to a `STAGE_LATENCY.labels(stage=...)` call that never runs. Confirm the metric even exists first with `curl -s http://localhost:9090/api/v1/label/__name__/values | python -m json.tool` and grep the output for your series names.

---

## FAQ

<details class="faq">
<summary><strong>What time window should I use for rate() in these panels?</strong></summary>

Use a window of at least 4× the scrape interval so every range has two or more samples; with a 15s scrape, `1m` is the practical floor and `5m` is a stable default. Match the window to the panel: short (`1m`) for reactive throughput graphs, longer (`5m`) for ratios and alert rules to damp noise. Never let the window fall below the scrape interval or `rate()` returns empty.

</details>

<details class="faq">
<summary><strong>Should consumer lag be a counter or a gauge in Grafana?</strong></summary>

Consumer lag is a gauge: it is the current difference between the log-end offset and the committed offset per partition, which rises and falls. Never wrap it in `rate()`. Reserve `rate()` for monotonic counters like events ingested or validation failures. Mixing the two — for example `rate()` over a lag gauge — produces meaningless negative spikes whenever lag drops.

</details>

<details class="faq">
<summary><strong>How do I stop the validation failure panel alert from flapping?</strong></summary>

Add a `for:` duration (5–10m) to the alert rule so a transient spike must persist before firing, widen the `rate()` window to `5m` to smooth the ratio, and gate the ratio on a minimum request volume so a single failure against near-zero traffic cannot cross the threshold. Together these remove the vast majority of false pages.

</details>

<details class="faq">
<summary><strong>Why does my dedup hit ratio panel show values above 1 or NaN?</strong></summary>

NaN comes from dividing by a zero-traffic denominator when no lookups occurred in the window; wrap the expression so it only evaluates when the denominator is non-zero, or display it as a stat panel that renders no-data cleanly. Values above 1 mean your numerator label selector overlaps the denominator or double-counts — ensure hits are a strict subset of total lookups sharing an identical label set.

</details>

---

## Related

- [Geo-Specific Metrics & Instrumentation](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/) — parent: the metrics and instrumentation patterns these panels visualize
- [Tracking Geometry Validation Failure Rate with Prometheus](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/tracking-geometry-validation-failure-rate-with-prometheus/) — the counter design behind the validation failure panel
- [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/) — diagnosing the per-partition lag and skew this dashboard surfaces
