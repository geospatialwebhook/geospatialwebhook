---
title: "Sensor Data Routing Patterns for Geospatial Webhooks"
description: "Build spatial routing pipelines in Python: schema validation, spatial classification, broker dispatch, and at-least-once delivery for IoT and GIS streams."
slug: "sensor-data-routing-patterns"
type: "guide"
breadcrumb: "Sensor Data Routing Patterns"
datePublished: "2024-03-15"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Sensor Data Routing Patterns for Geospatial Webhooks",
      "description": "A step-by-step guide to building deterministic spatial routing pipelines in Python: schema validation, spatial classification, broker dispatch, and at-least-once delivery for IoT and GIS telemetry streams.",
      "datePublished": "2024-03-15",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/" },
        { "@type": "ListItem", "position": 2, "name": "Core Event Fundamentals & Architecture", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/" },
        { "@type": "ListItem", "position": 3, "name": "Sensor Data Routing Patterns", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Build a Spatial Sensor Data Routing Pipeline",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Secure ingestion and schema validation" },
        { "@type": "HowToStep", "position": 2, "name": "Spatial and attribute classification" },
        { "@type": "HowToStep", "position": 3, "name": "Route resolution and fan-out logic" },
        { "@type": "HowToStep", "position": 4, "name": "Asynchronous broker dispatch" },
        { "@type": "HowToStep", "position": 5, "name": "Downstream consumption and state sync" }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "When should I partition by H3 cell instead of device ID?",
          "acceptedAnswer": { "@type": "Answer", "text": "Use H3 partitioning when downstream consumers are regionally scoped — tile renderers, per-city alerting services, or geographic shards of a PostGIS database. Use device-ID partitioning when ordering guarantees per sensor matter more than spatial locality, such as time-series telemetry streams where out-of-order events corrupt state." }
        },
        {
          "@type": "Question",
          "name": "How do I handle sensors that report in a CRS other than WGS 84 (EPSG:4326)?",
          "acceptedAnswer": { "@type": "Answer", "text": "Reproject at the ingestion boundary before any spatial classification. Use pyproj's Transformer with always_xy=True to avoid axis-order ambiguity. Store the original CRS in the event envelope as a metadata field so consumers can audit provenance, but route exclusively on EPSG:4326 coordinates." }
        },
        {
          "@type": "Question",
          "name": "What is the right queue depth limit to apply backpressure at the ingress?",
          "acceptedAnswer": { "@type": "Answer", "text": "A practical starting point is 10,000 in-flight events per ingress worker. Monitor P99 ingestion latency and drop rate. When P99 exceeds 300 ms or drop rate exceeds 0.05%, tighten the limit or scale out workers. Return HTTP 429 with a Retry-After header so upstream senders back off gracefully." }
        },
        {
          "@type": "Question",
          "name": "Can I skip the message broker and route directly from FastAPI to consumers?",
          "acceptedAnswer": { "@type": "Answer", "text": "Only for very low throughput (under ~50 events/second) with a single consumer. Without a broker, a consumer crash silently drops events and spatial mutations are lost. For production IoT feeds, always interpose a durable broker — Redis Streams is the lowest-friction option, Kafka is the right choice when you need replay, consumer group partitioning, or retention beyond 24 hours." }
        }
      ]
    }
  ]
}
</script>

**Raw telemetry from spatial sensors rarely flows directly to consumers — it passes through a deterministic routing layer that validates, classifies, and dispatches payloads based on geographic boundaries, attribute thresholds, and subscriber rules.** This page is part of [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/) and covers how to build that routing layer in Python from ingestion through broker dispatch.

---

## Prerequisites

Before deploying a spatial routing pipeline, confirm your environment meets these requirements:

- [ ] **Python 3.10+** — native `asyncio`, structural pattern matching, strict type hints
- [ ] **FastAPI or Starlette** — ASGI webhook ingestion with Uvicorn or Hypercorn
- [ ] **Pydantic v2** — strict payload validation, model caching, CRS enum enforcement
- [ ] **Shapely 2.0+** — in-memory spatial predicates via GEOS (polygon intersection, point-in-polygon)
- [ ] **pyproj 3.5+** — coordinate reprojection from device-native CRS to EPSG:4326
- [ ] **Message broker** — Redis Streams, RabbitMQ, or Apache Kafka for decoupled dispatch
- [ ] **GeoJSON compliance** — payloads must conform to [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946) before entering the router
- [ ] **OpenTelemetry + Prometheus** — routing latency, queue depth, and drop-rate observability

---

## Architecture Blueprint

The routing pipeline is a five-stage, stage-isolated sequence. Each stage enforces strict contracts so individual phases can be scaled or replaced independently.

<figure class="fig">
<svg viewBox="0 6 780 294" role="img" aria-label="Five-stage sensor data routing pipeline diagram" xmlns="http://www.w3.org/2000/svg">
  <title>Sensor Data Routing Pipeline</title>
  <desc>Data flows left-to-right through five stages: Ingestion &amp; Validation, Spatial Classification, Route Resolution, Broker Dispatch, and Consumer Sync. Invalid events are sent to a Dead-Letter Queue below Stage 1. Suppression and deduplication occur at Stage 3.</desc>
  <rect x="0" y="6" width="780" height="294" fill="var(--fig-bg)"/>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Source input -->
  <rect x="12" y="20" width="120" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3" stroke-dasharray="4,3"/>
  <text x="72" y="40" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">HTTP POST / MQTT</text>
  <line x1="72" y1="52" x2="72" y2="82" stroke="currentColor" stroke-width="1.4" marker-end="url(#arr)" opacity="0.5"/>
  <!-- Stage 1 -->
  <rect x="12" y="84" width="120" height="60" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.45"/>
  <text x="72" y="106" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">1. Ingestion</text>
  <text x="72" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">&amp; Schema</text>
  <text x="72" y="136" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">Validation</text>
  <!-- Arrow 1→2 -->
  <line x1="132" y1="114" x2="162" y2="114" stroke="currentColor" stroke-width="1.4" marker-end="url(#arr)" opacity="0.55"/>
  <!-- Stage 2 -->
  <rect x="164" y="84" width="120" height="60" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.45"/>
  <text x="224" y="106" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">2. Spatial</text>
  <text x="224" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">&amp; Attribute</text>
  <text x="224" y="136" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">Classification</text>
  <!-- Arrow 2→3 -->
  <line x1="284" y1="114" x2="314" y2="114" stroke="currentColor" stroke-width="1.4" marker-end="url(#arr)" opacity="0.55"/>
  <!-- Stage 3 -->
  <rect x="316" y="84" width="120" height="60" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.45"/>
  <text x="376" y="106" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">3. Route</text>
  <text x="376" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">Resolution</text>
  <text x="376" y="136" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">&amp; Fan-Out</text>
  <!-- Arrow 3→4 -->
  <line x1="436" y1="114" x2="466" y2="114" stroke="currentColor" stroke-width="1.4" marker-end="url(#arr)" opacity="0.55"/>
  <!-- Stage 4 -->
  <rect x="468" y="84" width="120" height="60" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.45"/>
  <text x="528" y="106" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">4. Broker</text>
  <text x="528" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">Dispatch</text>
  <text x="528" y="136" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">(async)</text>
  <!-- Arrow 4→5 -->
  <line x1="588" y1="114" x2="618" y2="114" stroke="currentColor" stroke-width="1.4" marker-end="url(#arr)" opacity="0.55"/>
  <!-- Stage 5 -->
  <rect x="620" y="84" width="148" height="60" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.45"/>
  <text x="694" y="106" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">5. Consumer</text>
  <text x="694" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">&amp; State</text>
  <text x="694" y="136" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">Sync</text>
  <!-- Dead-letter queue (below Stage 1) -->
  <rect x="12" y="210" width="120" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3" stroke-dasharray="4,3"/>
  <text x="72" y="231" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">Dead-Letter Queue</text>
  <line x1="72" y1="144" x2="72" y2="208" stroke="currentColor" stroke-width="1.3" marker-end="url(#arr)" opacity="0.4" stroke-dasharray="4,3"/>
  <text x="82" y="184" font-size="9" fill="currentColor" opacity="0.5">invalid</text>
  <!-- Suppression note (below Stage 3) -->
  <text x="376" y="192" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.5">suppression / dedup</text>
  <line x1="376" y1="144" x2="376" y2="186" stroke="currentColor" stroke-width="1" opacity="0.32" stroke-dasharray="3,3"/>
  <!-- Consumer outputs (below Stage 5) -->
  <rect x="620" y="210" width="148" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3" stroke-dasharray="4,3"/>
  <text x="694" y="231" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">PostGIS / Tile Cache</text>
  <line x1="694" y1="144" x2="694" y2="208" stroke="currentColor" stroke-width="1.4" marker-end="url(#arr)" opacity="0.5"/>
  <!-- Footer label -->
  <text x="390" y="284" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.4">Sensor Data Routing Pipeline — geospatialwebhook.com</text>
</svg>
<figcaption><b>Figure 1.</b> Sensor Data Routing Pipeline</figcaption>
</figure>

---

## Step-by-Step Implementation

### Step 1 — Secure Ingestion and Schema Validation

**Purpose:** Reject malformed and tampered payloads before they consume any downstream compute.

Raw sensor payloads arrive via HTTP POST or MQTT-to-HTTP bridge. The ingress layer validates JSON structure, verifies the cryptographic signature (`HMAC-SHA256` or `Ed25519` — the signing strategies are covered in detail at [Securing Webhook Endpoints with Spatial Token Validation](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/)), and extracts routing metadata: `device_id`, epoch timestamp, coordinate reference system (CRS), and firmware version. Invalid payloads go straight to a dead-letter queue; spatial operations on corrupt geometries cause silent routing failures or broker poisoning.

```python
import hashlib
import hmac
from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel, field_validator, model_validator
from shapely.geometry import shape
from shapely.validation import make_valid
import pyproj

app = FastAPI()
WEBHOOK_SECRET = b"your-hmac-secret"  # load from env in production

class SensorPayload(BaseModel):
    device_id: str
    timestamp_utc: float          # Unix epoch, seconds
    crs: str = "EPSG:4326"        # default; must be EPSG code string
    geometry: dict                 # raw GeoJSON geometry object
    properties: dict = {}

    @field_validator("crs")
    @classmethod
    def crs_must_be_epsg(cls, v: str) -> str:
        if not v.upper().startswith("EPSG:"):
            raise ValueError("CRS must be an EPSG code, e.g. EPSG:4326")
        return v.upper()

    @model_validator(mode="after")
    def geometry_must_be_valid(self) -> "SensorPayload":
        try:
            geom = shape(self.geometry)
        except Exception as exc:
            raise ValueError(f"GeoJSON geometry parse error: {exc}") from exc
        if not geom.is_valid:
            geom = make_valid(geom)  # attempt automatic repair
        if geom.is_empty:
            raise ValueError("Geometry is empty after validation")
        return self

def verify_hmac(body: bytes, signature: str) -> bool:
    expected = hmac.new(WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.removeprefix("sha256="))

@app.post("/ingest")
async def ingest(request: Request):
    body = await request.body()
    sig = request.headers.get("X-Hub-Signature-256", "")
    if not verify_hmac(body, sig):
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        payload = SensorPayload.model_validate_json(body)
    except Exception as exc:
        # quarantine to dead-letter queue instead of returning 400
        await quarantine(body, reason=str(exc))
        return {"status": "quarantined"}
    return await route_payload(payload)
```

### Step 2 — Spatial and Attribute Classification

**Purpose:** Determine which registered zones and consumers the event belongs to.

The router evaluates the reprojected point or polygon against registered spatial zones (geofences, administrative boundaries, wildfire risk polygons) and attribute filters (device type, state transitions, threshold crossings). This stage intersects with [Feature Change Triggers](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/) when routing decisions depend on delta detection rather than absolute state. Spatial indexing with an R-tree is mandatory; brute-force intersection testing degrades linearly with zone count and introduces unacceptable tail latency at production scale. Topology checks and geometry repair belong here, following the same patterns described in [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/).

```python
from shapely.strtree import STRtree
from shapely.geometry import shape, Point
import pyproj

# Build once at startup; refresh when zone registry changes
TRANSFORMER_CACHE: dict[str, pyproj.Transformer] = {}

def get_transformer(source_crs: str) -> pyproj.Transformer:
    if source_crs not in TRANSFORMER_CACHE:
        TRANSFORMER_CACHE[source_crs] = pyproj.Transformer.from_crs(
            source_crs, "EPSG:4326", always_xy=True
        )
    return TRANSFORMER_CACHE[source_crs]

class ZoneIndex:
    """R-tree-backed index of registered spatial zones."""

    def __init__(self, zones: list[dict]):
        self._zones = zones
        self._geoms = [shape(z["geometry"]) for z in zones]
        self._tree = STRtree(self._geoms)

    def classify(self, geom) -> list[dict]:
        candidate_indices = self._tree.query(geom)
        return [
            self._zones[i]
            for i in candidate_indices
            if self._geoms[i].intersects(geom)
        ]

def reproject_geometry(payload: SensorPayload):
    """Return a Shapely geometry in EPSG:4326."""
    geom = shape(payload.geometry)
    if payload.crs == "EPSG:4326":
        return geom
    transformer = get_transformer(payload.crs)
    return transform(transformer.transform, geom)

async def classify_payload(payload: SensorPayload, index: ZoneIndex) -> list[dict]:
    geom_wgs84 = reproject_geometry(payload)
    matched_zones = index.classify(geom_wgs84)
    # Attribute filtering — e.g. temperature threshold + zone membership
    props = payload.properties
    return [
        z for z in matched_zones
        if z.get("device_type") in (props.get("device_type"), None)
    ]
```

### Step 3 — Route Resolution and Fan-Out

**Purpose:** Translate matched zones into a dispatch list with partition keys and TTL metadata.

<figure class="fig">
<svg viewBox="0 0 760 232" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="One sensor ping matching several overlapping zones and fanning out to different consumers with different partition keys">
<title>One ping, several zones, several partition keys</title>
<desc>A vehicle ping at a single coordinate is tested against the registered zones and falls inside three of them: a city congestion zone, a delivery service area, and an air-quality study region. Matching is not exclusive, so the ping fans out to three dispatch entries rather than being routed to one destination. Each entry carries its own partition key and its own time-to-live, because the consumers order and expire on different things — the congestion consumer keys on the H3 cell so a neighbourhood's pings stay ordered together and expires them after five minutes, the delivery consumer keys on the vehicle id so one vehicle's track stays ordered and holds for an hour, and the analytics consumer keys on the study id and retains for thirty days. The fan-out is therefore where a single spatial fact becomes several routing decisions, and none of them can be derived from the geometry alone — they come from what each consumer needs ordered.</desc>
<rect x="0" y="0" width="760" height="232" fill="var(--fig-bg)"/>
<defs><marker id="sz-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<ellipse cx="120" cy="98" rx="100" ry="56" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.3" opacity="0.9"/>
<ellipse cx="150" cy="120" rx="76" ry="46" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3" opacity="0.75"/>
<ellipse cx="106" cy="128" rx="64" ry="38" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3" opacity="0.7"/>
<circle cx="126" cy="122" r="5" fill="var(--fig-ink)"/>
<text x="126" y="192" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink)">one ping, inside all three</text>
<text x="126" y="206" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">zone matching is not exclusive</text>
<line x1="228" y1="110" x2="266" y2="60" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sz-a)"/>
<line x1="228" y1="120" x2="266" y2="120" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sz-a)"/>
<line x1="228" y1="130" x2="266" y2="180" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sz-a)"/>
<rect x="270" y="34" width="476" height="52" rx="6" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.3"/>
<text x="282" y="52" font-size="9.5" font-weight="600" fill="var(--fig-ink)">congestion zone → traffic consumer</text>
<text x="282" y="68" font-size="8.5" font-family="monospace" fill="var(--fig-ink-soft)">partition_key = h3_r7 · ttl = 5 min</text>
<text x="282" y="80" font-size="8.5" fill="var(--fig-ink-soft)">orders by neighbourhood, so a district's pings stay together</text>
<rect x="270" y="94" width="476" height="52" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="282" y="112" font-size="9.5" font-weight="600" fill="var(--fig-ink)">delivery area → dispatch consumer</text>
<text x="282" y="128" font-size="8.5" font-family="monospace" fill="var(--fig-ink-soft)">partition_key = vehicle_id · ttl = 1 h</text>
<text x="282" y="140" font-size="8.5" fill="var(--fig-ink-soft)">orders by vehicle, so one track never interleaves</text>
<rect x="270" y="154" width="476" height="52" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="282" y="172" font-size="9.5" font-weight="600" fill="var(--fig-ink)">air-quality region → analytics consumer</text>
<text x="282" y="188" font-size="8.5" font-family="monospace" fill="var(--fig-ink-soft)">partition_key = study_id · ttl = 30 d</text>
<text x="282" y="200" font-size="8.5" fill="var(--fig-ink-soft)">orders by study, retains for the length of the survey</text>
<rect x="14" y="214" width="732" height="0" fill="none"/>
<text x="14" y="224" font-size="9" fill="var(--fig-ink-soft)">The key and TTL come from what each consumer needs ordered and how long it needs it — never from the geometry, which is identical in all three entries.</text>
</svg>
<figcaption><b>Figure 2.</b> Zone matching produces a set, not a destination. Each match carries its own partition key because the three consumers order on different things — and a shared key would give two of them the wrong guarantee.</figcaption>
</figure>

A single sensor event may route to multiple consumers (fan-out) or be suppressed entirely if it matches an exclusion rule or a deduplication window. Suppression prevents alert fatigue and cuts broker load during high-frequency telemetry bursts — the overlap-based suppression approach is detailed in [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/). For idempotency key generation — essential when a consumer group receives the same event more than once — follow the approach in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/).

```python
import hashlib, json, time
from dataclasses import dataclass

@dataclass
class DispatchEnvelope:
    topic: str
    partition_key: str   # device_id for ordering; H3 cell for spatial locality
    payload: dict
    event_id: str
    ttl_seconds: int = 300

def build_event_id(payload: SensorPayload) -> str:
    """Deterministic SHA-256 event ID for idempotency tracking."""
    canonical = json.dumps(
        {"device_id": payload.device_id,
         "timestamp_utc": payload.timestamp_utc,
         "geometry": payload.geometry},
        sort_keys=True
    ).encode()
    return hashlib.sha256(canonical).hexdigest()

def resolve_routes(
    payload: SensorPayload,
    matched_zones: list[dict],
    dedup_window_seconds: int = 5,
    seen_ids: set[str] | None = None,
) -> list[DispatchEnvelope]:
    seen_ids = seen_ids or set()
    event_id = build_event_id(payload)
    if event_id in seen_ids:
        return []   # suppressed — duplicate within dedup window
    envelopes = []
    for zone in matched_zones:
        envelopes.append(DispatchEnvelope(
            topic=zone["topic"],
            partition_key=payload.device_id,
            payload={"event_id": event_id,
                     "device_id": payload.device_id,
                     "timestamp_utc": payload.timestamp_utc,
                     "geometry": payload.geometry,
                     "zone_id": zone["id"],
                     "properties": payload.properties},
            event_id=event_id,
        ))
    seen_ids.add(event_id)
    return envelopes
```

### Step 4 — Asynchronous Broker Dispatch

**Purpose:** Push resolved routes to a durable message broker without blocking the ingress worker.

Partitioning strategy directly impacts consumer scaling and spatial locality. Hash-based partitioning on `device_id` ensures ordered delivery per sensor. Spatial partitioning by H3 cell (resolution 5–7) optimizes downstream [Tile Update Event Pipelines](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/) and regional analytics. Configure explicit retention policies, consumer group offsets, and backpressure thresholds; unbounded broker topics exhaust memory during telemetry spikes. For high-frequency streams where JSON serialization overhead is measurable, consider the payload format tradeoffs in [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/).

The choice of partition key is a one-way door at production scale — it determines whether consumers can be scaled by sensor or by geography, and the two strategies move events to different partitions for the same input stream:

<figure class="fig">
<svg viewBox="46 0 668 320" role="img" aria-label="Comparison of device-ID hash partitioning versus H3 spatial partitioning" xmlns="http://www.w3.org/2000/svg">
  <title>Partition Key Strategy: device_id Hash vs H3 Cell</title>
  <desc>Two routing strategies for the same sensor stream. Hash partitioning on device_id sends every event from one sensor to the same partition, preserving per-sensor order. H3 cell partitioning sends events from the same geographic area to the same partition, preserving spatial locality regardless of which sensor produced them.</desc>
  <rect x="46" y="0" width="668" height="320" fill="var(--fig-bg)"/>
  <defs>
    <marker id="parr" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Shared source -->
  <rect x="320" y="14" width="120" height="34" rx="5" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.5"/>
  <text x="380" y="30" text-anchor="middle" font-size="10.5" font-weight="600" fill="currentColor">Resolved routes</text>
  <text x="380" y="42" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">events A, B, C…</text>
  <line x1="380" y1="48" x2="200" y2="74" stroke="currentColor" stroke-width="1.2" marker-end="url(#parr)" opacity="0.45"/>
  <line x1="380" y1="48" x2="560" y2="74" stroke="currentColor" stroke-width="1.2" marker-end="url(#parr)" opacity="0.45"/>
  <!-- LEFT: device_id hash -->
  <text x="200" y="90" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor">Hash on device_id</text>
  <text x="200" y="104" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">orders events per sensor</text>
  <rect x="60" y="120" width="124" height="40" rx="5" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.45"/>
  <text x="122" y="138" text-anchor="middle" font-size="9.5" fill="currentColor">partition P0</text>
  <text x="122" y="152" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">sensor-001 only</text>
  <rect x="216" y="120" width="124" height="40" rx="5" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.45"/>
  <text x="278" y="138" text-anchor="middle" font-size="9.5" fill="currentColor">partition P1</text>
  <text x="278" y="152" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">sensor-002 only</text>
  <text x="200" y="186" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">✓ strict per-sensor order</text>
  <text x="200" y="200" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">✗ hot sensor = skewed partition</text>
  <!-- divider -->
  <line x1="380" y1="84" x2="380" y2="232" stroke="currentColor" stroke-width="1" opacity="0.25" stroke-dasharray="4,4"/>
  <!-- RIGHT: H3 cell -->
  <text x="560" y="90" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor">Hash on H3 cell</text>
  <text x="560" y="104" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">groups events by region</text>
  <rect x="420" y="120" width="124" height="40" rx="5" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.45"/>
  <text x="482" y="138" text-anchor="middle" font-size="9.5" fill="currentColor">partition P0</text>
  <text x="482" y="152" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">cell 8a2a… (city A)</text>
  <rect x="576" y="120" width="124" height="40" rx="5" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.45"/>
  <text x="638" y="138" text-anchor="middle" font-size="9.5" fill="currentColor">partition P1</text>
  <text x="638" y="152" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">cell 8a3b… (city B)</text>
  <text x="560" y="186" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">✓ regional consumer locality</text>
  <text x="560" y="200" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">✗ per-sensor order not preserved</text>
  <!-- consumers -->
  <rect x="60" y="246" width="280" height="32" rx="5" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.35" stroke-dasharray="4,3"/>
  <text x="200" y="266" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">time-series consumers (scale by sensor)</text>
  <line x1="122" y1="160" x2="160" y2="244" stroke="currentColor" stroke-width="1.1" marker-end="url(#parr)" opacity="0.4"/>
  <line x1="278" y1="160" x2="240" y2="244" stroke="currentColor" stroke-width="1.1" marker-end="url(#parr)" opacity="0.4"/>
  <rect x="420" y="246" width="280" height="32" rx="5" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.35" stroke-dasharray="4,3"/>
  <text x="560" y="266" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">tile / alerting consumers (scale by region)</text>
  <line x1="482" y1="160" x2="520" y2="244" stroke="currentColor" stroke-width="1.1" marker-end="url(#parr)" opacity="0.4"/>
  <line x1="638" y1="160" x2="600" y2="244" stroke="currentColor" stroke-width="1.1" marker-end="url(#parr)" opacity="0.4"/>
  <text x="380" y="304" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.4">Partition Key Strategy — geospatialwebhook.com</text>
</svg>
<figcaption><b>Figure 3.</b> Partition Key Strategy: device_id Hash vs H3 Cell</figcaption>
</figure>

```python
import asyncio
import aioredis

redis: aioredis.Redis | None = None

async def get_redis() -> aioredis.Redis:
    global redis
    if redis is None:
        redis = await aioredis.from_url("redis://localhost:6379", decode_responses=False)
    return redis

async def dispatch_to_broker(envelopes: list[DispatchEnvelope]) -> None:
    r = await get_redis()
    async with r.pipeline(transaction=False) as pipe:
        for env in envelopes:
            serialized = json.dumps(env.payload).encode()
            # XADD to Redis Stream; maxlen trims to ~100k events per topic
            pipe.xadd(
                env.topic,
                {"data": serialized, "partition_key": env.partition_key},
                maxlen=100_000,
                approximate=True,
            )
        await pipe.execute()

async def route_payload(payload: SensorPayload) -> dict:
    # ZoneIndex loaded at startup; passed via app state in production
    zone_index: ZoneIndex = app.state.zone_index
    matched = await classify_payload(payload, zone_index)
    envelopes = resolve_routes(payload, matched)
    if envelopes:
        asyncio.create_task(dispatch_to_broker(envelopes))
    return {"status": "accepted", "routes": len(envelopes)}
```

### Step 5 — Downstream Consumption and State Sync

**Purpose:** Pull from broker partitions, apply idempotent writes, and update application state.

Consumers pull from Redis Streams or Kafka partitions, deserialize payloads, and update PostGIS or an in-memory spatial cache. They must implement idempotent write patterns because network partitions or broker retries will deliver duplicate events. State synchronization should use optimistic concurrency control or version vectors rather than blind overwrites; when concurrent writes produce conflicting spatial state, the resolution strategies in [Conflict Resolution Strategies](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/) apply. For full implementation details on retry backoff, idempotency key tracking in Redis, and dead-letter routing, see [Implementing at-least-once delivery for GIS webhooks](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/).

```python
import asyncio, json
import aioredis
import asyncpg

CONSUMER_GROUP = "spatial-consumers"
CONSUMER_NAME = "worker-1"
PROCESSED_KEY = "processed_event_ids"   # Redis SET for idempotency tracking

async def consume_stream(stream: str, db_pool: asyncpg.Pool) -> None:
    r = await get_redis()
    # Create group at stream start; ignore if already exists
    try:
        await r.xgroup_create(stream, CONSUMER_GROUP, id="0", mkstream=True)
    except aioredis.ResponseError:
        pass

    while True:
        messages = await r.xreadgroup(
            CONSUMER_GROUP, CONSUMER_NAME,
            streams={stream: ">"},
            count=50, block=1000,
        )
        for _, entries in (messages or []):
            for msg_id, fields in entries:
                event = json.loads(fields[b"data"])
                event_id = event["event_id"]
                already_seen = await r.sismember(PROCESSED_KEY, event_id)
                if already_seen:
                    await r.xack(stream, CONSUMER_GROUP, msg_id)
                    continue
                try:
                    await write_to_postgis(db_pool, event)
                    await r.sadd(PROCESSED_KEY, event_id)
                    await r.expire(PROCESSED_KEY, 86_400)   # 24 h TTL
                    await r.xack(stream, CONSUMER_GROUP, msg_id)
                except Exception as exc:
                    # Leave unacknowledged; broker retries on next read
                    print(f"Consumer error for {event_id}: {exc}")

async def write_to_postgis(pool: asyncpg.Pool, event: dict) -> None:
    geom_json = json.dumps(event["geometry"])
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO sensor_events (event_id, device_id, geom, recorded_at)
            VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), to_timestamp($4))
            ON CONFLICT (event_id) DO NOTHING
            """,
            event["event_id"], event["device_id"], geom_json, event["timestamp_utc"],
        )
```

---

## Spatial Validation and Error Handling

Geometry topology checks must run inside the ingestion model validator (see Step 1), not inside the spatial classification worker. The classification worker should receive only pre-validated, EPSG:4326 geometries. CRS alignment code belongs at the boundary between ingestion and classification — never inside the broker consumer.

When Pydantic rejects a payload, quarantine the raw bytes with a structured reason string, the originating `device_id`, and the wall-clock timestamp. This gives operators enough context to replay the event after a firmware fix without re-ingesting the entire stream.

For mixed-CRS streams — common when a device fleet spans multiple manufacturers — normalize all incoming coordinates to EPSG:4326 at the ingestion boundary using `pyproj.Transformer` with `always_xy=True`. Storing EPSG codes in the event envelope rather than inferring them from coordinate magnitude prevents silent axis-order bugs. Full normalization strategies are covered in [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/), and the `asyncio`-native patterns for processing geometrically heavy payloads without blocking the event loop appear in [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/).

---

## Retry, Backoff, and Delivery Guarantees

At-least-once delivery is the industry standard for geospatial telemetry: no event is lost, but consumers must handle duplicates. Exactly-once delivery is rarely achievable across distributed spatial systems due to network partitions and broker leader elections.

The exponential backoff with jitter pattern prevents retry thundering-herds when a PostGIS write or geometry validation fails:

```python
import asyncio, random

async def retry_with_backoff(coro, max_attempts: int = 5, base_delay: float = 0.5):
    """Exponential backoff with full jitter for spatial write operations."""
    for attempt in range(max_attempts):
        try:
            return await coro()
        except Exception as exc:
            if attempt == max_attempts - 1:
                raise
            delay = base_delay * (2 ** attempt) + random.uniform(0, base_delay)
            await asyncio.sleep(delay)
```

Use deterministic event IDs (SHA-256 of `device_id + timestamp + geometry hash`) to track processed events in Redis. When a duplicate arrives, the consumer checks membership in a Redis SET, skips processing, and returns a `200 OK` to prevent broker redelivery storms. The [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) pattern covers the Redis SET expiry strategy and handling hash collisions for high-cardinality device fleets.

---

## Verification

Run this integration test harness against a local Redis + FastAPI stack to confirm the full pipeline works end-to-end:

```python
import pytest, asyncio, json, hashlib, hmac, httpx

ENDPOINT = "http://localhost:8000/ingest"
SECRET = b"your-hmac-secret"

def sign(body: bytes) -> str:
    return "sha256=" + hmac.new(SECRET, body, hashlib.sha256).hexdigest()

VALID_PAYLOAD = {
    "device_id": "sensor-001",
    "timestamp_utc": 1700000000.0,
    "crs": "EPSG:4326",
    "geometry": {"type": "Point", "coordinates": [-122.4194, 37.7749]},
    "properties": {"temperature_c": 24.5},
}

@pytest.mark.asyncio
async def test_valid_payload_accepted():
    body = json.dumps(VALID_PAYLOAD).encode()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            ENDPOINT, content=body,
            headers={"X-Hub-Signature-256": sign(body),
                     "Content-Type": "application/json"}
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"

@pytest.mark.asyncio
async def test_invalid_signature_rejected():
    body = json.dumps(VALID_PAYLOAD).encode()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            ENDPOINT, content=body,
            headers={"X-Hub-Signature-256": "sha256=bad",
                     "Content-Type": "application/json"}
        )
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_invalid_crs_quarantined():
    payload = {**VALID_PAYLOAD, "crs": "OSGB36"}   # missing EPSG: prefix
    body = json.dumps(payload).encode()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            ENDPOINT, content=body,
            headers={"X-Hub-Signature-256": sign(body),
                     "Content-Type": "application/json"}
        )
    assert resp.json()["status"] == "quarantined"
```

---

## Troubleshooting

<div style="overflow-x:auto;">

| Symptom | Likely spatial cause | Fix |
|---|---|---|
| P99 ingestion latency spikes above 500 ms | Brute-force polygon intersection on large zone registry | Replace linear scan with `STRtree.query()` R-tree index |
| Consumers report duplicate geometry writes | Missing idempotency check before PostGIS `INSERT` | Add `ON CONFLICT (event_id) DO NOTHING` + Redis SET membership check |
| Broker queue depth grows unbounded | Consumers blocked on slow geometry validation | Move geometry validation to ingestion worker; consumers receive pre-validated payloads |
| Silent coordinate flip (lat/lon swapped) | `pyproj` axis order not forced to XY | Use `always_xy=True` in `Transformer.from_crs()` |
| Dead-letter queue fills with `"Geometry is empty"` | Device firmware emits `null` coordinate arrays | Add `null`-coordinate guard in Pydantic `@model_validator` before calling `shape()` |
| Consumer lag grows per geographic shard | Partition skew — one H3 cell has 10× events of others | Lower H3 resolution (larger cells) or add a secondary partition key for high-density areas |

</div>

---

## FAQ

<details class="faq">
<summary><strong>When should I partition by H3 cell instead of device ID?</strong></summary>

Use H3 partitioning when downstream consumers are regionally scoped — tile renderers, per-city alerting services, or geographic shards of a PostGIS database. Use device-ID partitioning when ordering guarantees per sensor matter more than spatial locality, such as time-series telemetry streams where out-of-order events corrupt state. You can combine both by using `device_id` as the primary partition key and including the H3 cell ID in the event envelope for downstream routing hints.

</details>

<details class="faq">
<summary><strong>How do I handle sensors that report in a CRS other than WGS 84 (EPSG:4326)?</strong></summary>

Reproject at the ingestion boundary, before spatial classification, using `pyproj.Transformer.from_crs(source, "EPSG:4326", always_xy=True)`. Store the original CRS in the event envelope as a metadata field so consumers can audit provenance. Route exclusively on EPSG:4326 coordinates. This is the same normalization strategy described in [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/).

</details>

<details class="faq">
<summary><strong>Can I skip the message broker and route synchronously from FastAPI to consumers?</strong></summary>

Only for very low throughput (under ~50 events per second) with a single consumer. Without a broker, a consumer crash silently drops events and spatial mutations are lost with no replay capability. For production IoT feeds, always interpose a durable broker. Redis Streams is the lowest-friction option; Kafka is the right choice when you need event replay, consumer group partitioning, or retention beyond 24 hours.

</details>

<details class="faq">
<summary><strong>What queue depth limit should I use to apply backpressure at the ingress?</strong></summary>

A practical starting point is 10,000 in-flight events per ingress worker. Monitor P99 ingestion latency and drop rate using OpenTelemetry counters. When P99 exceeds 300 ms or drop rate exceeds 0.05%, tighten the limit or scale out workers. Return HTTP 429 with a `Retry-After` header so upstream senders back off gracefully rather than hammering the endpoint.

</details>

---

## Related

- [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/) — the parent section covering spatial event modeling, delivery semantics, and pipeline architecture
- [Implementing at-least-once delivery for GIS webhooks](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/) — deep-dive on retry backoff, idempotency key storage, and dead-letter routing
- [Feature Change Triggers](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/) — how to detect and dispatch spatial mutations from PostGIS and CDC connectors
- [Tile Update Event Pipelines](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/) — consuming routed sensor events to invalidate and regenerate raster and vector tiles
- [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) — normalizing mixed-CRS payloads before they enter the routing layer
