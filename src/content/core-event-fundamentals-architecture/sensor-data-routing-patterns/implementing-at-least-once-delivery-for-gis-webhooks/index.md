---
title: "Implementing At-Least-Once Delivery for GIS Webhooks"
description: "Implement at-least-once delivery for GIS webhooks: idempotency key derivation, Redis-backed deduplication, exponential backoff with jitter, and dead-letter routing."
slug: "implementing-at-least-once-delivery-for-gis-webhooks"
type: "article"
breadcrumb:
  - label: "Core Event Fundamentals & Architecture"
    url: "/core-event-fundamentals-architecture/"
  - label: "Sensor Data Routing Patterns"
    url: "/core-event-fundamentals-architecture/sensor-data-routing-patterns/"
  - label: "Implementing At-Least-Once Delivery for GIS Webhooks"
    url: "/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/"
datePublished: "2025-08-01"
dateModified: "2026-06-24"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Implementing At-Least-Once Delivery for GIS Webhooks",
      "description": "A complete implementation guide for at-least-once delivery in GIS webhook pipelines: idempotency key derivation, Redis-backed deduplication, exponential backoff with jitter, and dead-letter routing for spatial payloads.",
      "datePublished": "2025-08-01",
      "dateModified": "2026-06-24",
      "author": { "@type": "Organization", "name": "GeoSpatialWebhook" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Core Event Fundamentals & Architecture", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/" },
        { "@type": "ListItem", "position": 2, "name": "Sensor Data Routing Patterns", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/" },
        { "@type": "ListItem", "position": 3, "name": "Implementing At-Least-Once Delivery for GIS Webhooks", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Implement At-Least-Once Delivery for GIS Webhooks",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Acknowledge immediately", "text": "Return 200 OK before any spatial processing; push the raw payload to a durable queue." },
        { "@type": "HowToStep", "position": 2, "name": "Derive an idempotency key", "text": "Prefer the X-Event-ID header; fall back to a SHA-256 hash of the coordinate-normalized payload." },
        { "@type": "HowToStep", "position": 3, "name": "Atomic check-and-set", "text": "Use Redis SET NX EX to mark the key as in-flight before any geometry write." },
        { "@type": "HowToStep", "position": 4, "name": "Process with bounded retries", "text": "Apply exponential backoff with full jitter; cap at 5–7 attempts." },
        { "@type": "HowToStep", "position": 5, "name": "Route exhausted events to a dead-letter queue", "text": "Preserve the full payload and retry count for manual replay or alerting." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is the difference between at-least-once and exactly-once delivery for GIS webhooks?",
          "acceptedAnswer": { "@type": "Answer", "text": "At-least-once guarantees every spatial event arrives but may produce duplicates; your pipeline must deduplicate using idempotency keys. Exactly-once additionally prevents reprocessing at the broker level, but requires distributed transactions that most spatial stacks cannot support without significant latency cost." }
        },
        {
          "@type": "Question",
          "name": "Why must I normalize coordinates before hashing the payload?",
          "acceptedAnswer": { "@type": "Answer", "text": "Floating-point serialization varies by sender library: 40.7128 and 40.71280000000001 are the same coordinate but produce different hashes, causing the deduplication gate to miss duplicate events. Rounding to 6 decimal places (~11 cm precision) produces stable hashes without meaningful geographic loss." }
        },
        {
          "@type": "Question",
          "name": "How long should idempotency keys be retained?",
          "acceptedAnswer": { "@type": "Answer", "text": "24–72 hours covers virtually all real-world retry windows. Retain dead-letter entries for 7 days to allow manual replay. Beyond that, keep only aggregated metrics — not raw payloads — to limit storage cost." }
        }
      ]
    }
  ]
}
</script>

**Immediately return `200 OK` before touching any geometry, persist the raw spatial payload to a durable queue, and enforce Redis-backed idempotency before every write — that is the complete at-least-once contract for a GIS webhook pipeline.**

This page is part of [Sensor Data Routing Patterns](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/), itself a section of [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/). It focuses on the precise implementation mechanics: key derivation, atomic deduplication, retry budgets, and dead-letter routing — all adapted for the coordinate-precision and CRS constraints that spatial payloads introduce.

---

<figure class="fig">
<svg viewBox="39 0 700 374" role="img" aria-label="At-least-once delivery flow for a GIS webhook" xmlns="http://www.w3.org/2000/svg">
  <title>At-least-once delivery flow for a GIS webhook</title>
  <desc>Five-lane flow: the Sender POSTs a spatial payload to the HTTP Receiver, which returns 200 OK immediately and enqueues the raw payload. A Background Worker derives an idempotency key and runs an atomic SET NX EX against Redis. If the key already exists the duplicate is skipped; if it is new the worker validates and writes the geometry to PostGIS. After MAX_RETRIES are exhausted the event is routed to a dead-letter queue.</desc>
  <rect x="39" y="0" width="700" height="374" fill="var(--fig-bg)"/>
  <defs>
    <marker id="alo-arr" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Lane headers -->
  <text x="75"  y="26" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.75">Sender</text>
  <text x="235" y="26" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.75">HTTP Receiver</text>
  <text x="395" y="26" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.75">Worker</text>
  <text x="545" y="26" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.75">Redis</text>
  <text x="685" y="26" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.75">PostGIS / DLQ</text>
  <!-- Lane lifelines -->
  <line x1="75"  y1="36" x2="75"  y2="360" stroke="currentColor" stroke-width="1.2" opacity="0.2"/>
  <line x1="235" y1="36" x2="235" y2="360" stroke="currentColor" stroke-width="1.2" opacity="0.2"/>
  <line x1="395" y1="36" x2="395" y2="360" stroke="currentColor" stroke-width="1.2" opacity="0.2"/>
  <line x1="545" y1="36" x2="545" y2="360" stroke="currentColor" stroke-width="1.2" opacity="0.2"/>
  <line x1="685" y1="36" x2="685" y2="360" stroke="currentColor" stroke-width="1.2" opacity="0.2"/>
  <!-- 1: POST -->
  <line x1="75"  y1="64" x2="231" y2="64" stroke="currentColor" stroke-width="1.5" opacity="0.6" marker-end="url(#alo-arr)"/>
  <text x="153" y="58" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">POST /webhooks/gis</text>
  <!-- 2: 200 OK -->
  <line x1="235" y1="92" x2="79" y2="92" stroke="currentColor" stroke-width="1.5" opacity="0.6" marker-end="url(#alo-arr)"/>
  <text x="153" y="86" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">200 OK (immediate)</text>
  <!-- 3: enqueue -->
  <line x1="235" y1="120" x2="391" y2="120" stroke="currentColor" stroke-width="1.5" opacity="0.6" stroke-dasharray="5,3" marker-end="url(#alo-arr)"/>
  <text x="315" y="114" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">enqueue raw payload</text>
  <!-- 4: SET NX EX -->
  <line x1="395" y1="156" x2="541" y2="156" stroke="currentColor" stroke-width="1.5" opacity="0.6" marker-end="url(#alo-arr)"/>
  <text x="470" y="150" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">SET NX EX (idemp key)</text>
  <!-- 5a: duplicate skip -->
  <line x1="545" y1="186" x2="399" y2="186" stroke="currentColor" stroke-width="1.5" opacity="0.55" stroke-dasharray="3,3" marker-end="url(#alo-arr)"/>
  <text x="470" y="180" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.7">nil → skip duplicate</text>
  <!-- 5b: new key proceed -->
  <line x1="545" y1="216" x2="399" y2="216" stroke="currentColor" stroke-width="1.5" opacity="0.6" marker-end="url(#alo-arr)"/>
  <text x="470" y="210" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">OK → proceed</text>
  <!-- 6: validate + write geometry -->
  <line x1="395" y1="252" x2="681" y2="252" stroke="currentColor" stroke-width="1.5" opacity="0.6" marker-end="url(#alo-arr)"/>
  <text x="538" y="246" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">validate + write geometry</text>
  <!-- 7: DLQ on exhaustion -->
  <line x1="395" y1="300" x2="681" y2="300" stroke="currentColor" stroke-width="1.5" opacity="0.6" stroke-dasharray="5,3" marker-end="url(#alo-arr)"/>
  <text x="538" y="294" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">route to DLQ after MAX_RETRIES</text>
  <!-- 8: delete key for replay -->
  <line x1="395" y1="334" x2="541" y2="334" stroke="currentColor" stroke-width="1.5" opacity="0.55" stroke-dasharray="3,3" marker-end="url(#alo-arr)"/>
  <text x="470" y="328" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.7">DEL key → allow replay</text>
</svg>
<figcaption><b>Figure 1.</b> At-least-once delivery flow for a GIS webhook</figcaption>
</figure>

## When to use this pattern

<figure class="fig">
<svg viewBox="0 0 760 224" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Acknowledging before processing versus after, and which failure each ordering produces">
<title>Acknowledge after the write, never before</title>
<desc>A consumer takes an event from the broker and must choose when to acknowledge. Acknowledging first and then processing gives at-most-once delivery: if the worker crashes between the acknowledgement and the PostGIS commit, the broker considers the event delivered and never redelivers it, so a sensor reading is silently lost with nothing to indicate it existed. Acknowledging after the commit gives at-least-once: a crash before the acknowledgement means the broker redelivers, so the event is processed a second time — visible, bounded, and made harmless by the idempotency key, which recognises the redelivery and short-circuits. The two orderings are not equally recoverable. A duplicate can be absorbed by a key you already have; a loss cannot be detected at all, because nothing in the system retains a record that the event was ever received.</desc>
<rect x="0" y="0" width="760" height="224" fill="var(--fig-bg)"/>
<defs><marker id="ao-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-rose-edge)">ack → process = at-most-once</text>
<rect x="14" y="30" width="130" height="30" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="79" y="49" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">receive</text>
<line x1="146" y1="45" x2="170" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#ao-a)"/>
<rect x="174" y="30" width="130" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="239" y="49" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">ACK</text>
<line x1="306" y1="45" x2="330" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#ao-a)"/>
<rect x="334" y="30" width="130" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5" stroke-dasharray="4,3"/>
<text x="399" y="49" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">crash before commit</text>
<line x1="466" y1="45" x2="490" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#ao-a)"/>
<rect x="494" y="30" width="252" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="506" y="49" font-size="8.5" font-weight="600" fill="var(--fig-ink)">reading lost — never redelivered, never logged</text>
<line x1="14" y1="78" x2="746" y2="78" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="98" font-size="10.5" font-weight="600" fill="var(--fig-mint-edge)">process → ack = at-least-once</text>
<rect x="14" y="108" width="130" height="30" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="79" y="127" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">receive</text>
<line x1="146" y1="123" x2="170" y2="123" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#ao-a)"/>
<rect x="174" y="108" width="130" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="239" y="127" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">claim key + commit</text>
<line x1="306" y1="123" x2="330" y2="123" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#ao-a)"/>
<rect x="334" y="108" width="130" height="30" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4" stroke-dasharray="4,3"/>
<text x="399" y="127" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">crash before ACK</text>
<line x1="466" y1="123" x2="490" y2="123" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#ao-a)"/>
<rect x="494" y="108" width="252" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="506" y="127" font-size="8.5" font-weight="600" fill="var(--fig-ink)">redelivered — key already claimed, no-op</text>
<rect x="14" y="158" width="732" height="56" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="26" y="176" font-size="10" font-weight="600" fill="var(--fig-ink)">The two failure modes are not equally recoverable</text>
<text x="26" y="194" font-size="9" fill="var(--fig-ink-soft)">A duplicate is visible, bounded, and absorbed by a key you already maintain. A loss leaves nothing behind — no row, no offset, no log line —</text>
<text x="26" y="207" font-size="9" fill="var(--fig-ink-soft)">so it cannot be detected, let alone repaired. That asymmetry is the whole argument for at-least-once plus idempotency.</text>
</svg>
<figcaption><b>Figure 2.</b> Both orderings lose something on a crash; only one loses something you can find afterwards. Acknowledgement order is where a pipeline actually chooses its delivery guarantee.</figcaption>
</figure>

At-least-once delivery with explicit idempotency enforcement is the right choice when:

- **Your upstream cannot guarantee deduplication.** Third-party GIS platforms (ArcGIS Online, Mapbox, Felt) resend events on connection timeout without a built-in deduplication protocol, so your receiver owns the duplicate-suppression contract.
- **Spatial processing is expensive but not strictly transactional.** Writing to PostGIS, updating routing graphs, or invalidating tile caches can tolerate an occasional redundant attempt, but silently processing the same coordinate update twice corrupts spatial indexes and inflates metric counters.
- **Network partitions are more likely than message loss.** Ephemeral network errors cause retries; at-least-once matches that failure model and avoids the overhead of distributed transactions that exactly-once requires.

When you need true exactly-once semantics — for example, financial transactions tied to a geographic asset — pair this pattern with a two-phase commit or use a broker (Kafka with `enable.idempotence=true`) that provides exactly-once at the protocol level.

## Complete runnable implementation

The following self-contained FastAPI application implements every component: immediate acknowledgment, coordinate-normalized idempotency key derivation, atomic Redis deduplication, bounded exponential backoff with full jitter, and dead-letter routing. Swap the `# SPATIAL PROCESSING` block for your actual PostGIS write, shapely validation, or tile cache invalidation call.

```python
"""
at_least_once_gis.py — Production at-least-once GIS webhook receiver.

Dependencies: fastapi, uvicorn, redis[asyncio], shapely, pyproj, pydantic
"""

import asyncio
import hashlib
import json
import logging
import math
import random
from typing import Any

import redis.asyncio as aioredis
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from pydantic import BaseModel, field_validator
from shapely.geometry import shape
from shapely.validation import explain_validity

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
IDEMPOTENCY_TTL_SECONDS = 86_400        # 24-hour retention for processed keys
DLQ_TTL_SECONDS = 604_800              # 7-day retention for dead-letter entries
MAX_RETRIES = 5
BASE_BACKOFF_SECONDS = 2.0
COORDINATE_PRECISION = 6               # ~11 cm; sufficient for all GIS use-cases

app = FastAPI(title="GIS Webhook Receiver")
redis_client = aioredis.Redis(host="localhost", port=6379, db=0, decode_responses=True)
logger = logging.getLogger("gis.at_least_once")

# ---------------------------------------------------------------------------
# Payload schema (GeoJSON Feature, strict)
# ---------------------------------------------------------------------------
class GeoJSONFeaturePayload(BaseModel):
    """Minimal GeoJSON Feature schema for webhook ingestion."""
    type: str
    geometry: dict[str, Any]
    properties: dict[str, Any] | None = None

    @field_validator("type")
    @classmethod
    def must_be_feature(cls, v: str) -> str:
        if v != "Feature":
            raise ValueError(f"Expected GeoJSON 'Feature', got '{v}'")
        return v

# ---------------------------------------------------------------------------
# Idempotency key derivation
# ---------------------------------------------------------------------------
def _round_coordinates(obj: Any) -> Any:
    """Recursively round all floats to COORDINATE_PRECISION decimal places.

    Floating-point serialization varies across sender libraries — 40.7128 and
    40.712800000001 are geographically identical but produce different SHA-256
    hashes. Rounding before hashing ensures duplicate payloads yield the same key.
    """
    if isinstance(obj, float):
        return round(obj, COORDINATE_PRECISION)
    if isinstance(obj, list):
        return [_round_coordinates(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _round_coordinates(v) for k, v in sorted(obj.items())}
    return obj

def derive_idempotency_key(payload: dict[str, Any], event_id: str | None) -> str:
    """Return a Redis key that uniquely identifies this spatial event.

    Priority:
    1. X-Event-ID or Idempotency-Key header (sender-assigned, most reliable).
    2. SHA-256 hash of the coordinate-normalized, key-sorted payload JSON
       (used when the sender provides no event identifier).
    """
    if event_id:
        return f"idemp:{event_id}"

    normalized = json.dumps(_round_coordinates(payload), sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(normalized.encode()).hexdigest()
    return f"idemp:{digest}"

# ---------------------------------------------------------------------------
# Backoff strategy
# ---------------------------------------------------------------------------
def full_jitter_backoff(attempt: int) -> float:
    """Full jitter: uniform sample in [0, min(cap, base * 2^attempt)].

    Full jitter outperforms equal-jitter and decorrelated jitter at preventing
    thundering-herd problems when many retrying workers recover simultaneously
    after a PostGIS or network outage.
    """
    cap = 60.0
    ceiling = min(cap, BASE_BACKOFF_SECONDS * math.pow(2, attempt))
    return random.uniform(0.0, ceiling)

# ---------------------------------------------------------------------------
# Geometry validation
# ---------------------------------------------------------------------------
def validate_geometry(geometry_dict: dict[str, Any]) -> None:
    """Raise ValueError for invalid or degenerate geometries before any DB write.

    Inserting an invalid polygon into PostGIS can corrupt spatial indexes and
    cause ST_Intersects / ST_Contains queries to return wrong results indefinitely.
    Validate with shapely before the geometry touches any spatial store.
    """
    try:
        geom = shape(geometry_dict)
    except Exception as exc:
        raise ValueError(f"Cannot parse geometry: {exc}") from exc

    if not geom.is_valid:
        raise ValueError(f"Invalid geometry: {explain_validity(geom)}")

    if geom.is_empty:
        raise ValueError("Geometry is empty — zero-area or zero-length feature rejected")

# ---------------------------------------------------------------------------
# Background worker
# ---------------------------------------------------------------------------
async def process_spatial_event(payload: dict[str, Any], event_id: str | None) -> None:
    """Deduplication + bounded-retry spatial processor.

    1. Derive the idempotency key.
    2. Atomic SET NX EX — skip immediately if key already exists (duplicate).
    3. Validate geometry before any spatial write.
    4. Attempt processing with exponential backoff and full jitter.
    5. On exhaustion, route to the dead-letter queue and release the key so
       manual replay is possible.
    """
    key = derive_idempotency_key(payload, event_id)

    # Atomic check-and-set: only ONE worker proceeds per unique event
    acquired = await redis_client.set(key, "processing", nx=True, ex=IDEMPOTENCY_TTL_SECONDS)
    if not acquired:
        logger.info("Duplicate spatial event skipped: %s", key)
        return

    # Validate geometry once, outside the retry loop — malformed geometries
    # will not succeed on retry, so fail fast and route directly to DLQ.
    try:
        validate_geometry(payload.get("geometry", {}))
    except ValueError as exc:
        logger.error("Geometry validation failed for %s: %s — routing to DLQ", key, exc)
        dlq_key = f"dlq:{key}"
        dlq_value = json.dumps({"payload": payload, "error": str(exc), "retries": 0})
        await redis_client.set(dlq_key, dlq_value, ex=DLQ_TTL_SECONDS)
        await redis_client.delete(key)
        return

    for attempt in range(MAX_RETRIES):
        try:
            # -------------------------------------------------------------------
            # SPATIAL PROCESSING — replace with your actual implementation:
            #   - asyncpg INSERT to PostGIS with ST_GeomFromGeoJSON
            #   - Shapely-based topology merge
            #   - Tile cache invalidation via HTTP to your tile server
            #   - Routing graph update in Neo4j / pgRouting
            # -------------------------------------------------------------------
            await asyncio.sleep(0.0)  # Remove; placeholder for real async call
            logger.info("Spatial event processed successfully: %s", key)
            return  # Success — idempotency key remains set in Redis as proof

        except Exception as exc:
            wait = full_jitter_backoff(attempt)
            logger.warning(
                "Attempt %d/%d failed for %s — retrying in %.2fs. Error: %s",
                attempt + 1, MAX_RETRIES, key, wait, exc,
            )
            await asyncio.sleep(wait)

    # Retries exhausted — move to dead-letter queue
    logger.error("Event %s exhausted %d retries. Routing to DLQ.", key, MAX_RETRIES)
    dlq_key = f"dlq:{key}"
    dlq_value = json.dumps({"payload": payload, "retries": MAX_RETRIES})
    await redis_client.set(dlq_key, dlq_value, ex=DLQ_TTL_SECONDS)

    # Delete processing key so the event can be replayed manually via DLQ consumer
    await redis_client.delete(key)

# ---------------------------------------------------------------------------
# HTTP endpoint
# ---------------------------------------------------------------------------
@app.post("/webhooks/gis", status_code=200)
async def receive_gis_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict[str, str]:
    """Accept a GeoJSON Feature webhook and acknowledge before processing.

    The immediate 200 OK stops the sender's retry timer. All spatial work
    happens in the background, decoupled from the HTTP response path.
    """
    try:
        raw = await request.json()
        payload = GeoJSONFeaturePayload(**raw).model_dump()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Schema validation failed: {exc}")

    # Prefer sender-assigned event identifier for stable deduplication
    event_id = (
        request.headers.get("X-Event-ID")
        or request.headers.get("Idempotency-Key")
    )

    background_tasks.add_task(process_spatial_event, payload, event_id)
    return {"status": "accepted"}
```

## Parameter reference

<div style="overflow-x:auto;">

| Parameter | Type | Default | Spatial constraint |
|---|---|---|---|
| `IDEMPOTENCY_TTL_SECONDS` | `int` | `86400` (24 h) | Must exceed your sender's maximum retry window. GIS platform SLAs are typically ≤ 4 h. |
| `DLQ_TTL_SECONDS` | `int` | `604800` (7 d) | Long enough for manual replay; trim after audit to cap storage. |
| `MAX_RETRIES` | `int` | `5` | Beyond 7, downstream degradation is usually structural, not transient. |
| `BASE_BACKOFF_SECONDS` | `float` | `2.0` | Minimum mean wait on first retry. Set higher for PostGIS-heavy writes. |
| `COORDINATE_PRECISION` | `int` | `6` | 6 decimal degrees ≈ 11 cm. Sufficient for all drone/IoT telemetry use-cases. Do not exceed 8 (float64 precision limit). |
| `X-Event-ID` header | `str` | None | Sender-supplied stable UUID. Preferred over hash-based key; eliminates precision ambiguity entirely. |
| `Idempotency-Key` header | `str` | None | Accepted as a fallback when `X-Event-ID` is absent. Same semantics. |

</div>

## Gotchas and spatial edge cases

1. **Coordinate precision drift causes missed duplicates.** Two payloads representing the same sensor ping may serialize `longitude` as `13.404954` and `13.4049540000001` depending on the sender's JSON library. Without `_round_coordinates()`, the SHA-256 hash differs and both events are processed, producing a duplicate PostGIS row. Always normalize to 6 decimal places before hashing.

2. **CRS ambiguity poisons the idempotency key.** If one delivery of an event declares `"crs": {"init": "epsg:4326"}` and a retry omits the CRS field entirely (a common GeoJSON spec violation), the hash will differ and the duplicate will slip through. Normalize the CRS field to a canonical EPSG:4326 declaration — or strip it, since GeoJSON RFC 7946 mandates WGS 84 — before hashing.

<figure class="fig">
<svg viewBox="0 0 760 224" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The same sensor ping delivered twice with differing CRS declarations, producing two idempotency keys until the field is normalised">
<title>An optional field that changes between deliveries breaks the key</title>
<desc>A sensor ping is delivered, times out, and is retried. The first delivery carries a legacy crs member with an init dictionary; the retry omits the crs member entirely, which is what RFC 7946 actually requires since GeoJSON is defined to be WGS 84. Both describe exactly the same point in exactly the same coordinate system, but the canonical strings differ, so the hashes differ and the idempotency gate admits the retry as a new event, writing a duplicate PostGIS row. The fix is to make the field's presence irrelevant before hashing: either strip the crs member entirely, which RFC 7946 permits because the projection is fixed by the spec, or normalise every variant to one canonical declaration. Stripping is preferable because it removes a degree of freedom rather than agreeing on one, and any field a sender may or may not include has to be treated this way, not just this one.</desc>
<rect x="0" y="0" width="760" height="224" fill="var(--fig-bg)"/>
<defs><marker id="ak-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="30" width="300" height="46" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="26" y="48" font-size="8.5" font-weight="600" fill="var(--fig-ink)">delivery 1</text>
<text x="26" y="63" font-size="8.5" font-family="monospace" fill="var(--fig-ink-soft)">"crs": {"init": "epsg:4326"}, "coordinates": […]</text>
<rect x="14" y="84" width="300" height="46" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="26" y="102" font-size="8.5" font-weight="600" fill="var(--fig-ink)">delivery 2 — the retry</text>
<text x="26" y="117" font-size="8.5" font-family="monospace" fill="var(--fig-ink-soft)">"coordinates": […]   ← no crs member at all</text>
<line x1="318" y1="80" x2="350" y2="80" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#ak-a)"/>
<rect x="354" y="52" width="180" height="56" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="444" y="72" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink)">two hashes</text>
<text x="444" y="88" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">9f2c1a… and 41ba6d…</text>
<text x="444" y="101" text-anchor="middle" font-size="8.5" fill="var(--fig-rose-edge)">gate admits both</text>
<line x1="538" y1="80" x2="570" y2="80" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#ak-a)"/>
<rect x="574" y="52" width="172" height="56" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="660" y="78" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink)">duplicate row</text>
<text x="660" y="94" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">same ping, written twice</text>
<text x="26" y="148" font-size="9" fill="var(--fig-ink-soft)">Both payloads describe the same point in the same coordinate system. Only the optional declaration differs —</text>
<text x="26" y="158" font-size="9" fill="var(--fig-ink-soft)">and RFC 7946 says the second form is the correct one.</text>
<rect x="14" y="164" width="366" height="52" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="182" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Strip it — preferred</text>
<text x="26" y="198" font-size="9" fill="var(--fig-ink-soft)">RFC 7946 fixes the projection, so the field carries no</text>
<text x="26" y="210" font-size="9" fill="var(--fig-ink-soft)">information. Removing it removes a degree of freedom.</text>
<rect x="394" y="164" width="352" height="52" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="406" y="182" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Normalise it — acceptable</text>
<text x="406" y="198" font-size="9" fill="var(--fig-ink-soft)">Every variant maps to one canonical declaration. Works,</text>
<text x="406" y="210" font-size="9" fill="var(--fig-ink-soft)">but you must enumerate the variants you have seen.</text>
</svg>
<figcaption><b>Figure 3.</b> Any field a sender <em>may</em> include is a field that will differ between a delivery and its retry. The rule generalises past <code>crs</code>: canonicalisation has to remove optionality, not just formatting.</figcaption>
</figure>

3. **Ring orientation flips on re-serialization.** Some spatial libraries (Turf.js, GDAL) may flip polygon exterior ring winding order between the original event and a retry. `_round_coordinates()` does not protect against this because the coordinate values are identical; the list order differs. Normalize ring orientation (right-hand rule per RFC 7946) with `shapely.geometry.mapping(orient(shape(geometry), sign=1.0))` before computing the hash, and apply this using [geometry validation pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/).

4. **Atomic `SET NX` is not cluster-safe without Redlock.** A single Redis instance provides true atomic `SET NX EX`. Across a Redis Cluster or Sentinel setup, `SET NX` is node-local — two workers may simultaneously acquire the key on different shards and both proceed. If your Redis deployment is clustered, either hash-tag your idempotency keys to pin them to a single slot (`{idemp}:hash`) or use a Redlock implementation. See [using Redis to cache spatial webhook signatures](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/) for a Redlock example.

5. **Invalid geometries must bypass the retry loop.** A self-intersecting polygon will fail `validate_geometry()` on every attempt. Retrying it wastes budget and delays DLQ routing. The implementation above validates once before entering the retry loop and routes directly to the DLQ on geometry failure — preserving retries for transient infrastructure errors only.

6. **DLQ key deletion enables manual replay.** Deleting the processing key after DLQ routing is intentional: if an operator fixes the downstream system and wants to replay the event, they must not be blocked by a stale `SET NX`. The DLQ entry itself carries full payload and retry count for forensic analysis.

## Minimal verification snippet

Run this against a local instance (`uvicorn at_least_once_gis:app --reload`) with Redis on `localhost:6379`.

```python
"""
test_at_least_once.py — Verify idempotency and DLQ routing end-to-end.

Run: pytest test_at_least_once.py -v
"""

import asyncio
import hashlib
import json
import pytest
import redis.asyncio as aioredis

from at_least_once_gis import (
    COORDINATE_PRECISION,
    derive_idempotency_key,
    full_jitter_backoff,
    validate_geometry,
    _round_coordinates,
)

# ---------------------------------------------------------------------------
# Unit: idempotency key stability
# ---------------------------------------------------------------------------
def test_coordinate_rounding_produces_stable_key():
    """Two payloads differing only in float noise must yield the same key."""
    payload_a = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [13.404954, 52.520008]},
        "properties": {},
    }
    payload_b = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [13.4049540000001, 52.5200080000001]},
        "properties": {},
    }
    key_a = derive_idempotency_key(payload_a, None)
    key_b = derive_idempotency_key(payload_b, None)
    assert key_a == key_b, "Coordinate noise must not produce distinct idempotency keys"

def test_event_id_header_takes_priority():
    """When X-Event-ID is provided it overrides the hash-based key."""
    payload = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}}
    key = derive_idempotency_key(payload, "evt-abc-123")
    assert key == "idemp:evt-abc-123"

# ---------------------------------------------------------------------------
# Unit: geometry validation
# ---------------------------------------------------------------------------
def test_valid_point_passes():
    validate_geometry({"type": "Point", "coordinates": [13.4050, 52.5200]})  # no exception

def test_self_intersecting_polygon_rejected():
    # Bowtie polygon — invalid topology
    bowtie = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]],
    }
    with pytest.raises(ValueError, match="Invalid geometry"):
        validate_geometry(bowtie)

def test_empty_geometry_rejected():
    from shapely.wkt import loads
    # Pass an empty geometry dict (missing type)
    with pytest.raises((ValueError, KeyError)):
        validate_geometry({})

# ---------------------------------------------------------------------------
# Unit: backoff stays within bounds
# ---------------------------------------------------------------------------
def test_backoff_never_exceeds_cap():
    for attempt in range(20):
        assert full_jitter_backoff(attempt) <= 60.0

def test_backoff_is_non_negative():
    for attempt in range(10):
        assert full_jitter_backoff(attempt) >= 0.0

# ---------------------------------------------------------------------------
# Integration: duplicate suppression via Redis
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_duplicate_event_suppressed():
    """Second call with the same key must be a no-op (key already set)."""
    r = aioredis.Redis(host="localhost", port=6379, db=15, decode_responses=True)
    key = "idemp:test-dedup-001"
    await r.delete(key)

    first = await r.set(key, "processing", nx=True, ex=60)
    second = await r.set(key, "processing", nx=True, ex=60)

    assert first is True,  "First acquisition must succeed"
    assert second is None, "Duplicate acquisition must be rejected by SET NX"

    await r.delete(key)
    await r.aclose()
```

The idempotency and geometry-validation unit tests run without a live Redis instance. Mark the integration test with `@pytest.mark.asyncio` and ensure `pytest-asyncio` is installed (`pip install pytest-asyncio`).

---

## Related

- [Sensor Data Routing Patterns](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/) — parent section covering queue topology, geographic partitioning, and fan-out strategies for IoT and drone telemetry
- [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — detailed treatment of hash strategies, H3-cell keying, and TTL selection for spatial idempotency stores
- [Using Redis to Cache Spatial Webhook Signatures](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/) — Redlock and cluster-safe patterns for high-availability deduplication
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — topology checks, ring orientation normalization, and CRS validation before spatial writes
- [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/) — the architectural principles underpinning every spatial event pipeline on this site
