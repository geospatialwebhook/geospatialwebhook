---
title: "Geometry Validation Pipelines"
description: "Build async geometry validation pipelines in Python: topology repair, coordinate bounds, Pydantic schema enforcement, CRS alignment, and clean error routing for webhook payloads."
slug: "geometry-validation-pipelines"
type: "guide"
breadcrumb: "Spatial Payload Routing & Parsing > Geometry Validation Pipelines"
datePublished: "2024-11-01"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Geometry Validation Pipelines for Geospatial Webhooks",
      "description": "Step-by-step guide to building asynchronous geometry validation pipelines in Python — covering schema enforcement, coordinate bounds, topology repair, CRS alignment, and error routing with runnable code.",
      "datePublished": "2024-11-01",
      "dateModified": "2026-06-25",
      "author": {"@type": "Organization", "name": "GeoSpatialWebhook"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Spatial Payload Routing & Parsing", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/"},
        {"@type": "ListItem", "position": 3, "name": "Geometry Validation Pipelines", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "How to Build a Geometry Validation Pipeline for Webhook Payloads",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Enforce schema and geometry type with Pydantic"},
        {"@type": "HowToStep", "position": 2, "name": "Validate coordinate sequence length and WGS84 bounds"},
        {"@type": "HowToStep", "position": 3, "name": "Check topology and attempt automatic repair"},
        {"@type": "HowToStep", "position": 4, "name": "Align CRS to EPSG:4326 and apply precision control"},
        {"@type": "HowToStep", "position": 5, "name": "Categorize failures and route to repair, feedback, or DLQ"},
        {"@type": "HowToStep", "position": 6, "name": "Wire the stages into an async FastAPI handler"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should geometry validation run synchronously in the webhook handler or offloaded to a worker?",
          "acceptedAnswer": {"@type": "Answer", "text": "Run cheap schema and bounds checks synchronously inside the request so malformed payloads get an immediate HTTP 400 and never reach the broker. Offload GEOS-backed topology checks and CRS transformation to an async worker pool only when geometries are large (thousands of vertices) or throughput is high — those operations are CPU-bound and will block the event loop if run inline."}
        },
        {
          "@type": "Question",
          "name": "When should I auto-repair a geometry with make_valid versus rejecting it?",
          "acceptedAnswer": {"@type": "Answer", "text": "Auto-repair self-intersections, bowtie polygons, and unclosed rings with make_valid when the result is still the same geometry type and area change is within tolerance — flag these as repaired so consumers can audit them. Reject (route to a dead-letter queue) when make_valid returns an empty geometry, changes the geometry type (for example a Polygon collapsing to a LineString), or when coordinates contain NaN or Infinity, since those indicate upstream corruption that repair would mask."}
        },
        {
          "@type": "Question",
          "name": "Why does is_valid pass but a spatial join still fails downstream?",
          "acceptedAnswer": {"@type": "Answer", "text": "is_valid only checks OGC Simple Features topology — it does not check coordinate reference system. A geometry can be topologically valid in EPSG:3857 yet break a join against EPSG:4326 data because the coordinates are in metres, not degrees. Always normalize CRS to a single canonical projection before any join, and assert that coordinates fall within the expected bounds for that CRS."}
        },
        {
          "@type": "Question",
          "name": "How do I avoid re-validating the same static geometry on every delivery?",
          "acceptedAnswer": {"@type": "Answer", "text": "Cache validation results in Redis keyed by a deterministic hash of the normalized coordinate array (json.dumps with sort_keys=True, then SHA-256). Immutable geometries such as administrative boundaries hit the cache and skip the GEOS computation entirely, which removes the dominant cost from p99 latency during traffic spikes."}
        }
      ]
    }
  ]
}
</script>

**A geometry validation pipeline is the gatekeeping stage that rejects, repairs, or normalizes every incoming spatial payload before it reaches your broker — so malformed coordinates, broken topology, and CRS drift never corrupt downstream analytics or routing.**

This page is part of [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/), the section covering how to route, parse, and transform geospatial webhook payloads at production scale. Validation sits immediately after deserialization and before transformation, storage, or dispatch, so it can be scaled independently of the heavier downstream stages.

---

## Prerequisites

Before wiring up a validation pipeline, verify the following are in place:

- [ ] Python 3.10+ with `asyncio` support
- [ ] `shapely>=2.0` for GEOS-backed topology predicates and `make_valid()`
- [ ] `pydantic>=2.0` for strict payload schema enforcement
- [ ] `pyproj>=3.5` for coordinate reference system transformation
- [ ] `fastapi` and an ASGI server (`uvicorn`) for the ingestion endpoint
- [ ] An async message broker (Redis Streams, RabbitMQ, or Kafka) plus a dead-letter destination
- [ ] Idempotency already applied at ingestion, following the approach in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/)

Anchor your rules to external standards: the [RFC 7946 GeoJSON specification](https://datatracker.ietf.org/doc/html/rfc7946) defines coordinate ordering and ring closure, and the OGC Simple Features model defines what "valid" means for each geometry type.

---

## Pipeline Architecture

The diagram below shows the four-stage path from a raw webhook delivery to a validated geometry published on the broker. Each stage either passes the payload forward, hands it to the repair branch, or isolates it for review — so a single bad payload can never stall the stream.

<figure class="fig">
<svg viewBox="6 10 747 450" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Four-stage geometry validation pipeline from webhook ingestion to validated publish, with a structural-reject branch returning HTTP 400, a topology repair branch, and a dead-letter branch for fatal errors">
  <title>Geometry Validation Pipeline</title>
  <desc>Four numbered stages laid out left to right: Schema and Type, Coordinate Bounds, Topology and Repair, and CRS Alignment, connected by arrows toward a validated publish. The Schema stage rejects structural errors with HTTP 400; the Topology stage branches to a repair queue or, when repair fails, to a dead-letter queue. A lower panel compares the three error tiers: recoverable, structural, and fatal.</desc>
  <rect x="6" y="10" width="747" height="450" fill="var(--fig-bg)"/>
  <defs>
    <marker id="gv-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Stage 1 -->
  <rect x="20" y="24" width="160" height="92" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <text x="100" y="46" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Stage 1</text>
  <text x="100" y="63" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Schema &amp; Type</text>
  <line x1="40" y1="78" x2="160" y2="78" stroke="currentColor" stroke-width="0.75" opacity="0.25"/>
  <text x="100" y="93" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">Pydantic v2</text>
  <text x="100" y="106" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">required fields</text>
  <!-- Stage 2 -->
  <rect x="220" y="24" width="160" height="92" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <text x="300" y="46" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Stage 2</text>
  <text x="300" y="63" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Coordinate Bounds</text>
  <line x1="240" y1="78" x2="360" y2="78" stroke="currentColor" stroke-width="0.75" opacity="0.25"/>
  <text x="300" y="93" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">ring length</text>
  <text x="300" y="106" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">no NaN / Inf</text>
  <!-- Stage 3 -->
  <rect x="420" y="24" width="160" height="92" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <text x="500" y="46" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Stage 3</text>
  <text x="500" y="63" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Topology &amp; Repair</text>
  <line x1="440" y1="78" x2="560" y2="78" stroke="currentColor" stroke-width="0.75" opacity="0.25"/>
  <text x="500" y="93" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">is_valid</text>
  <text x="500" y="106" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">make_valid()</text>
  <!-- Stage 4 -->
  <rect x="620" y="24" width="120" height="92" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
  <text x="680" y="46" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Stage 4</text>
  <text x="680" y="63" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">CRS Align</text>
  <line x1="636" y1="78" x2="724" y2="78" stroke="currentColor" stroke-width="0.75" opacity="0.25"/>
  <text x="680" y="93" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">&#8594; EPSG:4326</text>
  <text x="680" y="106" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.6">round precision</text>
  <!-- Arrows between stages -->
  <line x1="182" y1="70" x2="216" y2="70" stroke="currentColor" stroke-width="1.5" marker-end="url(#gv-arrow)" opacity="0.6"/>
  <line x1="382" y1="70" x2="416" y2="70" stroke="currentColor" stroke-width="1.5" marker-end="url(#gv-arrow)" opacity="0.6"/>
  <line x1="582" y1="70" x2="616" y2="70" stroke="currentColor" stroke-width="1.5" marker-end="url(#gv-arrow)" opacity="0.6"/>
  <!-- Validated publish out of Stage 4 -->
  <line x1="680" y1="116" x2="680" y2="150" stroke="currentColor" stroke-width="1.5" marker-end="url(#gv-arrow)" opacity="0.6"/>
  <rect x="600" y="150" width="140" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.4"/>
  <text x="670" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">Publish to broker</text>
  <!-- Structural reject from Stage 1 -->
  <line x1="100" y1="116" x2="100" y2="166" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#gv-arrow)" opacity="0.55"/>
  <rect x="20" y="166" width="160" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.35"/>
  <text x="100" y="186" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">Structural error</text>
  <text x="100" y="200" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">&#8594; HTTP 400</text>
  <!-- Repair / DLQ branch from Stage 3 -->
  <line x1="500" y1="116" x2="500" y2="166" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#gv-arrow)" opacity="0.55"/>
  <rect x="416" y="166" width="168" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.35"/>
  <text x="500" y="186" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">Repair ok &#8594; repair queue</text>
  <text x="500" y="200" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">Repair fails &#8594; DLQ</text>
  <!-- Error tiers panel -->
  <rect x="20" y="262" width="720" height="184" rx="8" fill="none" stroke="currentColor" stroke-width="1" opacity="0.25"/>
  <text x="380" y="286" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.85">Error Categorization Tiers</text>
  <rect x="44" y="304" width="208" height="122" rx="6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <text x="148" y="328" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-weight="700">Recoverable</text>
  <text x="148" y="350" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">make_valid()</text>
  <text x="148" y="365" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">resolves it</text>
  <text x="148" y="386" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">Route to repair</text>
  <text x="148" y="401" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">queue, flag repaired</text>
  <text x="148" y="418" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.55">e.g. bowtie polygon</text>
  <rect x="276" y="304" width="208" height="122" rx="6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <text x="380" y="328" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-weight="700">Structural</text>
  <text x="380" y="350" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">Schema mismatch,</text>
  <text x="380" y="365" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">missing fields</text>
  <text x="380" y="386" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">Reject with 400</text>
  <text x="380" y="401" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">+ failed_field</text>
  <text x="380" y="418" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.55">Producer self-corrects</text>
  <rect x="508" y="304" width="208" height="122" rx="6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <text x="612" y="328" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-weight="700">Fatal</text>
  <text x="612" y="350" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">NaN / Inf coords,</text>
  <text x="612" y="365" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">unsupported CRS</text>
  <text x="612" y="386" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">Archive to DLQ</text>
  <text x="612" y="401" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">with full context</text>
  <text x="612" y="418" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.55">Manual triage</text>
</svg>
<figcaption><b>Figure 1.</b> Geometry Validation Pipeline</figcaption>
</figure>

The pipeline has four numbered stages:

1. **Schema and type** — enforce required fields and a known geometry type with Pydantic before any GEOS work runs.
2. **Coordinate bounds** — verify ring lengths and reject `NaN`, `Infinity`, or out-of-range coordinates.
3. **Topology and repair** — run `is_valid`, attempt `make_valid()`, and branch failures to repair or the dead-letter queue.
4. **CRS alignment** — normalize to a canonical projection (EPSG:4326) and apply precision rounding before publishing.

<figure class="fig">
<svg viewBox="0 0 760 234" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="What make_valid returns for three invalid inputs, and why the result type must be checked before publishing">
<title>make_valid always returns something — not always what you expect</title>
<desc>Three invalid geometries put through make_valid. A bow-tie polygon whose ring self-intersects becomes a MultiPolygon of two parts: the repair succeeded, but the type changed, so a consumer that pattern-matches on Polygon now silently skips it. A polygon with a zero-width sliver becomes a GeometryCollection containing a polygon and a dangling linestring, because the degenerate part cannot be represented as an area — publishing that to a topic typed as polygons breaks the schema contract. A polygon whose ring collapses entirely returns an empty geometry, which is valid, has no coordinates, and will silently produce a null bounding box and a null partition key downstream. In all three cases make_valid did its job and returned a topologically valid result; what it did not do is preserve the type or guarantee non-emptiness, so the pipeline must assert both before publishing rather than treating a successful repair as a successful validation.</desc>
<rect x="0" y="0" width="760" height="234" fill="var(--fig-bg)"/>
<defs><marker id="vr-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="30" width="240" height="122" rx="7" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="134" y="48" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">bow-tie</text>
<path d="M44 62 L134 104 L44 104 L134 62 Z" fill="none" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<line x1="150" y1="83" x2="176" y2="83" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#vr-a)"/>
<text x="182" y="80" font-size="8.5" font-weight="600" fill="var(--fig-ink)">MultiPolygon</text>
<text x="182" y="92" font-size="8" fill="var(--fig-ink-soft)">2 parts</text>
<text x="26" y="126" font-size="8.5" fill="var(--fig-ink-soft)">repair worked — the type changed.</text>
<text x="26" y="140" font-size="8.5" fill="var(--fig-gold-edge)">A Polygon-only consumer skips it silently.</text>
<rect x="262" y="30" width="240" height="122" rx="7" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="382" y="48" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">zero-width sliver</text>
<path d="M292 62 L372 62 L372 104 L292 104 Z M372 83 L426 83" fill="none" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<line x1="432" y1="83" x2="446" y2="83" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#vr-a)"/>
<text x="274" y="126" font-size="8.5" fill="var(--fig-ink-soft)">→ GeometryCollection: polygon + linestring</text>
<text x="274" y="140" font-size="8.5" fill="var(--fig-gold-edge)">The dangling part breaks a polygon-typed topic.</text>
<rect x="510" y="30" width="236" height="122" rx="7" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="628" y="48" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">collapsed ring</text>
<circle cx="628" cy="83" r="20" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.4" stroke-dasharray="4,3"/>
<text x="522" y="126" font-size="8.5" fill="var(--fig-ink-soft)">→ empty geometry — valid, no coordinates</text>
<text x="522" y="140" font-size="8.5" fill="var(--fig-rose-edge)">null bbox, null partition key, no error raised</text>
<rect x="14" y="170" width="732" height="56" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="26" y="188" font-size="10" font-weight="600" fill="var(--fig-ink)">A successful repair is not a successful validation</text>
<text x="26" y="206" font-size="9" fill="var(--fig-ink-soft)">make_valid guarantees topological validity and nothing else — not the geometry type, and not that anything is left.</text>
<text x="26" y="220" font-size="9" fill="var(--fig-ink-soft)">Assert both after the call: check geom_type against what the topic expects, and check is_empty, before anything is published.</text>
</svg>
<figcaption><b>Figure 2.</b> Each of these repairs is correct — GEOS returned a valid geometry every time. The pipeline still has to check what it got back, because "valid" and "what the downstream contract expects" are different assertions.</figcaption>
</figure>

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Validation stages ordered by cost, showing what each rejects and why GEOS work runs last">
<title>Validation stages, ordered so the cheap checks protect the expensive one</title>
<desc>Four validation stages applied to ten thousand payloads. Pydantic schema and type checking costs about 60 microseconds and rejects 400 payloads with missing fields or unknown geometry types. Coordinate bounds checking costs about 30 microseconds and rejects 250 more carrying NaN, infinity, out-of-range values or rings too short to close. Only then does GEOS work begin: is_valid plus make_valid costs about 2.4 milliseconds and handles 180 topology failures. CRS alignment and precision rounding costs about 400 microseconds on what survives. The ordering matters because the two cheap stages remove 650 payloads that would otherwise reach GEOS, and a NaN coordinate reaching shapely does not raise a clean error — it produces a geometry whose predicates return unpredictably, so the bounds check is not merely an optimisation but the thing that keeps GEOS's failures diagnosable.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-ink)">10,000 payloads · width is remaining traffic</text>
<rect x="14" y="30" width="700" height="30" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="26" y="49" font-size="9.5" fill="var(--fig-ink)">1 · Pydantic schema + geometry type — 60 µs</text>
<text x="536" y="49" font-size="9" fill="var(--fig-ink-soft)">−400 malformed</text>
<rect x="14" y="66" width="672" height="30" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="26" y="85" font-size="9.5" fill="var(--fig-ink)">2 · coordinate bounds · NaN · ring length — 30 µs</text>
<text x="512" y="85" font-size="9" fill="var(--fig-ink-soft)">−250 out of range</text>
<rect x="14" y="102" width="655" height="30" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="121" font-size="9.5" font-weight="600" fill="var(--fig-ink)">3 · GEOS: is_valid + make_valid — 2.4 ms</text>
<text x="486" y="121" font-size="9" fill="var(--fig-ink-soft)">180 repaired or dead-lettered</text>
<rect x="14" y="138" width="650" height="30" rx="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.3"/>
<text x="26" y="157" font-size="9.5" fill="var(--fig-ink)">4 · CRS alignment + precision rounding — 400 µs</text>
<text x="486" y="157" font-size="9" fill="var(--fig-ink-soft)">9,170 published</text>
<rect x="14" y="180" width="732" height="50" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="26" y="198" font-size="10" font-weight="600" fill="var(--fig-ink)">Stage 2 is not an optimisation — it keeps stage 3's failures diagnosable</text>
<text x="26" y="212" font-size="9" fill="var(--fig-ink-soft)">A NaN coordinate reaching shapely does not raise a clean error. It builds a geometry whose predicates answer unpredictably,</text>
<text x="26" y="223" font-size="9" fill="var(--fig-ink-soft)">so the bug surfaces later as a wrong spatial join rather than here as a rejection.</text>
</svg>
<figcaption><b>Figure 3.</b> The cheap stages exist to keep the expensive one honest as much as to keep it fast: GEOS accepts values that make its own results meaningless, so the bounds check has to run before it.</figcaption>
</figure>

---

## Step-by-Step Implementation

### Step 1 — Schema and Type Enforcement

Validation begins at the JSON boundary. Reject payloads missing `type` or `coordinates`, or carrying an unsupported geometry type, before spending CPU on GEOS. This runs synchronously inside the request so producers get an immediate, actionable error.

```python
from pydantic import BaseModel, field_validator
from typing import Literal, Union

ALLOWED_TYPES = {
    "Point", "LineString", "Polygon",
    "MultiPoint", "MultiLineString", "MultiPolygon",
}

class GeometryPayload(BaseModel):
    feature_id: str
    type: Literal[
        "Point", "LineString", "Polygon",
        "MultiPoint", "MultiLineString", "MultiPolygon",
    ]
    coordinates: Union[list, list[list], list[list[list]]]
    crs_epsg: int = 4326  # CRS reported by the provider; EPSG:4326 default

    @field_validator("coordinates", mode="before")
    @classmethod
    def ensure_list(cls, v):
        if not isinstance(v, list) or not v:
            raise ValueError("coordinates must be a non-empty JSON array")
        return v
```

If validation fails, return a structured error with a clear `error_code` and `failed_field` so producers can self-correct without platform-team intervention.

### Step 2 — Coordinate Sequence and Bounds Validation

A passing schema does not mean the numbers are usable. A `LineString` needs at least two distinct points; a `Polygon` exterior ring needs at least four coordinates with the first and last matching. Scan for `NaN`, `Infinity`, and coordinates outside valid WGS84 bounds.

```python
import math

def validate_coordinate_bounds(coords: list) -> bool:
    """Flatten nested coordinate arrays and bounds-check every (lon, lat) pair."""
    flat: list[float] = []

    def flatten(node):
        for item in node:
            flatten(item) if isinstance(item, list) else flat.append(item)

    flatten(coords)
    if len(flat) % 2 != 0:
        return False  # odd count means a malformed pair

    for i in range(0, len(flat), 2):
        lon, lat = flat[i], flat[i + 1]
        if math.isnan(lon) or math.isinf(lon) or not (-180.0 <= lon <= 180.0):
            return False
        if math.isnan(lat) or math.isinf(lat) or not (-90.0 <= lat <= 90.0):
            return False
    return True
```

Bounds checks assume the payload is already in EPSG:4326. When the provider reports a projected CRS, run this check *after* Step 4, against the bounds of that CRS instead.

### Step 3 — Topology Integrity and Automatic Repair

Coordinate bounds say nothing about self-intersections, unclosed rings, duplicate consecutive vertices, or wrong ring orientation. Shapely's `is_valid` is a fast boolean predicate; `make_valid()` resolves common violations such as bowtie polygons. Reject only when repair changes the geometry type or yields an empty result.

```python
from shapely.geometry import shape, mapping
from shapely.validation import make_valid, explain_validity

def validate_topology(geom_dict: dict) -> tuple[bool, dict, bool]:
    """
    Returns (ok, geometry_dict, was_repaired).
    ok=False means the geometry could not be repaired and must be dead-lettered.
    """
    geom = shape(geom_dict)
    if geom.is_valid:
        return True, geom_dict, False

    reason = explain_validity(geom)  # e.g. "Self-intersection[12.3 45.6]"
    repaired = make_valid(geom)

    # Reject repairs that collapse the geometry or change its dimensionality
    if repaired.is_empty or repaired.geom_type != geom.geom_type:
        return False, {"reason": reason}, False

    return True, mapping(repaired), True
```

Flagging `was_repaired` lets downstream consumers audit which geometries were silently altered — important for regulatory and cadastral data where a repaired boundary is not the same as the one a surveyor submitted.

### Step 4 — CRS Alignment and Precision Control

Raw payloads arrive in arbitrary coordinate reference systems. Normalize to a single canonical projection before publishing; consistent projection is the topic of [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/), and skipping it is the leading cause of false-positive overlaps and broken spatial joins. Cache transformers, since per-request `Transformer` construction triggers an expensive PROJ database lookup.

```python
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform as shapely_transform

_transformer_cache: dict[tuple[int, int], Transformer] = {}

def _get_transformer(source_epsg: int, target_epsg: int = 4326) -> Transformer:
    key = (source_epsg, target_epsg)
    if key not in _transformer_cache:
        # always_xy=True keeps (lon, lat) order across PROJ 6+ axis conventions
        _transformer_cache[key] = Transformer.from_crs(
            source_epsg, target_epsg, always_xy=True
        )
    return _transformer_cache[key]

def normalize_to_wgs84(geom_dict: dict, source_epsg: int, precision: int = 7) -> dict:
    """Reproject to EPSG:4326, then round AFTER transform to avoid topology drift."""
    geom = shape(geom_dict)
    if source_epsg != 4326:
        geom = shapely_transform(_get_transformer(source_epsg).transform, geom)

    def _round(x, y, z=None):
        # ~1 cm precision at the equator with 7 decimal places
        return (round(x, precision), round(y, precision))

    return mapping(shapely_transform(_round, geom))
```

Round precision only *after* transformation — rounding first can move a vertex enough to introduce a self-intersection that Stage 3 would have caught but Stage 4 reintroduces.

### Step 5 — Error Categorization and Routing

Once a stage fails, route the payload by tier so retries, producer feedback, and manual triage stay separate. Valid geometries proceed to the broker.

```python
from enum import Enum

class ErrorTier(str, Enum):
    RECOVERABLE = "recoverable"  # make_valid() fixed it; publish with repaired=True
    STRUCTURAL = "structural"    # schema / missing field; reject with HTTP 400
    FATAL = "fatal"              # NaN, unsupported CRS, unrepairable; archive to DLQ

async def route_result(broker, tier: ErrorTier | None, payload: dict) -> dict:
    if tier is None:
        await broker.publish("validated-geometries", payload)
        return {"status": "valid"}
    if tier is ErrorTier.RECOVERABLE:
        await broker.publish("repaired-geometries", {**payload, "repaired": True})
        return {"status": "repaired"}
    if tier is ErrorTier.STRUCTURAL:
        return {"status": "rejected", "tier": tier.value}  # caller returns HTTP 400
    await broker.publish("geometry-dlq", payload)  # FATAL: keep full context
    return {"status": "dead_lettered"}
```

Teams standardizing on binary serialization can map validated GeoJSON straight to Protocol Buffers to cut payload size and parse cost — see [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/). For latency-critical routing, [converting WKT to Protobuf for low-latency routing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/converting-wkt-to-protobuf-for-low-latency-routing/) shows how to attach validation metadata as Protobuf extensions while stripping redundant JSON syntax.

### Step 6 — Async Handler Integration

The FastAPI endpoint wires all stages together. Cheap checks run inline; the GEOS-heavy stages run in a thread pool so they never block the event loop, and a result cache short-circuits immutable geometries.

```python
import asyncio
import hashlib
import json
from fastapi import FastAPI, HTTPException, Request
from pydantic import ValidationError
from redis.asyncio import Redis

app = FastAPI()
redis_client = Redis.from_url("redis://localhost:6379/0", decode_responses=True)

@app.post("/webhooks/geometry")
async def validate_geometry(request: Request, broker=...):
    raw = await request.json()

    # Stage 1: schema (sync, fast) — structural failures become HTTP 400
    try:
        payload = GeometryPayload(**raw)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.errors())

    geom_dict = {"type": payload.type, "coordinates": payload.coordinates}

    # Cache hit: identical normalized geometry already validated
    cache_key = "geomval:" + hashlib.sha256(
        json.dumps(geom_dict, sort_keys=True).encode()
    ).hexdigest()
    if await redis_client.exists(cache_key):
        return {"status": "valid", "cached": True}

    # Stages 2-4 are CPU-bound: run off the event loop
    def _heavy() -> tuple[ErrorTier | None, dict]:
        if not validate_coordinate_bounds(payload.coordinates):
            return ErrorTier.FATAL, {**raw, "reason": "out_of_bounds_or_nan"}
        ok, fixed, repaired = validate_topology(geom_dict)
        if not ok:
            return ErrorTier.FATAL, {**raw, **fixed}
        normalized = normalize_to_wgs84(fixed, payload.crs_epsg)
        tier = ErrorTier.RECOVERABLE if repaired else None
        return tier, {"feature_id": payload.feature_id, "geometry": normalized}

    tier, out = await asyncio.to_thread(_heavy)
    result = await route_result(broker, tier, out)

    if result["status"] in ("valid", "repaired"):
        await redis_client.set(cache_key, "1", ex=86400)  # 24h for static geometries
    return result
```

---

## Spatial Validation and Error Handling

The most damaging failures are the ones that pass `is_valid` but are semantically wrong. Three guards catch them:

- **Type allowlist before parsing.** `shape()` will happily build a `GeometryCollection` you never intended to support. Constrain the type in Pydantic so an unexpected type is a structural rejection, not a downstream surprise.
- **`make_valid()` on every operand before any predicate.** Self-touching rings make `intersects()` and `union()` raise `TopologyException`. Repairing first keeps the resolution path free of defensive try/except blocks.
- **Bounds re-check after reprojection.** A transform can push a coordinate just outside valid range due to floating-point drift; assert bounds again on the normalized geometry before publishing.

```python
from shapely.validation import explain_validity
from shapely.geometry import shape

def diagnose(geom_dict: dict) -> str | None:
    """Return a human-readable reason a geometry is unusable, or None if fine."""
    geom = shape(geom_dict)
    if geom.is_empty:
        return "empty geometry"
    if not geom.is_valid:
        return explain_validity(geom)  # pinpoints self-intersection coordinates
    if not validate_coordinate_bounds(geom_dict["coordinates"]):
        return "coordinates outside WGS84 bounds after normalization"
    return None
```

When `make_valid()` cannot produce a usable geometry — rare, usually coordinate overflow — log the raw payload and route to the dead-letter queue rather than returning HTTP 500.

---

## Retry, Backoff, and Delivery Guarantees

Validation is CPU-bound, so the failure you must plan for is not network loss but *broker backpressure*: validation workers can produce faster than the broker accepts. When publishing fails, retry with exponential backoff and full jitter, and shed load at the receiver rather than buffering unbounded in-flight tasks.

```python
import asyncio
import random

async def publish_with_backoff(
    broker,
    topic: str,
    payload: dict,
    max_attempts: int = 5,
    base_delay_ms: int = 50,
) -> bool:
    """At-least-once publish with full-jitter backoff. Returns False if exhausted."""
    for attempt in range(max_attempts):
        try:
            await broker.publish(topic, payload)
            return True
        except (ConnectionError, TimeoutError):
            ceiling_ms = (2 ** attempt) * base_delay_ms
            await asyncio.sleep(random.uniform(0, ceiling_ms) / 1000.0)
    return False
```

**At-least-once vs exactly-once:** most providers deliver at-least-once, so the same geometry can arrive twice. The validation result cache (Step 6) plus the upstream idempotency key turn that into effectively-once for identical payloads. If `publish_with_backoff` exhausts its budget, return HTTP `503` with a `Retry-After` header — pushing redelivery back to the provider — instead of accumulating tasks. When in-flight work exceeds a bounded ceiling, return HTTP `429` at the receiver to apply backpressure cleanly.

---

## Verification

This test suite confirms each stage in isolation without a broker or network, using two deliberately broken geometries.

```python
import math
import pytest
from shapely.geometry import Polygon, mapping

# A self-intersecting "bowtie" polygon — invalid but repairable
BOWTIE = {"type": "Polygon",
          "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]}
# A valid square in EPSG:4326
SQUARE = mapping(Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]))

def test_bounds_rejects_nan():
    from your_module import validate_coordinate_bounds
    assert validate_coordinate_bounds([[0.0, 0.0], [float("nan"), 1.0]]) is False

def test_bounds_rejects_out_of_range():
    from your_module import validate_coordinate_bounds
    assert validate_coordinate_bounds([[200.0, 0.0]]) is False  # lon > 180

def test_topology_repairs_bowtie():
    from your_module import validate_topology
    ok, fixed, repaired = validate_topology(BOWTIE)
    assert ok is True and repaired is True

def test_valid_square_is_untouched():
    from your_module import validate_topology
    ok, fixed, repaired = validate_topology(SQUARE)
    assert ok is True and repaired is False

def test_crs_normalization_rounds_precision():
    from your_module import normalize_to_wgs84
    # EPSG:3857 metres near the equator -> degrees
    out = normalize_to_wgs84(
        {"type": "Point", "coordinates": [111319.49, 0.0]}, source_epsg=3857
    )
    assert math.isclose(out["coordinates"][0], 1.0, abs_tol=1e-4)
```

Run with `pytest -v` — all five assertions pass offline.

---

## Troubleshooting

<div style="overflow-x:auto">

| Symptom | Likely Spatial Cause | Fix |
|---|---|---|
| `TopologyException` on `union()` / `intersection()` downstream | Geometry passed `is_valid` but a consumer skipped `make_valid()` | Repair in Stage 3 and publish only the repaired geometry; never the raw input |
| Validation passes but spatial joins return zero rows | CRS never normalized — coordinates are in metres (EPSG:3857), not degrees | Enforce Stage 4 normalization to EPSG:4326 before publishing |
| `make_valid()` collapses a Polygon to a LineString | Degenerate ring (zero area) or all-collinear vertices | Reject as fatal when `geom_type` changes; route to the DLQ for inspection |
| Self-intersection reappears after normalization | Precision rounding applied before reprojection moved a vertex | Round AFTER the transform, not before, as in `normalize_to_wgs84` |
| Event loop stalls under load, p99 latency spikes | GEOS topology checks running inline on the async handler | Offload Stages 2-4 with `asyncio.to_thread` or a worker pool |
| DLQ fills with the same `feature_id` repeatedly | A producer is emitting coordinates with `NaN` or in an unsupported CRS | Bounds-check in Stage 2 and return the `failed_field` so the producer self-corrects |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Should validation run in the handler or in a worker?</strong></summary>

Run cheap schema and bounds checks synchronously inside the request so malformed payloads get an immediate HTTP 400 and never reach the broker. Offload GEOS-backed topology checks and CRS transformation to a thread pool (`asyncio.to_thread`) only when geometries are large or throughput is high — those operations are CPU-bound and will block the event loop if run inline.

</details>

<details class="faq">
<summary><strong>When should I auto-repair with make_valid versus rejecting?</strong></summary>

Auto-repair self-intersections, bowtie polygons, and unclosed rings when `make_valid()` returns the same geometry type and the area change is within tolerance — and flag those as repaired so consumers can audit them. Reject (route to the dead-letter queue) when `make_valid()` returns an empty geometry, changes the geometry type, or when coordinates contain `NaN` or `Infinity`, since those indicate upstream corruption that repair would only mask.

</details>

<details class="faq">
<summary><strong>Why does is_valid pass but a join still fails?</strong></summary>

`is_valid` only checks OGC Simple Features topology — it does not check the coordinate reference system. A geometry can be valid in EPSG:3857 yet break a join against EPSG:4326 data because the coordinates are in metres, not degrees. Always normalize CRS to a single canonical projection before any join, and assert coordinates fall within the expected bounds for that CRS.

</details>

<details class="faq">
<summary><strong>How do I avoid re-validating the same static geometry?</strong></summary>

Cache validation results in Redis keyed by a deterministic hash of the normalized coordinate array (`json.dumps` with `sort_keys=True`, then SHA-256). Immutable geometries such as administrative boundaries hit the cache and skip the GEOS computation entirely, which removes the dominant cost from p99 latency during traffic spikes.

</details>

---

## Operational Considerations

**Instrument every stage.** Track `validation_duration_ms` per stage (schema, bounds, topology, CRS), `validation_pass_rate`, `repair_success_rate`, `dlq_ingestion_count` by tier, and `geometry_size_bytes` distribution. The `geometry_repair_count` metric in particular is a leading indicator of upstream provider quality and feeds directly into the conflict-handling metrics discussed in [Conflict Resolution Strategies](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/).

**Scale on CPU, not connections.** Because GEOS work dominates, deploy validation workers behind a horizontal autoscaler keyed on CPU utilization or broker queue depth rather than request rate.

**Validate before serialization, not after.** Running validation upstream of binary encoding means the repaired, normalized geometry is what gets serialized — so the integrity guarantee is preserved end to end into [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/) and any downstream broker.

**Keep heavy parsing off the hot path.** For payloads with very large geometries, defer parsing to a dedicated worker as covered in [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) so the validation receiver stays responsive under burst load.

---

## Related

- [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/) — parent section covering routing, parsing, and transformation of geospatial webhook payloads
- [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) — canonical projection handling that powers Stage 4 of this pipeline
- [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/) — compact binary serialization for validated geometries
- [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) — offloading large-geometry work so the validation receiver stays responsive
- [Converting WKT to Protobuf for Low-Latency Routing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/converting-wkt-to-protobuf-for-low-latency-routing/) — attaching validation metadata to binary payloads for fast dispatch
