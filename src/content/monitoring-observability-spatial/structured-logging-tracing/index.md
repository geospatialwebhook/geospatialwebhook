---
title: "Structured Logging & Tracing for Spatial Events"
description: "Structured JSON logging and OpenTelemetry tracing for async geospatial webhooks: attach bounding box, H3 cell, EPSG CRS, and correlation IDs without logging heavy geometries."
slug: "structured-logging-tracing"
type: "guide"
breadcrumb: "Monitoring & Observability for Spatial Pipelines > Structured Logging & Tracing for Spatial Events"
datePublished: "2025-02-10"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Structured Logging & Tracing for Spatial Events",
      "description": "How to add structured JSON logging and distributed tracing to async geospatial webhook pipelines: attaching bounding box, H3 cell, EPSG CRS, feature id, and idempotency key to every log line, propagating correlation IDs across asyncio tasks, and following one event through OpenTelemetry spans from HTTP ingress to consumer.",
      "url": "https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/",
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
        {"@type": "ListItem", "position": 3, "name": "Structured Logging & Tracing for Spatial Events", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Add structured logging and tracing to a spatial webhook pipeline",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Define a compact spatial log context (bbox, H3 cell, EPSG CRS, feature id, idempotency key, event_type)"},
        {"@type": "HowToStep", "position": 2, "name": "Bind a correlation id into contextvars at HTTP ingress"},
        {"@type": "HowToStep", "position": 3, "name": "Inject the spatial context into every log line with a structlog processor"},
        {"@type": "HowToStep", "position": 4, "name": "Wrap the geometry handler in an OpenTelemetry span with spatial attributes"},
        {"@type": "HowToStep", "position": 5, "name": "Propagate trace context across the broker into the consumer"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why should I never log the full geometry of a spatial event?",
          "acceptedAnswer": {"@type": "Answer", "text": "A single MultiPolygon can carry tens of thousands of coordinate pairs. Serialising that into every log line inflates log volume by orders of magnitude, blows past field-size limits in log backends, and slows the hot path with JSON encoding you never read. Log a compact spatial fingerprint instead: the bounding box, an H3 or geohash cell, the source CRS as an EPSG code, the feature id, and the vertex count. That is enough to locate the event, reason about where it sits, and correlate across services, while the full geometry stays in the payload store keyed by feature id."}
        },
        {
          "@type": "Question",
          "name": "How do correlation IDs survive across asyncio tasks and broker hops?",
          "acceptedAnswer": {"@type": "Answer", "text": "Within a process, store the correlation id in a contextvars.ContextVar. asyncio.create_task copies the current context, so a spawned task inherits the id automatically, whereas loop.run_in_executor does not and needs the id passed explicitly. Across a broker hop the in-process context is gone, so you must serialise the correlation id (and the W3C traceparent header) into the message envelope and rebind it in the consumer before doing any work. Structured logging and OpenTelemetry propagation both rely on this handoff."}
        },
        {
          "@type": "Question",
          "name": "What is the difference between a correlation ID and an OpenTelemetry trace ID?",
          "acceptedAnswer": {"@type": "Answer", "text": "A correlation id is an application-level identifier you mint and control, usually one per inbound webhook, and it is convenient to filter logs on. An OpenTelemetry trace id is a 16-byte identifier managed by the tracing SDK that ties together spans across services and is carried in the W3C traceparent header. They are complementary: put both on every log line so you can pivot from a log search to a full trace waterfall and back. Many teams simply set the correlation id equal to the trace id to avoid maintaining two identifiers."}
        },
        {
          "@type": "Question",
          "name": "Should tracing spans include the geometry as an attribute?",
          "acceptedAnswer": {"@type": "Answer", "text": "No. Span attributes are indexed and shipped on every export, so a large geometry there is even more costly than in a log line and is often silently truncated by the collector. Attach only low-cardinality-friendly spatial metadata: geo.crs as an EPSG string, geo.h3_cell, geo.bbox as four rounded numbers, geo.vertex_count, and geo.feature_id. Be careful with the H3 cell: at fine resolutions it is high cardinality and can explode your metrics if the same attributes feed span metrics, so prefer a coarse resolution for attributes."}
        }
      ]
    }
  ]
}
</script>

**Structured logging attaches a compact spatial fingerprint — bounding box, H3 cell, source CRS as an EPSG code, feature id, and idempotency key — to every log line, while distributed tracing stitches those lines into one waterfall that follows a single webhook from HTTP ingress through validation, broker publish, and consumer, all without ever serialising a heavy geometry into your telemetry.**

This topic is part of [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/), the discipline of making event-driven geospatial systems debuggable in production. Where [Geo-Specific Metrics & Instrumentation](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/) answers "how many and how fast" in aggregate, structured logs and traces answer "what happened to *this* event" — the question you actually ask at 3 a.m. when one feature update silently vanished between the receiver and the tile builder.

---

## Prerequisites

Confirm your stack before wiring in the context processors and spans below. Check off each item as you verify it:

- [ ] **Python 3.11+** — required for `contextvars` copy semantics used by `asyncio.create_task` and for `TaskGroup`
- [ ] **`structlog` 24.x** — the processor chain is the injection point for spatial context
- [ ] **`opentelemetry-sdk` 1.25+ / `opentelemetry-api`** — spans, context propagation, and the OTLP exporter
- [ ] **`opentelemetry-instrumentation-fastapi`** (or your framework's instrumentor) — auto-creates the ingress span
- [ ] **`h3` 4.x** — to derive a coarse cell index for log and span context
- [ ] **`shapely` 2.0+** — to compute the bounding box and vertex count cheaply
- [ ] **A broker with header support** (Kafka, Redis Streams, RabbitMQ) — the W3C `traceparent` must ride in the message envelope
- [ ] **An OTLP-compatible collector** (Tempo, Jaeger, or the OpenTelemetry Collector) — to receive and render the trace waterfall

---

## Architecture

Observability for an async spatial pipeline has three planes that share one set of identifiers. Get the identifiers right and both planes light up; get them wrong and you have logs that cannot be joined to traces and traces that stop at a broker boundary.

1. **Context plane** — a per-event `correlation_id` and a small, immutable `SpatialContext` (bounding box, H3 cell, EPSG CRS, feature id, idempotency key, `event_type`) live in `contextvars`. They are bound once at ingress and read by every log call and span for the life of the event, including across spawned `asyncio` tasks.
2. **Log plane** — `structlog` runs a processor chain on every event. A custom processor reads the context plane and merges the spatial fingerprint into the JSON record, so every line is self-describing without the call site repeating fields.
3. **Trace plane** — OpenTelemetry creates a span per stage. The ingress span is the root; validation and publish are children; the broker carries the `traceparent` header so the consumer span re-parents under the same trace, producing the waterfall below.

The trace waterfall is the payoff — one event, four spans, one trace id, read top to bottom in wall-clock time:

<svg viewBox="0 0 760 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="OpenTelemetry trace waterfall for one spatial webhook event across ingress, validate, publish, and consume spans" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>Trace waterfall for one spatial webhook event</title>
  <desc>A horizontal waterfall showing four spans on a shared timeline: an ingress root span spanning the full width, a validate child span, a publish child span, and a consume span that re-parents after the broker hop. A dashed vertical line marks the broker boundary where the traceparent header carries context forward.</desc>
  <defs>
    <marker id="tw-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- time axis -->
  <line x1="150" y1="40" x2="150" y2="270" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <text x="150" y="30" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">t=0</text>
  <text x="740" y="30" text-anchor="end" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">wall-clock time →</text>
  <line x1="150" y1="270" x2="748" y2="270" stroke="currentColor" stroke-width="1" opacity="0.3" marker-end="url(#tw-arr)"/>
  <!-- trace id label -->
  <text x="10" y="30" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">trace_id 4bf9…a1</text>
  <!-- ingress root span -->
  <text x="140" y="70" text-anchor="end" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">HTTP ingress</text>
  <rect x="150" y="58" width="560" height="20" rx="4" fill="currentColor" opacity="0.18" stroke="currentColor" stroke-width="1"/>
  <text x="160" y="72" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.75">span: receive_webhook (root)</text>
  <!-- validate child -->
  <text x="140" y="108" text-anchor="end" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">validate</text>
  <rect x="175" y="96" width="150" height="20" rx="4" fill="currentColor" opacity="0.3" stroke="currentColor" stroke-width="1"/>
  <text x="185" y="110" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">span: validate_geometry</text>
  <!-- publish child -->
  <text x="140" y="146" text-anchor="end" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">publish</text>
  <rect x="335" y="134" width="120" height="20" rx="4" fill="currentColor" opacity="0.3" stroke="currentColor" stroke-width="1"/>
  <text x="345" y="148" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">span: broker_publish</text>
  <!-- broker boundary -->
  <line x1="470" y1="48" x2="470" y2="240" stroke="currentColor" stroke-width="1.2" opacity="0.45" stroke-dasharray="4,3"/>
  <text x="470" y="232" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">broker hop · traceparent header</text>
  <!-- consume span (re-parented) -->
  <text x="140" y="192" text-anchor="end" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">consume</text>
  <rect x="500" y="180" width="200" height="20" rx="4" fill="currentColor" opacity="0.3" stroke="currentColor" stroke-width="1"/>
  <text x="510" y="194" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">span: process_spatial_event</text>
  <!-- link from publish to consume across boundary -->
  <line x1="455" y1="144" x2="500" y2="182" stroke="currentColor" stroke-width="1.2" opacity="0.5" marker-end="url(#tw-arr)" stroke-dasharray="3,2"/>
  <!-- shared attributes footer -->
  <text x="150" y="262" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">every span: geo.crs=EPSG:4326 · geo.h3_cell · geo.bbox · geo.feature_id · correlation_id</text>
</svg>

The dashed line is the only place things break in practice. In-process the context plane keeps everyone in sync; at the broker hop the process context is gone and both the correlation id and the `traceparent` must be carried explicitly in the message. Everything downstream depends on that handoff, so it gets its own step below.

---

## Step-by-Step Implementation

### Step 1 — Define a Compact Spatial Context

The whole strategy rests on one rule: derive a small fingerprint of the geometry once, and log/trace *that* — never the coordinates themselves. Compute the bounding box, a coarse H3 cell, the vertex count, and carry the identifiers you already have.

```python
from dataclasses import dataclass, asdict
from shapely.geometry import shape
import h3


@dataclass(frozen=True)
class SpatialContext:
    """Compact, log-safe fingerprint of a spatial event. Never holds coordinates."""
    feature_id: str
    event_type: str
    crs: str                 # always an EPSG code, e.g. "EPSG:4326"
    idempotency_key: str
    bbox: tuple[float, float, float, float]  # (minx, miny, maxx, maxy), rounded
    h3_cell: str             # coarse cell for locating, not fine-grained routing
    vertex_count: int


def build_spatial_context(
    raw_geometry: dict,
    feature_id: str,
    event_type: str,
    idempotency_key: str,
    crs: str = "EPSG:4326",
    h3_resolution: int = 5,   # ~250 km² cells: coarse on purpose (low cardinality)
) -> SpatialContext:
    """
    Derive a compact context from a GeoJSON geometry (RFC 7946).
    Assumes coordinates are already in EPSG:4326 (WGS84); normalise upstream if not.
    """
    geom = shape(raw_geometry)
    minx, miny, maxx, maxy = geom.bounds
    # Representative point is guaranteed to lie inside the geometry, unlike centroid
    rep = geom.representative_point()
    cell = h3.latlng_to_cell(rep.y, rep.x, h3_resolution)  # (lat, lng) order

    return SpatialContext(
        feature_id=feature_id,
        event_type=event_type,
        crs=crs,
        idempotency_key=idempotency_key,
        bbox=(round(minx, 5), round(miny, 5), round(maxx, 5), round(maxy, 5)),
        h3_cell=cell,
        vertex_count=len(geom.get_coordinates() if hasattr(geom, "get_coordinates")
                         else list(geom.exterior.coords) if geom.geom_type == "Polygon"
                         else []),
    )
```

Rounding the bounding box to five decimals (~1.1 m at the equator in EPSG:4326) keeps the fields short and stable across floating-point drift. The H3 cell here is deliberately coarse — resolution 5, not 9 — because a fine cell is high-cardinality and will hurt you if these attributes ever feed span metrics. Choosing an appropriate H3 resolution is a recurring decision explored in [H3 vs S2 vs Quadkey for Spatial Partitioning](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/).

---

### Step 2 — Bind a Correlation ID at Ingress

Store the correlation id and the spatial context in `contextvars`. A `ContextVar` is task-local: `asyncio.create_task` copies the current context, so any task you spawn inherits the id for free — the property that makes async logging coherent.

```python
import contextvars
import uuid

# Module-level context variables — one binding per in-flight event
correlation_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "correlation_id", default="-"
)
spatial_ctx_var: contextvars.ContextVar[SpatialContext | None] = contextvars.ContextVar(
    "spatial_ctx", default=None
)


def bind_request_context(
    ctx: SpatialContext,
    incoming_correlation_id: str | None = None,
) -> str:
    """
    Bind correlation id + spatial context for the current async task.
    Reuse an inbound id if the upstream sender provided one (chained webhooks);
    otherwise mint a fresh one so every event is traceable end to end.
    """
    cid = incoming_correlation_id or uuid.uuid4().hex
    correlation_id_var.set(cid)
    spatial_ctx_var.set(ctx)
    return cid
```

Bind once, as early as possible in the request handler, and never re-set it deeper in the stack. Reusing an upstream-supplied id lets you stitch together chained webhooks (e.g. a feature change from [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) that fans out into tile rebuilds) under a single correlation id.

---

### Step 3 — Inject Spatial Context with a structlog Processor

A structlog *processor* is a function run on every log event before rendering. This one reads the context plane and merges the fingerprint into the record, so call sites stay clean — `log.info("published")` still emits the full spatial context.

```python
import logging
import structlog


def add_spatial_context(logger, method_name, event_dict: dict) -> dict:
    """structlog processor: merge correlation id + spatial fingerprint into every line."""
    event_dict["correlation_id"] = correlation_id_var.get()

    ctx = spatial_ctx_var.get()
    if ctx is not None:
        event_dict["feature_id"] = ctx.feature_id
        event_dict["event_type"] = ctx.event_type
        event_dict["crs"] = ctx.crs                    # e.g. "EPSG:4326"
        event_dict["idempotency_key"] = ctx.idempotency_key
        event_dict["h3_cell"] = ctx.h3_cell
        event_dict["bbox"] = ctx.bbox
        event_dict["vertex_count"] = ctx.vertex_count
    return event_dict


def configure_logging() -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            add_spatial_context,                       # our spatial injector
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),       # structured JSON output
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        cache_logger_on_first_use=True,
    )


log = structlog.get_logger()
```

A resulting line is a single JSON object — `{"event": "broker_publish", "correlation_id": "9f3c…", "feature_id": "parcel-8841", "crs": "EPSG:4326", "h3_cell": "85283473fffffff", "bbox": [-0.13, 51.5, -0.12, 51.51], "vertex_count": 5, "level": "info", "timestamp": "…"}` — greppable, joinable, and free of raw coordinates.

---

### Step 4 — Wrap the Geometry Handler in an OpenTelemetry Span

Spans give you timing and parent/child structure. Set spatial attributes with a `geo.` prefix, record exceptions on the span, and keep attributes low-cardinality — no coordinates, coarse H3 only.

```python
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

tracer = trace.get_tracer("geospatial.webhook")


async def process_spatial_event(raw_geometry: dict, ctx: SpatialContext) -> None:
    """Consumer-side handler wrapped in a span with spatial attributes."""
    with tracer.start_as_current_span("process_spatial_event") as span:
        span.set_attribute("geo.crs", ctx.crs)               # "EPSG:4326"
        span.set_attribute("geo.feature_id", ctx.feature_id)
        span.set_attribute("geo.event_type", ctx.event_type)
        span.set_attribute("geo.h3_cell", ctx.h3_cell)       # coarse res 5
        span.set_attribute("geo.bbox", list(ctx.bbox))
        span.set_attribute("geo.vertex_count", ctx.vertex_count)
        span.set_attribute("messaging.idempotency_key", ctx.idempotency_key)

        try:
            await run_spatial_join(raw_geometry)             # the real work
            log.info("spatial_event_processed")
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, "spatial processing failed"))
            log.error("spatial_event_failed", error=str(exc))
            raise
```

Heavy geometry parsing belongs off the event loop; the span happily wraps an `await` that delegates CPU-bound work to an executor. That interplay between spans and executors is the subject of the deep dive in [Adding OpenTelemetry Spans to Async Geometry Handlers](https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/adding-opentelemetry-spans-to-async-geometry-handlers/), and the executor pattern itself comes from [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/).

---

### Step 5 — Propagate Trace Context Across the Broker

This is the dashed line in the diagram. The in-process context does not survive a broker hop, so inject the W3C `traceparent` and the correlation id into the message headers on publish, and extract them on consume before creating the child span.

```python
from opentelemetry import propagate, context as otel_context


async def publish_spatial_event(producer, topic: str, payload: bytes, ctx: SpatialContext) -> None:
    """Producer side: create a publish span and inject propagation headers."""
    with tracer.start_as_current_span("broker_publish") as span:
        span.set_attribute("geo.h3_cell", ctx.h3_cell)
        span.set_attribute("messaging.destination", topic)

        headers: dict[str, str] = {}
        propagate.inject(headers)                            # writes W3C 'traceparent'
        headers["correlation_id"] = correlation_id_var.get()

        await producer.send(
            topic,
            value=payload,
            headers=[(k, v.encode()) for k, v in headers.items()],
        )


async def consume_spatial_event(message, raw_geometry: dict, ctx: SpatialContext) -> None:
    """Consumer side: extract context so the consume span re-parents under the same trace."""
    headers = {k: v.decode() for k, v in (message.headers or [])}
    parent_ctx = propagate.extract(headers)                 # reads 'traceparent'
    token = otel_context.attach(parent_ctx)
    try:
        bind_request_context(ctx, incoming_correlation_id=headers.get("correlation_id"))
        await process_spatial_event(raw_geometry, ctx)      # its span parents correctly
    finally:
        otel_context.detach(token)
```

Without `propagate.inject`/`extract`, the consumer starts a brand-new trace and you lose the causal link — the waterfall stops at the broker and every consumed event looks like an orphaned root.

---

## Spatial Validation and Error Handling

Telemetry code must never crash the hot path, and it must never be the thing that logs a giant coordinate array. Guard the fingerprint derivation, and validate that the geometry is usable before you compute a bounding box on it.

```python
from shapely.geometry import shape
from shapely.validation import explain_validity
from pydantic import BaseModel, field_validator


class SpatialEventEnvelope(BaseModel):
    feature_id: str
    event_type: str
    crs: str = "EPSG:4326"
    idempotency_key: str

    @field_validator("crs")
    @classmethod
    def crs_must_be_epsg(cls, v: str) -> str:
        # Enforce an explicit EPSG code so logs are unambiguous across services
        if not v.startswith("EPSG:"):
            raise ValueError(f"crs must be an EPSG code, got {v!r}")
        return v


def safe_build_context(raw_geometry: dict, env: SpatialEventEnvelope) -> SpatialContext:
    """
    Build the log context defensively. A telemetry failure must degrade to a
    minimal context, never raise into the request path or dump coordinates.
    """
    geom = shape(raw_geometry)
    if not geom.is_valid:
        # Log the *reason* and the feature id — not the geometry
        log.warning("invalid_geometry_for_context", reason=explain_validity(geom),
                    feature_id=env.feature_id)
    try:
        return build_spatial_context(
            raw_geometry, env.feature_id, env.event_type, env.idempotency_key, env.crs,
        )
    except Exception as exc:
        log.warning("spatial_context_degraded", error=str(exc), feature_id=env.feature_id)
        return SpatialContext(
            feature_id=env.feature_id, event_type=env.event_type, crs=env.crs,
            idempotency_key=env.idempotency_key, bbox=(0, 0, 0, 0),
            h3_cell="unknown", vertex_count=-1,
        )
```

Requiring the CRS to be an explicit `EPSG:` code at the schema boundary means a log line can never be ambiguous about whether `bbox` is in EPSG:4326 (WGS84) degrees or EPSG:3857 (Web Mercator) metres — a distinction that silently corrupts any downstream bounding-box query if you guess wrong.

---

## Retry, Backoff, and Delivery Guarantees

Retries multiply log lines and can fragment a trace. The rule is: retries share the correlation id and the trace, and each attempt is its own span so you can see the backoff on the waterfall. Attach the attempt number and record why each attempt failed.

```python
import asyncio
import random


async def publish_with_retry(
    producer, topic: str, payload: bytes, ctx: SpatialContext,
    max_attempts: int = 5, base_delay: float = 0.5,
) -> None:
    """Exponential backoff with full jitter; each attempt is a child span."""
    for attempt in range(1, max_attempts + 1):
        with tracer.start_as_current_span("broker_publish_attempt") as span:
            span.set_attribute("retry.attempt", attempt)
            span.set_attribute("geo.feature_id", ctx.feature_id)
            try:
                await publish_spatial_event(producer, topic, payload, ctx)
                return
            except Exception as exc:
                span.record_exception(exc)
                if attempt == max_attempts:
                    log.error("publish_exhausted", attempts=attempt, error=str(exc))
                    raise
                # Full jitter: random within [0, base * 2**attempt]
                delay = random.uniform(0, base_delay * (2 ** attempt))
                log.warning("publish_retry", attempt=attempt, delay_s=round(delay, 3),
                            error=str(exc))
                await asyncio.sleep(delay)
```

Because the correlation id lives in `contextvars` and the trace context is current, every retry line and every attempt span carries the same identifiers automatically. Under **at-least-once** delivery the consumer may see the same event twice; the `idempotency_key` you logged and set as a span attribute is exactly what a downstream deduplicator uses to collapse those into one logical operation, so a duplicate shows up as two consume spans sharing one key rather than as a mystery. True **exactly-once** semantics would require a transactional broker and add latency rarely justified for spatial ingestion — logging the key and letting the consumer deduplicate is the pragmatic middle ground.

---

## Verification

Prove two things: that every log line carries the spatial context, and that trace context survives the broker hop. `structlog.testing.capture_logs` and the OpenTelemetry in-memory span exporter make both assertions cheap.

```python
import pytest
import structlog
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


SAMPLE_GEOMETRY = {
    "type": "Polygon",
    "coordinates": [[[-0.1276, 51.5074], [-0.1277, 51.5075],
                     [-0.1275, 51.5075], [-0.1276, 51.5074]]],
}


@pytest.fixture
def span_exporter():
    provider = TracerProvider()
    exporter = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    yield exporter
    exporter.clear()


def test_every_log_line_has_spatial_context():
    env = SpatialEventEnvelope(feature_id="parcel-8841", event_type="update",
                               idempotency_key="idem:v1:abc")
    ctx = safe_build_context(SAMPLE_GEOMETRY, env)
    bind_request_context(ctx)

    with structlog.testing.capture_logs() as logs:
        log.info("broker_publish")

    entry = logs[0]
    assert entry["crs"] == "EPSG:4326"
    assert entry["feature_id"] == "parcel-8841"
    assert entry["h3_cell"] != "unknown"
    assert "coordinates" not in entry            # never log the raw geometry


@pytest.mark.asyncio
async def test_trace_context_survives_broker_hop(span_exporter):
    env = SpatialEventEnvelope(feature_id="parcel-8841", event_type="update",
                               idempotency_key="idem:v1:abc")
    ctx = safe_build_context(SAMPLE_GEOMETRY, env)

    headers: dict[str, str] = {}
    with tracer.start_as_current_span("broker_publish"):
        from opentelemetry import propagate
        propagate.inject(headers)

    assert "traceparent" in headers, "publish must inject W3C traceparent"

    # Simulate the consumer re-parenting under the extracted context
    from opentelemetry import propagate, context as otel_context
    token = otel_context.attach(propagate.extract(headers))
    try:
        await process_spatial_event(SAMPLE_GEOMETRY, ctx)
    finally:
        otel_context.detach(token)

    spans = {s.name: s for s in span_exporter.get_finished_spans()}
    publish = spans["broker_publish"]
    consume = spans["process_spatial_event"]
    # Same trace id proves the waterfall is intact across the hop
    assert publish.context.trace_id == consume.context.trace_id
    assert consume.attributes["geo.crs"] == "EPSG:4326"
```

Run with `pytest -v --asyncio-mode=auto`. The second test is the important one: if `traceparent` injection or extraction is misconfigured, the consume span gets a fresh trace id and the equality assertion fails — the same failure you would otherwise only notice as broken waterfalls in production.

---

## Troubleshooting

<div style="overflow-x:auto;">

| Symptom | Likely spatial cause | Fix |
|---------|----------------------|-----|
| Log volume explodes after enabling context | Full geometry or coordinate array leaking into a field | Log only the `SpatialContext` fingerprint; assert `"coordinates" not in entry` in tests |
| Trace waterfall stops at the broker | `traceparent` not injected on publish or not extracted on consume | Call `propagate.inject(headers)` before send and `propagate.extract` + `context.attach` before the consume span |
| Consumer logs missing `correlation_id` | Context not rebound after the broker hop (in-process `contextvars` is gone) | Read `correlation_id` from the message headers and call `bind_request_context` first thing in the consumer |
| Metrics cardinality blows up | Fine-resolution H3 cell used as a span/metric attribute | Derive the attribute cell at a coarse resolution (res 5) separately from any fine routing cell |
| `bbox` values look wrong by orders of magnitude | Geometry was in EPSG:3857 (Web Mercator) metres, logged as if EPSG:4326 degrees | Enforce the `EPSG:` code at the schema boundary; normalise CRS before building context |
| Correlation id lost in a background task | Work dispatched via `run_in_executor`, which does not copy `contextvars` | Capture the id in the calling task and pass it into the executor callable explicitly |
| Spans appear with no attributes | Attributes set after the span closed, or on the wrong span object | Set attributes inside the `with tracer.start_as_current_span(...)` block, before the work |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Why should I never log the full geometry of a spatial event?</strong></summary>

A single MultiPolygon can carry tens of thousands of coordinate pairs. Serialising that into every log line inflates log volume by orders of magnitude, blows past field-size limits in log backends, and slows the hot path with JSON encoding you never read. Log a compact spatial fingerprint instead: the bounding box, an H3 or geohash cell, the source CRS as an EPSG code, the feature id, and the vertex count. That is enough to locate the event, reason about where it sits, and correlate across services, while the full geometry stays in the payload store keyed by feature id.

</details>

<details class="faq">
<summary><strong>How do correlation IDs survive across asyncio tasks and broker hops?</strong></summary>

Within a process, store the correlation id in a `contextvars.ContextVar`. `asyncio.create_task` copies the current context, so a spawned task inherits the id automatically, whereas `loop.run_in_executor` does not and needs the id passed explicitly. Across a broker hop the in-process context is gone, so you must serialise the correlation id (and the W3C `traceparent` header) into the message envelope and rebind it in the consumer before doing any work. Structured logging and OpenTelemetry propagation both rely on this handoff.

</details>

<details class="faq">
<summary><strong>What is the difference between a correlation ID and an OpenTelemetry trace ID?</strong></summary>

A correlation id is an application-level identifier you mint and control, usually one per inbound webhook, and it is convenient to filter logs on. An OpenTelemetry trace id is a 16-byte identifier managed by the tracing SDK that ties together spans across services and is carried in the W3C `traceparent` header. They are complementary: put both on every log line so you can pivot from a log search to a full trace waterfall and back. Many teams simply set the correlation id equal to the trace id to avoid maintaining two identifiers.

</details>

<details class="faq">
<summary><strong>Should tracing spans include the geometry as an attribute?</strong></summary>

No. Span attributes are indexed and shipped on every export, so a large geometry there is even more costly than in a log line and is often silently truncated by the collector. Attach only low-cardinality-friendly spatial metadata: `geo.crs` as an EPSG string, `geo.h3_cell`, `geo.bbox` as four rounded numbers, `geo.vertex_count`, and `geo.feature_id`. Be careful with the H3 cell: at fine resolutions it is high cardinality and can explode your metrics if the same attributes feed span metrics, so prefer a coarse resolution for attributes.

</details>

---

## Related

- [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/) — the parent section covering metrics, tracing, and lag monitoring for event-driven geospatial systems
- [Geo-Specific Metrics & Instrumentation](https://www.geospatialwebhook.com/monitoring-observability-spatial/geo-metrics-instrumentation/) — the aggregate counterpart to per-event logs and traces, covering Prometheus counters and Grafana dashboards
- [Adding OpenTelemetry Spans to Async Geometry Handlers](https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/adding-opentelemetry-spans-to-async-geometry-handlers/) — a focused walkthrough of instrumenting CPU-bound geometry work without blocking the event loop
- [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) — the executor patterns that keep span timings honest under heavy parsing loads
- [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — how the idempotency key you log and trace is used downstream to collapse duplicate deliveries
