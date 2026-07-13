---
title: "Monitoring & Observability for Spatial Pipelines"
description: "Instrument geospatial webhook pipelines in Python: geo-specific Prometheus metrics, structured logs carrying bbox and H3 context, and OpenTelemetry traces across async geometry handlers."
slug: "monitoring-observability-spatial"
type: "pillar"
breadcrumb: "Monitoring & Observability for Spatial Pipelines"
datePublished: "2025-02-01"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Monitoring & Observability for Python Geospatial Webhook Pipelines",
      "description": "How to instrument geospatial webhook and event pipelines in Python: the geo-specific metrics that matter (geometry validation failure rate, CRS-mismatch rate, partition skew, consumer lag per shard, dedup hit ratio, vertex-count distribution), Prometheus instrumentation, structured logging with spatial context, and OpenTelemetry tracing across async geometry handlers.",
      "url": "https://geospatialwebhook.com/monitoring-observability-spatial/",
      "datePublished": "2025-02-01",
      "dateModified": "2026-07-13",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Monitoring & Observability for Spatial Pipelines", "item": "https://geospatialwebhook.com/monitoring-observability-spatial/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Instrument a Geospatial Webhook Pipeline for Observability",
      "step": [
        {"@type": "HowToStep", "name": "Define geo-specific metrics", "text": "Declare Prometheus Counters and Histograms for geometry validation outcomes, CRS mismatches, and payload vertex counts, labelled by H3 shard and EPSG code."},
        {"@type": "HowToStep", "name": "Instrument the validation boundary", "text": "Increment outcome counters at the ingestion boundary and observe vertex-count and parse-time histograms before dispatch."},
        {"@type": "HowToStep", "name": "Emit structured logs with spatial context", "text": "Attach bounding box, H3 cell, and EPSG code to every log line as machine-parseable fields, not free text."},
        {"@type": "HowToStep", "name": "Trace events across async handlers", "text": "Wrap each async geometry handler in an OpenTelemetry span and propagate trace context through the broker as message headers."},
        {"@type": "HowToStep", "name": "Alert on rate of change, not absolute counts", "text": "Set alert thresholds on ratios and deltas — validation failure rate, partition skew, consumer lag per shard — so alerts survive traffic growth."}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Which metrics are unique to geospatial pipelines that generic HTTP dashboards miss?",
          "acceptedAnswer": {"@type": "Answer", "text": "Generic dashboards track request rate, latency, and error codes. They cannot see geometry validation failure rate, CRS-mismatch rate, partition skew across H3 or geohash shards, dedup hit ratio, or payload vertex-count distribution. These are the metrics that explain why a spatial pipeline degrades, because the failure is usually in the shape of the data, not the transport."}
        },
        {
          "@type": "Question",
          "name": "How do I label Prometheus metrics with spatial context without causing cardinality explosion?",
          "acceptedAnswer": {"@type": "Answer", "text": "Never label a metric with a raw coordinate, a full H3 cell ID at resolution 9+, or a geometry hash — each unique value creates a new time series. Label with low-cardinality dimensions instead: EPSG code, geometry type, a coarse H3 resolution (0-3) for shard grouping, and a bounded outcome enum. Keep the product of all label values per metric in the low thousands."}
        },
        {
          "@type": "Question",
          "name": "What is partition skew and why does it matter for spatial streams?",
          "acceptedAnswer": {"@type": "Answer", "text": "Partition skew is uneven event distribution across shards when you partition a stream by a spatial key such as an H3 cell or geohash prefix. Dense urban cells receive orders of magnitude more events than rural ones, so one consumer saturates while others idle. It shows up as high consumer lag on a single partition even though total throughput looks healthy, which is invisible to aggregate dashboards."}
        },
        {
          "@type": "Question",
          "name": "How should I structure logs so spatial context is queryable?",
          "acceptedAnswer": {"@type": "Answer", "text": "Emit JSON logs where bounding box, H3 cell, EPSG code, and geometry type are first-class fields rather than interpolated into a message string. A structured field lets you filter by EPSG code or bbox range in your log store; a string forces slow full-text search. Keep coordinate precision bounded so bbox values stay stable and diffable."}
        },
        {
          "@type": "Question",
          "name": "Where do I put OpenTelemetry spans in an async geometry pipeline?",
          "acceptedAnswer": {"@type": "Answer", "text": "Create one span per meaningful stage: receive and parse, validate topology, transform CRS, and persist. Set span attributes for EPSG code, vertex count, and H3 cell so a slow trace tells you which geometry caused it. Propagate the trace context through the broker as message headers so the consumer span links to the producer span across the async boundary."}
        },
        {
          "@type": "Question",
          "name": "What alert thresholds make sense for geo-specific metrics?",
          "acceptedAnswer": {"@type": "Answer", "text": "Alert on rates and ratios, not absolute counts, so thresholds survive traffic growth. A validation failure rate above roughly 1 percent sustained, a CRS-mismatch rate that steps up after a producer deploy, per-shard consumer lag exceeding your redelivery window, and partition skew where the hottest shard exceeds three to five times the median are all actionable signals."}
        }
      ]
    }
  ]
}
</script>

<p class="uplink"><a href="/">Home</a> → Monitoring &amp; Observability for Spatial Pipelines</p>

Every other section of this site builds a spatial pipeline — receiving webhooks, deduplicating events, routing and parsing geometries, guaranteeing delivery. This section measures them. Observability is the discipline of being able to answer, from telemetry alone, why a running geospatial system is behaving the way it is: which geometries are failing validation, which geographic shard is lagging, whether your deduplication layer is actually catching duplicates, and where a single event spent its time as it crossed a fleet of async handlers. For platform engineers, GIS backend developers, and SaaS founders running real-time spatial systems, generic application monitoring is necessary but nowhere near sufficient. Request rate, p95 latency, and HTTP status codes describe the transport. They are blind to the shape of the data, and in spatial systems the shape of the data is where almost every interesting failure lives.

This is the observability layer for the architectures the rest of the site teaches, so it deliberately does not re-explain how to build them. It measures and diagnoses them. The material divides into three implementation concerns, each with its own dedicated guide: [Geo-Specific Metrics & Instrumentation](/monitoring-observability-spatial/geo-metrics-instrumentation/) for the numbers only geo workloads produce, [Consumer Lag & Partition Skew Monitoring](/monitoring-observability-spatial/consumer-lag-partition-skew/) for keeping sharded spatial streams balanced, and [Structured Logging & Tracing for Spatial Events](/monitoring-observability-spatial/structured-logging-tracing/) for reconstructing the path of a single event through async geometry handlers. Together they form the three planes of observability — metrics, logs, and traces — wrapped around a spatial pipeline.

---

## Why Generic Observability Misses the Spatial Failures

A conventional monitoring stack watches a webhook receiver and reports that it is returning `200 OK` in 12 milliseconds at 800 requests per second. Everything looks healthy. Meanwhile, a firmware update on a fleet of IoT sensors has started emitting self-intersecting polygons, 4 percent of incoming events are being quietly routed to a dead-letter queue, and a downstream map is going stale in three cities. None of that is visible in the transport metrics, because the transport is working perfectly. The failure is entirely in the geometry.

Spatial pipelines fail along axes that generic dashboards cannot see:

**The failure is in the payload, not the protocol.** A geometry can be perfectly valid JSON and a perfectly formed HTTP body while being an invalid polygon under the OGC Simple Features rules. HTTP-level monitoring sees a well-formed request; only geometry-aware instrumentation sees the topology error. You need a metric that increments specifically when `shape()` succeeds but `is_valid` returns false.

**The distribution matters more than the average.** A payload vertex-count histogram with a healthy median can hide a long tail of million-vertex multipolygons that each block an event loop for hundreds of milliseconds. An average latency number smears that tail into invisibility. Spatial workloads are defined by their outliers — the one enormous geometry, the one hot shard, the one CRS nobody expected — so percentiles and full distributions matter far more than means.

**Aggregate throughput hides geographic imbalance.** When you partition a stream by a spatial key — an H3 cell, a geohash prefix, a Quadkey — total throughput can look balanced while a single dense urban shard is drowning. This is [partition skew](/monitoring-observability-spatial/consumer-lag-partition-skew/), and it is unique to spatially partitioned streams because population density, not a hash function, decides how events distribute. A round-robin partitioner produces even load by construction; a spatial partitioner produces load shaped like a population map.

**Correctness is invisible without a dedicated signal.** Whether your idempotency layer is actually catching duplicates is not something you can infer from success rates. If [spatial deduplication](/idempotency-spatial-deduplication/) silently stops matching — because a producer changed coordinate precision, say — every duplicate now sails through and creates a phantom record, and the only symptom is a slow-rising storage bill. The dedup hit ratio has to be an explicit, watched metric or the regression is undetectable until it is a data-quality incident.

The remedy is to instrument the pipeline at the level of the data it carries. That means three coordinated planes: geo-aware metrics for aggregate health and alerting, structured logs that carry spatial context on every line, and distributed traces that follow one event across async boundaries. The rest of this guide covers how they fit together and how to build each in Python.

---

## The Three Instrumentation Planes Around a Spatial Pipeline

Metrics, logs, and traces answer different questions and you need all three. Metrics answer "is the system healthy, and is it getting worse?" — they are cheap, aggregate, and drive alerts. Logs answer "what exactly happened to this event?" — they are detailed, per-event, and drive forensic investigation. Traces answer "where did this event spend its time, across every service and handler it touched?" — they connect causally-related work across the async boundaries that make spatial pipelines hard to reason about. The diagram below shows all three planes wrapped around the same pipeline, each tapping the stages it needs.

<svg viewBox="0 0 760 420" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Three instrumentation planes — metrics, logs, and traces — wrapped around a four-stage spatial pipeline of receive, validate, transform CRS, and persist" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>Three Observability Planes Around a Spatial Pipeline</title>
  <desc>A central horizontal spatial pipeline of four stages — Receive and parse, Validate topology, Transform CRS, Persist and dispatch — with a metrics plane above feeding Prometheus, a logs plane below feeding a structured log store, and a traces plane spanning all four stages feeding an OpenTelemetry collector.</desc>
  <defs>
    <marker id="arr-obs" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Metrics plane (top) -->
  <text x="20" y="34" font-family="system-ui,sans-serif" font-size="11" fill="currentColor" opacity="0.7" font-weight="600">METRICS plane</text>
  <rect x="560" y="16" width="180" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <text x="650" y="34" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="currentColor" opacity="0.7">Prometheus</text>
  <text x="650" y="48" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="currentColor" opacity="0.55">counters · histograms</text>
  <!-- Pipeline stages (middle) -->
  <rect x="30" y="180" width="150" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <text x="105" y="205" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="currentColor" font-weight="600">Receive</text>
  <text x="105" y="222" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="currentColor" opacity="0.7">parse payload</text>
  <rect x="205" y="180" width="150" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <text x="280" y="205" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="currentColor" font-weight="600">Validate</text>
  <text x="280" y="222" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="currentColor" opacity="0.7">topology check</text>
  <rect x="380" y="180" width="150" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <text x="455" y="205" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="currentColor" font-weight="600">Transform CRS</text>
  <text x="455" y="222" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="currentColor" opacity="0.7">EPSG normalize</text>
  <rect x="555" y="180" width="150" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <text x="630" y="205" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="currentColor" font-weight="600">Persist</text>
  <text x="630" y="222" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="currentColor" opacity="0.7">upsert · dispatch</text>
  <!-- pipeline arrows -->
  <line x1="180" y1="210" x2="203" y2="210" stroke="currentColor" stroke-width="1.5" opacity="0.55" marker-end="url(#arr-obs)"/>
  <line x1="355" y1="210" x2="378" y2="210" stroke="currentColor" stroke-width="1.5" opacity="0.55" marker-end="url(#arr-obs)"/>
  <line x1="530" y1="210" x2="553" y2="210" stroke="currentColor" stroke-width="1.5" opacity="0.55" marker-end="url(#arr-obs)"/>
  <!-- metrics taps (up) -->
  <line x1="280" y1="180" x2="280" y2="60" stroke="currentColor" stroke-width="1" opacity="0.4" marker-end="url(#arr-obs)"/>
  <line x1="455" y1="180" x2="455" y2="60" stroke="currentColor" stroke-width="1" opacity="0.4" marker-end="url(#arr-obs)"/>
  <text x="300" y="120" font-family="system-ui,sans-serif" font-size="9" fill="currentColor" opacity="0.6">validation outcomes</text>
  <text x="475" y="140" font-family="system-ui,sans-serif" font-size="9" fill="currentColor" opacity="0.6">CRS-mismatch rate</text>
  <!-- Logs plane (bottom) -->
  <text x="20" y="392" font-family="system-ui,sans-serif" font-size="11" fill="currentColor" opacity="0.7" font-weight="600">LOGS plane</text>
  <rect x="560" y="372" width="180" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <text x="650" y="390" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="currentColor" opacity="0.7">Structured log store</text>
  <text x="650" y="404" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="currentColor" opacity="0.55">bbox · H3 · EPSG fields</text>
  <line x1="280" y1="240" x2="280" y2="368" stroke="currentColor" stroke-width="1" opacity="0.4" marker-end="url(#arr-obs)"/>
  <line x1="630" y1="240" x2="630" y2="368" stroke="currentColor" stroke-width="1" opacity="0.4" marker-end="url(#arr-obs)"/>
  <!-- Traces plane (spanning band) -->
  <text x="20" y="272" font-family="system-ui,sans-serif" font-size="11" fill="currentColor" opacity="0.7" font-weight="600">TRACES plane</text>
  <rect x="30" y="280" width="675" height="26" rx="6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.35" stroke-dasharray="4 3"/>
  <text x="367" y="297" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="currentColor" opacity="0.6">one OpenTelemetry trace spans all stages · context propagated as broker headers → OTel collector</text>
</svg>

A practical implication of this layering is that each plane has a different cost profile and therefore a different sampling strategy. Metrics are always-on and aggregate, so you keep them all. Logs are per-event and can be voluminous, so you emit them structured but may sample the successful path and always keep failures. Traces are the most expensive per event, so you sample them — but you bias sampling toward the interesting: always trace an event that failed validation or hit a hot shard, sample the boring successes at a low rate. Getting this right is what keeps observability affordable at spatial-webhook volumes.

---

## The Metrics That Only Matter for Geo Workloads

A generic service exposes request count, error count, and a latency histogram. A spatial pipeline needs those too, but its real health lives in a second set of metrics that describe the geometry flowing through it. The table below is the core catalogue — the metrics you should be exposing from a production geospatial webhook system, with the Prometheus metric type, why it earns its place, and guidance on where to set an alert. Full instrumentation for each lives in [Geo-Specific Metrics & Instrumentation](/monitoring-observability-spatial/geo-metrics-instrumentation/); the point here is the shape of the catalogue.

| Metric | Prometheus type | Why it matters | Alert threshold guidance |
|---|---|---|---|
| Geometry validation failure rate | Counter (ratio of failed to total) | Isolates topology errors — self-intersections, bad ring winding, NaN coordinates — that HTTP status codes never surface | Sustained > ~1% over 5 min, or any step-change after a producer deploy |
| CRS-mismatch rate | Counter, labelled by EPSG code | Detects producers sending an unexpected or missing projection before it corrupts spatial joins | Any nonzero rate for an EPSG code not on your allowlist; step-up after upstream change |
| Partition skew (hot-shard ratio) | Gauge (max shard load ÷ median) | Reveals geographic imbalance across H3/geohash shards that aggregate throughput hides | Hottest shard > 3–5× median sustained |
| Consumer lag per geographic shard | Gauge, labelled by shard | Shows a single dense shard falling behind while others idle | Per-shard lag exceeding your redelivery/retry window |
| Dedup hit ratio | Counter (duplicates ÷ total) | Confirms the idempotency layer is actually catching duplicates; a drop signals silent regression | Sudden drop toward zero, or a spike signalling a provider retry storm |
| Payload vertex-count distribution | Histogram | Surfaces the heavy-geometry tail that blocks event loops and inflates parse time | p99 crossing your async-offload threshold (e.g. > 10k vertices) |
| Geometry parse/validate latency | Histogram | Separates CPU-bound geometry work from I/O so you know which to scale | p95 rising while request latency is flat |
| DLQ arrival rate (spatial) | Counter, labelled by failure stage | Quantifies events being shed to the dead-letter queue and at which pipeline stage | Any sustained nonzero rate; investigate the dominant stage label |

Two of these deserve pointers to their home sections. Consumer lag per geographic shard is where observability meets delivery: the pipeline that produces lag — brokers, retries, redelivery windows — is built in [Queue Management, Retries & Delivery Guarantees](/queue-management-retry-delivery/), and this section watches the lag that pipeline generates. The dedup hit ratio measures the effectiveness of [Idempotency & Spatial Deduplication](/idempotency-spatial-deduplication/); a healthy ratio is the proof that the deduplication layer described there is still doing its job in production.

A note that governs every row: keep label cardinality bounded. A Prometheus metric creates one time series per unique combination of label values, so labelling by raw coordinate, full-resolution H3 cell, or geometry hash will produce millions of series and take down your monitoring backend before it ever helps you. Label with the EPSG code, the geometry type, a coarse shard identifier, and a bounded outcome enum — dimensions with tens of values, not millions.

### Instrumenting Geometry Validation Outcomes with Prometheus

The single most valuable geo-specific metric is validation outcome, because it converts an invisible data-quality problem into a graph you can alert on. Here is a self-contained instrumentation of the validation boundary using the Prometheus Python client. A `Counter` tracks outcomes labelled by result and geometry type; a `Histogram` records the vertex count so the heavy-geometry tail is visible. The dedicated walkthrough is [Tracking Geometry Validation Failure Rate with Prometheus](/monitoring-observability-spatial/geo-metrics-instrumentation/tracking-geometry-validation-failure-rate-with-prometheus/).

```python
from prometheus_client import Counter, Histogram
from shapely.geometry import shape
from shapely.validation import explain_validity

# Low-cardinality labels only: outcome enum + geometry type.
# Never label with coordinates, hashes, or full-resolution cell IDs.
GEOM_VALIDATION = Counter(
    "geom_validation_total",
    "Geometry validation outcomes at the ingestion boundary",
    ["outcome", "geom_type"],  # outcome in {valid, invalid, unparseable, empty}
)

# Exponential buckets span the vertex range from trivial to event-loop-blocking.
GEOM_VERTICES = Histogram(
    "geom_vertex_count",
    "Distribution of vertices per incoming geometry",
    ["geom_type"],
    buckets=(4, 16, 64, 256, 1024, 4096, 16384, 65536),
)

def _vertex_count(geom) -> int:
    # Works for Polygon/MultiPolygon/LineString without materializing all coords twice.
    return sum(len(g.exterior.coords) if g.geom_type == "Polygon"
               else len(g.coords) for g in getattr(geom, "geoms", [geom]))

def validate_and_record(geojson: dict) -> bool:
    """Validate one geometry, emit metrics, and return whether it is admissible."""
    try:
        geom = shape(geojson)
    except Exception:
        GEOM_VALIDATION.labels(outcome="unparseable", geom_type="unknown").inc()
        return False

    gtype = geom.geom_type
    if geom.is_empty:
        GEOM_VALIDATION.labels(outcome="empty", geom_type=gtype).inc()
        return False

    GEOM_VERTICES.labels(geom_type=gtype).observe(_vertex_count(geom))

    if not geom.is_valid:
        # explain_validity() text (e.g. "Self-intersection") is a great log field,
        # but must NOT become a metric label — it is high-cardinality free text.
        GEOM_VALIDATION.labels(outcome="invalid", geom_type=gtype).inc()
        return False

    GEOM_VALIDATION.labels(outcome="valid", geom_type=gtype).inc()
    return True
```

The validation failure rate is then a PromQL expression over the counter — `sum(rate(geom_validation_total{outcome="invalid"}[5m])) / sum(rate(geom_validation_total[5m]))` — which you alert on as a ratio so the threshold holds regardless of traffic volume. The `explain_validity()` string, which tells you *why* a geometry is invalid, is deliberately kept out of the metric and pushed into the structured log instead, exactly because it is unbounded text.

---

## Structured Logs That Carry Spatial Context

Metrics tell you the validation failure rate rose to 3 percent; they cannot tell you that the failures are all self-intersecting polygons from device fleet 7 inside one bounding box. Logs answer that, but only if they carry spatial context as structured, queryable fields. A log line that interpolates coordinates into a message string — `"rejected geometry at 12.4,55.6"` — forces a slow full-text scan and cannot be filtered by range. The same information as JSON fields lets you query "all invalid geometries where `epsg != 4326` inside this bbox" directly in your log store.

The essential spatial fields to attach to every event log are the bounding box (a bounded, diffable summary of where the geometry is), the H3 cell (which shard it belongs to, enabling correlation with partition skew), the EPSG code (the projection it arrived in), and the geometry type and vertex count. The example below builds a structured logger and shows the fields in place. The complete pattern, including trace-ID correlation, is in [Structured Logging & Tracing for Spatial Events](/monitoring-observability-spatial/structured-logging-tracing/).

```python
import json
import logging
import h3
from shapely.geometry import shape

logger = logging.getLogger("spatial.pipeline")

def spatial_log_context(geojson: dict, epsg: int, device_id: str) -> dict:
    """Build a machine-parseable spatial context for one event."""
    geom = shape(geojson)
    minx, miny, maxx, maxy = geom.bounds
    centroid = geom.centroid
    return {
        "device_id": device_id,
        "epsg": epsg,                       # e.g. 4326 (WGS84) or 3857 (Web Mercator)
        "geom_type": geom.geom_type,
        # Round the bbox so identical footprints log identical values (stable, diffable).
        "bbox": [round(minx, 6), round(miny, 6), round(maxx, 6), round(maxy, 6)],
        # Coarse H3 cell (resolution 3) groups events into shards without exploding cardinality.
        "h3_cell": h3.latlng_to_cell(centroid.y, centroid.x, 3),
        "vertex_count": len(geom.exterior.coords) if geom.geom_type == "Polygon" else None,
    }

def log_validation_failure(geojson: dict, epsg: int, device_id: str, reason: str) -> None:
    ctx = spatial_log_context(geojson, epsg, device_id)
    ctx.update({"event": "geometry_validation_failed", "reason": reason, "level": "warning"})
    # One line of JSON: every field is filterable in the log store.
    logger.warning(json.dumps(ctx, separators=(",", ":")))
```

Two details make these logs durable. First, round the bounding box to a fixed precision so the same real-world footprint always produces the same logged bbox — this makes duplicate footprints groupable and keeps the field diffable across replays. Second, always log the EPSG code even when it is the expected `EPSG:4326 (WGS84)`; the value of the field is precisely that it lets you find the events where it was *not* what you expected, such as an unannounced `EPSG:3857 (Web Mercator)` payload. Follow the CRS-notation convention everywhere — the code number is what makes the log queryable, and it is what a future incident responder will grep for.

---

## Tracing an Event Across Async Geometry Handlers

The hardest spatial pipelines to debug are the asynchronous ones, where a single webhook fans out through a broker into a set of consumers that parse, validate, transform, and persist a geometry on different workers, possibly on different machines. Metrics and logs describe each hop in isolation; only a distributed trace stitches them into one causal story that says "this event spent 4 ms parsing, 180 ms validating a 90,000-vertex multipolygon, and 6 ms persisting." OpenTelemetry is the vendor-neutral way to produce that story in Python.

The model is one span per meaningful stage, with spatial attributes on each span so the trace is self-explaining, and trace context propagated through the broker so the consumer's spans link to the producer's. The snippet below shows a producer starting a span and injecting context into message headers, and a consumer extracting it to continue the trace. The full treatment, including instrumenting `asyncio` gather fan-out and handling context across `await` boundaries, is in [Adding OpenTelemetry Spans to Async Geometry Handlers](/monitoring-observability-spatial/structured-logging-tracing/adding-opentelemetry-spans-to-async-geometry-handlers/).

```python
from opentelemetry import trace, propagate
from opentelemetry.trace import SpanKind

tracer = trace.get_tracer("spatial.pipeline")

async def produce_geometry_event(geom, epsg: int, h3_cell: str, publish) -> None:
    """Start a span, tag it with spatial attributes, and inject context into headers."""
    with tracer.start_as_current_span("geometry.publish", kind=SpanKind.PRODUCER) as span:
        span.set_attribute("geo.epsg", epsg)
        span.set_attribute("geo.geom_type", geom.geom_type)
        span.set_attribute("geo.vertex_count", len(geom.exterior.coords))
        span.set_attribute("geo.h3_cell", h3_cell)  # links trace to partition/shard

        headers: dict[str, str] = {}
        propagate.inject(headers)  # W3C traceparent goes into the broker message headers
        await publish(payload=geom.wkt, headers=headers)

async def consume_geometry_event(message) -> None:
    """Continue the producer's trace on the consumer side across the async boundary."""
    ctx = propagate.extract(message.headers)  # rebuild parent context from headers
    with tracer.start_as_current_span("geometry.validate", context=ctx,
                                      kind=SpanKind.CONSUMER) as span:
        span.set_attribute("geo.h3_cell", message.headers.get("h3_cell", ""))
        # ... run validation / CRS transform here; exceptions are recorded on the span ...
        span.add_event("validation.complete")
```

Because each span carries the H3 cell as an attribute, traces double as a diagnostic for partition skew: filter your traces to the hot shard identified by the metrics plane and you immediately see the geometries that are making it hot. This is the payoff of coordinating the three planes — a metric raises the alarm, a trace localizes the cause to a shard, and the structured logs on that shard name the exact devices and bounding boxes responsible. The partitioning scheme that assigns events to shards in the first place, and the trade-offs between grid systems, are covered where they belong in [H3 vs S2 vs Quadkey for Spatial Partitioning](/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/); here we only observe the shards it produces.

---

## Consumer Lag and Partition Skew: Watching Sharded Spatial Streams

When a stream is partitioned by a spatial key, the health of the system is not one lag number but a distribution of lag across shards. A round-robin partitioner spreads load by construction; a spatial partitioner spreads it according to where events happen in the world, which is to say wildly unevenly. Ship geohash-prefix or H3-cell partitioning to a mapping product and the shard covering a metropolitan area will carry orders of magnitude more traffic than the shard covering an ocean. The result is a hot consumer that lags while its peers sit idle, and total throughput that looks entirely healthy the whole time.

Observing this requires per-shard metrics, not aggregates. Expose consumer lag as a gauge labelled by shard, and compute a skew ratio — the maximum shard load divided by the median — as a first-class signal. A skew ratio near 1 means balanced load; a ratio of 5 means your hottest shard is doing five times the median work and is a redistribution candidate. The remedies (finer partition keys, salting hot cells, dynamic reassignment) belong to stream design; detecting when you need them belongs here, and is developed fully in [Consumer Lag & Partition Skew Monitoring](/monitoring-observability-spatial/consumer-lag-partition-skew/) and its deep dive [Detecting Partition Skew in H3-Sharded Streams](/monitoring-observability-spatial/consumer-lag-partition-skew/detecting-partition-skew-in-h3-sharded-streams/).

The alerting principle throughout is to fire on rates and ratios rather than absolute counts. Absolute event counts grow with your business and will either page you constantly or never; a validation failure *rate*, a skew *ratio*, and a per-shard lag measured against your redelivery *window* all stay meaningful as the system scales. This is also why the metrics catalogue above expresses nearly every threshold as a proportion or a comparison to a baseline rather than a fixed number.

---

## From Metrics to Dashboards and Alerts

The three planes become operationally useful when they converge on a small number of screens and pages that a responder can read under pressure. A geospatial webhook health dashboard should lead with the geo-specific signals — validation failure rate, CRS-mismatch rate by EPSG code, partition skew, dedup hit ratio, and the vertex-count distribution — above the standard request-rate and latency panels, because in a spatial incident the geo panels are where the story is. A worked build of exactly this layout is in [A Grafana Dashboard for Geospatial Webhook Health](/monitoring-observability-spatial/geo-metrics-instrumentation/a-grafana-dashboard-for-geospatial-webhook-health/).

Alerts should map to the metrics catalogue but stay deliberately few. A validation failure rate above roughly 1 percent sustained, any CRS-mismatch traffic for a projection outside your allowlist, a partition skew ratio past 3 to 5, per-shard consumer lag exceeding the redelivery window, and a dedup hit ratio that suddenly collapses are the signals worth waking someone for. Each of these is a *change in the shape of the data*, which is the recurring theme of spatial observability: the transport can be flawless while the geometry quietly goes wrong, and the whole point of this instrumentation layer is to make that going-wrong visible the moment it starts.

Finally, treat observability as part of the pipeline's contract, not an afterthought bolted on during an incident. Every stage the other sections teach you to build — the [receiver](/core-event-fundamentals-architecture/), the [deduplication gate](/idempotency-spatial-deduplication/), the [parser and router](/spatial-payload-routing-parsing/), the [retry and delivery layer](/queue-management-retry-delivery/) — should emit its metrics, structured logs, and spans as it is written. Instrumentation added later never quite covers the paths that matter, and the paths that matter in spatial systems are the rare, heavy, malformed geometries that only observability can catch in the act.

---

## FAQ

<details class="faq">
<summary><strong>Which metrics are unique to geospatial pipelines that generic HTTP dashboards miss?</strong></summary>

Generic dashboards track request rate, latency, and error codes. They cannot see geometry validation failure rate, CRS-mismatch rate, partition skew across H3 or geohash shards, dedup hit ratio, or payload vertex-count distribution. These are the metrics that explain why a spatial pipeline degrades, because the failure is usually in the shape of the data, not the transport. A pipeline can return `200 OK` at low latency the entire time it is silently shedding malformed geometries to a dead-letter queue.

</details>

<details class="faq">
<summary><strong>How do I label Prometheus metrics with spatial context without causing cardinality explosion?</strong></summary>

Never label a metric with a raw coordinate, a full H3 cell ID at resolution 9 or higher, or a geometry hash — each unique value creates a new time series and will overwhelm your monitoring backend. Label with low-cardinality dimensions instead: the EPSG code, the geometry type, a coarse H3 resolution (0–3) for shard grouping, and a bounded outcome enum such as `{valid, invalid, unparseable, empty}`. Keep the product of all label values on any one metric in the low thousands. High-cardinality detail like the `explain_validity()` reason string belongs in structured logs, not in metric labels.

</details>

<details class="faq">
<summary><strong>What is partition skew and why does it matter for spatial streams?</strong></summary>

Partition skew is uneven event distribution across shards when you partition a stream by a spatial key such as an H3 cell or a geohash prefix. Dense urban cells receive orders of magnitude more events than rural ones, so one consumer saturates while others idle. It shows up as high consumer lag on a single partition even though total throughput looks healthy, which is invisible to aggregate dashboards. You detect it by exposing consumer lag as a per-shard gauge and computing a skew ratio of the hottest shard's load to the median.

</details>

<details class="faq">
<summary><strong>How should I structure logs so spatial context is queryable?</strong></summary>

Emit JSON logs where the bounding box, H3 cell, EPSG code, and geometry type are first-class fields rather than interpolated into a message string. A structured field lets you filter by EPSG code or bounding-box range directly in your log store; a string forces slow full-text search that cannot express range queries. Round coordinate precision so bbox values stay stable and diffable across replays, and always emit the EPSG code even when it is the expected `EPSG:4326 (WGS84)`, because the field's value is that it lets you find the events where the projection was something else.

</details>

<details class="faq">
<summary><strong>Where do I put OpenTelemetry spans in an async geometry pipeline?</strong></summary>

Create one span per meaningful stage: receive and parse, validate topology, transform CRS, and persist. Set span attributes for the EPSG code, vertex count, and H3 cell so a slow trace tells you which geometry caused it and which shard it belonged to. Crucially, propagate the trace context through the broker as message headers using the W3C `traceparent` format so the consumer span links to the producer span across the async boundary — without propagation you get disconnected fragments instead of one end-to-end trace.

</details>

<details class="faq">
<summary><strong>What alert thresholds make sense for geo-specific metrics?</strong></summary>

Alert on rates and ratios, not absolute counts, so thresholds survive traffic growth. A validation failure rate above roughly 1 percent sustained over five minutes, a CRS-mismatch rate that steps up after a producer deploy or appears for a projection outside your allowlist, per-shard consumer lag exceeding your redelivery window, a partition skew ratio where the hottest shard exceeds three to five times the median, and a dedup hit ratio that suddenly collapses toward zero are all actionable signals. Each represents a change in the shape of the data rather than a change in traffic volume.

</details>

---

## Related

- [Geo-Specific Metrics & Instrumentation](/monitoring-observability-spatial/geo-metrics-instrumentation/) — the full catalogue of spatial metrics and how to expose them with the Prometheus Python client
- [Consumer Lag & Partition Skew Monitoring](/monitoring-observability-spatial/consumer-lag-partition-skew/) — per-shard lag gauges and skew-ratio detection for spatially partitioned streams
- [Structured Logging & Tracing for Spatial Events](/monitoring-observability-spatial/structured-logging-tracing/) — JSON logs with bbox and H3 context, and OpenTelemetry spans across async handlers
- [Queue Management, Retries & Delivery Guarantees](/queue-management-retry-delivery/) — the broker, retry, and redelivery layer whose consumer lag this section measures
- [Idempotency & Spatial Deduplication](/idempotency-spatial-deduplication/) — the deduplication layer whose effectiveness the dedup hit ratio metric confirms in production
- [H3 vs S2 vs Quadkey for Spatial Partitioning](/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/) — the grid-system trade-offs behind the shards this section monitors for skew
