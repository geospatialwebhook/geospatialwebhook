---
title: "Webhook Security Boundaries for Spatial Event Pipelines"
description: "Harden geospatial webhook ingress: HMAC-SHA256 signature verification, region-scoped rate limiting, token validation, and idempotent delivery in Python."
slug: "webhook-security-boundaries"
type: "cluster"
breadcrumb: "Core Event Fundamentals & Architecture → Webhook Security Boundaries"
datePublished: "2024-11-01"
dateModified: "2026-06-24"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Webhook Security Boundaries for Spatial Event Pipelines",
      "description": "Harden geospatial webhook ingress with HMAC-SHA256 signature verification, region-scoped rate limiting, context-bound token validation, and idempotent delivery — step-by-step Python implementation.",
      "datePublished": "2024-11-01",
      "dateModified": "2026-06-24",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Core Event Fundamentals & Architecture", "item": "https://geospatialwebhook.com/core-event-fundamentals-architecture/"},
        {"@type": "ListItem", "position": 3, "name": "Webhook Security Boundaries", "item": "https://geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Secure Spatial Webhook Ingress in Python",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Isolate ingress and enforce context validation"},
        {"@type": "HowToStep", "position": 2, "name": "Verify HMAC-SHA256 payload signatures"},
        {"@type": "HowToStep", "position": 3, "name": "Apply region-scoped rate limiting"},
        {"@type": "HowToStep", "position": 4, "name": "Validate context-bound tokens and enforce idempotency"},
        {"@type": "HowToStep", "position": 5, "name": "Route asynchronously with delivery guarantees"},
        {"@type": "HowToStep", "position": 6, "name": "Verify the pipeline end-to-end"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does HMAC signature verification fail behind a reverse proxy?",
          "acceptedAnswer": {"@type": "Answer", "text": "Proxies often normalize request bodies by stripping trailing whitespace or re-encoding characters. HMAC signs the exact raw bytes, so any modification breaks the digest. Read the raw body before middleware parses it and disable body normalization in NGINX or Caddy."}
        },
        {
          "@type": "Question",
          "name": "Should I use IP allowlisting or HMAC for spatial webhooks?",
          "acceptedAnswer": {"@type": "Answer", "text": "Use both as defence-in-depth layers. IP allowlisting stops unauthenticated traffic at the network edge; HMAC verification proves the payload was not tampered with in transit. Neither alone is sufficient for high-value coordinate data."}
        },
        {
          "@type": "Question",
          "name": "How do I rate-limit by geographic region rather than by IP?",
          "acceptedAnswer": {"@type": "Answer", "text": "Key your Redis counters to a verified spatial partition identifier embedded in the webhook header — for example an H3 index at resolution 5 — rather than the client IP. This accommodates IoT gateways that legitimately emit high-frequency telemetry from a dense urban area while staying within burst limits for rural regions."}
        },
        {
          "@type": "Question",
          "name": "How long should idempotency keys be cached?",
          "acceptedAnswer": {"@type": "Answer", "text": "Cache idempotency keys for at least as long as your message broker's maximum redelivery window, typically 24–72 hours. Set Redis TTLs with SET NX EX so the key expires automatically. Spatial pipelines that fan out to tile caches or spatial indices are especially vulnerable to duplicate side-effects."}
        }
      ]
    }
  ]
}
</script>

**Spatial webhook ingress must be treated as a hardened security perimeter: verify every HMAC signature, enforce region-scoped rate limits, validate context-bound tokens, and reject duplicate deliveries before a single coordinate reaches your processing pipeline.**

This page is part of [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/), the architectural foundation for Python-based geospatial event pipelines.

---

## Prerequisites

- [ ] Python 3.10+ with `fastapi`, `uvicorn`, `pydantic`, and `httpx` installed
- [ ] Redis 6.2+ available for distributed rate limiting and idempotency key storage
- [ ] `shapely` 2.0+, `pyproj` 3.4+, and `geojson` 3.0+ for geometry validation and CRS alignment
- [ ] A message broker (Kafka, RabbitMQ, or AWS EventBridge) for async downstream routing
- [ ] `hmac` and `hashlib` from the Python standard library — no additional install required
- [ ] Reverse proxy (NGINX or Caddy) configured for TLS 1.3 termination with raw body pass-through

---

## Architecture: Four Security Layers

The diagram below shows data moving from an upstream spatial mutation through four mandatory checkpoints before any coordinate enters your processing pipeline.

<svg viewBox="0 0 720 400" role="img" aria-label="Four-layer webhook security boundary diagram" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:720px;height:auto;display:block;margin:1.5rem auto;">
  <title>Webhook Security Boundaries — Four-Layer Architecture</title>
  <desc>A spatial mutation event passes through four sequential security layers: TLS + ingress isolation, HMAC signature verification, region-scoped rate limiting, and token validation + idempotency check, before being dispatched asynchronously to a message broker.</desc>
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>

  <!-- Background layers -->
  <rect x="10" y="10" width="700" height="380" rx="12" fill="none" stroke="currentColor" stroke-opacity="0.12" stroke-width="1.5"/>

  <!-- Upstream source -->
  <rect x="30" y="165" width="110" height="70" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5" stroke-dasharray="5,3"/>
  <text x="85" y="196" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75" font-family="sans-serif">Spatial</text>
  <text x="85" y="211" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75" font-family="sans-serif">Mutation</text>
  <text x="85" y="226" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5" font-family="sans-serif">(SDK / IoT / GIS)</text>

  <!-- Arrow 1 -->
  <line x1="140" y1="200" x2="168" y2="200" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- Layer 1: TLS + Ingress -->
  <rect x="170" y="130" width="120" height="140" rx="8" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="230" y="158" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.55" font-family="sans-serif" font-weight="bold">LAYER 1</text>
  <text x="230" y="176" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-family="sans-serif">TLS 1.3</text>
  <text x="230" y="194" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-family="sans-serif">Ingress</text>
  <text x="230" y="212" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-family="sans-serif">Isolation</text>
  <text x="230" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5" font-family="sans-serif">/webhooks/v1/*</text>
  <text x="230" y="252" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5" font-family="sans-serif">JSON schema check</text>

  <!-- Arrow 2 -->
  <line x1="290" y1="200" x2="318" y2="200" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- Layer 2: HMAC -->
  <rect x="320" y="130" width="120" height="140" rx="8" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="380" y="158" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.55" font-family="sans-serif" font-weight="bold">LAYER 2</text>
  <text x="380" y="176" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-family="sans-serif">HMAC-SHA256</text>
  <text x="380" y="194" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-family="sans-serif">Signature</text>
  <text x="380" y="212" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-family="sans-serif">Verification</text>
  <text x="380" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5" font-family="sans-serif">raw-body digest</text>
  <text x="380" y="252" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5" font-family="sans-serif">timestamp window</text>

  <!-- Arrow 3 -->
  <line x1="440" y1="200" x2="468" y2="200" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- Layer 3: Rate limit -->
  <rect x="470" y="130" width="120" height="140" rx="8" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="530" y="158" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.55" font-family="sans-serif" font-weight="bold">LAYER 3</text>
  <text x="530" y="176" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-family="sans-serif">Region-Scoped</text>
  <text x="530" y="194" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-family="sans-serif">Rate Limit</text>
  <text x="530" y="212" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85" font-family="sans-serif">+ Token Auth</text>
  <text x="530" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5" font-family="sans-serif">H3 partition key</text>
  <text x="530" y="252" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5" font-family="sans-serif">idempotency check</text>

  <!-- Arrow 4 -->
  <line x1="590" y1="200" x2="618" y2="200" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- Downstream -->
  <rect x="620" y="165" width="80" height="70" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5" stroke-dasharray="5,3"/>
  <text x="660" y="196" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75" font-family="sans-serif">Message</text>
  <text x="660" y="211" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75" font-family="sans-serif">Broker</text>
  <text x="660" y="226" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5" font-family="sans-serif">202 Accepted</text>

  <!-- Reject arrows going down -->
  <line x1="230" y1="270" x2="230" y2="340" stroke="currentColor" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="4,2" marker-end="url(#arrow)"/>
  <line x1="380" y1="270" x2="380" y2="340" stroke="currentColor" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="4,2" marker-end="url(#arrow)"/>
  <line x1="530" y1="270" x2="530" y2="340" stroke="currentColor" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="4,2" marker-end="url(#arrow)"/>

  <text x="230" y="365" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.45" font-family="sans-serif">400 Bad Request</text>
  <text x="380" y="365" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.45" font-family="sans-serif">401 Unauthorized</text>
  <text x="530" y="365" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.45" font-family="sans-serif">429 / 409 Conflict</text>

  <!-- Label at top -->
  <text x="360" y="48" text-anchor="middle" font-size="13" fill="currentColor" opacity="0.7" font-family="sans-serif" font-weight="bold">Spatial Webhook Security Boundary</text>
  <text x="360" y="68" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.45" font-family="sans-serif">Each layer rejects independently — failed events never reach the broker</text>
</svg>

**Layer 1** handles network-level concerns: TLS termination, dedicated path isolation, and payload schema validation. **Layer 2** performs cryptographic proof that the payload is authentic and recent. **Layer 3** protects downstream capacity with geographic partitioning. Events that survive all three layers are dispatched to the broker with a `202 Accepted` response.

---

## Step-by-Step Implementation

### Step 1 — Isolate Ingress and Validate Spatial Schema

Webhook endpoints must never share routing tables with public REST or GraphQL APIs. Assign dedicated, versioned paths per event domain: `/webhooks/v1/features`, `/webhooks/v1/tiles`, `/webhooks/v1/sensors`. This enables targeted WAF rules, independent rate limits, and isolated logging.

Validate incoming payloads against strict Pydantic schemas before any business logic executes. When receiving [feature change triggers](/core-event-fundamentals-architecture/feature-change-triggers/), enforce bounding box constraints and reject payloads with self-intersecting polygons or unsupported coordinate reference systems. Normalize all coordinates to WGS84 (EPSG:4326) at the edge, following the coordinate ordering rules in [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946).

```python
from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel, field_validator
from shapely.geometry import shape
from shapely.validation import make_valid

app = FastAPI()


class SpatialWebhookPayload(BaseModel):
    event_id: str
    event_type: str
    geometry: dict
    region_id: str  # H3 index or S2 cell from upstream SDK
    timestamp: int  # Unix epoch seconds

    @field_validator("geometry")
    @classmethod
    def validate_and_normalize(cls, v: dict) -> dict:
        try:
            geom = shape(v)
        except Exception as exc:
            raise ValueError(f"Cannot parse geometry: {exc}") from exc

        if not geom.is_valid:
            geom = make_valid(geom)

        # Enforce WGS84 bounds (EPSG:4326): lon ∈ [-180, 180], lat ∈ [-90, 90]
        minx, miny, maxx, maxy = geom.bounds
        if not (-180 <= minx <= maxx <= 180 and -90 <= miny <= maxy <= 90):
            raise ValueError(
                f"Coordinates outside WGS84 (EPSG:4326) bounds: "
                f"lon=[{minx}, {maxx}], lat=[{miny}, {maxy}]"
            )
        return geom.__geo_interface__


@app.post("/webhooks/v1/features", status_code=202)
async def receive_feature_event(request: Request) -> dict:
    raw_body = await request.body()
    # Raw body is preserved here — signature verification reads it in Step 2
    # before Pydantic parses and normalizes the geometry
    return {"status": "accepted"}
```

Returning `202 Accepted` signals to the upstream sender that the payload was received. Processing happens asynchronously — never synchronously inside the HTTP handler.

### Step 2 — Verify HMAC-SHA256 Payload Signatures

Never trust request bodies even when TLS is enforced. Implement HMAC-SHA256 signature verification using a shared secret rotated via your key management system. The signature covers the exact raw payload bytes including any whitespace; a proxy that normalizes line endings will break verification.

Use Python's built-in `hmac.compare_digest` to prevent timing-oracle attacks. Standard equality (`==`) is forbidden for cryptographic comparison, as the [Python `hmac` documentation](https://docs.python.org/3/library/hmac.html) explicitly warns. Reject requests whose timestamp header drifts beyond five minutes to block replay attacks.

```python
import hmac
import hashlib
import time
from fastapi import Header, HTTPException


WEBHOOK_SECRET = "your-secret-rotated-via-kms"
TIMESTAMP_TOLERANCE_SECONDS = 300  # ±5 minutes


def verify_spatial_signature(
    raw_body: bytes,
    signature_header: str,
    timestamp_header: str,
) -> None:
    """Raises HTTPException if signature or timestamp is invalid."""
    # 1. Reject stale requests before computing the digest
    try:
        event_ts = int(timestamp_header)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=401, detail="Missing or invalid timestamp") from exc

    drift = abs(time.time() - event_ts)
    if drift > TIMESTAMP_TOLERANCE_SECONDS:
        raise HTTPException(
            status_code=401,
            detail=f"Timestamp drift {drift:.0f}s exceeds {TIMESTAMP_TOLERANCE_SECONDS}s window",
        )

    # 2. Compute expected digest over raw bytes — not the parsed JSON
    expected = hmac.new(
        WEBHOOK_SECRET.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    # 3. Constant-time comparison prevents timing-oracle attacks
    if not hmac.compare_digest(f"sha256={expected}", signature_header):
        raise HTTPException(status_code=401, detail="Signature mismatch")
```

Key rotation is handled by validating against two secrets in parallel during the rotation window: compute both digests and accept the request if either matches. This eliminates downtime during secret rotation.

### Step 3 — Apply Region-Scoped Rate Limiting

Generic IP-based rate limiting fails in spatial architectures. A single IoT gateway legitimately emits thousands of events per minute from a dense urban corridor while remaining idle in rural zones. Key your Redis sliding-window counters to a verified spatial partition identifier — such as an H3 hexagon index or S2 cell token — rather than the client IP.

For spatially aware delivery patterns, the [sensor data routing patterns](/core-event-fundamentals-architecture/sensor-data-routing-patterns/) page covers how to assign region identifiers from IoT sources before they reach your webhook endpoint.

```python
import redis
import time
from fastapi import HTTPException

redis_client = redis.Redis(host="localhost", port=6379, decode_responses=True)

REGION_RATE_LIMIT = 500     # max events per window
RATE_WINDOW_SECONDS = 60    # sliding window size


def enforce_region_rate_limit(region_id: str) -> None:
    """
    Sliding-window rate limit keyed to a geographic partition (H3 / S2 cell).
    Uses a Redis counter with a TTL matching the window size.
    """
    window_slot = int(time.time() // RATE_WINDOW_SECONDS)
    key = f"ratelimit:{region_id}:{window_slot}"

    # Atomic increment: returns the new counter value
    count = redis_client.incr(key)
    if count == 1:
        # First event in this window — set expiry so the key self-cleans
        redis_client.expire(key, RATE_WINDOW_SECONDS)

    if count > REGION_RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            headers={
                "Retry-After": str(RATE_WINDOW_SECONDS - (int(time.time()) % RATE_WINDOW_SECONDS)),
                "X-Spatial-Partition": region_id,
            },
            detail=f"Rate limit exceeded for region {region_id}",
        )
```

The `Retry-After` header tells upstream clients exactly how many seconds remain in the current window. The `X-Spatial-Partition` identifier allows the upstream SDK to route excess telemetry to a secondary endpoint or buffer locally.

### Step 4 — Validate Context-Bound Tokens and Enforce Idempotency

Authentication tokens for spatial webhooks must be scoped to specific event types, geographic partitions, and expiration windows. Long-lived API keys in webhook configurations are a significant security liability: rotate to short-lived, context-bound tokens that embed region claims and permitted event schemas. The full signing pattern is detailed in [securing webhook endpoints with spatial token validation](/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/).

Pair token validation with strict idempotency enforcement. Spatial systems frequently experience duplicate deliveries due to network retries, load balancer failovers, or broker redelivery after a consumer crash. Generate a deterministic idempotency key from the event ID and verified spatial partition, then cache it in Redis. For the canonical approach to building these keys, follow [event key generation for spatial data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/).

```python
import hashlib
from fastapi import HTTPException


IDEMPOTENCY_TTL_SECONDS = 86_400  # 24 hours — matches broker max redelivery window


def build_idempotency_key(event_id: str, region_id: str) -> str:
    """Deterministic key: same event + region always produces the same key."""
    return hashlib.sha256(f"{event_id}:{region_id}".encode()).hexdigest()


def enforce_idempotency(event_id: str, region_id: str) -> None:
    """
    Atomically mark an event as seen. Raises 409 Conflict for duplicates.
    SET NX EX is atomic — no race condition between check and set.
    """
    key = f"idem:{build_idempotency_key(event_id, region_id)}"
    was_set = redis_client.set(key, "1", nx=True, ex=IDEMPOTENCY_TTL_SECONDS)
    if not was_set:
        raise HTTPException(
            status_code=409,
            detail=f"Duplicate event {event_id} for region {region_id}",
        )
```

The `SET NX EX` operation is atomic: it sets the key only if it does not already exist, eliminating the race condition between checking and writing that plagues two-step check-then-set patterns.

### Step 5 — Route Asynchronously to the Downstream Pipeline

Once a webhook passes all four security layers, dispatch it asynchronously to your message broker. Synchronous processing at the webhook layer introduces latency, blocks connection pools, and increases timeout risk during traffic surges.

For tile regeneration events, route payloads to your [tile update event pipelines](/core-event-fundamentals-architecture/tile-update-event-pipelines/) using partitioned topics keyed by spatial region. For feature mutation events that require CRS re-projection before downstream consumers can act on them, apply [CRS normalization strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/) as part of the async task, not inside the webhook handler.

```python
import asyncio
import json
from fastapi import BackgroundTasks


async def dispatch_to_broker(payload: dict, region_id: str) -> None:
    """
    Publish to a partitioned Kafka topic keyed by region_id.
    Runs outside the HTTP request lifecycle — latency here is invisible to the sender.
    """
    topic = f"spatial.events.{payload['event_type']}"
    message = json.dumps(payload).encode("utf-8")

    # In production, use aiokafka or a producer pool;
    # asyncio.sleep simulates async I/O without a real broker dependency.
    await asyncio.sleep(0)  # yield to event loop
    # producer.send(topic, key=region_id.encode(), value=message)


@app.post("/webhooks/v1/features", status_code=202)
async def receive_feature_event(
    request: Request,
    background_tasks: BackgroundTasks,
    x_hub_signature_256: str = Header(...),
    x_webhook_timestamp: str = Header(...),
    x_spatial_region: str = Header(...),
) -> dict:
    raw_body = await request.body()

    # Security layers execute in order — each raises if invalid
    verify_spatial_signature(raw_body, x_hub_signature_256, x_webhook_timestamp)
    enforce_region_rate_limit(x_spatial_region)

    payload = SpatialWebhookPayload.model_validate_json(raw_body)
    enforce_idempotency(payload.event_id, x_spatial_region)

    background_tasks.add_task(dispatch_to_broker, payload.model_dump(), x_spatial_region)
    return {"status": "accepted", "event_id": payload.event_id}
```

---

## Spatial Validation and Error Handling

Beyond schema validation, spatial webhook handlers must handle geometry edge cases that generic validators miss:

**Coordinate reference system drift.** Upstream SDKs or IoT gateways may silently emit coordinates in EPSG:3857 (Web Mercator) without advertising this. X/Y values above 20,000,000 in absolute terms are a strong signal of EPSG:3857 data masquerading as EPSG:4326. Reject or re-project using `pyproj`:

```python
from pyproj import Transformer

def reproject_if_needed(coords: list[float], source_epsg: int) -> list[float]:
    if source_epsg == 4326:
        return coords
    transformer = Transformer.from_crs(source_epsg, 4326, always_xy=True)
    lon, lat = transformer.transform(coords[0], coords[1])
    return [lon, lat]
```

**Self-intersecting polygons.** A polygon with crossing rings passes JSON schema validation but will corrupt spatial index operations. Call `shapely.validation.make_valid()` and log the original geometry before discarding the malformed version so you can investigate upstream SDK bugs.

**Empty or degenerate geometries.** A `POINT EMPTY` or a `LINESTRING` with a single vertex passes GeoJSON parsing but breaks downstream topology checks. Validate `geom.is_empty` and `len(geom.coords) > 1` before dispatch.

---

## Retry, Backoff, and Delivery Guarantees

Spatial event pipelines sit between at-least-once and exactly-once delivery semantics. The idempotency layer in Step 4 converts at-least-once broker delivery into effectively-once processing, but only when the broker acknowledgment fails after the payload has already been processed. For full at-least-once delivery guarantees from the upstream webhook sender's perspective, see [implementing at-least-once delivery for GIS webhooks](/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/).

When the downstream broker is temporarily unavailable, apply exponential backoff with jitter to avoid thundering herd storms at recovery:

```python
import asyncio
import random


async def dispatch_with_backoff(
    payload: dict,
    region_id: str,
    max_attempts: int = 5,
) -> None:
    """Exponential backoff with ±25% jitter for broker dispatch."""
    base_delay = 0.5  # seconds

    for attempt in range(1, max_attempts + 1):
        try:
            await dispatch_to_broker(payload, region_id)
            return
        except Exception as exc:
            if attempt == max_attempts:
                # Route to dead-letter queue for manual inspection
                await route_to_dead_letter(payload, region_id, str(exc))
                return
            jitter = random.uniform(0.75, 1.25)
            delay = base_delay * (2 ** (attempt - 1)) * jitter
            await asyncio.sleep(delay)


async def route_to_dead_letter(payload: dict, region_id: str, reason: str) -> None:
    """Publish failed payloads to a quarantine topic with full spatial context."""
    dlq_entry = {
        "original_payload": payload,
        "region_id": region_id,
        "failure_reason": reason,
    }
    # dlq_producer.send("spatial.events.dead-letter", value=json.dumps(dlq_entry).encode())
```

For cache-backed idempotency checks that survive broker restarts, the [cache-backed idempotency checks](/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) page covers Redis persistence configuration and TTL strategies in detail.

---

## Verification

Confirm that all four security layers behave correctly with a self-contained pytest suite:

```python
import pytest
import hashlib
import hmac
import time
from fastapi.testclient import TestClient
from app import app  # your FastAPI application module

client = TestClient(app)
SECRET = "your-secret-rotated-via-kms"


def make_valid_headers(raw_body: bytes, region_id: str = "8928308280fffff") -> dict:
    ts = str(int(time.time()))
    digest = hmac.new(SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    return {
        "X-Hub-Signature-256": f"sha256={digest}",
        "X-Webhook-Timestamp": ts,
        "X-Spatial-Region": region_id,
    }


VALID_PAYLOAD = b'{"event_id":"evt-001","event_type":"feature.updated","geometry":{"type":"Point","coordinates":[-122.4194,37.7749]},"region_id":"8928308280fffff","timestamp":' + str(int(time.time())).encode() + b"}"


def test_valid_request_accepted():
    headers = make_valid_headers(VALID_PAYLOAD)
    resp = client.post("/webhooks/v1/features", content=VALID_PAYLOAD, headers=headers)
    assert resp.status_code == 202
    assert resp.json()["event_id"] == "evt-001"


def test_invalid_signature_rejected():
    headers = make_valid_headers(VALID_PAYLOAD)
    headers["X-Hub-Signature-256"] = "sha256=deadbeef"
    resp = client.post("/webhooks/v1/features", content=VALID_PAYLOAD, headers=headers)
    assert resp.status_code == 401


def test_stale_timestamp_rejected():
    stale_ts = str(int(time.time()) - 400)  # 400s ago — beyond the 300s window
    raw = VALID_PAYLOAD
    digest = hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
    headers = {
        "X-Hub-Signature-256": f"sha256={digest}",
        "X-Webhook-Timestamp": stale_ts,
        "X-Spatial-Region": "8928308280fffff",
    }
    resp = client.post("/webhooks/v1/features", content=raw, headers=headers)
    assert resp.status_code == 401


def test_out_of_bounds_geometry_rejected():
    bad_body = b'{"event_id":"evt-002","event_type":"feature.updated","geometry":{"type":"Point","coordinates":[200.0,37.7749]},"region_id":"8928308280fffff","timestamp":' + str(int(time.time())).encode() + b"}"
    headers = make_valid_headers(bad_body)
    resp = client.post("/webhooks/v1/features", content=bad_body, headers=headers)
    assert resp.status_code == 422  # Pydantic validation error
```

Run with `pytest -v test_webhook_security.py`. All four assertions must pass before promoting to production.

---

## Troubleshooting

<div class="table-scroll">

| Symptom | Likely spatial cause | Fix |
|---------|---------------------|-----|
| Signature mismatch on every request | Reverse proxy normalizes body encoding or strips trailing newline | Read raw body before any middleware; set `proxy_request_buffering off` in NGINX |
| CRS drift — coordinates appear in the ocean | Upstream SDK sends EPSG:3857 without metadata | Detect values outside WGS84 bounds and re-project with `pyproj`; reject payloads missing `crs` or `srid` fields |
| Token leakage — webhook URL appears in browser console | Context-bound token embedded in client-side mapping SDK config | Use server-side token vending; issue short-lived tokens scoped to a single region and event type |
| Rate limit bypass from a single dense-area sensor | H3/S2 region ID absent or spoofed in header | Validate region ID against known SDK partition ranges; derive it server-side from the payload geometry when the header is untrusted |
| Duplicate geometry processing after broker restart | Idempotency key TTL shorter than broker redelivery window | Extend Redis TTL to match broker max redelivery window (at least 72 hours for Kafka with default retention) |
| `make_valid()` silently produces MultiPolygon | Self-intersecting ring healed by splitting into parts | Log geometry type before and after healing; alert on type changes so upstream SDK bugs surface quickly |

</div>

---

## FAQ

<details class="faq">
<summary>Why does HMAC signature verification fail behind a reverse proxy?</summary>

Proxies often normalize request bodies by stripping trailing whitespace, converting line endings, or re-encoding certain characters. HMAC signs the exact raw bytes, so any modification breaks the digest. Read the raw body in your FastAPI handler with `await request.body()` before any middleware parses it, and disable body normalization in NGINX (`proxy_request_buffering off`) or Caddy.

</details>

<details class="faq">
<summary>Should I use IP allowlisting or HMAC for spatial webhooks?</summary>

Use both as defence-in-depth layers. IP allowlisting at the WAF or reverse proxy stops unauthenticated traffic before it consumes compute. HMAC verification proves the payload was not tampered with in transit, even if an attacker shares a network with an allowlisted IP. Neither alone is sufficient for webhook endpoints that carry high-value coordinate data.

</details>

<details class="faq">
<summary>How do I rate-limit by geographic region rather than by IP?</summary>

Key your Redis counters to a verified spatial partition identifier embedded in the webhook header — for example an H3 index at resolution 5 or an S2 cell token. Derive this identifier server-side from the payload geometry when the header cannot be trusted. This approach accommodates IoT gateways that legitimately emit high-frequency telemetry from a dense urban area while staying within burst limits for rural regions.

</details>

<details class="faq">
<summary>How long should idempotency keys be cached in Redis?</summary>

Cache idempotency keys for at least as long as your message broker's maximum redelivery window. For Kafka with default retention this is typically 72 hours; for RabbitMQ with manual acknowledgment it may be shorter. Use `SET NX EX` so keys expire automatically and do not accumulate unboundedly. Spatial pipelines that fan out to tile caches or spatial indices are especially vulnerable to duplicate side-effects.

</details>

---

## Related

- [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/) — parent architectural domain covering spatial event design
- [Securing webhook endpoints with spatial token validation](/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/) — context-bound token issuance and validation patterns
- [Event key generation for spatial data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — deterministic idempotency key construction from GeoJSON events
- [Cache-backed idempotency checks](/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) — Redis persistence and TTL strategies for deduplication
- [Sensor data routing patterns](/core-event-fundamentals-architecture/sensor-data-routing-patterns/) — assigning geographic partition identifiers to IoT telemetry
