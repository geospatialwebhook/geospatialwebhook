---
title: "Tracking Geometry Validation Failure Rate with Prometheus"
description: "Instrument a Python webhook handler to export geometry validation outcomes as a Prometheus Counter labelled by failure reason, then alert on the failure rate."
slug: "tracking-geometry-validation-failure-rate-with-prometheus"
type: "article"
breadcrumb:
  - label: "Monitoring & Observability for Spatial Pipelines"
    url: "/monitoring-observability-spatial/"
  - label: "Geo-Specific Metrics & Instrumentation"
    url: "/monitoring-observability-spatial/geo-metrics-instrumentation/"
  - label: "Tracking Geometry Validation Failure Rate with Prometheus"
    url: "/monitoring-observability-spatial/geo-metrics-instrumentation/tracking-geometry-validation-failure-rate-with-prometheus/"
datePublished: "2025-05-19"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Tracking Geometry Validation Failure Rate with Prometheus",
      "description": "Instrument a Python webhook handler to export geometry validation outcomes as a Prometheus Counter labelled by failure reason, then alert on the failure rate.",
      "url": "https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/tracking-geometry-validation-failure-rate-with-prometheus/",
      "datePublished": "2025-05-19",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Monitoring & Observability for Spatial Pipelines", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/" },
        { "@type": "ListItem", "position": 2, "name": "Geo-Specific Metrics & Instrumentation", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/" },
        { "@type": "ListItem", "position": 3, "name": "Tracking Geometry Validation Failure Rate with Prometheus", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/tracking-geometry-validation-failure-rate-with-prometheus/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Track Geometry Validation Failure Rate with Prometheus",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Declare a labelled Counter", "text": "Create a prometheus_client Counter named geometry_validation_total with two labels: result (ok or fail) and reason (a bounded enum such as self_intersection, too_few_points, nan_coord, crs_mismatch, or none)." },
        { "@type": "HowToStep", "position": 2, "name": "Wrap Shapely validation", "text": "Write a validate() function that runs Shapely topology checks, classifies any failure into one of the fixed reason values, and increments the Counter exactly once per geometry with the matching label pair." },
        { "@type": "HowToStep", "position": 3, "name": "Expose /metrics", "text": "Mount the prometheus_client ASGI or WSGI app so Prometheus can scrape geometry_validation_total, and keep label cardinality bounded by never labelling with feature id or raw coordinates." },
        { "@type": "HowToStep", "position": 4, "name": "Add a recording rule and alert", "text": "Define a PromQL recording rule that divides the rate of failures by the rate of all validations over a 5-minute window, then alert when that failure ratio exceeds your threshold." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why should I not label the Counter by feature id or coordinates?",
          "acceptedAnswer": { "@type": "Answer", "text": "Every distinct label value creates a separate time series in Prometheus. Feature ids and raw coordinates are unbounded, so labelling by them produces millions of series, blows up memory in both the client and the server, and makes queries slow or impossible. Keep labels to bounded enums like result and reason." }
        },
        {
          "@type": "Question",
          "name": "How does rate() handle counter resets when my handler restarts?",
          "acceptedAnswer": { "@type": "Answer", "text": "Prometheus Counters are monotonic within a process, but a restart resets them to zero. The rate() and increase() functions detect the drop and automatically compensate, so a single restart does not create a negative spike. This is exactly why you must use rate() over a window rather than subtracting raw counter values yourself." }
        },
        {
          "@type": "Question",
          "name": "Should I validate geometry before or after reprojection?",
          "acceptedAnswer": { "@type": "Answer", "text": "Validate both. Validate on ingest in the source CRS to catch malformed payloads early, and validate again after reprojection to EPSG:4326 because coordinate transforms can introduce NaN coordinates or degenerate rings near projection edges. Use a stage label or two separate counters so you can tell pre-transform from post-transform failures apart." }
        },
        {
          "@type": "Question",
          "name": "What rate() window should I pick for the failure-rate alert?",
          "acceptedAnswer": { "@type": "Answer", "text": "Pick a window at least four times your scrape interval so each rate() sample sees several data points. With a 15-second scrape, a 5-minute window is a safe default: responsive enough to catch a bad deploy within minutes, wide enough to avoid noise from a single unlucky payload." }
        }
      ]
    }
  ]
}
</script>

**To track geometry validation failure rate, declare a single `prometheus_client.Counter` named `geometry_validation_total` with `result` and `reason` labels, increment it once per geometry inside a `validate()` wrapper around Shapely, expose `/metrics`, and alert when `rate(failures) / rate(total)` over a 5-minute window crosses your threshold.** The labels stay bounded — a fixed set of failure reasons — so you can slice by cause without exploding time-series cardinality.

This page belongs to [Geo-Specific Metrics & Instrumentation](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/), part of the wider [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/) reference — the section covering how to make spatial webhook pipelines legible to Prometheus and Grafana.

---

## When to use this pattern

Reach for a labelled validation Counter when:

- You run a webhook handler that parses inbound GeoJSON or WKT and you need to know *why* geometries are being rejected, not just how many — a rising `self_intersection` rate points at a different upstream bug than a rising `crs_mismatch` rate.
- You want an alert that fires on a *ratio* (failures per total) rather than an absolute count, so a traffic spike does not trigger a false page and a traffic lull does not hide a regression.
- You already scrape a `/metrics` endpoint with Prometheus and want geometry health to sit alongside your latency and queue-depth metrics.

It is not the right tool when you need per-feature forensic detail — which coordinate failed, which tenant sent it. That belongs in structured logs or traces, never in a metric label, because label cardinality would explode. Use metrics for rates and trends; use logs for individual events.

---

## Why label choice makes or breaks this metric

Prometheus stores one independent time series for every unique combination of metric name and label values. A Counter labelled `result` (2 values) × `reason` (5 values) is at most 10 series — cheap, fast, and permanent. The moment you add a `feature_id` or a raw coordinate string as a label, cardinality becomes unbounded: every payload mints a new series, the client process leaks memory holding them, and the Prometheus server's ingestion and query paths grind to a halt. This failure mode is the single most common way geospatial teams break their monitoring stack.

The discipline, then, is to classify every validation outcome into a small, fixed enum *before* it touches a label. The diagram below shows the flow: a geometry enters, Shapely checks run, the outcome collapses to one bounded `reason`, and the Counter advances by exactly one.

<svg viewBox="0 0 760 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Geometry validation to bounded Prometheus counter label flow" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>Geometry validation outcome to a bounded Prometheus counter label</title>
  <desc>A geometry payload enters a validate wrapper running Shapely checks. The outcome is classified into one of a fixed set of reasons — self_intersection, too_few_points, nan_coord, crs_mismatch or none — then increments a single counter labelled by result and reason. A side note warns against labelling by feature id or coordinates.</desc>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L8,3.5 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Box 1: geometry in -->
  <rect x="8" y="80" width="120" height="72" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="68" y="108" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Geometry</text>
  <text x="68" y="124" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">GeoJSON / WKT</text>
  <text x="68" y="171" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">INPUT</text>
  <line x1="128" y1="116" x2="150" y2="116" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 2: validate() Shapely -->
  <rect x="152" y="80" width="140" height="72" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="222" y="105" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">validate()</text>
  <text x="222" y="122" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">Shapely checks</text>
  <text x="222" y="136" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">is_valid, explain</text>
  <text x="222" y="171" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">STAGE 1</text>
  <line x1="292" y1="116" x2="314" y2="116" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 3: classify reason -->
  <rect x="316" y="80" width="164" height="72" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="398" y="103" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Classify reason</text>
  <text x="398" y="120" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">self_intersection</text>
  <text x="398" y="133" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">too_few_points · nan_coord</text>
  <text x="398" y="146" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">crs_mismatch · none</text>
  <text x="398" y="171" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">STAGE 2 · bounded enum</text>
  <line x1="480" y1="116" x2="502" y2="116" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 4: counter -->
  <rect x="504" y="80" width="150" height="72" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="579" y="103" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Counter +1</text>
  <text x="579" y="121" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">geometry_validation</text>
  <text x="579" y="134" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">_total{result,reason}</text>
  <text x="579" y="171" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">OUTPUT → /metrics</text>
  <!-- warning note -->
  <text x="380" y="40" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7" font-weight="600">Never label by feature_id or raw coordinates — unbounded cardinality</text>
  <line x1="380" y1="48" x2="380" y2="78" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.2" stroke-dasharray="3,3"/>
</svg>

---

## Complete runnable implementation

The module below is self-contained. It declares two Counters — one for validation outcomes and one for reprojections labelled by source EPSG — wraps Shapely in a `validate()` function that maps every failure to a fixed reason, and exposes `/metrics` through the `prometheus_client` ASGI app so a FastAPI or Starlette handler can mount it. Install with `pip install prometheus-client shapely`.

```python
import math
from enum import Enum
from prometheus_client import Counter, make_asgi_app
from shapely.geometry import shape
from shapely.validation import explain_validity


class Reason(str, Enum):
    """Bounded set of failure causes. Keeping this a closed enum is what
    guarantees the metric's label cardinality stays small and constant."""
    NONE = "none"                       # geometry is valid
    SELF_INTERSECTION = "self_intersection"
    TOO_FEW_POINTS = "too_few_points"
    NAN_COORD = "nan_coord"
    CRS_MISMATCH = "crs_mismatch"


# One Counter, two low-cardinality labels: result in {ok, fail},
# reason in the Reason enum above => at most 2 x 5 = 10 time series.
GEOMETRY_VALIDATION_TOTAL = Counter(
    "geometry_validation_total",
    "Count of geometry validation attempts by outcome and failure reason.",
    labelnames=("result", "reason"),
)

# Reprojections labelled ONLY by source EPSG code (a bounded set in practice:
# you accept a handful of input CRSs). Never label by the geometry itself.
REPROJECTION_TOTAL = Counter(
    "geometry_reprojection_total",
    "Count of geometry reprojections to EPSG:4326 by source CRS.",
    labelnames=("source_epsg",),
)


def _has_nan(geom) -> bool:
    """True if any coordinate is NaN or infinite — a common artefact of a
    bad reprojection near projection edges (e.g. EPSG:3857 poles)."""
    for x, y in _iter_coords(geom):
        if not (math.isfinite(x) and math.isfinite(y)):
            return True
    return False


def _iter_coords(geom):
    """Yield (x, y) pairs from any Shapely geometry, recursing into parts."""
    if hasattr(geom, "geoms"):          # multi-part / collection
        for part in geom.geoms:
            yield from _iter_coords(part)
    elif geom.geom_type == "Polygon":
        yield from geom.exterior.coords
        for ring in geom.interiors:
            yield from ring.coords
    else:                               # Point, LineString
        yield from geom.coords


def _classify(geom) -> Reason:
    """Map a geometry to exactly one bounded Reason. Order matters: check the
    cheap structural faults before the topological ones."""
    coords = list(_iter_coords(geom))
    if _has_nan(geom):
        return Reason.NAN_COORD
    # LinearRing/Polygon needs >= 4 coords; LineString needs >= 2.
    min_points = 4 if geom.geom_type in ("Polygon", "MultiPolygon") else 2
    if len(coords) < min_points:
        return Reason.TOO_FEW_POINTS
    if not geom.is_valid:
        # explain_validity() returns strings like "Self-intersection[...]".
        if "self-intersection" in explain_validity(geom).lower():
            return Reason.SELF_INTERSECTION
        return Reason.SELF_INTERSECTION  # default topological bucket
    return Reason.NONE


def validate(geojson_geometry: dict, expected_epsg: int = 4326) -> bool:
    """Validate one GeoJSON geometry and record the outcome exactly once.

    Returns True if the geometry is usable, False otherwise. Increments
    GEOMETRY_VALIDATION_TOTAL with a bounded (result, reason) label pair.

    RFC 7946 pins GeoJSON to EPSG:4326 (WGS84). If the payload declares any
    other CRS we record a crs_mismatch rather than silently trusting it.
    """
    declared = _declared_epsg(geojson_geometry)
    if declared is not None and declared != expected_epsg:
        GEOMETRY_VALIDATION_TOTAL.labels(
            result="fail", reason=Reason.CRS_MISMATCH.value
        ).inc()
        return False

    try:
        geom = shape(geojson_geometry)   # dict -> Shapely object
    except (ValueError, KeyError, TypeError):
        GEOMETRY_VALIDATION_TOTAL.labels(
            result="fail", reason=Reason.TOO_FEW_POINTS.value
        ).inc()
        return False

    reason = _classify(geom)
    result = "ok" if reason is Reason.NONE else "fail"
    GEOMETRY_VALIDATION_TOTAL.labels(result=result, reason=reason.value).inc()
    return reason is Reason.NONE


def _declared_epsg(geojson_geometry: dict):
    """Best-effort extraction of a declared EPSG code from a legacy GeoJSON
    'crs' member. Returns None when absent (RFC 7946 assumes EPSG:4326)."""
    crs = geojson_geometry.get("crs")
    if not crs:
        return None
    name = crs.get("properties", {}).get("name", "")
    for token in name.replace(":", " ").split():
        if token.isdigit():
            return int(token)
    return None


# Mount this at /metrics on your ASGI app:
#     app.mount("/metrics", metrics_app)
metrics_app = make_asgi_app()
```

To record a reprojection, increment the second Counter with the numeric source EPSG as a string — for example `REPROJECTION_TOTAL.labels(source_epsg="3857").inc()` when converting an EPSG:3857 (Web Mercator) payload to EPSG:4326 (WGS84). Because you accept only a handful of input CRSs, that label stays bounded. This validation logic pairs naturally with a full [geometry validation pipeline](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/); the Counter simply makes that pipeline's outcomes observable.

### PromQL recording rule and alert

Put this in your Prometheus rules file. The recording rule precomputes the failure ratio so dashboards and alerts share one definition.

{% raw %}
```yaml
groups:
  - name: geometry_validation
    rules:
      # Recording rule: fraction of validations that failed, per 5m window.
      - record: job:geometry_validation_failure_rate:ratio5m
        expr: |
          sum(rate(geometry_validation_total{result="fail"}[5m]))
          /
          sum(rate(geometry_validation_total[5m]))

      # Alert when more than 5% of geometries fail validation for 10 minutes.
      - alert: HighGeometryValidationFailureRate
        expr: job:geometry_validation_failure_rate:ratio5m > 0.05
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Geometry validation failure rate above 5%"
          description: "5m failure ratio is {{ $value | humanizePercentage }}."
```
{% endraw %}

To see which cause dominates, break the numerator down by `reason`: `sum by (reason) (rate(geometry_validation_total{result="fail"}[5m]))`. A sudden spike isolated to `crs_mismatch` tells you an upstream producer changed its CRS; a spike in `nan_coord` points at your own reprojection step.

---

## Parameter reference

<div style="overflow-x:auto;">

| Name | Kind | Labels / args | Notes |
|---|---|---|---|
| `geometry_validation_total` | Counter | `result` (`ok`/`fail`), `reason` (bounded enum) | ≤ 10 series; incremented once per geometry |
| `geometry_reprojection_total` | Counter | `source_epsg` (string EPSG code) | Bounded by accepted input CRSs; never label by geometry |
| `Reason` | Enum (str) | `none`, `self_intersection`, `too_few_points`, `nan_coord`, `crs_mismatch` | Closed set — the cardinality guarantee |
| `validate(geometry, expected_epsg)` | function | `geometry: dict`, `expected_epsg: int = 4326` | Returns `bool`; RFC 7946 assumes EPSG:4326 |
| `make_asgi_app()` | app factory | — | Mount at `/metrics` for Prometheus scrape |
| `rate(...[5m])` | PromQL | window ≥ 4× scrape interval | Compensates for counter resets automatically |

</div>

---

## Gotchas and spatial edge cases

1. **High-cardinality labels will crash your monitoring.** Never put `feature_id`, tenant id, or raw coordinates in a label. Each unique value is a permanent time series held in memory by both the client and Prometheus. Keep labels to closed enums; push per-event detail to logs and traces instead.

2. **Counter resets on restart are handled by `rate()`, not by you.** A process restart zeroes every Counter. If you subtract raw counter values across a restart you get a negative, nonsensical result. `rate()` and `increase()` detect the reset and correct for it — always alert on `rate()`, never on `metric - metric offset`.

3. **Pick a `rate()` window at least four times your scrape interval.** With a 15-second scrape, a 5-minute window gives each sample ~20 data points, smoothing single-payload noise while still catching a bad deploy within minutes. Too narrow a window makes the alert flap; too wide makes it slow to fire.

4. **Validate before *and* after reprojection.** A geometry that is valid in EPSG:3857 (Web Mercator) can acquire NaN coordinates when transformed to EPSG:4326 (WGS84) near the projection's polar limits, and reprojection can collapse a thin sliver polygon into a degenerate ring. Validating only on ingest misses these; add a `stage` label or a second Counter to separate pre-transform from post-transform failures.

5. **Classify into exactly one reason.** A geometry can fail several checks at once (too few points *and* NaN). Decide a fixed precedence — structural before topological, as in `_classify` above — so the total across reasons equals the total failures and your ratio math stays exact.

6. **A `null` geometry is valid GeoJSON, not a failure.** RFC 7946 §3.2 permits `"geometry": null` on a Feature. Handle that case before calling `shape()` so a legitimately geometry-less feature does not inflate your failure count.

7. **`explain_validity()` strings are not a stable API contract.** Shapely's human-readable reasons can change between versions. Match loosely (lowercase substring) and always fall back to a default topological bucket rather than crashing on an unrecognised message.

---

## Verification

This pytest exercise scrapes the exposed metrics text and asserts the Counter actually moved after an invalid geometry passes through `validate()`. It uses the `prometheus_client` default registry rendered by `generate_latest`.

```python
from prometheus_client import generate_latest
from your_module import validate, GEOMETRY_VALIDATION_TOTAL  # adjust import


def _sample(result: str, reason: str) -> float:
    """Read the current counter value for one label pair from the registry."""
    return GEOMETRY_VALIDATION_TOTAL.labels(result=result, reason=reason)._value.get()


def test_self_intersection_increments_fail_counter():
    before = _sample("fail", "self_intersection")

    # A bow-tie polygon: valid ring length, but self-intersecting.
    bowtie = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]],
    }
    assert validate(bowtie) is False

    after = _sample("fail", "self_intersection")
    assert after == before + 1  # the counter moved by exactly one


def test_valid_point_increments_ok_counter():
    before = _sample("ok", "none")
    assert validate({"type": "Point", "coordinates": [-73.965, 40.782]}) is True
    assert _sample("ok", "none") == before + 1


def test_metrics_endpoint_exposes_series():
    """The /metrics scrape output must contain our counter by name."""
    validate({"type": "Point", "coordinates": [0, 0]})
    body = generate_latest().decode("utf-8")
    assert "geometry_validation_total" in body
    assert 'result="ok"' in body
```

Run with `pytest -q`. The first test proves the failure path increments the correctly labelled series; the third proves the series is actually visible on the scrape endpoint Prometheus reads. Once the counter is flowing, wire it into [a Grafana dashboard for geospatial webhook health](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/a-grafana-dashboard-for-geospatial-webhook-health/) to visualise the failure ratio alongside throughput and latency.

---

## FAQ

<details class="faq">
<summary><strong>Why should I not label the Counter by feature id or coordinates?</strong></summary>

Every distinct label value creates a separate time series in Prometheus. Feature ids and raw coordinates are unbounded, so labelling by them produces millions of series, blows up memory in both the client and the server, and makes queries slow or impossible. Keep labels to bounded enums like `result` and `reason`.

</details>

<details class="faq">
<summary><strong>How does rate() handle counter resets when my handler restarts?</strong></summary>

Prometheus Counters are monotonic within a process, but a restart resets them to zero. The `rate()` and `increase()` functions detect the drop and automatically compensate, so a single restart does not create a negative spike. This is exactly why you must use `rate()` over a window rather than subtracting raw counter values yourself.

</details>

<details class="faq">
<summary><strong>Should I validate geometry before or after reprojection?</strong></summary>

Validate both. Validate on ingest in the source CRS to catch malformed payloads early, and validate again after reprojection to EPSG:4326 (WGS84) because coordinate transforms can introduce NaN coordinates or degenerate rings near projection edges. Use a stage label or two separate counters so you can tell pre-transform from post-transform failures apart.

</details>

<details class="faq">
<summary><strong>What rate() window should I pick for the failure-rate alert?</strong></summary>

Pick a window at least four times your scrape interval so each `rate()` sample sees several data points. With a 15-second scrape, a 5-minute window is a safe default: responsive enough to catch a bad deploy within minutes, wide enough to avoid noise from a single unlucky payload.

</details>

---

## Related

- [Geo-Specific Metrics & Instrumentation](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/) — the parent section on exporting spatial pipeline health to Prometheus
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — the validation logic whose outcomes this Counter measures
- [A Grafana Dashboard for Geospatial Webhook Health](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/a-grafana-dashboard-for-geospatial-webhook-health/) — visualising the failure ratio this metric feeds
