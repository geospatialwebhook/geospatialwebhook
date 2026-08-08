---
title: "Spatial Payload Routing & Parsing"
description: "Architectural patterns and Python implementation strategies for routing, validating, and transforming geospatial webhook payloads at production scale."
slug: "spatial-payload-routing-parsing"
type: "section"
breadcrumb: "Spatial Payload Routing & Parsing"
datePublished: "2025-01-15"
dateModified: "2026-06-24"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Spatial Payload Routing & Parsing",
      "description": "Architectural patterns and Python implementation strategies for routing, validating, and transforming geospatial webhook payloads at production scale.",
      "datePublished": "2025-01-15",
      "dateModified": "2026-06-24",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/" },
        { "@type": "ListItem", "position": 2, "name": "Spatial Payload Routing & Parsing", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "How to build a spatial payload routing and parsing pipeline in Python",
      "step": [
        { "@type": "HowToStep", "name": "Accept and triage webhook payloads at the ingestion gateway" },
        { "@type": "HowToStep", "name": "Apply content-based routing using feature type and spatial extent" },
        { "@type": "HowToStep", "name": "Validate geometry topology and enforce schema contracts" },
        { "@type": "HowToStep", "name": "Normalise coordinate reference systems to a canonical CRS" },
        { "@type": "HowToStep", "name": "Serialise and emit clean events to downstream consumers" }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "When should I partition spatial events by H3 instead of S2?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "H3 is preferable when your consumers need uniform-area hexagonal cells and you are already using Uber's ecosystem tools. S2 cells are better when you need hierarchical containment queries or integration with Google infrastructure. Both outperform simple bounding-box partitioning for skewed geographic distributions."
          }
        },
        {
          "@type": "Question",
          "name": "How do I handle mixed CRS payloads in a single event stream?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Detect the CRS from explicit properties or infer it from coordinate magnitude. Transform every incoming geometry to EPSG:4326 at the normalisation layer before it reaches any downstream service. Cache the pyproj Transformer objects by (source_crs, target_crs) tuple to avoid repeated initialisation overhead."
          }
        },
        {
          "@type": "Question",
          "name": "What is the safest way to route payloads whose geometry type is unknown?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Parse the geometry type field first with a lightweight structural check before running any topological validation. Route unknown types to a quarantine topic rather than dropping them silently, so a DLQ consumer can attempt schema detection and replay."
          }
        },
        {
          "@type": "Question",
          "name": "Is GeoJSON or Protobuf better for high-frequency spatial webhook payloads?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "GeoJSON is human-readable and broadly supported but carries 3–5× the wire size of equivalent Protobuf messages for dense coordinate arrays. For payloads exceeding a few hundred features per second, the serialisation and parsing overhead of GeoJSON becomes measurable. Protobuf with a well-designed spatial schema reduces broker latency and consumer CPU at the cost of a schema registry and code-generation step."
          }
        },
        {
          "@type": "Question",
          "name": "How do I avoid duplicate spatial events reaching downstream consumers?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Generate a deterministic idempotency key from a stable hash of the geometry, source identifier, and event timestamp. Check the key against a Redis SET NX EX store at the routing layer before publishing. Duplicates are discarded before they enter the broker, keeping consumer logic simple."
          }
        }
      ]
    }
  ]
}
</script>

IoT sensors, field data collectors, satellite downlinks, and third-party GIS platforms continuously stream coordinate data, feature updates, and spatial events into backend systems. Handling this influx requires more than a standard REST endpoint — it demands a resilient, event-driven architecture where spatial payload routing and parsing acts as the central nervous system. For platform engineers, GIS backend developers, and real-time spatial application builders, mastering this layer is the difference between a brittle data pipeline and a scalable, fault-tolerant spatial mesh.

This guide covers the architectural patterns, Python implementation strategies, and operational safeguards required to route, validate, and transform spatial payloads efficiently in production.

---

## Anatomy of a Spatial Ingestion Pipeline

A spatial payload does not travel from source to consumer in a single hop. In a well-designed event-driven system, it passes through three distinct logical layers, each with a narrow, well-defined responsibility.

<figure class="fig">
<svg viewBox="6 46 708 238" role="img" aria-label="Three-layer spatial ingestion pipeline: Ingestion Gateway, Routing Engine, and Parsing and Normalisation Layer" xmlns="http://www.w3.org/2000/svg">
  <title>Spatial Ingestion Pipeline</title>
  <desc>Diagram showing how a spatial webhook payload flows from the Ingestion Gateway through the Routing Engine into the Parsing and Normalisation Layer before reaching downstream consumers.</desc>
  <rect x="6" y="46" width="708" height="238" fill="var(--fig-bg)"/>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Layer fills (theme-aware: currentColor at low opacity) -->
  <rect x="20"  y="60" width="160" height="180" rx="10" fill="currentColor" opacity="0.05"/>
  <rect x="280" y="60" width="160" height="180" rx="10" fill="currentColor" opacity="0.05"/>
  <rect x="540" y="60" width="160" height="180" rx="10" fill="currentColor" opacity="0.05"/>
  <!-- Layer box outlines -->
  <rect x="20"  y="60" width="160" height="180" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <rect x="280" y="60" width="160" height="180" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <rect x="540" y="60" width="160" height="180" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
  <!-- Layer headings -->
  <text x="100" y="90" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.85">Ingestion Gateway</text>
  <text x="360" y="90" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.85">Routing Engine</text>
  <text x="620" y="90" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.85">Parse &amp; Normalise</text>
  <!-- Bullets layer 1 -->
  <text x="35" y="118" font-size="10" fill="currentColor" opacity="0.7">• TLS termination</text>
  <text x="35" y="136" font-size="10" fill="currentColor" opacity="0.7">• Rate limiting</text>
  <text x="35" y="154" font-size="10" fill="currentColor" opacity="0.7">• Auth + HMAC</text>
  <text x="35" y="172" font-size="10" fill="currentColor" opacity="0.7">• Push to broker</text>
  <text x="35" y="190" font-size="10" fill="currentColor" opacity="0.7">• Ack immediately</text>
  <!-- Bullets layer 2 -->
  <text x="295" y="118" font-size="10" fill="currentColor" opacity="0.7">• Feature type check</text>
  <text x="295" y="136" font-size="10" fill="currentColor" opacity="0.7">• Spatial extent hash</text>
  <text x="295" y="154" font-size="10" fill="currentColor" opacity="0.7">• Priority assignment</text>
  <text x="295" y="172" font-size="10" fill="currentColor" opacity="0.7">• Partition key (H3/S2)</text>
  <text x="295" y="190" font-size="10" fill="currentColor" opacity="0.7">• Idempotency filter</text>
  <!-- Bullets layer 3 -->
  <text x="555" y="118" font-size="10" fill="currentColor" opacity="0.7">• Schema validation</text>
  <text x="555" y="136" font-size="10" fill="currentColor" opacity="0.7">• Topology check</text>
  <text x="555" y="154" font-size="10" fill="currentColor" opacity="0.7">• CRS transform</text>
  <text x="555" y="172" font-size="10" fill="currentColor" opacity="0.7">• Serialise output</text>
  <text x="555" y="190" font-size="10" fill="currentColor" opacity="0.7">• Enrich + emit</text>
  <!-- Arrows between layers -->
  <line x1="182" y1="150" x2="278" y2="150" stroke="currentColor" stroke-width="1.5" opacity="0.45" marker-end="url(#arr)"/>
  <line x1="442" y1="150" x2="538" y2="150" stroke="currentColor" stroke-width="1.5" opacity="0.45" marker-end="url(#arr)"/>
  <!-- Webhook source label -->
  <text x="100" y="268" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.55">Webhook / IoT source</text>
  <line x1="100" y1="242" x2="100" y2="255" stroke="currentColor" stroke-width="1" opacity="0.35" stroke-dasharray="3,2"/>
  <!-- Consumer label -->
  <text x="620" y="268" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.55">Downstream consumers</text>
  <line x1="620" y1="242" x2="620" y2="255" stroke="currentColor" stroke-width="1" opacity="0.35" stroke-dasharray="3,2"/>
</svg>
<figcaption><b>Figure 1.</b> Spatial Ingestion Pipeline</figcaption>
</figure>

**Layer 1 — Ingestion Gateway.** Accepts HTTP webhook payloads, applies rate limiting, validates HMAC signatures (as detailed in [Securing Webhook Endpoints with Spatial Token Validation](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/)), and pushes raw messages to a message broker — Apache Kafka, RabbitMQ, AWS Kinesis, or Redis Streams. The gateway acknowledges immediately and never blocks on parsing.

**Layer 2 — Routing Engine.** Inspects payload metadata and spatial attributes to determine destination queues, processing priority, and transformation requirements. This is where geographic partitioning, feature-type classification, and idempotency filtering occur.

**Layer 3 — Parsing & Normalisation.** Validates geometry, resolves coordinate reference systems (CRS), enforces schema contracts, and emits clean, standardised events to downstream services.

The challenge is the spatial nature of the data. Unlike flat JSON objects, geospatial payloads carry coordinate arrays, topology constraints, and projection metadata. A single malformed polygon or mismatched CRS can stall a synchronous worker and degrade the entire ingestion pipeline. Production systems decouple ingestion from processing so that the routing layer can triage payloads based on complexity, origin, and downstream SLAs.

---

## Architectural Patterns

### Pattern 1: Content-Based Spatial Routing

Content-based routing evaluates the internal structure of each payload rather than its HTTP headers alone.

**Feature classification** dispatches `Point` payloads to real-time tracking services, while `Polygon` and `MultiPolygon` updates route to analytics engines or tiling queues. This one decision eliminates a class of head-of-line blocking where a large complex polygon occupies a worker that should be processing lightweight point telemetry.

<figure class="fig">
<svg viewBox="0 0 760 234" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Head-of-line blocking when point telemetry shares a queue with heavy polygons, and the same traffic split by feature type">
<title>One queue, two workloads, and the blocking that follows</title>
<desc>A shared queue carries vehicle position pings costing about two milliseconds each alongside occasional land-cover multipolygons costing about nine hundred milliseconds. When a polygon reaches the head of a worker's queue, the four hundred and fifty point pings that arrived behind it wait the full nine hundred milliseconds, so real-time tracking latency is decided entirely by how recently an analytics payload happened to arrive. Classifying by geometry type at the gateway and dispatching points to a tracking queue and polygons to a tiling queue removes the coupling: the point queue holds its two-millisecond service time regardless of polygon traffic, and the polygon queue is sized for throughput rather than latency because nothing time-sensitive is waiting behind it. The classification is a single field read on metadata the gateway already extracted, so it costs nothing and it is what lets the two workloads be scaled and tuned independently.</desc>
<rect x="0" y="0" width="760" height="234" fill="var(--fig-bg)"/>
<defs><marker id="hl-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-rose-edge)">One queue — points wait behind polygons</text>
<rect x="14" y="30" width="120" height="34" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="74" y="44" text-anchor="middle" font-size="8.5" font-weight="600" fill="var(--fig-ink)">MultiPolygon</text>
<text x="74" y="57" text-anchor="middle" font-size="8" fill="var(--fig-ink-soft)">900 ms</text>
<rect x="138" y="30" width="36" height="34" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<text x="156" y="51" text-anchor="middle" font-size="8" fill="var(--fig-ink-soft)">pt</text>
<rect x="178" y="30" width="36" height="34" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<text x="196" y="51" text-anchor="middle" font-size="8" fill="var(--fig-ink-soft)">pt</text>
<rect x="218" y="30" width="36" height="34" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<text x="236" y="51" text-anchor="middle" font-size="8" fill="var(--fig-ink-soft)">pt</text>
<text x="262" y="51" font-size="9" fill="var(--fig-ink-soft)">… 450 more point pings, all waiting</text>
<rect x="500" y="30" width="246" height="34" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="512" y="44" font-size="9" font-weight="600" fill="var(--fig-ink)">tracking latency: up to 900 ms</text>
<text x="512" y="57" font-size="8" fill="var(--fig-ink-soft)">set by when an analytics payload last arrived</text>
<line x1="14" y1="86" x2="746" y2="86" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="106" font-size="10.5" font-weight="600" fill="var(--fig-mint-edge)">Classified at the gateway on geometry type</text>
<polygon points="90,124 150,148 90,172 30,148" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="90" y="145" text-anchor="middle" font-size="8.5" font-weight="600" fill="var(--fig-ink)">geometry</text>
<text x="90" y="157" text-anchor="middle" font-size="8.5" font-weight="600" fill="var(--fig-ink)">type?</text>
<line x1="152" y1="138" x2="186" y2="126" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#hl-a)"/>
<line x1="152" y1="158" x2="186" y2="172" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#hl-a)"/>
<rect x="190" y="110" width="300" height="34" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="202" y="124" font-size="8.5" font-weight="600" fill="var(--fig-ink)">Point → tracking queue</text>
<text x="202" y="137" font-size="8" fill="var(--fig-ink-soft)">2 ms service time, unaffected by polygon traffic</text>
<rect x="190" y="156" width="300" height="34" rx="5" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.4"/>
<text x="202" y="170" font-size="8.5" font-weight="600" fill="var(--fig-ink)">Polygon / MultiPolygon → tiling queue</text>
<text x="202" y="183" font-size="8" fill="var(--fig-ink-soft)">sized for throughput; nothing latency-bound waits behind it</text>
<rect x="500" y="124" width="246" height="52" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="512" y="141" font-size="9" font-weight="600" fill="var(--fig-ink)">tracking latency: 2 ms, stable</text>
<text x="512" y="157" font-size="8" fill="var(--fig-ink-soft)">and the two queues can now be scaled,</text>
<text x="512" y="168" font-size="8" fill="var(--fig-ink-soft)">retried and alerted on independently</text>
<rect x="14" y="198" width="732" height="34" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="26" y="213" font-size="9.5" fill="var(--fig-ink)">The classification is one field read on metadata the gateway already extracted — it costs nothing, and it</text>
<text x="26" y="224" font-size="9.5" fill="var(--fig-ink)">decouples two workloads with incompatible latency requirements.</text>
</svg>
<figcaption><b>Figure 2.</b> Head-of-line blocking is not a throughput problem — total work is identical either way. It is a latency problem created by letting two workloads with different service times share one queue.</figcaption>
</figure>

**Schema detection** identifies whether the payload conforms to GeoJSON (RFC 7946), Esri JSON, WKT, or a proprietary binary format, then dispatches to the appropriate deserialiser. When payloads exceed typical JSON size limits or require strict bandwidth optimisation, teams migrate to compact binary formats — the trade-offs are explored in depth in [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/).

**Metadata tagging** extracts timestamps, device IDs, and confidence scores to route high-fidelity sensor data to archival stores while sending low-confidence telemetry to filtering queues. Tags are extracted once at the gateway and propagated as message attributes — downstream workers never re-parse the raw payload to make routing decisions.

<figure class="fig">
<svg viewBox="0 0 760 222" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Routing metadata extracted once at the gateway and propagated as message attributes, versus each worker re-parsing the raw payload">
<title>Extract routing metadata once, carry it as attributes</title>
<desc>A payload passes through four routing decisions on its way to a consumer. If each stage re-parses the raw body to read the fields it routes on, a 3-megabyte multipolygon is deserialised four times at roughly 40 milliseconds each, so 160 milliseconds of the event's journey is spent re-reading bytes that never changed — and every stage acquires its own dependency on the payload schema, so a producer adding a field can break a router that does not otherwise care about geometry at all. Extracting the routing fields once at the gateway and attaching them as broker message attributes lets each stage read a few hundred bytes of header: the cost falls to about 0.2 milliseconds total, and the schema dependency exists in exactly one place. The rule follows from what routing actually needs, which is never the geometry itself but a handful of derived scalars — type, cell, tenant, priority, confidence.</desc>
<rect x="0" y="0" width="760" height="222" fill="var(--fig-bg)"/>
<defs><marker id="tg-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-rose-edge)">Each stage re-parses the raw body</text>
<rect x="14" y="30" width="168" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="98" y="49" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">router · parse 3 MB · 40 ms</text>
<line x1="184" y1="45" x2="204" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#tg-a)"/>
<rect x="208" y="30" width="168" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="292" y="49" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">classifier · parse again · 40 ms</text>
<line x1="378" y1="45" x2="398" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#tg-a)"/>
<rect x="402" y="30" width="168" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="486" y="49" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">dedup · parse again · 40 ms</text>
<line x1="572" y1="45" x2="592" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#tg-a)"/>
<rect x="596" y="30" width="150" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="671" y="49" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">partitioner · 40 ms</text>
<text x="14" y="78" font-size="9" fill="var(--fig-rose-edge)" font-weight="600">160 ms re-reading bytes that never changed —</text>
<text x="330" y="78" font-size="9" fill="var(--fig-ink-soft)">and four independent dependencies on the payload schema.</text>
<line x1="14" y1="94" x2="746" y2="94" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="114" font-size="10.5" font-weight="600" fill="var(--fig-mint-edge)">Tagged once at the gateway</text>
<rect x="14" y="124" width="196" height="42" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="140" font-size="8.5" font-weight="600" fill="var(--fig-ink)">gateway · parse once · 40 ms</text>
<text x="26" y="153" font-size="8" fill="var(--fig-ink-soft)">emits: geom_type, h3_r6, tenant,</text>
<text x="26" y="163" font-size="8" fill="var(--fig-ink-soft)">priority, confidence, idem_key</text>
<line x1="212" y1="145" x2="232" y2="145" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#tg-a)"/>
<rect x="236" y="124" width="120" height="42" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="296" y="149" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">router · 0.05 ms</text>
<rect x="360" y="124" width="120" height="42" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="420" y="149" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">classifier · 0.05 ms</text>
<rect x="484" y="124" width="120" height="42" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="544" y="149" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">dedup · 0.05 ms</text>
<rect x="608" y="124" width="138" height="42" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="677" y="149" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">partitioner · 0.05 ms</text>
<rect x="14" y="182" width="732" height="34" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="26" y="199" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Routing never needs the geometry — only scalars derived from it.</text>
<text x="26" y="211" font-size="9" fill="var(--fig-ink-soft)">Type, cell, tenant, priority, confidence. Once those are attributes, the schema dependency lives in one place and the raw body is read exactly once.</text>
</svg>
<figcaption><b>Figure 3.</b> The saving is real but secondary. The structural gain is that only the gateway knows the payload schema, so a producer change breaks one component instead of four.</figcaption>
</figure>

```python
from enum import Enum
from typing import Any

class RouteTarget(str, Enum):
    REALTIME_TRACKING = "realtime.tracking"
    ANALYTICS_BATCH   = "analytics.batch"
    TILE_INVALIDATION = "tile.invalidation"
    QUARANTINE        = "quarantine"
    DLQ               = "dlq"

def classify_payload(payload: dict[str, Any]) -> RouteTarget:
    """Route a GeoJSON feature to the appropriate broker topic."""
    geom = payload.get("geometry") or {}
    geom_type = geom.get("type", "Unknown")
    confidence = payload.get("properties", {}).get("confidence", 1.0)

    if confidence < 0.4:
        return RouteTarget.QUARANTINE
    if geom_type == "Point":
        return RouteTarget.REALTIME_TRACKING
    if geom_type in ("Polygon", "MultiPolygon"):
        # High-vertex polygons go to batch analytics; small ones trigger tile updates
        coords = geom.get("coordinates", [[[]]])
        vertex_count = sum(len(ring) for ring in coords[0]) if coords else 0
        return RouteTarget.ANALYTICS_BATCH if vertex_count > 500 else RouteTarget.TILE_INVALIDATION
    return RouteTarget.QUARANTINE
```

### Pattern 2: Spatial Partitioning with Index-Aware Dispatch

Spatial partitioning ensures that related events land in the same consumer group, preserving ordering and reducing cross-region joins. Production pipelines use spatial indexing schemes such as H3, S2, or Quadkeys rather than tenant ID alone. By hashing the centroid or bounding box of an incoming geometry, the router assigns the payload to a specific partition key. This guarantees that all updates affecting a specific tile, watershed, or administrative boundary are processed sequentially by the same worker instance, eliminating race conditions during topology updates.

```python
import h3
from shapely.geometry import shape

def spatial_partition_key(geojson_geometry: dict, resolution: int = 7) -> str:
    """
    Compute an H3 cell key at the given resolution for a GeoJSON geometry.
    Resolution 7 gives cells ~5 km² — suitable for most fleet-tracking workloads.
    """
    geom = shape(geojson_geometry)
    centroid = geom.centroid
    # h3.latlng_to_cell expects (lat, lng) — note axis order
    return h3.latlng_to_cell(centroid.y, centroid.x, resolution)
```

Partition skew — where a disproportionate share of events map to a single cell — is one of the most common production problems in geographic workloads. Monitor the distribution of partition keys and re-shard hot cells by dropping the H3 resolution one level (larger cells) or splitting at the broker level. The same ordering concern arises for tile invalidation events, which are covered in [Tile Update Event Pipelines](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/).

### Pattern 3: Priority Routing with Multi-Path Queues

Not all spatial events carry equal urgency. Real-time asset tracking demands sub-second processing; historical boundary corrections can tolerate eventual consistency. Priority routing assigns weights based on payload metadata:

- **Hot path** — low-latency queues for live tracking, emergency response, and dynamic pricing engines.
- **Warm path** — batch-friendly queues for analytics aggregation, map tile regeneration, and ML feature extraction.
- **Cold path** — archival queues for compliance logging, long-term trend analysis, and cold-storage replication.

```python
import asyncio
from dataclasses import dataclass

@dataclass
class SpatialEvent:
    payload: dict
    sla_ms: int          # maximum acceptable processing latency in milliseconds
    event_type: str

HOT_THRESHOLD_MS  = 500
WARM_THRESHOLD_MS = 30_000

async def publish_with_priority(
    event: SpatialEvent,
    broker_client,
) -> None:
    """Publish a spatial event to the broker topic that matches its SLA."""
    if event.sla_ms <= HOT_THRESHOLD_MS:
        topic = "spatial.hot"
    elif event.sla_ms <= WARM_THRESHOLD_MS:
        topic = "spatial.warm"
    else:
        topic = "spatial.cold"

    await broker_client.publish(topic, event.payload, priority=event.sla_ms)
```

---

## Python Implementation & Serialisation

### Async Gateway with FastAPI

The ingestion gateway should be non-blocking from first byte to broker acknowledgement. FastAPI with `asyncio` handles thousands of concurrent webhook connections without thread starvation. The HTTP handler must never parse geometry — it acknowledges the request, publishes the raw bytes, and returns.

```python
import hashlib
import hmac
import json
import os

from fastapi import FastAPI, HTTPException, Request
from aiokafka import AIOKafkaProducer

app = FastAPI()
_producer: AIOKafkaProducer | None = None
WEBHOOK_SECRET = os.environ["WEBHOOK_SECRET"].encode()

@app.on_event("startup")
async def startup() -> None:
    global _producer
    _producer = AIOKafkaProducer(bootstrap_servers=os.environ["KAFKA_BROKERS"])
    await _producer.start()

@app.post("/webhook/spatial")
async def receive_spatial_event(request: Request) -> dict:
    body = await request.body()

    # Validate HMAC-SHA256 signature before touching payload content
    sig_header = request.headers.get("X-Spatial-Signature", "")
    expected = "sha256=" + hmac.new(WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig_header, expected):
        raise HTTPException(status_code=401, detail="Invalid signature")

    # Publish raw bytes — DO NOT parse geometry here
    await _producer.send_and_wait("spatial.raw", body)
    return {"status": "accepted"}
```

### Serialisation Format Trade-offs

| Format | Wire size (1 k features) | Parse time | Schema evolution | Use case |
|---|---|---|---|---|
| GeoJSON | ~2.4 MB | fast | flexible | External integrations, low frequency |
| MessagePack | ~0.9 MB | fast | flexible | Internal queues, moderate frequency |
| Protobuf | ~0.5 MB | very fast | strict (registry) | High-throughput internal pipelines |
| FlatBuffers | ~0.45 MB | near-zero copy | strict | Memory-mapped, read-heavy consumers |

GeoJSON is broadly supported and human-readable, but for payloads exceeding a few hundred features per second the serialisation overhead becomes measurable. [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/) covers schema design and field compression strategies that reduce broker latency without sacrificing spatial fidelity.

### Parsing Workers

Parsing workers consume from the broker and must never block the event loop on CPU-bound geometry operations. Offload heavy transformations to a process pool:

```python
import asyncio
import json
from concurrent.futures import ProcessPoolExecutor
from shapely.geometry import shape
from shapely.validation import make_valid

_executor = ProcessPoolExecutor(max_workers=4)

def _parse_geometry_sync(geom_dict: dict) -> dict:
    """Run in a subprocess — safe to block; does not hold the event loop."""
    geom = shape(geom_dict)
    if not geom.is_valid:
        geom = make_valid(geom)
    return {
        "wkt": geom.wkt,
        "bounds": geom.bounds,
        "centroid": (geom.centroid.x, geom.centroid.y),
        "area_m2": geom.area,  # only meaningful in projected CRS
    }

async def parse_geometry(geom_dict: dict) -> dict:
    """Async wrapper — returns to the event loop while the subprocess runs."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_executor, _parse_geometry_sync, geom_dict)
```

For sustained high concurrency, the patterns in [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) explore worker-pool sizing, backpressure signalling, and memory caps for large polygon sets.

---

## Spatial-Specific Concerns

### CRS Normalisation

Coordinate Reference Systems are the silent killers of spatial pipelines. A payload might arrive in EPSG:4326 (WGS84 geographic), EPSG:3857 (Web Mercator), EPSG:27700 (British National Grid), or a local engineering system. Downstream services typically expect a single canonical CRS — EPSG:4326 for global storage, EPSG:3857 for web rendering. The normalisation layer must:

1. Detect explicit `crs` properties or infer them from coordinate magnitude and axis ordering.
2. Transform coordinates using `pyproj`, caching `Transformer` objects by `(source_epsg, target_epsg)` tuple to avoid repeated initialisation.
3. Handle datum shifts, axis ordering (lat/lon vs lon/lat per EPSG convention), and precision loss gracefully.

```python
from functools import lru_cache
from pyproj import Transformer

@lru_cache(maxsize=64)
def _get_transformer(source_epsg: int, target_epsg: int) -> Transformer:
    """Cache transformers — initialisation is expensive; reuse across requests."""
    return Transformer.from_crs(
        f"EPSG:{source_epsg}",
        f"EPSG:{target_epsg}",
        always_xy=True,   # force (lon, lat) order regardless of EPSG convention
    )

def transform_coordinates(
    coords: list[list[float]],
    source_epsg: int,
    target_epsg: int = 4326,
) -> list[list[float]]:
    tf = _get_transformer(source_epsg, target_epsg)
    return [[*tf.transform(x, y)] for x, y in coords]
```

[CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) covers fallback heuristics for payloads with missing or ambiguous CRS metadata, projection caching, and audit logging to maintain spatial integrity across mixed-source streams. When payloads carry entirely unknown projections, [Handling Mixed CRS Payloads in Python Event Handlers](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/) provides a step-by-step detection and transformation workflow.

### Geometry Validation Before Dispatch

Geospatial payloads frequently violate implicit assumptions. Coordinates may fall outside valid bounds, rings may self-intersect, or topology rules may be broken. Validation occurs in two phases:

1. **Structural validation** — ensures required fields exist, types match, and coordinate arrays are properly nested. Use Pydantic with a typed `GeoJSONGeometry` model.
2. **Topological validation** — verifies geometric integrity using Shapely or GEOS. This catches invalid polygons, unclosed rings, and duplicate vertices before they corrupt spatial indexes.

Invalid geometries should be quarantined rather than silently dropped or propagated. The full validation pipeline, including per-tenant rule configuration, is described in [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/).

### Spatial Indexing Strategy

Choosing the right cell scheme for partitioning and spatial join keys depends on your query patterns:

| Scheme | Cell shape | Uniform area | Hierarchy | Best for |
|---|---|---|---|---|
| H3 | Hexagon | Yes (approx.) | Yes (15 levels) | Density grids, isochrones, fleet tracking |
| S2 | Curved quad | No | Yes (30 levels) | Containment queries, global coverage |
| Quadkey | Rectangle | No | Yes (zoom-based) | Tile systems, slippy-map integration |

For most fleet-tracking workloads, H3 at resolution 7 (~5 km² cells) provides a good balance between cardinality and granularity. Sensor routing patterns that rely on cell-based dispatch are covered in [Sensor Data Routing Patterns](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/).

---

## Production Hardening

### Failure Modes and Error Classification

Spatial data is inherently messy. Production systems categorise failures before deciding on a recovery path:

- **Transient errors** — network timeouts, broker unavailability, temporary resource exhaustion. These trigger exponential backoff with jitter and requeue on the same topic.
- **Permanent errors** — invalid topology that `make_valid` cannot repair, unsupported CRS, schema violations. These bypass retries and move to a Dead Letter Queue (DLQ).
- **Ambiguous errors** — payloads that pass structural validation but fail business rules (e.g., coordinates outside the expected bounding box for a regional deployment). These route to a quarantine topic for manual review or automated reconciliation.

```python
import asyncio
import random
import logging
from typing import Callable, Awaitable

logger = logging.getLogger(__name__)

class SpatialProcessingError(Exception):
    """Permanent failure — do not retry."""

async def process_with_backoff(
    fn: Callable[[], Awaitable[None]],
    max_attempts: int = 5,
    base_delay: float = 0.5,
) -> None:
    """Exponential backoff with full jitter for transient spatial pipeline errors."""
    for attempt in range(1, max_attempts + 1):
        try:
            await fn()
            return
        except SpatialProcessingError:
            raise  # permanent — let caller route to DLQ
        except Exception as exc:
            if attempt == max_attempts:
                raise
            delay = base_delay * (2 ** (attempt - 1)) * random.random()
            logger.warning("Attempt %d failed (%s); retrying in %.2fs", attempt, exc, delay)
            await asyncio.sleep(delay)
```

At-least-once delivery for spatial webhooks requires careful idempotency design, covered in [Implementing At-Least-Once Delivery for GIS Webhooks](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/).

### Idempotency and Deduplication

Webhooks frequently deliver duplicate events due to network retries or upstream system failures. The routing layer must implement idempotency keys — typically derived from a stable hash of the geometry, source identifier, and event timestamp — and check them against a Redis-backed store before publishing downstream.

```python
import hashlib
import json
import redis.asyncio as aioredis

_redis: aioredis.Redis | None = None

async def is_duplicate(payload: dict, ttl_seconds: int = 86400) -> bool:
    """
    Return True if this payload has already been processed.
    Key expires after TTL to avoid unbounded growth.
    """
    # Hash over a stable subset — exclude mutable envelope fields
    key_data = json.dumps({
        "geometry": payload.get("geometry"),
        "source_id": payload.get("properties", {}).get("source_id"),
        "event_time": payload.get("properties", {}).get("event_time"),
    }, sort_keys=True)
    idem_key = "spatial:idem:" + hashlib.sha256(key_data.encode()).hexdigest()
    result = await _redis.set(idem_key, "1", nx=True, ex=ttl_seconds)
    return result is None  # SET NX returns None if key already existed
```

The deterministic key generation strategy used here is discussed in detail in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/), and the Redis-backed signature cache pattern is explored in [Using Redis to Cache Spatial Webhook Signatures](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/).

### Monitoring Metrics for Geo Workloads

Standard application metrics are necessary but not sufficient for a spatial pipeline. Instrument these additional signals:

| Metric | Type | Alert threshold |
|---|---|---|
| `spatial.crs_transform_latency_ms` | Histogram (p95/p99) | p99 > 50 ms |
| `spatial.geometry_vertex_count` | Histogram | p99 > 50 000 vertices |
| `spatial.validation_failure_rate` | Counter / rate | > 2% over 5 min |
| `spatial.partition_skew_ratio` | Gauge | Top cell > 20× median |
| `spatial.dlq_depth` | Gauge | Any growth over 60 s |
| `spatial.consumer_lag_per_h3_cell` | Gauge per cell | Lag > 10 000 messages |

Use percentiles (p95, p99) rather than averages — spatial payloads exhibit high variance driven by geometry complexity. Partition skew monitoring is particularly important: a single hot H3 cell can cause one consumer instance to fall behind while others sit idle.

### Security and Compliance

Geospatial payloads often contain sensitive location data. The ingestion gateway must validate TLS certificates, enforce IP allowlists, and strip unnecessary headers. Payload encryption at rest and in transit is mandatory for regulated industries. Coordinate masking or spatial generalisation — snapping coordinates to a coarser grid — can reduce precision for non-essential consumers while preserving analytical utility. The full security model, including HMAC validation and spatial token schemes, is covered in [Webhook Security Boundaries](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/).

Generalisation deserves care, because it is the one control that changes the data rather than restricting access to it. Snapping to a coarse grid is irreversible by design, so a consumer given generalised coordinates can never recover the original precision — which is the point, but it also means the decision has to be made per consumer rather than per stream. Route the full-precision geometry to consumers with a demonstrated need and a generalised copy to everyone else, and record which variant each topic carries in the schema, so a later reader cannot mistake a snapped coordinate for a surveyed one.

---

## Frequently Asked Questions

<details class="faq">
<summary><strong>When should I partition spatial events by H3 instead of S2?</strong></summary>

H3 is preferable when your consumers need uniform-area hexagonal cells and you are already using Uber's ecosystem tools. S2 cells are better when you need hierarchical containment queries or integration with Google infrastructure. Both outperform simple bounding-box partitioning for skewed geographic distributions. For slippy-map tile workflows, Quadkeys align naturally with zoom levels and avoid the cell-boundary artefacts that hex grids introduce at low resolutions.
</details>

<details class="faq">
<summary><strong>How do I handle mixed CRS payloads in a single event stream?</strong></summary>

Detect the CRS from explicit properties or infer it from coordinate magnitude (values > 180 are almost certainly projected, not geographic). Transform every incoming geometry to EPSG:4326 at the normalisation layer before it reaches any downstream service. Cache `pyproj.Transformer` objects by `(source_epsg, target_epsg)` tuple to avoid repeated initialisation overhead. Log the original CRS alongside the transformed output for audit purposes.
</details>

<details class="faq">
<summary><strong>What is the safest way to route payloads whose geometry type is unknown?</strong></summary>

Parse the geometry type field first with a lightweight structural check before running any topological validation. Route unknown types to a quarantine topic rather than dropping them silently, so a DLQ consumer can attempt schema detection and replay. Never let an unknown geometry type propagate to a spatial index or database — invalid inserts are far more expensive to remediate than a quarantine backlog.
</details>

<details class="faq">
<summary><strong>Is GeoJSON or Protobuf better for high-frequency spatial webhook payloads?</strong></summary>

GeoJSON is human-readable and broadly supported but carries 3–5× the wire size of equivalent Protobuf messages for dense coordinate arrays. For payloads exceeding a few hundred features per second, the serialisation and parsing overhead of GeoJSON becomes measurable. Protobuf with a well-designed spatial schema reduces broker latency and consumer CPU at the cost of a schema registry and code-generation step. MessagePack is a practical middle ground — smaller than GeoJSON, no schema registry required.
</details>

<details class="faq">
<summary><strong>How do I avoid duplicate spatial events reaching downstream consumers?</strong></summary>

Generate a deterministic idempotency key from a stable hash of the geometry, source identifier, and event timestamp. Check the key against a Redis `SET NX EX` store at the routing layer before publishing. Duplicates are discarded before they enter the broker, keeping consumer logic simple. Coordinate overlap deduplication — where two near-identical geometries from different sources must be collapsed — requires a spatial join step and is addressed in [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/).
</details>

---

## Related

- [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/) — event-driven foundations, feature-change triggers, and webhook security boundaries
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — topology checks, Shapely-based repair, and per-tenant validation rules
- [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) — detecting, transforming, and auditing coordinate reference systems in event streams
- [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — idempotency key design, Redis-backed signature caches, and overlap deduplication
- [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) — worker-pool patterns for CPU-bound geometry operations
