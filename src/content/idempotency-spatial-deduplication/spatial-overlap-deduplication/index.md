---
title: "Spatial Overlap Deduplication for Geospatial Webhooks"
description: "Suppress redundant geospatial webhook events in Python using Shapely spatial predicates, Redis caching, and configurable area overlap thresholds."
slug: "spatial-overlap-deduplication"
type: "guide"
breadcrumb:
  - label: "Idempotency & Spatial Deduplication"
    url: "/idempotency-spatial-deduplication/"
  - label: "Spatial Overlap Deduplication"
    url: "/idempotency-spatial-deduplication/spatial-overlap-deduplication/"
datePublished: "2025-08-01"
dateModified: "2026-06-25"
schema:
  - Article
  - BreadcrumbList
  - HowTo
  - FAQPage
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Spatial Overlap Deduplication for Geospatial Webhooks",
      "description": "Implement spatial overlap deduplication in Python to suppress redundant geospatial webhook events using Shapely predicates, Redis caching, and configurable area thresholds.",
      "datePublished": "2025-08-01",
      "dateModified": "2026-06-25",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Idempotency & Spatial Deduplication", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/"},
        {"@type": "ListItem", "position": 2, "name": "Spatial Overlap Deduplication", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Implement Spatial Overlap Deduplication for Geospatial Webhooks",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Normalize Inbound Payloads", "text": "Extract geometry, validate against GeoJSON standards, and enforce a single CRS before spatial evaluation."},
        {"@type": "HowToStep", "position": 2, "name": "Generate Deterministic Spatial Keys", "text": "Derive stable grid-aligned cache keys from geometry bounding boxes combined with a temporal window."},
        {"@type": "HowToStep", "position": 3, "name": "Execute Cache-Backed Idempotency Check", "text": "Perform a Redis SET NX lookup to short-circuit processing before touching the spatial predicate engine."},
        {"@type": "HowToStep", "position": 4, "name": "Evaluate Spatial Overlap", "text": "Run Shapely intersection predicates against spatially indexed candidates to apply configurable area thresholds."},
        {"@type": "HowToStep", "position": 5, "name": "Apply Conflict Resolution Policy", "text": "Suppress, merge, or escalate events based on overlap ratio, temporal decay, and geometry complexity rules."}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does exact-hash deduplication fail for geospatial payloads?",
          "acceptedAnswer": {"@type": "Answer", "text": "Coordinate precision drift, CRS transformations, and topology normalization by GIS libraries all change the raw bytes of a geometry without changing its spatial footprint. Hash-based filters therefore treat functionally identical shapes as distinct events."}
        },
        {
          "@type": "Question",
          "name": "What overlap ratio threshold should I use in production?",
          "acceptedAnswer": {"@type": "Answer", "text": "Start at 0.85 (85% area intersection) for tight deduplication. Telemetry with GPS drift may need 0.70–0.75. Always measure false-positive suppression rates against a labelled sample before deploying a threshold to production."}
        },
        {
          "@type": "Question",
          "name": "How do I compute overlap ratios without projection errors?",
          "acceptedAnswer": {"@type": "Answer", "text": "Area calculations in EPSG:4326 (degrees squared) are not meaningful for ratio comparisons. Project both geometries to an equal-area CRS such as EPSG:6933 or a local UTM zone before computing intersection.area / new_geom.area."}
        },
        {
          "@type": "Question",
          "name": "Can I use PostGIS instead of Shapely for overlap checks?",
          "acceptedAnswer": {"@type": "Answer", "text": "Yes. ST_Intersects + ST_Area(ST_Intersection(...)) / ST_Area(...) express the same predicate and benefit from GiST index acceleration at database scale. The Python layer then only needs to interpret the boolean result rather than loading full geometry objects."}
        }
      ]
    }
  ]
}
</script>

**Spatial overlap deduplication suppresses redundant geospatial webhook events by evaluating geometric intersection and configurable area thresholds rather than exact byte-for-byte payload hashes — making it resilient to coordinate precision drift, CRS variance, and topology normalization artifacts.**

This topic is part of [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/), which covers the full range of strategies for ensuring geospatial event pipelines process each unique spatial footprint exactly once.

---

## Prerequisites

Verify these dependencies before implementing the pattern:

- [ ] Python 3.9+ with an async-capable framework: FastAPI, Starlette, or aiohttp
- [ ] `shapely>=2.0` — vector geometry operations, spatial predicates, topology validation
- [ ] `pyproj>=3.4` — coordinate reference system transformations
- [ ] `pydantic>=2.0` — payload schema validation with GeoJSON model support
- [ ] `redis[asyncio]>=4.5` — sub-millisecond cache lookups with atomic SET NX support
- [ ] Redis 6.2+ (or compatible store) with TTL management enabled
- [ ] A message broker (Kafka, RabbitMQ, or AWS SQS) to decouple ingestion from evaluation workers
- [ ] All inbound webhook sources documented with their native CRS (EPSG code)

---

## Why Exact-Hash Deduplication Fails for Spatial Payloads

Standard idempotency patterns rely on deterministic identifiers: request IDs, transaction hashes, or exact payload checksums. Geospatial data systematically violates these assumptions through four mechanisms:

**Floating-point precision drift.** A polygon serialized to 6 decimal places in one system may arrive at 8 decimal places after a CRS transformation, breaking exact string matches while representing the same physical boundary.

**CRS mismatch.** Inbound payloads commonly mix EPSG:4326 (WGS 84), EPSG:3857 (Web Mercator), and local projected systems. Identical physical areas yield completely different coordinate arrays depending on projection. Normalizing coordinates to a canonical CRS — as detailed in [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) — is a prerequisite for any comparison.

**Topology normalization.** GIS libraries automatically close rings, reorder vertices, or snap coordinates to grid tolerances. Two payloads representing the same delivery zone or sensor coverage area rarely produce identical JSON bytes.

**Temporal overlap.** Mobile telemetry and IoT pings frequently report overlapping bounding boxes as devices move or sensors aggregate readings over sliding windows, producing streams of near-identical geometries that differ only in sub-metre vertex positions.

<figure class="fig">
<svg viewBox="0 0 760 262" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Four pairs of geometries at different intersection-over-union ratios, showing where a suppression threshold falls">
<title>What an overlap threshold actually decides</title>
<desc>Four pairs of sensor coverage polygons at increasing degrees of separation, each scored by intersection over union. At 0.99 the second polygon is the same footprint with vertex jitter of a few centimetres, which is exactly what exact-hash deduplication misses and what the threshold exists to catch. At 0.82 a device has drifted a few metres between pings, still the same observation. At 0.41 the coverage has genuinely moved and the pair describes two different observations that happen to share ground. At 0.04 they are unrelated. A threshold set at 0.90 suppresses the first two cases and forwards the rest. Setting it too high lets jitter through as novel events and the deduplication does nothing; too low and genuine movement is suppressed, so the map silently stops updating for a device that is still moving — the more dangerous direction, because a suppressed event produces no error and no metric.</desc>
<rect x="0" y="0" width="760" height="262" fill="var(--fig-bg)"/>
<rect x="14" y="34" width="176" height="112" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="102" y="52" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">IoU 0.99</text>
<rect x="52" y="66" width="86" height="58" fill="none" stroke="var(--fig-ink)" stroke-width="1.6"/>
<rect x="55" y="68" width="86" height="58" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.6" stroke-dasharray="4,3"/>
<text x="102" y="140" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">vertex jitter — cm</text>
<rect x="200" y="34" width="176" height="112" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="288" y="52" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">IoU 0.82</text>
<rect x="234" y="66" width="86" height="58" fill="none" stroke="var(--fig-ink)" stroke-width="1.6"/>
<rect x="248" y="72" width="86" height="58" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.6" stroke-dasharray="4,3"/>
<text x="288" y="140" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">drift between pings — m</text>
<rect x="386" y="34" width="176" height="112" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="474" y="52" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">IoU 0.41</text>
<rect x="412" y="66" width="86" height="58" fill="none" stroke="var(--fig-ink)" stroke-width="1.6"/>
<rect x="456" y="76" width="86" height="58" fill="none" stroke="var(--fig-mint-edge)" stroke-width="1.6" stroke-dasharray="4,3"/>
<text x="474" y="140" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">genuinely moved</text>
<rect x="572" y="34" width="174" height="112" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="659" y="52" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">IoU 0.04</text>
<rect x="586" y="66" width="70" height="46" fill="none" stroke="var(--fig-ink)" stroke-width="1.6"/>
<rect x="648" y="88" width="70" height="46" fill="none" stroke="var(--fig-mint-edge)" stroke-width="1.6" stroke-dasharray="4,3"/>
<text x="659" y="140" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">unrelated</text>
<line x1="376" y1="30" x2="376" y2="152" stroke="var(--fig-gold-edge)" stroke-width="2" stroke-dasharray="6,3"/>
<text x="376" y="168" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-gold-edge)">threshold 0.90 — suppress left, forward right</text>
<rect x="14" y="182" width="366" height="70" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="26" y="200" font-size="10" font-weight="600" fill="var(--fig-ink)">Threshold too high — say 0.999</text>
<text x="26" y="217" font-size="9" fill="var(--fig-ink-soft)">Jitter passes as novel. Deduplication does nothing and you pay for</text>
<text x="26" y="230" font-size="9" fill="var(--fig-ink-soft)">the predicate evaluation anyway. Visible immediately in throughput.</text>
<text x="26" y="245" font-size="9" fill="var(--fig-gold-edge)">Loud, and cheap to find.</text>
<rect x="394" y="182" width="352" height="70" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="406" y="200" font-size="10" font-weight="600" fill="var(--fig-ink)">Threshold too low — say 0.40</text>
<text x="406" y="217" font-size="9" fill="var(--fig-ink-soft)">Real movement is suppressed. The map stops updating for a device</text>
<text x="406" y="230" font-size="9" fill="var(--fig-ink-soft)">that is still moving, and a suppressed event raises nothing.</text>
<text x="406" y="245" font-size="9" fill="var(--fig-rose-edge)">Silent — which is why you alert on the suppression rate.</text>
</svg>
<figcaption><b>Figure 1.</b> The threshold is a statement about how far a thing must move before it counts as having moved. The two failure directions are not symmetric: too high wastes CPU visibly, too low drops real updates silently — so instrument the suppression rate, not just the hit rate.</figcaption>
</figure>

Hash-based filters either drop legitimate updates or let duplicates through. Spatial predicate evaluation is resilient to these variances because it asks whether two geometries occupy the same footprint, not whether their byte representations match.

---

## Architecture: Four-Layer Deduplication Pipeline

The pipeline separates concerns across four layers to keep expensive spatial computation off the hot path.

<figure class="fig">
<svg viewBox="0 16 740 362" role="img" aria-label="Four-layer spatial overlap deduplication pipeline diagram" xmlns="http://www.w3.org/2000/svg">
  <title>Spatial Overlap Deduplication Pipeline</title>
  <desc>Data flows left to right through four layers: Webhook Ingress, Payload Normalisation, Cache Lookup, and Spatial Predicate. A cache hit suppresses the event immediately. An overlap above threshold suppresses and logs. A cache miss combined with overlap below threshold forwards the event to the downstream processor.</desc>
  <rect x="0" y="16" width="740" height="362" fill="var(--fig-bg)"/>
  <defs>
    <marker id="sodp-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Layer 1: Ingress -->
  <rect x="10" y="30" width="148" height="70" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
  <text x="84" y="54" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Layer 1</text>
  <text x="84" y="72" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.8">Webhook Ingress</text>
  <text x="84" y="89" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.6">FastAPI endpoint</text>
  <!-- Arrow 1→2 -->
  <line x1="158" y1="65" x2="186" y2="65" stroke="currentColor" stroke-width="1.5" opacity="0.6" marker-end="url(#sodp-arr)"/>
  <!-- Layer 2: Normalisation -->
  <rect x="186" y="30" width="148" height="70" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
  <text x="260" y="54" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Layer 2</text>
  <text x="260" y="72" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.8">Payload Normalise</text>
  <text x="260" y="89" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.6">CRS → EPSG:4326</text>
  <!-- Arrow 2→3 -->
  <line x1="334" y1="65" x2="362" y2="65" stroke="currentColor" stroke-width="1.5" opacity="0.6" marker-end="url(#sodp-arr)"/>
  <!-- Layer 3: Cache -->
  <rect x="362" y="30" width="148" height="70" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
  <text x="436" y="54" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Layer 3</text>
  <text x="436" y="72" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.8">Cache Lookup</text>
  <text x="436" y="89" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.6">Redis SET NX</text>
  <!-- Arrow 3→4 -->
  <line x1="510" y1="65" x2="538" y2="65" stroke="currentColor" stroke-width="1.5" opacity="0.6" marker-end="url(#sodp-arr)"/>
  <!-- Layer 4: Predicate -->
  <rect x="538" y="30" width="190" height="70" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
  <text x="633" y="54" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Layer 4</text>
  <text x="633" y="72" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.8">Spatial Predicate</text>
  <text x="633" y="89" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.6">Shapely STRtree</text>
  <!-- Cache HIT → suppress (down from Layer 3) -->
  <line x1="436" y1="100" x2="436" y2="166" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.5" marker-end="url(#sodp-arr)"/>
  <rect x="356" y="166" width="160" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3"/>
  <text x="436" y="184" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" opacity="0.8">Cache HIT</text>
  <text x="436" y="200" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">suppress · return 200</text>
  <!-- Overlap ≥ threshold → suppress (down from Layer 4) -->
  <line x1="633" y1="100" x2="633" y2="166" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.5" marker-end="url(#sodp-arr)"/>
  <rect x="545" y="166" width="176" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3"/>
  <text x="633" y="184" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" opacity="0.8">Overlap &#8805; threshold</text>
  <text x="633" y="200" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">suppress · log audit</text>
  <!-- Downstream: novel event (bottom) -->
  <rect x="186" y="312" width="368" height="52" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
  <text x="370" y="334" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Downstream Processor</text>
  <text x="370" y="352" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">Cache MISS + overlap below threshold &#8594; publish unique event</text>
  <!-- Arrows to downstream -->
  <line x1="436" y1="210" x2="352" y2="312" stroke="currentColor" stroke-width="1.5" opacity="0.6" marker-end="url(#sodp-arr)"/>
  <line x1="633" y1="210" x2="500" y2="312" stroke="currentColor" stroke-width="1.5" opacity="0.6" marker-end="url(#sodp-arr)"/>
  <!-- MISS label on first arrow -->
  <text x="372" y="268" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">MISS</text>
  <text x="582" y="268" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">below threshold</text>
</svg>
<figcaption><b>Figure 2.</b> Spatial Overlap Deduplication Pipeline</figcaption>
</figure>

**Layer 1 — Webhook ingress:** FastAPI or aiohttp receives the raw POST and immediately validates the HTTP signature (see [Securing Webhook Endpoints with Spatial Token Validation](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/)). The raw body is enqueued for async processing without blocking the HTTP response.

**Layer 2 — Payload normalisation:** Extract the GeoJSON geometry, validate topology with `shapely.validation.make_valid`, and reproject to a canonical CRS (EPSG:4326) before any comparison. This step also validates the payload schema via Pydantic to reject malformed geometry types early.

**Layer 3 — Cache-backed fast path:** Generate a grid-aligned spatial key and issue an atomic Redis SET NX. On a cache hit, the event is a known duplicate: return 200 immediately, no predicate evaluation needed. This layer typically eliminates 60–80 % of retry traffic before geometry is loaded.

**Layer 4 — Spatial predicate evaluation:** For cache misses, load candidate geometries from a recent event store (spatial index or PostGIS query) and evaluate overlap with Shapely predicates. Events whose intersection area exceeds the configured threshold are suppressed and logged to an audit trail; those below it are novel and forwarded to the downstream processor.

---

## Step-by-Step Implementation

### 1. Validate and Normalise Inbound Payloads

Webhook sources rarely emit uniform geometry. Before any comparison, enforce a single CRS, close polygon rings, and repair invalid topology. This is the same normalisation foundation described in [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/).

```python
from shapely.geometry import shape
from shapely.ops import transform
from shapely.validation import make_valid
import pyproj
from pydantic import BaseModel, field_validator
from typing import Any

class SpatialWebhookPayload(BaseModel):
    event_id: str
    source_crs: str = "EPSG:4326"
    geometry: dict[str, Any]

    @field_validator("geometry")
    @classmethod
    def geometry_must_be_valid_geojson(cls, v: dict) -> dict:
        allowed = {"Point", "MultiPoint", "LineString", "MultiLineString",
                   "Polygon", "MultiPolygon", "GeometryCollection"}
        if v.get("type") not in allowed:
            raise ValueError(f"Unsupported geometry type: {v.get('type')}")
        return v


TARGET_CRS = "EPSG:4326"


def normalize_geometry(payload: SpatialWebhookPayload):
    """
    Return a valid Shapely geometry normalised to EPSG:4326.
    Projects from the payload's declared source CRS when needed.
    """
    geom = shape(payload.geometry)

    # Repair self-intersections and unclosed rings before any predicate
    if not geom.is_valid:
        geom = make_valid(geom)

    if payload.source_crs != TARGET_CRS:
        transformer = pyproj.Transformer.from_crs(
            payload.source_crs, TARGET_CRS, always_xy=True
        )
        geom = transform(transformer.transform, geom)

    return geom
```

Always call `make_valid` before storing or comparing; Shapely 2.x raises `TopologicalError` on predicates against invalid geometries rather than silently returning incorrect results.

### 2. Generate a Grid-Aligned Spatial Cache Key

Raw coordinate strings are unsuitable as cache keys because floating-point variance produces distinct strings for the same physical location. Round the bounding box centroid to a fixed grid precision and combine it with a temporal window bucket. This approach aligns with the broader key-derivation patterns in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/).

```python
import hashlib
from datetime import datetime, timezone

# Spatial grid precision in decimal degrees.
# Precision 4 = ~11 m grid cell; precision 3 = ~111 m grid cell.
GRID_PRECISION = 4
# Temporal window width in minutes (events within the same window share a bucket).
WINDOW_MINUTES = 60


def spatial_cache_key(geom, event_time: datetime | None = None) -> str:
    """
    Derive a deterministic cache key from a geometry's centroid grid cell
    and an hourly time bucket.
    """
    if event_time is None:
        event_time = datetime.now(tz=timezone.utc)

    centroid = geom.centroid
    grid_lat = round(centroid.y, GRID_PRECISION)
    grid_lon = round(centroid.x, GRID_PRECISION)
    # Bucket by hour (or subdivide by WINDOW_MINUTES for sub-hour windows)
    bucket = event_time.strftime("%Y%m%dT%H")

    raw = f"{grid_lat}:{grid_lon}:{bucket}"
    return "sodp:" + hashlib.sha256(raw.encode()).hexdigest()[:20]
```

Grid-aligned keys ensure that geometries falling in the same spatial cell and time window share a cache namespace, enabling fast overlap lookup without scanning the full event history.

### 3. Cache-Backed Fast-Path Check

Perform a Redis SET NX before loading any geometry objects. The vast majority of webhook retries are caught here, keeping the spatial predicate engine off the critical path. The implementation mirrors the atomic locking approach described in [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/).

```python
import redis.asyncio as aioredis

CACHE_TTL_SECONDS = 3600  # 1-hour deduplication window


async def is_duplicate_via_cache(
    client: aioredis.Redis,
    key: str,
) -> bool:
    """
    Atomically claim the cache key.
    Returns True  → key already existed  → event is a duplicate.
    Returns False → key was absent       → event may be novel (proceed to predicate).
    """
    # SET key value NX EX ttl — atomic; no race between GET and SET
    acquired = await client.set(key, "1", nx=True, ex=CACHE_TTL_SECONDS)
    return not bool(acquired)
```

Use `nx=True` (SET NX) rather than a GET + SET sequence to prevent a TOCTOU race where two concurrent retries both pass the cache check and both reach the expensive predicate layer.

### 4. Spatial Predicate Evaluation with Area Threshold

For cache misses, retrieve candidate geometries from the recent event store and evaluate overlap with Shapely. Use an R-tree (`STRtree`) to avoid pairwise O(n²) comparisons — the R-tree filters candidates to those whose bounding boxes intersect before the exact predicate runs.

The decision itself is a single ratio: project both shapes to an equal-area CRS, divide the intersection area by the incoming geometry's area, and compare against the threshold. The diagram below shows why a near-identical retry is suppressed while a genuinely shifted footprint passes through.

<figure class="fig">
<svg viewBox="56 2 608 248" role="img" aria-label="Equal-area overlap ratio comparison: a near-duplicate geometry above threshold is suppressed, a shifted geometry below threshold passes" xmlns="http://www.w3.org/2000/svg">
  <title>Overlap Ratio Decides Suppression</title>
  <desc>Two scenarios. On the left, an incoming polygon overlaps a stored polygon by 0.91 of its area, exceeding the 0.85 threshold, so the event is suppressed. On the right, the incoming polygon overlaps by only 0.42, below the threshold, so the event is forwarded as a novel spatial update.</desc>
  <rect x="56" y="2" width="608" height="248" fill="var(--fig-bg)"/>
  <!-- Left scenario: high overlap, suppressed -->
  <text x="170" y="28" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Near-duplicate retry</text>
  <!-- stored polygon -->
  <rect x="70" y="48" width="150" height="110" rx="4" fill="currentColor" opacity="0.12" stroke="currentColor" stroke-width="1.4"/>
  <!-- incoming polygon, slightly shifted -->
  <rect x="84" y="58" width="150" height="110" rx="4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="5,3" opacity="0.85"/>
  <text x="170" y="192" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">overlap ratio = 0.91</text>
  <text x="170" y="210" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">&#8805; 0.85 &#8594; suppress</text>
  <!-- divider -->
  <line x1="360" y1="40" x2="360" y2="220" stroke="currentColor" stroke-width="1" opacity="0.2"/>
  <!-- Right scenario: low overlap, forwarded -->
  <text x="540" y="28" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Shifted footprint</text>
  <rect x="430" y="48" width="130" height="110" rx="4" fill="currentColor" opacity="0.12" stroke="currentColor" stroke-width="1.4"/>
  <rect x="520" y="58" width="130" height="110" rx="4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="5,3" opacity="0.85"/>
  <text x="540" y="192" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">overlap ratio = 0.42</text>
  <text x="540" y="210" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">&lt; 0.85 &#8594; forward</text>
  <!-- legend -->
  <rect x="70" y="232" width="16" height="10" fill="currentColor" opacity="0.12" stroke="currentColor" stroke-width="1"/>
  <text x="94" y="241" font-size="10" fill="currentColor" opacity="0.7">stored geometry</text>
  <rect x="240" y="232" width="16" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="4,2"/>
  <text x="264" y="241" font-size="10" fill="currentColor" opacity="0.7">incoming geometry</text>
</svg>
<figcaption><b>Figure 3.</b> Overlap Ratio Decides Suppression</figcaption>
</figure>

```python
from shapely.strtree import STRtree
from shapely.geometry.base import BaseGeometry
import pyproj
from shapely.ops import transform as shp_transform

# Minimum fractional area overlap to treat two geometries as duplicates.
OVERLAP_THRESHOLD = 0.85

# Project to equal-area CRS for meaningful area ratios.
# EPSG:6933 covers the full globe; swap for a local UTM zone for higher accuracy.
_AREA_CRS_TRANSFORMER = pyproj.Transformer.from_crs(
    "EPSG:4326", "EPSG:6933", always_xy=True
)


def _project_for_area(geom: BaseGeometry) -> BaseGeometry:
    return shp_transform(_AREA_CRS_TRANSFORMER.transform, geom)


def is_duplicate_via_overlap(
    new_geom: BaseGeometry,
    candidates: list[BaseGeometry],
) -> bool:
    """
    Return True if any candidate overlaps new_geom by >= OVERLAP_THRESHOLD.
    All geometries must be in EPSG:4326; area comparison projects to EPSG:6933.
    """
    if not candidates:
        return False

    tree = STRtree(candidates)
    # R-tree pre-filter: only intersecting bounding boxes proceed to exact check
    hits = tree.query(new_geom, predicate="intersects")

    new_geom_area = _project_for_area(new_geom).area
    if new_geom_area == 0:
        # Point or line — fall back to exact-contains check
        return any(candidates[i].contains(new_geom) for i in hits)

    for idx in hits:
        candidate = candidates[idx]
        intersection = new_geom.intersection(candidate)
        if intersection.is_empty:
            continue
        overlap_ratio = _project_for_area(intersection).area / new_geom_area
        if overlap_ratio >= OVERLAP_THRESHOLD:
            return True

    return False
```

Never compute area ratios in EPSG:4326 — degree-squared values are not proportional to real-world area, particularly at latitudes above 45°. Always project to an equal-area CRS first.

### 5. Compose the Full Async Pipeline

Wire the layers together in a FastAPI endpoint. The webhook receiver returns 200 immediately after accepting the event; the deduplication logic runs in a background task.

```python
from fastapi import FastAPI, Request, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
import redis.asyncio as aioredis
from contextlib import asynccontextmanager
import json

app = FastAPI()
redis_client: aioredis.Redis | None = None

@asynccontextmanager
async def lifespan(app_: FastAPI):
    global redis_client
    redis_client = aioredis.from_url("redis://localhost:6379", decode_responses=True)
    yield
    await redis_client.aclose()

app = FastAPI(lifespan=lifespan)

# In production, load recent event geometries from a PostGIS query or
# a shared in-memory spatial index refreshed by a background worker.
recent_geometries: list = []


async def process_spatial_event(raw_body: bytes) -> None:
    payload_dict = json.loads(raw_body)
    try:
        payload = SpatialWebhookPayload(**payload_dict)
    except Exception as exc:
        # Schema validation failure — route to DLQ
        print(f"[DLQ] invalid payload: {exc}")
        return

    geom = normalize_geometry(payload)
    key = spatial_cache_key(geom)

    if await is_duplicate_via_cache(redis_client, key):
        print(f"[DEDUP] cache hit: {key}")
        return

    if is_duplicate_via_overlap(geom, recent_geometries):
        print(f"[DEDUP] overlap threshold exceeded for event {payload.event_id}")
        # Persist audit record: original event_id, overlap ratio, canonical event ref
        return

    # Novel event — forward to downstream processor
    recent_geometries.append(geom)  # update in-memory index
    print(f"[PUBLISH] forwarding unique event {payload.event_id}")


@app.post("/webhook/spatial")
async def receive_spatial_event(request: Request, background_tasks: BackgroundTasks):
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty body")
    background_tasks.add_task(process_spatial_event, body)
    return JSONResponse({"status": "accepted"}, status_code=200)
```

---

## Spatial Validation and Error Handling

Wrap the normalisation step in explicit error handling to prevent a single malformed payload from stalling the pipeline:

```python
from shapely.errors import TopologicalError, GEOSException

async def safe_normalize(payload: SpatialWebhookPayload):
    try:
        return normalize_geometry(payload)
    except (TopologicalError, GEOSException, ValueError) as exc:
        # Route to dead-letter queue with original payload and error context
        print(f"[DLQ] geometry error for event {payload.event_id}: {exc}")
        return None
```

Apply Pydantic validation at the HTTP boundary (as shown in `SpatialWebhookPayload`) and a second topology check inside the worker after normalisation. This two-stage approach catches both malformed JSON and geometrically invalid shapes that pass JSON schema validation.

For [async processing of heavy geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/), offload normalisation of complex multi-polygon payloads to a dedicated worker pool to prevent a large geometry from monopolising the async event loop. When upstream sources send conflicting representations of the same region, consult the [Conflict Resolution Strategies](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/) patterns for merge and escalation policies.

---

## Retry, Backoff, and Delivery Guarantees

The spatial deduplication layer is designed for **at-least-once delivery** from the broker side combined with **exactly-once processing** enforced by the cache. At high throughput, a few edge cases require explicit handling:

```python
import asyncio
import random

MAX_RETRIES = 4
BASE_DELAY_SECONDS = 0.25


async def publish_with_backoff(event_id: str, payload: dict) -> None:
    """
    Retry forwarding a novel event to the downstream processor with
    exponential backoff and full jitter to avoid retry storms.
    """
    for attempt in range(MAX_RETRIES):
        try:
            # Replace with your broker client (aiokafka, aio-pika, etc.)
            await downstream_publish(event_id, payload)
            return
        except Exception as exc:
            if attempt == MAX_RETRIES - 1:
                print(f"[DLQ] exhausted retries for {event_id}: {exc}")
                await send_to_dlq(event_id, payload, reason=str(exc))
                return
            delay = BASE_DELAY_SECONDS * (2 ** attempt) * random.random()
            await asyncio.sleep(delay)


async def downstream_publish(event_id: str, payload: dict) -> None:
    # Placeholder for aiokafka / aio-pika / SQS publish call
    pass


async def send_to_dlq(event_id: str, payload: dict, reason: str) -> None:
    # Persist to append-only DLQ with geometry snapshot and reason code
    pass
```

**At-least-once vs. exactly-once tradeoffs:** The Redis SET NX provides exactly-once semantics within the cache TTL window. Events that arrive after TTL expiry are treated as novel — intentional, because a geometry change 25 hours later likely represents a genuine spatial update. For stricter exactly-once guarantees across longer windows, persist the spatial key to a durable store (PostgreSQL with a GiST index on the geometry column) rather than relying solely on Redis TTL. The broader delivery guarantee patterns are covered in [Implementing At-Least-Once Delivery for GIS Webhooks](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/).

---

## Conflict Resolution and Tolerance Thresholds

Spatial overlap evaluation introduces edge cases that require explicit, documented resolution policies:

**Partial overlaps below threshold:** Events whose intersection falls below `OVERLAP_THRESHOLD` are treated as distinct spatial updates even if they share significant area. Keep the threshold configurable per event source type — GPS tracks need a lower threshold (0.70–0.75) than static delivery zone polygons (0.90+).

**Multi-polygon payloads:** Normalise complex geometries using `shapely.ops.unary_union` before evaluation. Fragmented multi-part geometries can produce misleading overlap ratios when evaluated part-by-part.

**Temporal decay:** Sliding-window deduplication prevents over-suppression. An event overlapping with a 48-hour-old geometry may represent a legitimate state change. Set TTL values that reflect the expected update frequency for each event source.

**Area calculations in geographic CRS:** Ratios computed in EPSG:4326 are mathematically invalid — always project to EPSG:6933 or a local UTM zone before `intersection.area / new_geom.area`. Document the CRS used in your runbooks so threshold values can be recalibrated consistently.

---

## Verification

Run this test harness after deployment to confirm the pipeline correctly classifies overlapping and non-overlapping events:

```python
import asyncio
import pytest
from shapely.geometry import Polygon, mapping

# A base polygon covering a 0.01° × 0.01° cell
BASE = Polygon([(0, 0), (0.01, 0), (0.01, 0.01), (0, 0.01), (0, 0)])
# 90 % overlap — should be suppressed
NEAR_DUPE = Polygon([(0.001, 0.001), (0.011, 0.001), (0.011, 0.011), (0.001, 0.011), (0.001, 0.001)])
# Distant polygon — should be forwarded
DISTANT = Polygon([(1, 1), (1.01, 1), (1.01, 1.01), (1, 1.01), (1, 1)])


@pytest.mark.asyncio
async def test_overlap_suppression():
    """Events with >= 85 % area overlap are classified as duplicates."""
    result = is_duplicate_via_overlap(NEAR_DUPE, [BASE])
    assert result is True, "Near-duplicate polygon should be suppressed"


@pytest.mark.asyncio
async def test_distant_event_passes():
    """Events with no spatial intersection are classified as novel."""
    result = is_duplicate_via_overlap(DISTANT, [BASE])
    assert result is False, "Distant polygon should be forwarded"


@pytest.mark.asyncio
async def test_cache_deduplication(monkeypatch):
    """Second call with the same key returns duplicate=True."""
    seen = {}

    async def fake_set(key, val, *, nx, ex):
        if key in seen:
            return None  # NX fails — key exists
        seen[key] = val
        return True

    class FakeRedis:
        set = fake_set

    client = FakeRedis()
    key = "sodp:test-key-abc123"
    first = await is_duplicate_via_cache(client, key)
    second = await is_duplicate_via_cache(client, key)
    assert first is False, "First call should not be a duplicate"
    assert second is True, "Second call with same key should be a duplicate"
```

---

## Troubleshooting

<div style="overflow-x:auto;">

| Symptom | Likely Spatial Cause | Fix |
|---|---|---|
| Identical events pass through deduplication | Grid precision too coarse; centroids hash to different buckets | Increase `GRID_PRECISION` from 3 to 4–5; verify centroid calculation on the normalised geometry, not the raw input |
| Legitimate updates suppressed | Overlap threshold too high for the source's GPS jitter | Lower `OVERLAP_THRESHOLD` per source type; add a temporal decay check before suppression |
| Area overlap ratios always 0 | Geometries in different CRS; intersection produces empty geometry | Confirm all geometries are reprojected to EPSG:4326 before predicate; call `make_valid` post-transform |
| `TopologicalError` on `.intersection()` | Invalid topology not caught at ingress | Call `make_valid(geom)` inside `normalize_geometry`; add a post-transform validity assertion |
| Redis memory grows unbounded | TTL not applied; key namespace collision | Ensure `ex=CACHE_TTL_SECONDS` is passed to every SET; prefix keys with `sodp:` to isolate the namespace |
| STRtree queries slow at scale | Candidates list rebuilt per request | Build the R-tree once per worker, refresh on a background schedule, and pass it as a shared dependency |
| Duplicate events in audit log | Cache TTL expired before retry arrived | Increase TTL or switch to a durable store (PostgreSQL) for long-window deduplication requirements |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Why does exact-hash deduplication fail for geospatial payloads?</strong></summary>

Coordinate precision drift, CRS transformations, and automatic topology normalization by GIS libraries all change the raw bytes of a geometry without changing its spatial footprint. A polygon serialised at 6-decimal precision by one source may arrive at 8 decimal places after a reprojection step in a middleware layer, producing a completely different SHA-256 hash despite representing the same physical boundary. Hash-based filters therefore treat functionally identical shapes as distinct events, either duplicating processing or blocking legitimate updates.

</details>

<details class="faq">
<summary><strong>What overlap threshold should I use in production?</strong></summary>

Start at 0.85 (85 % area intersection) and measure false-positive suppression rates against a labelled sample of your real event stream before promoting to production. IoT telemetry with GPS drift typically needs a lower threshold — 0.70 to 0.75 — while static administrative boundary updates can safely use 0.90 or higher. Store the threshold in configuration, not code, so it can be tuned per event source without a deployment.

</details>

<details class="faq">
<summary><strong>How do I avoid incorrect area ratios?</strong></summary>

Always project both geometries to an equal-area CRS — EPSG:6933 (World Equal Area) covers the full globe; a local UTM zone gives higher accuracy within a constrained region — before computing `intersection.area / new_geom.area`. In EPSG:4326, the unit is degrees squared, which is not proportional to real-world area and produces ratios that vary by latitude. A 0.85 threshold applied in geographic coordinates could suppress events in equatorial regions while allowing duplicates at polar latitudes.

</details>

<details class="faq">
<summary><strong>Can I use PostGIS instead of Shapely for the overlap check?</strong></summary>

Yes. `ST_Intersects(geom_a, geom_b)` combined with `ST_Area(ST_Intersection(geom_a, geom_b)) / ST_Area(geom_a)` expresses the same predicate inside the database, where a GiST index on the geometry column accelerates the spatial filter automatically. The Python layer then only needs to interpret the boolean result. PostGIS is the right choice when candidates are already stored in PostgreSQL and you want to avoid loading full geometry objects into Python memory for every evaluation.

</details>

---

## Related

- [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — parent section covering the full idempotency strategy for geospatial event pipelines
- [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — deterministic idempotency key derivation from GeoJSON feature hashes
- [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) — Redis data structures, atomic SET NX patterns, and cache invalidation strategies
- [Conflict Resolution Strategies](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/) — merge and escalation policies when overlapping events represent genuine spatial state changes
- [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) — normalising mixed-CRS payloads to a canonical projection before comparison
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — topology checks, ring orientation enforcement, and GeoJSON schema validation
