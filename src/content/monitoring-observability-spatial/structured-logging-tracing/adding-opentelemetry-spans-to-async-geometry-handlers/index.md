---
title: "Adding OpenTelemetry Spans to Async Geometry Handlers"
description: "Instrument an async Python geometry pipeline with OpenTelemetry so one webhook event yields a connected trace across ingress, validate, reproject, and publish."
slug: "adding-opentelemetry-spans-to-async-geometry-handlers"
type: "article"
breadcrumb:
  - label: "Monitoring & Observability for Spatial Pipelines"
    url: "/monitoring-observability-spatial/"
  - label: "Structured Logging & Tracing for Spatial Events"
    url: "/monitoring-observability-spatial/structured-logging-tracing/"
  - label: "Adding OpenTelemetry Spans to Async Geometry Handlers"
    url: "/monitoring-observability-spatial/structured-logging-tracing/adding-opentelemetry-spans-to-async-geometry-handlers/"
datePublished: "2025-05-01"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Adding OpenTelemetry Spans to Async Geometry Handlers",
      "description": "Instrument an async Python geometry-processing pipeline with OpenTelemetry so one webhook event produces a single connected trace across ingress, validate, reproject, and publish.",
      "url": "https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/adding-opentelemetry-spans-to-async-geometry-handlers/",
      "datePublished": "2025-05-01",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Monitoring & Observability for Spatial Pipelines", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/" },
        { "@type": "ListItem", "position": 2, "name": "Structured Logging & Tracing for Spatial Events", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/" },
        { "@type": "ListItem", "position": 3, "name": "Adding OpenTelemetry Spans to Async Geometry Handlers", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/adding-opentelemetry-spans-to-async-geometry-handlers/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Instrument an Async Geometry Handler with OpenTelemetry Spans",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Configure a tracer provider", "text": "Create an SDK TracerProvider with a span processor and exporter, register it globally, and obtain a named tracer for the geometry pipeline." },
        { "@type": "HowToStep", "position": 2, "name": "Wrap each stage in a span", "text": "Open a span with tracer.start_as_current_span around each handler — ingress, validate_geometry, reproject, publish — so they nest into one trace tree." },
        { "@type": "HowToStep", "position": 3, "name": "Attach bounded geo attributes", "text": "Record low-cardinality geo context on each span (h3 cell, source EPSG, vertex count, geometry type) and never the raw coordinate array." },
        { "@type": "HowToStep", "position": 4, "name": "Propagate context across create_task", "text": "Capture the active OpenTelemetry context before scheduling a background task and attach it inside the coroutine so the child span links to the parent trace." },
        { "@type": "HowToStep", "position": 5, "name": "Verify with an in-memory exporter", "text": "Run the pipeline in a test against InMemorySpanExporter and assert the finished-span parent/child tree by trace_id and parent span_id." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does my publish span show up as a separate trace instead of a child?",
          "acceptedAnswer": { "@type": "Answer", "text": "asyncio.create_task does not carry the OpenTelemetry context into the new task on all runtimes and instrumentation setups, so a span opened inside the task starts a fresh root. Capture context.get_current() in the scheduling coroutine and context.attach() it as the first line of the background coroutine, detaching the token in a finally block." }
        },
        {
          "@type": "Question",
          "name": "Can I put the geometry coordinates in a span attribute for debugging?",
          "acceptedAnswer": { "@type": "Answer", "text": "No. A raw coordinate array can be kilobytes per span, it inflates trace storage and export payloads, and it can leak sensitive location data into your observability backend. Record derived, bounded values instead — an h3 cell index, the vertex count, the bounding-box area, and the source EPSG code." }
        },
        {
          "@type": "Question",
          "name": "How do I keep high-volume geometry traces from overwhelming the backend?",
          "acceptedAnswer": { "@type": "Answer", "text": "Use a parent-based, ratio sampler (ParentBased(TraceIdRatioBased(rate))) so the sampling decision is made once at ingress and inherited by every child span in the pipeline. Sample a small fraction of normal traffic and pair it with tail-based sampling in a collector to always keep error and high-latency traces." }
        },
        {
          "@type": "Question",
          "name": "Should h3 cell index be a span attribute or a metric label?",
          "acceptedAnswer": { "@type": "Answer", "text": "As a span attribute it is safe because spans are individual records, not aggregated time series. As a Prometheus metric label it would explode cardinality — millions of h3 cells become millions of series. Keep the cell on the span for per-request debugging and aggregate to a coarse resolution before using it as a metric label." }
        }
      ]
    }
  ]
}
</script>

**To trace an async geometry pipeline, configure one SDK `TracerProvider`, wrap each handler stage in `tracer.start_as_current_span(...)` so ingress, validate, reproject, and publish nest under a single root span, attach only bounded geo attributes (h3 cell, source EPSG, vertex count), and manually re-attach the captured context inside any `asyncio.create_task` coroutine so the child span stays in the same trace.** Done correctly, one webhook delivery produces one connected trace you can read top to bottom.

This page belongs to [Structured Logging & Tracing for Spatial Events](https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/), part of the [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/) — the reference for making event-driven spatial systems debuggable in production.

---

## When to use this pattern

Reach for distributed tracing over plain structured logs when:

- A single webhook event fans out across several async coroutines or tasks — validate, reproject, enrich, publish — and you need to see the causal chain and per-stage latency for one delivery, not aggregate counters.
- Slow or failing events are hard to pin down because logs from concurrent deliveries interleave, and you cannot tell which log line belongs to which payload.
- You already ship spans from an upstream service (an API gateway, a Kafka producer) and want the geometry worker to continue the same trace rather than start a disconnected one.

It is not the right tool when you only need rates, ratios, or histograms — geometry validation failure rate, queue depth, reprojection duration percentiles. Those are aggregate signals and belong in metrics; see [Geo-Specific Metrics & Instrumentation](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/) for that layer. Tracing answers "what happened to *this* event"; metrics answer "how is the fleet doing".

---

## Why async breaks a naive trace

OpenTelemetry tracks the "current span" in a context variable. In synchronous code, opening a span with `start_as_current_span` sets that context for the duration of the `with` block, and any span opened inside becomes its child automatically. Async pipelines break this in two places.

First, `await` boundaries are fine — the context travels with the coroutine — but `asyncio.create_task` schedules a coroutine that may not inherit the active OpenTelemetry context. A span opened inside that task can silently start a brand-new root trace, so your `publish` stage appears as an orphan disconnected from `ingress`. Second, geometry payloads tempt you to attach the whole coordinate array as an attribute for "easier debugging", which bloats every span and can leak location data.

The diagram shows the shape you want: one root span per delivery, three nested child spans, and a fourth span that crosses a `create_task` boundary yet stays inside the same trace because the context was re-attached by hand.

<figure class="fig">
<svg viewBox="6 16 753 268" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="One webhook event producing a single OpenTelemetry trace across four async stages">
  <title>A single trace across four async geometry stages</title>
  <desc>A root span labelled process_geometry_event spans the full width. Beneath it, three nested child spans — validate_geometry, reproject, and publish — sit in sequence. The publish span sits below a dashed create_task boundary, with an arrow showing the OpenTelemetry context being carried across it so publish remains a child of the root rather than a new trace.</desc>
  <rect x="6" y="16" width="753" height="268" fill="var(--fig-bg)"/>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L8,3.5 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Root span -->
  <rect x="20" y="30" width="720" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.5"/>
  <text x="34" y="51" font-size="12" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">process_geometry_event  (root span · trace_id shared by all children)</text>
  <!-- Child 1 validate -->
  <rect x="40" y="86" width="200" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="140" y="107" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">validate_geometry</text>
  <!-- Child 2 reproject -->
  <rect x="270" y="86" width="200" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="370" y="107" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">reproject</text>
  <!-- attributes note -->
  <text x="40" y="140" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">span attributes: geo.h3_cell · geo.source_epsg · geo.vertex_count   (never the raw coordinates)</text>
  <!-- create_task boundary -->
  <line x1="20" y1="180" x2="740" y2="180" stroke="currentColor" stroke-opacity="0.4" stroke-width="1.2" stroke-dasharray="5 4"/>
  <text x="500" y="174" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">asyncio.create_task boundary — context attached by hand</text>
  <!-- context carry arrow -->
  <line x1="400" y1="124" x2="400" y2="204" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="410" y="164" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">carry ctx</text>
  <!-- Child 3 publish -->
  <rect x="300" y="212" width="200" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="400" y="233" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">publish</text>
  <text x="300" y="268" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">still a child of the root — same trace_id, parent = process_geometry_event</text>
</svg>
<figcaption><b>Figure 1.</b> A single trace across four async geometry stages</figcaption>
</figure>

---

## Complete runnable implementation

The module below is self-contained. It configures a tracer, instruments four async stages, attaches bounded geo attributes, and shows the manual context handoff across `asyncio.create_task`. It uses only `opentelemetry-api` and `opentelemetry-sdk` (`pip install opentelemetry-api opentelemetry-sdk`); the `h3` call is illustrative and stubbed so the file runs standalone.

```python
import asyncio
from opentelemetry import trace, context
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
from opentelemetry.trace import SpanKind, Status, StatusCode

# --- One-time tracer setup (do this at process startup) -------------------
# ParentBased(TraceIdRatioBased(rate)) makes the sampling decision once at the
# root and every child span inherits it, so heavy geometry traces are kept or
# dropped as a whole rather than half-recorded.
provider = TracerProvider(sampler=ParentBased(TraceIdRatioBased(0.10)))
provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("geospatial.webhook.geometry_handler")


def _bounded_geo_attrs(feature: dict) -> dict:
    """Derive low-cardinality, size-safe span attributes from a GeoJSON feature.

    We deliberately never attach the coordinate array itself: it can be
    kilobytes per span, inflates export payloads, and may leak location data.
    Instead we record an h3 cell (spatial bucket), the source CRS, the vertex
    count, and the geometry type — all small and bounded.
    """
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates") or []

    def _count_vertices(c) -> int:
        if not isinstance(c, list):
            return 0
        if c and isinstance(c[0], (int, float)):
            return 1  # a single [lon, lat] position
        return sum(_count_vertices(x) for x in c)

    lon, lat = 0.0, 0.0
    if geom.get("type") == "Point" and len(coords) >= 2:
        lon, lat = coords[0], coords[1]

    return {
        # h3.latlng_to_cell(lat, lon, 8) in real code; stubbed here to stay standalone.
        "geo.h3_cell": f"stub-h3-r8-{round(lat, 2)}-{round(lon, 2)}",
        "geo.source_epsg": int(feature.get("source_epsg", 4326)),  # EPSG:4326 (WGS84)
        "geo.geometry_type": geom.get("type", "unknown"),
        "geo.vertex_count": _count_vertices(coords),
    }


# --- Stage handlers, each wrapped in its own span -------------------------
async def validate_geometry(feature: dict) -> dict:
    with tracer.start_as_current_span("validate_geometry") as span:
        span.set_attributes(_bounded_geo_attrs(feature))
        await asyncio.sleep(0)  # stand-in for real async validation I/O
        if not feature.get("geometry"):
            span.set_status(Status(StatusCode.ERROR, "null geometry"))
            raise ValueError("feature has no geometry")
        return feature


async def reproject(feature: dict, target_epsg: int = 4326) -> dict:
    with tracer.start_as_current_span("reproject") as span:
        span.set_attribute("geo.source_epsg", int(feature.get("source_epsg", 4326)))
        span.set_attribute("geo.target_epsg", target_epsg)  # EPSG:4326 (WGS84)
        await asyncio.sleep(0)  # stand-in for pyproj transform
        feature["source_epsg"] = target_epsg
        return feature


async def publish(feature: dict) -> None:
    # Runs inside a task scheduled by the ingress handler. The parent context
    # is attached by the caller before we open this span (see below).
    with tracer.start_as_current_span("publish", kind=SpanKind.PRODUCER) as span:
        span.set_attribute("geo.h3_cell", _bounded_geo_attrs(feature)["geo.h3_cell"])
        await asyncio.sleep(0)  # stand-in for Kafka/Redis produce


# --- Ingress: root span + manual context propagation ---------------------
async def process_geometry_event(feature: dict) -> None:
    with tracer.start_as_current_span("process_geometry_event", kind=SpanKind.CONSUMER):
        feature = await validate_geometry(feature)
        feature = await reproject(feature)

        # Capture the ACTIVE context now, while the root span is current.
        parent_ctx = context.get_current()

        async def _publish_task() -> None:
            # Re-attach the captured context as the first action in the task,
            # otherwise the publish span may start a brand-new root trace.
            token = context.attach(parent_ctx)
            try:
                await publish(feature)
            finally:
                context.detach(token)

        task = asyncio.create_task(_publish_task())
        await task  # await so the span exports before the demo exits


if __name__ == "__main__":
    demo = {
        "type": "Feature",
        "source_epsg": 4326,  # EPSG:4326 (WGS84)
        "geometry": {"type": "Point", "coordinates": [-73.965355, 40.782865]},
        "properties": {"sensor_id": "SN-42"},
    }
    asyncio.run(process_geometry_event(demo))
```

Run it and the console exporter prints four spans that share one `trace_id`, with `validate_geometry`, `reproject`, and `publish` all pointing at the `process_geometry_event` span as their parent.

---

## Parameter reference

<div style="overflow-x:auto;">

| Span / attribute | Type | Spatial constraint | Default |
|---|---|---|---|
| `process_geometry_event` | span (`CONSUMER`) | Root span per delivery; owns the sampling decision | — |
| `validate_geometry` | span | Set `ERROR` status on invalid/null geometry | — |
| `reproject` | span | Carry both `geo.source_epsg` and `geo.target_epsg` | — |
| `publish` | span (`PRODUCER`) | Must inherit context across `create_task` | — |
| `geo.h3_cell` | `str` | One h3 index at a fixed resolution (7–9); low cardinality per span | — |
| `geo.source_epsg` | `int` | Numeric EPSG code, e.g. `4326` (WGS84) or `3857` (Web Mercator) | `4326` |
| `geo.vertex_count` | `int` | Derived count, never the coordinate array itself | `0` |
| `geo.geometry_type` | `str` | Bounded enum: Point, LineString, Polygon, … per RFC 7946 | `"unknown"` |
| sampler ratio | `float` | `0.0`–`1.0`; keep low for high-volume geometry traffic | `0.10` |

</div>

---

## Gotchas and spatial edge cases

1. **Context lost across `create_task`.** This is the most common failure. `asyncio.create_task` does not reliably carry the OpenTelemetry context, so a span opened in the task becomes a new root. Always `context.get_current()` in the scheduling coroutine and `context.attach()` it as the first line of the task, detaching in a `finally`.

<figure class="fig">
<svg viewBox="0 0 760 236" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A span opened inside create_task becoming an orphan root, and the same span correctly parented by attaching the captured context">
<title>The orphan span that create_task produces</title>
<desc>An ingress span opens and schedules geometry validation with asyncio.create_task. Because create_task does not carry the OpenTelemetry context into the new task, the span opened inside it has no parent and is exported as a second root, so the trace splits: the ingress trace shows a suspiciously fast request that appears to finish before its own work, and the validation work appears as an unrelated trace with no request attached. Nothing errors, and both traces look individually plausible, which is why this survives review. Capturing context.get_current in the scheduling coroutine and attaching it as the first statement of the task — with a matching detach in a finally block — restores the parent link, and validation appears as a child span nested under ingress where its duration is counted against the request.</desc>
<rect x="0" y="0" width="760" height="236" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-rose-edge)">create_task without attaching context — two roots</text>
<rect x="90" y="30" width="150" height="22" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="100" y="45" font-size="8.5" fill="var(--fig-ink)">ingress · 12 ms</text>
<text x="248" y="45" font-size="8.5" fill="var(--fig-rose-edge)">"request finished in 12 ms" — before its own work ran</text>
<rect x="90" y="58" width="30" height="18" rx="3" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<text x="126" y="71" font-size="8" fill="var(--fig-ink-soft)">parse</text>
<rect x="90" y="92" width="300" height="22" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="100" y="107" font-size="8.5" fill="var(--fig-ink)">validate_geometry · 840 ms — ROOT of its own trace</text>
<text x="398" y="107" font-size="8.5" fill="var(--fig-rose-edge)">no request, no bbox, no correlation id</text>
<text x="14" y="132" font-size="9" fill="var(--fig-ink-soft)">Both traces are individually plausible and nothing errors — which is why the break survives code review.</text>
<line x1="14" y1="144" x2="746" y2="144" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="164" font-size="10.5" font-weight="600" fill="var(--fig-mint-edge)">ctx = context.get_current() → context.attach(ctx) in the task</text>
<rect x="90" y="174" width="420" height="22" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="100" y="189" font-size="8.5" fill="var(--fig-ink)">ingress · 872 ms</text>
<rect x="106" y="200" width="30" height="18" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<text x="142" y="213" font-size="8" fill="var(--fig-ink-soft)">parse</text>
<rect x="184" y="200" width="300" height="18" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="194" y="213" font-size="8" fill="var(--fig-ink)">validate_geometry · 840 ms — child</text>
<text x="500" y="213" font-size="8.5" fill="var(--fig-mint-edge)">its duration now counts against the request</text>
<text x="14" y="232" font-size="9" fill="var(--fig-ink-soft)">Detach in a finally block — an attached context that outlives its task leaks into whatever coroutine the event loop runs next.</text>
</svg>
<figcaption><b>Figure 2.</b> The orphan is not a missing span but a mis-parented one, so nothing looks broken: latency simply disappears from the request it belonged to. Suspiciously fast ingress spans are the symptom worth watching for.</figcaption>
</figure>

2. **Raw coordinates as attributes.** A large `Polygon` or `MultiPolygon` coordinate array is kilobytes per span. Attaching it multiplies export volume, can breach exporter size limits, and leaks precise location data. Record `geo.vertex_count`, `geo.h3_cell`, and a bounding-box area instead.

<figure class="fig">
<svg viewBox="0 0 760 234" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Attaching raw coordinates to a span versus a compact spatial fingerprint, compared by export volume and what each lets you query">
<title>A spatial fingerprint carries the same answers at a thousandth the size</title>
<desc>A span for one multipolygon of forty-one thousand vertices. Attaching the raw coordinate array adds about 1.6 megabytes to the span, which multiplied across ten thousand spans an hour is roughly 16 gigabytes of export traffic, breaches most exporters' per-span size limits so the span is dropped entirely, and writes precise location data into a telemetry backend that is rarely access-controlled for it. A fingerprint of vertex count, H3 cell at resolution seven, source EPSG code and bounding-box area adds about 180 bytes, roughly nine thousand times smaller, and still answers the questions anyone actually asks of a trace: which region is slow, is this payload unusually large, which CRS did it arrive in. What it cannot answer is the exact shape — and a trace was never the right place to look that up, because the feature id in the same span leads to the source of record.</desc>
<rect x="0" y="0" width="760" height="234" fill="var(--fig-bg)"/>
<rect x="14" y="30" width="352" height="120" rx="7" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="50" font-size="10" font-weight="600" fill="var(--fig-ink)">geo.coordinates = [[13.40, 52.52], …]</text>
<text x="26" y="70" font-size="9" fill="var(--fig-ink-soft)">41,000 vertices ≈ 1.6 MB on one span</text>
<text x="26" y="86" font-size="9" fill="var(--fig-ink-soft)">× 10,000 spans/h ≈ 16 GB/h of export</text>
<text x="26" y="106" font-size="9" fill="var(--fig-rose-edge)">breaches per-span size limits ⇒ span dropped</text>
<text x="26" y="122" font-size="9" fill="var(--fig-rose-edge)">writes precise location into an unguarded backend</text>
<text x="26" y="140" font-size="8.5" fill="var(--fig-ink-soft)">The instrumentation you added to debug it removes the span you needed.</text>
<rect x="386" y="30" width="360" height="120" rx="7" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="398" y="50" font-size="10" font-weight="600" fill="var(--fig-ink)">the fingerprint — about 180 bytes</text>
<text x="398" y="70" font-size="9" font-family="monospace" fill="var(--fig-ink-soft)">geo.vertex_count  41337</text>
<text x="398" y="86" font-size="9" font-family="monospace" fill="var(--fig-ink-soft)">geo.h3_cell       871f1d4ffffffff</text>
<text x="398" y="102" font-size="9" font-family="monospace" fill="var(--fig-ink-soft)">geo.source_epsg   27700</text>
<text x="398" y="118" font-size="9" font-family="monospace" fill="var(--fig-ink-soft)">geo.bbox_area_km2 14.2</text>
<text x="398" y="140" font-size="8.5" fill="var(--fig-mint-edge)">~9,000× smaller, and the span survives export</text>
<rect x="14" y="164" width="366" height="62" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="26" y="182" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Questions it still answers</text>
<text x="26" y="199" font-size="9" fill="var(--fig-ink-soft)">Which region is slow · is this payload unusually large ·</text>
<text x="26" y="212" font-size="9" fill="var(--fig-ink-soft)">which CRS did it arrive in · group latency by cell</text>
<rect x="394" y="164" width="352" height="62" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="406" y="182" font-size="9.5" font-weight="600" fill="var(--fig-ink)">What it gives up</text>
<text x="406" y="199" font-size="9" fill="var(--fig-ink-soft)">The exact shape — which a trace was never the place to hold.</text>
<text x="406" y="212" font-size="9" fill="var(--fig-ink-soft)">The feature id on the same span leads to the source of record.</text>
</svg>
<figcaption><b>Figure 3.</b> Record derived facts, not the payload. A span carrying its geometry is large enough to be dropped by the exporter, so the instrumentation removes exactly the evidence it was added to capture.</figcaption>
</figure>

3. **Attribute cardinality creep.** Span attributes tolerate high cardinality far better than metric labels, but backends still index them. Avoid per-request unique strings like a full delivery UUID *as a searchable dimension* unless you need it; prefer the h3 cell at a coarse resolution for spatial grouping.

4. **Sampling that splits a trace.** A head sampler that decides independently per span can keep `validate_geometry` but drop `publish`, giving you half a trace. Use `ParentBased(TraceIdRatioBased(rate))` so one decision at the root propagates to all children.

5. **CRS mismatch hidden by tracing.** Recording only `geo.target_epsg` hides reprojection bugs. Always record `geo.source_epsg` *and* `geo.target_epsg` so a trace shows, for example, an EPSG:3857 (Web Mercator) payload that was never normalized to EPSG:4326 (WGS84).

6. **Spans not exported in short-lived scripts.** With `SimpleSpanProcessor`/`BatchSpanProcessor`, spans flush asynchronously. In tests or one-shot workers call `provider.force_flush()` (or `await` the task as above) before the process exits, or the last spans vanish.

7. **Instrumenting CPU-bound offload.** Heavy reprojection or validation often runs in a thread or process pool. `run_in_executor` does not carry context automatically either — capture and re-attach it inside the executor callable, the same way you do for `create_task`. See [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) for the offload patterns this applies to.

---

## Verification

This test drives the pipeline against an `InMemorySpanExporter` and asserts the span tree by `trace_id` and `parent` linkage — proving the `publish` span really is a child and not an orphan. Run with `pytest`.

```python
import asyncio
import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import geometry_handler as gh  # the module shown above


@pytest.fixture
def spans():
    """Swap in a provider backed by an in-memory exporter for assertions."""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    # Rebind the module's tracer to the test provider.
    gh.tracer = trace.get_tracer("test.geometry_handler")
    yield exporter
    exporter.clear()


def test_single_connected_trace(spans):
    feature = {
        "type": "Feature",
        "source_epsg": 3857,  # EPSG:3857 (Web Mercator) — should be recorded
        "geometry": {"type": "Point", "coordinates": [-73.965355, 40.782865]},
    }
    asyncio.run(gh.process_geometry_event(feature))

    finished = {s.name: s for s in spans.get_finished_spans()}
    assert set(finished) == {
        "process_geometry_event", "validate_geometry", "reproject", "publish",
    }

    root = finished["process_geometry_event"]
    # All four spans share ONE trace_id.
    trace_ids = {s.context.trace_id for s in finished.values()}
    assert len(trace_ids) == 1

    # publish crossed a create_task boundary but is still a child of the root.
    publish = finished["publish"]
    assert publish.parent is not None
    assert publish.parent.span_id == root.context.span_id
    assert root.parent is None  # the root has no parent


def test_geo_attributes_are_bounded(spans):
    feature = {
        "type": "Feature",
        "source_epsg": 4326,  # EPSG:4326 (WGS84)
        "geometry": {"type": "Point", "coordinates": [-73.965355, 40.782865]},
    }
    asyncio.run(gh.process_geometry_event(feature))

    validate = next(
        s for s in spans.get_finished_spans() if s.name == "validate_geometry"
    )
    attrs = dict(validate.attributes)
    assert attrs["geo.vertex_count"] == 1
    assert attrs["geo.source_epsg"] == 4326
    # No raw coordinate array leaked onto any attribute value.
    assert all("coordinates" not in str(v) for v in attrs.values())
```

---

## FAQ

<details class="faq">
<summary><strong>Why does my publish span show up as a separate trace instead of a child?</strong></summary>

`asyncio.create_task` does not carry the OpenTelemetry context into the new task on all runtimes and instrumentation setups, so a span opened inside the task starts a fresh root. Capture `context.get_current()` in the scheduling coroutine and `context.attach()` it as the first line of the background coroutine, detaching the token in a `finally` block.

</details>

<details class="faq">
<summary><strong>Can I put the geometry coordinates in a span attribute for debugging?</strong></summary>

No. A raw coordinate array can be kilobytes per span, it inflates trace storage and export payloads, and it can leak sensitive location data into your observability backend. Record derived, bounded values instead — an h3 cell index, the vertex count, the bounding-box area, and the source EPSG code.

</details>

<details class="faq">
<summary><strong>How do I keep high-volume geometry traces from overwhelming the backend?</strong></summary>

Use a parent-based, ratio sampler (`ParentBased(TraceIdRatioBased(rate))`) so the sampling decision is made once at ingress and inherited by every child span in the pipeline. Sample a small fraction of normal traffic and pair it with tail-based sampling in a collector to always keep error and high-latency traces.

</details>

<details class="faq">
<summary><strong>Should h3 cell index be a span attribute or a metric label?</strong></summary>

As a span attribute it is safe because spans are individual records, not aggregated time series. As a Prometheus metric label it would explode cardinality — millions of h3 cells become millions of series. Keep the cell on the span for per-request debugging and aggregate to a coarse resolution before using it as a metric label.

</details>

---

## Related

- [Structured Logging & Tracing for Spatial Events](https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/) — the parent guide to correlating logs and traces across a spatial event pipeline
- [Geo-Specific Metrics & Instrumentation](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/) — the aggregate signal layer that complements per-event traces
- [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) — the offload patterns whose task and executor boundaries need manual context propagation
