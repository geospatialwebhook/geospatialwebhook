---
title: "Geo-Specific Metrics & Instrumentation"
description: "Instrument a Python geospatial webhook pipeline with prometheus_client: define geometry, CRS, dedup, latency, and DLQ metrics, and pick Counter vs Gauge vs Histogram."
slug: "geo-metrics-instrumentation"
type: "cluster"
breadcrumb: "Monitoring & Observability for Spatial Pipelines > Geo-Specific Metrics & Instrumentation"
datePublished: "2025-02-10"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Geo-Specific Metrics & Instrumentation",
      "description": "How to instrument a Python geospatial webhook pipeline with the Prometheus client so the metrics that matter for spatial workloads are exported: geometry validation failure rate, CRS-mismatch counts, vertex-count histograms, dedup hit ratio, per-stage latency, and DLQ depth.",
      "url": "https://geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/",
      "datePublished": "2025-02-10",
      "dateModified": "2026-07-13",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Monitoring & Observability for Spatial Pipelines", "item": "https://geospatialwebhook.com/monitoring-observability-spatial/"},
        {"@type": "ListItem", "position": 3, "name": "Geo-Specific Metrics & Instrumentation", "item": "https://geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Instrument a Python geospatial webhook pipeline with Prometheus",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Define the core geo metric set and pick Counter, Gauge, or Histogram for each"},
        {"@type": "HowToStep", "position": 2, "name": "Wire prometheus_client instruments into the FastAPI geometry handler"},
        {"@type": "HowToStep", "position": 3, "name": "Control label cardinality on high-cardinality geo labels"},
        {"@type": "HowToStep", "position": 4, "name": "Expose the /metrics endpoint for Prometheus to scrape"},
        {"@type": "HowToStep", "position": 5, "name": "Verify the exported metrics by scraping /metrics in a test"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should geometry vertex count be a Histogram or a Gauge?",
          "acceptedAnswer": {"@type": "Answer", "text": "Use a Histogram. Vertex count is a per-event measurement whose distribution matters: you want to know the p95 and p99 of how many coordinates arrive, not just the last value. A Gauge only holds the most recent observation and loses the distribution, so a single 200,000-vertex polygon would be indistinguishable from a steady stream of them. Configure explicit buckets that match your geometry sizes, for example 10, 100, 1000, 10000, and 100000 vertices."}
        },
        {
          "@type": "Question",
          "name": "Why is putting the EPSG code in a metric label safe but the geometry ID dangerous?",
          "acceptedAnswer": {"@type": "Answer", "text": "Prometheus creates one time series per unique combination of label values. EPSG codes are drawn from a small, bounded set (you typically see a handful: EPSG:4326, EPSG:3857, EPSG:27700, and a few more), so a source_epsg label produces bounded cardinality. A geometry ID, feature ID, or raw coordinate is unbounded: every event creates a new series, the local registry grows without limit, and the Prometheus server can be overwhelmed. Only labels with a small, stable value set belong on a metric."}
        },
        {
          "@type": "Question",
          "name": "How do I measure dedup cache hit ratio with Prometheus if it only exports counters?",
          "acceptedAnswer": {"@type": "Answer", "text": "Export two counters, one for cache hits and one for cache misses (or a total), and compute the ratio at query time in PromQL rather than storing a ratio directly. A ratio stored as a Gauge cannot be aggregated correctly across replicas, but rate(dedup_cache_hits_total[5m]) / rate(dedup_cache_lookups_total[5m]) gives an accurate, replica-aggregated hit ratio over any window. This is the standard Prometheus pattern: export raw counts, derive rates and ratios in the query layer."}
        },
        {
          "@type": "Question",
          "name": "Does the Prometheus client add latency to my webhook handler?",
          "acceptedAnswer": {"@type": "Answer", "text": "Negligibly. Counter.inc(), Gauge.set(), and Histogram.observe() are in-process operations against a local registry that update atomic counters in memory; they do not perform network I/O. The actual scrape happens out of band when Prometheus pulls /metrics on its own schedule. The one cost to watch is label cardinality: looking up or creating a child series with .labels() is cheap per call but expensive in aggregate if the label set is unbounded, because the in-memory registry grows and every scrape must serialise all of it."}
        }
      ]
    }
  ]
}
</script>

**Instrumenting a geospatial webhook pipeline means exporting the handful of metrics that reveal spatial-specific failure — geometry validity, CRS drift, vertex volume, dedup effectiveness, per-stage latency, and dead-letter depth — as Prometheus time series, each modelled with the correct instrument type so the numbers stay meaningful under aggregation.**

This topic sits under [Monitoring & Observability for Spatial Pipelines](/monitoring-observability-spatial/), the broader practice of making a real-time geospatial event system legible in production. Generic HTTP dashboards tell you the endpoint returned 200; they do not tell you that 4% of incoming polygons are self-intersecting or that a sensor firmware update started shipping EPSG:27700 into a pipeline that assumes EPSG:4326 (WGS84). This page defines the metric set that closes that gap and shows how to wire it with the `prometheus_client` library.

---

## Prerequisites

Before instrumenting, confirm your stack meets this baseline. Check off each item as you verify it:

- [ ] **Python 3.11+** — required for the typing and `contextlib` timing helpers used below
- [ ] **`prometheus-client` 0.20+** — the official Python instrumentation library (`Counter`, `Gauge`, `Histogram`, `make_asgi_app`)
- [ ] **`fastapi` 0.110+ / `starlette`** — the async webhook handler the instruments hook into
- [ ] **`shapely` 2.0+** — used to count vertices and evaluate geometry validity for the metrics
- [ ] **A running Prometheus server** — or `prometheus` in Docker, configured to scrape your service's `/metrics`
- [ ] **A single-value-set understanding of your CRS inputs** — know which EPSG codes actually arrive, so CRS labels stay bounded
- [ ] **`pytest` + `httpx`** — for the scrape-the-endpoint verification test at the end

---

## Architecture

Instrumentation in the Prometheus model is pull-based, and that shapes the whole design. Your handler never pushes numbers anywhere. Instead it mutates in-process metric objects that live in a local registry, and a separate Prometheus server periodically scrapes a text-format `/metrics` endpoint your app exposes. The pipeline is four layers:

1. **Handler instrumentation** — inside the FastAPI geometry handler, each processing stage calls `Counter.inc()`, `Gauge.set()`, or `Histogram.observe()` on module-level metric objects. These are cheap in-memory atomic updates with no network I/O.
2. **Metric registry** — the `prometheus_client` default `CollectorRegistry` holds every metric and its label-keyed child series in memory. This is the single source of truth the exporter reads.
3. **`/metrics` exposition** — an ASGI sub-app (or the `make_asgi_app()` helper) renders the registry to the Prometheus text exposition format on demand, when scraped.
4. **Prometheus scrape** — the Prometheus server pulls `/metrics` on its configured interval (commonly 15s), stores the samples, and makes them queryable in PromQL and Grafana.

<svg viewBox="0 0 760 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Instrumentation flow from FastAPI handler through the metric registry and /metrics endpoint to the Prometheus server" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>Geo-metrics instrumentation flow</title>
  <desc>The FastAPI geometry handler mutates in-process metric objects; those objects live in the CollectorRegistry; the /metrics ASGI endpoint renders the registry as text; and the Prometheus server pulls that endpoint on its own scrape interval.</desc>
  <defs>
    <marker id="gm-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- 1: Handler -->
  <rect x="12" y="95" width="150" height="66" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="87" y="120" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">FastAPI handler</text>
  <text x="87" y="136" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">validate · dedup · route</text>
  <text x="87" y="150" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">inc() · observe() · set()</text>
  <line x1="164" y1="128" x2="196" y2="128" stroke="currentColor" stroke-width="1.5" marker-end="url(#gm-arr)" opacity="0.55"/>
  <!-- 2: Registry -->
  <rect x="198" y="95" width="150" height="66" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="273" y="120" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Metric registry</text>
  <text x="273" y="136" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">CollectorRegistry</text>
  <text x="273" y="150" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">in-memory series</text>
  <line x1="350" y1="128" x2="382" y2="128" stroke="currentColor" stroke-width="1.5" marker-end="url(#gm-arr)" opacity="0.55"/>
  <!-- 3: /metrics -->
  <rect x="384" y="95" width="150" height="66" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="459" y="120" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">/metrics</text>
  <text x="459" y="136" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">text exposition</text>
  <text x="459" y="150" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">rendered on scrape</text>
  <!-- pull arrow from Prometheus back to /metrics -->
  <line x1="636" y1="128" x2="538" y2="128" stroke="currentColor" stroke-width="1.5" marker-end="url(#gm-arr)" opacity="0.55" stroke-dasharray="5,3"/>
  <text x="590" y="120" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">pull (15s)</text>
  <!-- 4: Prometheus -->
  <rect x="638" y="95" width="110" height="66" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="693" y="124" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Prometheus</text>
  <text x="693" y="140" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">TSDB · PromQL</text>
  <!-- stage labels -->
  <text x="87" y="86" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.5">① INSTRUMENT</text>
  <text x="273" y="86" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.5">② COLLECT</text>
  <text x="459" y="86" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.5">③ EXPOSE</text>
  <text x="693" y="86" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.5">④ SCRAPE</text>
</svg>

### The core geo metric set

Choosing the instrument type is the decision that makes or breaks the metric. A **Counter** only ever goes up and is read through `rate()`; use it for events you tally. A **Gauge** holds a single current value that can rise or fall; use it for levels you sample. A **Histogram** records a distribution into buckets plus a sum and count; use it for per-event measurements where percentiles matter. The following table fixes the choice for each spatial signal.

| Metric | Instrument | Labels (bounded) | Why this type |
|--------|-----------|------------------|---------------|
| Geometry validation failures | Counter | `reason`, `geometry_type` | You tally failures and read the failure rate with `rate()`; a running total is exactly a Counter |
| CRS mismatch / reprojection count | Counter | `source_epsg`, `target_epsg` | Each reprojection is a discrete event; EPSG codes are a small bounded set, so they are safe labels |
| Coordinate / vertex count per event | Histogram | `geometry_type` | Distribution matters — you want p95/p99 of geometry size, which a Gauge cannot express |
| Dedup cache hit ratio | Counter (×2) | `outcome` | Export hits and lookups as counters; derive the ratio in PromQL, never store a ratio Gauge |
| Per-stage processing latency | Histogram | `stage` | Latency is a distribution; buckets give you SLO-aligned percentiles per pipeline stage |
| DLQ depth | Gauge | `queue` | A current level that goes up and down — the canonical Gauge use case |

Two of these deserve emphasis. The dedup **hit ratio** is not stored as a ratio: Prometheus cannot aggregate a pre-divided Gauge across replicas, so you export raw counts and let PromQL divide. The dedup layer this instruments is described in [Idempotency & Spatial Deduplication](/idempotency-spatial-deduplication/); a low hit ratio there is a signal that upstream retries are not being caught. **DLQ depth** is a Gauge because it is a level, not an event count — it rises when events fail past their retry budget and falls when an operator drains the queue.

The reason the Counter-versus-Gauge distinction is not cosmetic is that Prometheus treats the two completely differently at query time. A Counter is expected to only increase and to reset to zero on process restart; the `rate()` and `increase()` functions are built to detect those resets and compute a correct per-second rate across them. Feed a Gauge into `rate()` and you get nonsense, because a Gauge's decreases look like counter resets. Conversely, applying `rate()` to something that should be a level — like DLQ depth — erases exactly the information you care about. Getting the type right at declaration time is therefore what makes every downstream query, alert, and dashboard panel correct; a mistyped metric cannot be salvaged in PromQL. When in doubt, ask whether the number can ever legitimately go down during normal operation: if yes, it is a Gauge; if it only accumulates, it is a Counter; if you need its distribution rather than a single value, it is a Histogram.

---

## Step-by-step implementation

### Step 1 — Declare the metrics at module scope

Metric objects must be created exactly once per process. Declaring them at module scope guarantees a single instance in the default registry; creating them inside the request handler raises a duplicate-timeseries error on the second request. Every histogram gets explicit buckets tuned to spatial reality — default buckets are latency-shaped and useless for vertex counts.

```python
from prometheus_client import Counter, Gauge, Histogram

# Counter: geometry validation failures, sliced by why and by geometry type.
GEOMETRY_VALIDATION_FAILURES = Counter(
    "geo_geometry_validation_failures_total",
    "Count of geometries rejected by the validation stage.",
    ["reason", "geometry_type"],
)

# Counter: CRS mismatches requiring reprojection. EPSG codes are a bounded set.
CRS_REPROJECTIONS = Counter(
    "geo_crs_reprojections_total",
    "Count of payloads reprojected from a source CRS to the pipeline CRS.",
    ["source_epsg", "target_epsg"],
)

# Histogram: vertices per geometry. Buckets span point to dense-polygon scale.
GEOMETRY_VERTEX_COUNT = Histogram(
    "geo_geometry_vertex_count",
    "Distribution of coordinate/vertex counts per incoming geometry.",
    ["geometry_type"],
    buckets=(1, 10, 50, 100, 500, 1_000, 5_000, 10_000, 100_000),
)

# Counter pair for dedup: export raw counts, derive the ratio in PromQL.
DEDUP_LOOKUPS = Counter(
    "geo_dedup_cache_lookups_total",
    "Total idempotency cache lookups.",
    ["outcome"],  # values: "hit" | "miss"
)

# Histogram: per-stage latency in seconds, SLO-aligned buckets.
STAGE_LATENCY = Histogram(
    "geo_stage_latency_seconds",
    "Wall-clock latency of each pipeline stage.",
    ["stage"],  # values: "validate" | "dedup" | "reproject" | "route"
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5),
)

# Gauge: current dead-letter queue depth.
DLQ_DEPTH = Gauge(
    "geo_dlq_depth",
    "Current number of events sitting in the dead-letter queue.",
    ["queue"],
)
```

Note the naming convention: Counters end in `_total`, Histograms measuring time end in `_seconds`, and Gauges use a plain noun. Prometheus tooling relies on these suffixes.

### Step 2 — Wire the instruments into the FastAPI geometry handler

Each stage updates its metric as the event flows through. Use a small timing context manager so the latency histogram wraps each stage without repetition. The vertex count is computed from the parsed geometry, and the dedup outcome is recorded on the branch that decides it.

```python
import time
from contextlib import contextmanager

from fastapi import FastAPI, Request, Response
from shapely.geometry import shape

app = FastAPI()


@contextmanager
def observe_stage(stage: str):
    """Record wall-clock duration of a pipeline stage into STAGE_LATENCY."""
    start = time.perf_counter()
    try:
        yield
    finally:
        STAGE_LATENCY.labels(stage=stage).observe(time.perf_counter() - start)


def count_vertices(geom) -> int:
    """Total coordinate count across all rings/parts of a shapely geometry."""
    if geom.geom_type == "Point":
        return 1
    if hasattr(geom, "geoms"):  # multi-part geometry collection
        return sum(count_vertices(g) for g in geom.geoms)
    if geom.geom_type == "Polygon":
        return len(geom.exterior.coords) + sum(len(r.coords) for r in geom.interiors)
    return len(geom.coords)  # LineString, LinearRing


@app.post("/webhook/spatial")
async def receive(request: Request) -> Response:
    body = await request.json()
    geometry_type = body.get("geometry", {}).get("type", "unknown")

    # --- validate stage ---
    with observe_stage("validate"):
        try:
            geom = shape(body["geometry"])
            if not geom.is_valid:
                GEOMETRY_VALIDATION_FAILURES.labels(
                    reason="invalid_topology", geometry_type=geometry_type
                ).inc()
                return Response(status_code=422, content="invalid geometry")
        except (KeyError, ValueError, TypeError):
            GEOMETRY_VALIDATION_FAILURES.labels(
                reason="malformed", geometry_type=geometry_type
            ).inc()
            return Response(status_code=400, content="malformed payload")

    # Record geometry size for the distribution.
    GEOMETRY_VERTEX_COUNT.labels(geometry_type=geometry_type).observe(count_vertices(geom))

    # --- dedup stage ---
    with observe_stage("dedup"):
        is_duplicate = await already_seen(body["event_id"])  # your cache lookup
        DEDUP_LOOKUPS.labels(outcome="hit" if is_duplicate else "miss").inc()
        if is_duplicate:
            return Response(status_code=200, content="duplicate")

    # --- reproject stage (CRS alignment) ---
    source_epsg = body.get("crs", "EPSG:4326")
    if source_epsg != "EPSG:4326":  # pipeline canonical CRS per RFC 7946
        with observe_stage("reproject"):
            geom = reproject_to_wgs84(geom, source_epsg)  # your pyproj transform
            CRS_REPROJECTIONS.labels(
                source_epsg=source_epsg, target_epsg="EPSG:4326"
            ).inc()

    # --- route stage ---
    with observe_stage("route"):
        await route_event(body, geom)

    return Response(status_code=202, content="accepted")
```

The validation failures counter is the raw material behind [Tracking Geometry Validation Failure Rate with Prometheus](/monitoring-observability-spatial/geo-metrics-instrumentation/tracking-geometry-validation-failure-rate-with-prometheus/), which turns `geo_geometry_validation_failures_total` into an alerting rule. The validation logic itself belongs in a dedicated stage; see [Geometry Validation Pipelines](/spatial-payload-routing-parsing/geometry-validation-pipelines/) for the full topology, ring-orientation, and CRS checks that precede instrumentation.

### Step 3 — Keep the DLQ gauge fresh

A Gauge only reflects reality if something sets it. Update it wherever an event enters or leaves the dead-letter queue, or refresh it periodically from the queue's own length. Prefer setting the absolute value from the source of truth over `inc()`/`dec()`, which drift if a process restarts.

```python
async def refresh_dlq_depth(dlq_client, queue_name: str = "spatial-dlq") -> None:
    """Sample the queue's true length and publish it as the current gauge value."""
    depth = await dlq_client.llen(queue_name)  # e.g. Redis list length
    DLQ_DEPTH.labels(queue=queue_name).set(depth)
```

Call `refresh_dlq_depth` on a short interval from a background task. A steadily climbing `geo_dlq_depth` is the earliest sign that a downstream dependency is failing every retry — pair it with the consumer-side signals in [Consumer Lag & Partition Skew Monitoring](/monitoring-observability-spatial/consumer-lag-partition-skew/) to distinguish a stuck consumer from a genuine burst of poison messages.

---

## Label cardinality: the one way to break your metrics

Prometheus creates a distinct time series for every unique combination of label values. Bounded labels are free; unbounded labels are a production incident. The rule is absolute: **only attach a label whose value set is small and stable.**

```python
# SAFE — source_epsg draws from a handful of known EPSG codes.
CRS_REPROJECTIONS.labels(source_epsg="EPSG:27700", target_epsg="EPSG:4326").inc()

# DANGEROUS — every event has a unique ID, so this creates one series per event.
# The local registry grows without bound and the scrape payload explodes.
# GEOMETRY_VALIDATION_FAILURES.labels(reason=event_id, geometry_type=gt).inc()

# DANGEROUS — raw coordinates are effectively infinite-cardinality.
# GEOMETRY_VERTEX_COUNT.labels(geometry_type=f"{lat},{lon}").observe(n)
```

High-cardinality geo labels to never use: geometry ID, feature ID, event ID, raw coordinates, bounding-box strings, user ID, and full H3/S2 cell indices at fine resolution. If you need per-feature detail, that belongs in traces and logs, not metrics — see [Structured Logging & Tracing for Spatial Events](/monitoring-observability-spatial/structured-logging-tracing/) for where unbounded spatial identifiers legitimately live. A coarse H3 resolution (say, resolution 3, a few thousand cells globally) can be an acceptable label; resolution 9 (millions of cells) cannot.

A practical guardrail is to bound the value at the call site by mapping to a category:

```python
def epsg_label(raw_crs: str) -> str:
    """Collapse unrecognised CRS strings into a single 'other' bucket
    so a malformed or exotic CRS cannot explode label cardinality."""
    known = {"EPSG:4326", "EPSG:3857", "EPSG:27700", "EPSG:4269", "CRS84"}
    return raw_crs if raw_crs in known else "other"
```

---

## Expose the /metrics endpoint

Mount the exposition endpoint as an ASGI sub-app so scrapes are served by the same process that holds the registry. This is the surface Prometheus pulls.

```python
from prometheus_client import make_asgi_app

# Serves the default registry in Prometheus text exposition format.
app.mount("/metrics", make_asgi_app())
```

Then point Prometheus at it:

```yaml
scrape_configs:
  - job_name: "geo-webhook"
    metrics_path: /metrics
    scrape_interval: 15s
    static_configs:
      - targets: ["geo-webhook.internal:8000"]
```

A note on multi-process servers: under Gunicorn/Uvicorn with several workers, each worker holds its own registry, and a plain scrape hits only one at random. For that topology use `prometheus_client`'s multiprocess mode (`PROMETHEUS_MULTIPROC_DIR`) so counters aggregate across workers.

---

## Verification

Do not trust that a metric is exported until you have scraped it. This test drives the handler, then pulls `/metrics` through the ASGI app and asserts the expected series and label values appear in the exposition text.

```python
import pytest
from httpx import AsyncClient, ASGITransport

from app import app  # the FastAPI app defined above


@pytest.mark.asyncio
async def test_metrics_endpoint_exports_geo_series():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Drive one malformed event so a validation-failure series is created.
        await client.post("/webhook/spatial", json={"event_id": "e1", "geometry": {}})

        # Scrape the exposition endpoint the way Prometheus would.
        resp = await client.get("/metrics")
        assert resp.status_code == 200
        body = resp.text

        # The counter and its labels must be present in the text format.
        assert "geo_geometry_validation_failures_total" in body
        assert 'reason="malformed"' in body

        # Histograms export _bucket, _sum, and _count series.
        assert "geo_stage_latency_seconds_bucket" in body
        assert 'stage="validate"' in body


@pytest.mark.asyncio
async def test_dedup_counter_increments_by_outcome():
    from app import DEDUP_LOOKUPS

    before = DEDUP_LOOKUPS.labels(outcome="miss")._value.get()
    DEDUP_LOOKUPS.labels(outcome="miss").inc()
    after = DEDUP_LOOKUPS.labels(outcome="miss")._value.get()
    assert after == before + 1
```

Run with `pytest -v --asyncio-mode=auto`. The first test proves the full instrument-to-exposition path works; the second confirms a labelled counter actually moves. Once the series are confirmed present, they can be graphed — the panels are laid out in [A Grafana Dashboard for Geospatial Webhook Health](/monitoring-observability-spatial/geo-metrics-instrumentation/a-grafana-dashboard-for-geospatial-webhook-health/), which turns each metric here into a dashboard row.

---

## Troubleshooting

<div style="overflow-x:auto;">

| Symptom | Likely spatial cause | Fix |
|---------|----------------------|-----|
| Prometheus scrape times out or memory balloons | An unbounded geo label (event ID, raw coords, fine H3 cell) created millions of series | Remove the offending label; move per-feature detail to logs/traces; collapse exotic CRS to an `other` bucket |
| `Duplicate timeseries in CollectorRegistry` on startup | Metric objects created inside the request handler or imported twice | Declare all `Counter`/`Gauge`/`Histogram` once at module scope |
| Vertex-count percentiles are always in the top bucket | Histogram buckets left at latency defaults, too small for polygons | Set explicit buckets spanning your real geometry sizes (1 to 100k vertices) |
| Dedup hit ratio looks wrong after scaling out | A ratio was stored as a Gauge and cannot aggregate across replicas | Export raw hit/lookup counters; compute the ratio in PromQL with `rate(...)/rate(...)` |
| DLQ depth flatlines while the queue is clearly growing | Gauge updated with `inc()`/`dec()` that drifted after a restart | Sample the queue's true length and publish it with `.set()` on an interval |
| CRS reprojection count stays at zero despite mixed inputs | Counter incremented before the `source != target` branch, or CRS defaulted silently | Increment only inside the reprojection branch; log the observed `source_epsg` distribution |
| `/metrics` returns data from only one worker | Multi-process server with per-worker registries | Enable `prometheus_client` multiprocess mode via `PROMETHEUS_MULTIPROC_DIR` |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Should geometry vertex count be a Histogram or a Gauge?</strong></summary>

Use a Histogram. Vertex count is a per-event measurement whose distribution matters: you want to know the p95 and p99 of how many coordinates arrive, not just the last value. A Gauge only holds the most recent observation and loses the distribution, so a single 200,000-vertex polygon would be indistinguishable from a steady stream of them. Configure explicit buckets that match your geometry sizes, for example 10, 100, 1000, 10000, and 100000 vertices.

</details>

<details class="faq">
<summary><strong>Why is putting the EPSG code in a metric label safe but the geometry ID dangerous?</strong></summary>

Prometheus creates one time series per unique combination of label values. EPSG codes are drawn from a small, bounded set (you typically see a handful: EPSG:4326, EPSG:3857, EPSG:27700, and a few more), so a `source_epsg` label produces bounded cardinality. A geometry ID, feature ID, or raw coordinate is unbounded: every event creates a new series, the local registry grows without limit, and the Prometheus server can be overwhelmed. Only labels with a small, stable value set belong on a metric.

</details>

<details class="faq">
<summary><strong>How do I measure dedup cache hit ratio with Prometheus if it only exports counters?</strong></summary>

Export two counters, one for cache hits and one for cache misses (or a total), and compute the ratio at query time in PromQL rather than storing a ratio directly. A ratio stored as a Gauge cannot be aggregated correctly across replicas, but `rate(dedup_cache_hits_total[5m]) / rate(dedup_cache_lookups_total[5m])` gives an accurate, replica-aggregated hit ratio over any window. This is the standard Prometheus pattern: export raw counts, derive rates and ratios in the query layer.

</details>

<details class="faq">
<summary><strong>Does the Prometheus client add latency to my webhook handler?</strong></summary>

Negligibly. `Counter.inc()`, `Gauge.set()`, and `Histogram.observe()` are in-process operations against a local registry that update atomic counters in memory; they do not perform network I/O. The actual scrape happens out of band when Prometheus pulls `/metrics` on its own schedule. The one cost to watch is label cardinality: looking up or creating a child series with `.labels()` is cheap per call but expensive in aggregate if the label set is unbounded, because the in-memory registry grows and every scrape must serialise all of it.

</details>

---

## Related

- [Monitoring & Observability for Spatial Pipelines](/monitoring-observability-spatial/) — the parent section covering metrics, logging, tracing, and lag monitoring for geospatial event systems
- [Tracking Geometry Validation Failure Rate with Prometheus](/monitoring-observability-spatial/geo-metrics-instrumentation/tracking-geometry-validation-failure-rate-with-prometheus/) — turning the validation-failure counter into an alerting rule with PromQL
- [A Grafana Dashboard for Geospatial Webhook Health](/monitoring-observability-spatial/geo-metrics-instrumentation/a-grafana-dashboard-for-geospatial-webhook-health/) — the panels that visualise every metric defined here
- [Consumer Lag & Partition Skew Monitoring](/monitoring-observability-spatial/consumer-lag-partition-skew/) — pairing DLQ depth with consumer-side signals to locate stalls
- [Structured Logging & Tracing for Spatial Events](/monitoring-observability-spatial/structured-logging-tracing/) — where high-cardinality spatial identifiers belong instead of metric labels
