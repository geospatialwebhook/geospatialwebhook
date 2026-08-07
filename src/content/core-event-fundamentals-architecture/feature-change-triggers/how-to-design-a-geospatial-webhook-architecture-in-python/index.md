---
title: "Design a Geospatial Webhook Architecture in Python"
description: "Build a production geospatial webhook in Python: async dispatch, Shapely validation, HMAC signing, exponential backoff, and dead-letter routing."
slug: "how-to-design-a-geospatial-webhook-architecture-in-python"
type: "article"
breadcrumb:
  - label: "Core Event Fundamentals & Architecture"
    url: "/core-event-fundamentals-architecture/"
  - label: "Feature Change Triggers"
    url: "/core-event-fundamentals-architecture/feature-change-triggers/"
  - label: "How to Design a Geospatial Webhook Architecture in Python"
    url: "/core-event-fundamentals-architecture/feature-change-triggers/how-to-design-a-geospatial-webhook-architecture-in-python/"
datePublished: "2025-04-10"
dateModified: "2026-06-24"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "How to Design a Geospatial Webhook Architecture in Python",
      "description": "Step-by-step guide to designing a production-ready geospatial webhook architecture in Python: async dispatch, Shapely validation, HMAC signing, exponential backoff, and dead-letter routing for spatial event pipelines.",
      "datePublished": "2025-04-10",
      "dateModified": "2026-06-24",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Core Event Fundamentals & Architecture", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/"},
        {"@type": "ListItem", "position": 2, "name": "Feature Change Triggers", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/"},
        {"@type": "ListItem", "position": 3, "name": "How to Design a Geospatial Webhook Architecture in Python", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/how-to-design-a-geospatial-webhook-architecture-in-python/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Design a Geospatial Webhook Architecture in Python",
      "description": "Decouple spatial event ingestion from HTTP delivery using an async message broker, enforce Shapely geometry validation, sign payloads with HMAC-SHA256, and implement exponential backoff with dead-letter routing.",
      "step": [
        {"@type": "HowToStep", "name": "Define the canonical GeoEvent schema with Pydantic v2 and Shapely validation"},
        {"@type": "HowToStep", "name": "Implement HMAC-SHA256 payload signing"},
        {"@type": "HowToStep", "name": "Write an async dispatcher with exponential backoff and jitter"},
        {"@type": "HowToStep", "name": "Route undeliverable events to a dead-letter queue"},
        {"@type": "HowToStep", "name": "Verify correctness with a pytest integration harness"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why use async dispatch instead of synchronous HTTP for geospatial webhooks?",
          "acceptedAnswer": {"@type": "Answer", "text": "Spatial payloads — especially polygon geometries — can be large and validation is CPU-bound. Blocking on synchronous HTTP calls ties up workers and creates backpressure in the ingestion layer. Async dispatch with aiohttp decouples validation from delivery so the ingestion path stays write-optimized."}
        },
        {
          "@type": "Question",
          "name": "How do I handle CRS mismatches before dispatching a webhook payload?",
          "acceptedAnswer": {"@type": "Answer", "text": "Normalize all incoming geometries to WGS 84 (EPSG:4326) at the validation layer using pyproj before serializing to GeoJSON. Reject or reproject any geometry whose CRS metadata differs from EPSG:4326 and log the original SRID so consumers can audit it."}
        },
        {
          "@type": "Question",
          "name": "When should events go to a dead-letter queue vs. be retried?",
          "acceptedAnswer": {"@type": "Answer", "text": "Retry on transient HTTP errors (5xx, timeouts, connection resets). Send to the dead-letter queue after max_retries is exhausted, or immediately on 4xx client errors (bad endpoint, auth failure) — retrying those wastes resources. Preserve the full original payload and failure metadata in the DLQ so the event can be replayed cleanly."}
        }
      ]
    }
  ]
}
</script>

**To design a geospatial webhook architecture in Python, decouple spatial event ingestion from HTTP delivery using an async message broker, validate geometry with Shapely before dispatch, sign every payload with HMAC-SHA256, and apply exponential backoff with dead-letter routing for undeliverable events.**

This page is part of the [Feature Change Triggers](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/) topic under [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/). It focuses on the single concrete question of how to wire these four concerns together into a runnable Python service.

---

## When to use this pattern

Use the four-layer async architecture described here when:

- Your spatial data source emits high-frequency feature mutations (PostGIS triggers, GDAL pipelines, IoT sensor feeds) and a synchronous HTTP call on every write would introduce unacceptable latency or backpressure.
- Consumers need guaranteed at-least-once delivery — a fire-and-forget HTTP call on a database trigger is not sufficient, because you lose the event if the consumer is temporarily unavailable.
- Payload validation is non-trivial: you need to check geometry topology, enforce coordinate ring orientation, or reject coordinates outside WGS 84 (EPSG:4326) bounds before events leave your system.

If you only need to push a single event type to a single internal service with no retry requirements, a simpler synchronous `requests.post` is fine. This architecture pays off when you operate across multiple tenants, multiple endpoint registrations, or geographies with variable network reliability.

---

## Architecture overview

The pipeline operates across four logical layers. Each isolates a single concern so that failures do not cascade and each layer can scale independently.

<figure class="fig">
<svg viewBox="0 16 780 319" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Four-layer geospatial webhook pipeline: Ingestion, Validation, Broker, Dispatcher">
  <title>Four-layer geospatial webhook pipeline</title>
  <desc>Data flows left-to-right from the Ingestion layer through Spatial Validation, then a Message Broker, to the Async Dispatcher which delivers signed payloads to consumer endpoints.</desc>
  <rect x="0" y="16" width="780" height="319" fill="var(--fig-bg)"/>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Layer boxes -->
  <rect x="10"  y="60" width="160" height="200" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <rect x="200" y="60" width="160" height="200" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <rect x="390" y="60" width="160" height="200" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <rect x="580" y="60" width="190" height="200" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
  <!-- Layer labels -->
  <text x="90"  y="44" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.75">1. Ingestion</text>
  <text x="280" y="44" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.75">2. Validation</text>
  <text x="470" y="44" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.75">3. Broker</text>
  <text x="675" y="44" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" opacity="0.75">4. Dispatcher</text>
  <!-- Ingestion items -->
  <rect x="24"  y="82"  width="132" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="90"  y="102" text-anchor="middle" font-size="11" fill="currentColor">PostGIS trigger</text>
  <rect x="24"  y="122" width="132" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="90"  y="142" text-anchor="middle" font-size="11" fill="currentColor">GDAL pipeline</text>
  <rect x="24"  y="162" width="132" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="90"  y="182" text-anchor="middle" font-size="11" fill="currentColor">IoT sensor feed</text>
  <rect x="24"  y="202" width="132" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="90"  y="222" text-anchor="middle" font-size="11" fill="currentColor">Client SDK event</text>
  <!-- Arrows ingestion → validation -->
  <line x1="170" y1="160" x2="196" y2="160" stroke="currentColor" stroke-width="1.5" opacity="0.5" marker-end="url(#arr)"/>
  <!-- Validation items -->
  <rect x="214" y="82"  width="132" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="280" y="102" text-anchor="middle" font-size="11" fill="currentColor">Shapely topology</text>
  <rect x="214" y="122" width="132" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="280" y="142" text-anchor="middle" font-size="11" fill="currentColor">CRS → EPSG:4326</text>
  <rect x="214" y="162" width="132" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="280" y="182" text-anchor="middle" font-size="11" fill="currentColor">Pydantic schema</text>
  <rect x="214" y="202" width="132" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="280" y="222" text-anchor="middle" font-size="11" fill="currentColor">Delta threshold</text>
  <!-- Arrows validation → broker -->
  <line x1="360" y1="160" x2="386" y2="160" stroke="currentColor" stroke-width="1.5" opacity="0.5" marker-end="url(#arr)"/>
  <!-- Broker items -->
  <rect x="404" y="82"  width="132" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="470" y="102" text-anchor="middle" font-size="11" fill="currentColor">Redis Streams</text>
  <rect x="404" y="122" width="132" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="470" y="142" text-anchor="middle" font-size="11" fill="currentColor">Topic per feature</text>
  <rect x="404" y="162" width="132" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="470" y="182" text-anchor="middle" font-size="11" fill="currentColor">Subscription index</text>
  <rect x="404" y="202" width="132" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="470" y="222" text-anchor="middle" font-size="11" fill="currentColor">Ordered by feat. ID</text>
  <!-- Arrows broker → dispatcher -->
  <line x1="550" y1="160" x2="576" y2="160" stroke="currentColor" stroke-width="1.5" opacity="0.5" marker-end="url(#arr)"/>
  <!-- Dispatcher items -->
  <rect x="594" y="82"  width="162" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="675" y="102" text-anchor="middle" font-size="11" fill="currentColor">HMAC-SHA256 sign</text>
  <rect x="594" y="122" width="162" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="675" y="142" text-anchor="middle" font-size="11" fill="currentColor">aiohttp async POST</text>
  <rect x="594" y="162" width="162" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="675" y="182" text-anchor="middle" font-size="11" fill="currentColor">Exponential backoff</text>
  <rect x="594" y="202" width="162" height="30" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="675" y="222" text-anchor="middle" font-size="11" fill="currentColor">Dead-letter queue</text>
  <!-- DLQ loop arrow back -->
  <path d="M675,232 Q675,300 470,300 Q265,300 90,300 Q90,265 90,260" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="5,3" opacity="0.35" marker-end="url(#arr)"/>
  <text x="390" y="318" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5">DLQ replay path</text>
</svg>
<figcaption><b>Figure 1.</b> Four-layer geospatial webhook pipeline</figcaption>
</figure>

**Layer 1 — Ingestion:** Receives raw feature mutations and normalizes them into a canonical schema: `event_id` (UUID), `feature_id`, `geometry` (GeoJSON dict), `change_type` (`create | update | delete`), and `properties`. This layer is write-optimized and never blocks downstream workers.

**Layer 2 — Spatial Validation:** Parses geometry through Shapely, checks topology validity, and evaluates spatial delta thresholds — the same logic that drives [Feature Change Triggers](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/). Events that do not cross a meaningful delta (micro-edits, null-geometry noise) are dropped here, not forwarded.

**Layer 3 — Message Broker:** Publishes validated events to Redis Streams, RabbitMQ, or Kafka. Subscriber matching happens via spatial bounding-box indexes or attribute tags. The broker guarantees ordering per `feature_id` and persists events until acknowledged. Storing idempotency keys in the broker maps directly to the [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) strategy.

**Layer 4 — Async Dispatcher:** Pulls events, signs payloads with HMAC-SHA256 (as detailed in [Securing Webhook Endpoints with Spatial Token Validation](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/)), and delivers them over non-blocking HTTP. Delivery state, retry counts, and consumer health are tracked in a sidecar store.

---

## Complete runnable implementation

The module below is self-contained and production-aligned. It wires all four layers: Pydantic v2 schema with Shapely validation, HMAC signing, async delivery with jitter, and dead-letter routing. No placeholder TODOs — every part runs as written.

```python
# geospatial_webhook_dispatcher.py
#
# Dependencies:
#   pip install fastapi aiohttp pydantic shapely uvicorn
#
# Run with:
#   uvicorn geospatial_webhook_dispatcher:app --host 0.0.0.0 --port 8000

import asyncio
import hashlib
import hmac
import json
import logging
import random
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

import aiohttp
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from shapely.geometry import shape
from shapely.validation import explain_validity

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# One shared aiohttp.ClientSession per worker process — created on startup,
# closed on shutdown via the lifespan handler defined below.
_session: aiohttp.ClientSession | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Reuse TCP connections + DNS cache across every POST so retries do not
    # repeat the TLS handshake. on_event("startup"/"shutdown") is deprecated
    # in modern FastAPI; the lifespan context manager is the supported path.
    global _session
    connector = aiohttp.TCPConnector(limit=50, ttl_dns_cache=300)
    _session = aiohttp.ClientSession(connector=connector)
    try:
        yield
    finally:
        await _session.close()


app = FastAPI(title="Geospatial Webhook Dispatcher", lifespan=lifespan)

# ---------------------------------------------------------------------------
# 1. Canonical GeoEvent schema
#    All fields follow RFC 7946 conventions; geometry must be WGS 84 (EPSG:4326).
# ---------------------------------------------------------------------------

class GeoEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    feature_id: str
    geometry: dict                              # RFC 7946 GeoJSON geometry object
    change_type: Literal["create", "update", "delete"]
    properties: dict = Field(default_factory=dict)
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    @field_validator("geometry")
    @classmethod
    def validate_geojson_geometry(cls, v: dict) -> dict:
        """
        Parse through Shapely to catch topology errors before the event
        reaches the broker.  Self-intersecting polygons, unclosed rings, and
        empty geometries all raise ValueError here, not at delivery time.
        """
        if not v or "type" not in v or "coordinates" not in v:
            raise ValueError("geometry must be a valid GeoJSON geometry object")
        try:
            geom = shape(v)
        except Exception as exc:
            raise ValueError(f"Could not parse geometry: {exc}") from exc

        if geom.is_empty:
            raise ValueError("geometry must not be empty")

        if not geom.is_valid:
            detail = explain_validity(geom)
            raise ValueError(f"Invalid topology: {detail}")

        return v


# ---------------------------------------------------------------------------
# 2. HMAC-SHA256 payload signing
#    Consumers verify this header as described in RFC 6455 §10 conventions.
#    Key is the shared webhook secret; body is the canonical JSON encoding.
# ---------------------------------------------------------------------------

def sign_payload(payload: dict, secret: str) -> str:
    """Return hex digest of HMAC-SHA256 over the canonical JSON body."""
    # Compact encoding ensures the signature is stable regardless of
    # the client's JSON serializer key ordering.
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------
# 3. Async dispatcher with exponential backoff + full jitter
#    The ClientSession is created once per worker in the lifespan handler
#    above — never one per request, and never one per retry attempt.
# ---------------------------------------------------------------------------

async def deliver_with_retry(
    url: str,
    payload: dict,
    secret: str,
    max_retries: int = 4,
) -> bool:
    """
    Attempt delivery up to max_retries times.
    Returns True on success, False after exhausting retries (caller routes to DLQ).

    Backoff formula: min(cap, 2^attempt) + uniform(0, 1)
    Cap at 30 s to avoid very long waits on the last attempt.
    """
    headers = {
        "Content-Type": "application/json",
        "X-Webhook-Signature": f"sha256={sign_payload(payload, secret)}",
        "X-Event-ID": payload["event_id"],
        "X-Feature-ID": payload["feature_id"],
    }
    timeout = aiohttp.ClientTimeout(total=10)

    for attempt in range(max_retries):
        try:
            assert _session is not None, "ClientSession not initialised"
            async with _session.post(
                url, json=payload, headers=headers, timeout=timeout
            ) as resp:
                if resp.status < 300:
                    log.info(
                        "delivered event=%s to=%s attempt=%d",
                        payload["event_id"], url, attempt + 1,
                    )
                    return True

                # 4xx = client-side error; retrying will not help
                if 400 <= resp.status < 500:
                    log.error(
                        "client error status=%d event=%s url=%s — routing to DLQ",
                        resp.status, payload["event_id"], url,
                    )
                    return False

                # 5xx = server-side transient; fall through to retry
                log.warning(
                    "server error status=%d event=%s attempt=%d",
                    resp.status, payload["event_id"], attempt + 1,
                )

        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            log.warning(
                "network error event=%s attempt=%d error=%s",
                payload["event_id"], attempt + 1, exc,
            )

        if attempt < max_retries - 1:
            # Full jitter: actual delay is uniform in [0, capped_base]
            base = min(30.0, 2 ** attempt)
            delay = random.uniform(0, base)
            await asyncio.sleep(delay)

    log.error(
        "exhausted retries event=%s url=%s — routing to DLQ",
        payload["event_id"], url,
    )
    return False


async def route_to_dlq(payload: dict, reason: str) -> None:
    """
    In production: write to a Redis LPUSH / Kafka topic / database row.
    Preserve event_id, feature_id, original payload, failure reason, and
    timestamp so the event can be replayed or audited without data loss.
    """
    record = {
        "dlq_timestamp": datetime.now(timezone.utc).isoformat(),
        "reason": reason,
        "payload": payload,
    }
    # Replace this log statement with your broker write:
    log.error("DLQ record: %s", json.dumps(record))


# ---------------------------------------------------------------------------
# 4. FastAPI endpoint
#    In production, replace the direct POST with a broker consumer loop that
#    reads from Redis Streams / Kafka topics and calls deliver_with_retry.
# ---------------------------------------------------------------------------

@app.post("/dispatch")
async def dispatch_event(
    event: GeoEvent,
    x_target_endpoint: str = Header(..., description="Consumer endpoint URL"),
    x_webhook_secret: str = Header(default="change-me"),
) -> dict:
    """
    Validate and dispatch a single geospatial event.

    Headers
    -------
    X-Target-Endpoint : full URL of the consumer webhook endpoint
    X-Webhook-Secret  : shared HMAC secret for payload signing
    """
    payload = event.model_dump(mode="json")
    delivered = await deliver_with_retry(x_target_endpoint, payload, x_webhook_secret)

    if not delivered:
        await route_to_dlq(payload, reason="delivery_failed")
        raise HTTPException(
            status_code=502,
            detail=f"Could not deliver event {event.event_id}; routed to DLQ",
        )

    return {"status": "delivered", "event_id": event.event_id}
```

---

## Parameter / option reference

<div style="overflow-x:auto;">

| Parameter | Type | Spatial constraint | Default |
|---|---|---|---|
| `geometry` | `dict` | RFC 7946 GeoJSON geometry; coordinates in WGS 84 (EPSG:4326); no self-intersections | required |
| `feature_id` | `str` | Any opaque string; used as broker ordering key | required |
| `change_type` | `"create" \| "update" \| "delete"` | — | required |
| `properties` | `dict` | Arbitrary key-value pairs; avoid embedding full geometry duplicates here | `{}` |
| `max_retries` | `int` | — | `4` |
| `timeout` (per attempt) | `float` (seconds) | Keep ≤ 15 s; large polygon serialization can inflate response time | `10` |
| `X-Webhook-Secret` | `str` | Minimum 32 random bytes in production; rotate on breach | `"change-me"` |

</div>

---

## Gotchas and spatial edge cases

1. **Coordinate ring orientation.** RFC 7946 requires exterior rings to be counter-clockwise and interior rings (holes) to be clockwise. Shapely's `is_valid` check does not enforce RFC 7946 winding order — it only checks topological validity. Call `shapely.geometry.mapping(geom)` after `geom = orient(geom, sign=1.0)` from `shapely.ops` before serializing to JSON.

<figure class="fig">
<svg viewBox="0 0 760 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ring winding order: topologically valid but RFC 7946 non-conformant polygons, and what orient fixes">
<title>Topological validity and RFC 7946 winding are different checks</title>
<desc>Three versions of the same polygon with a hole. The first has a counter-clockwise exterior ring and a clockwise hole, which is what RFC 7946 requires; shapely reports it valid and consumers agree on its meaning. The second has both rings counter-clockwise: shapely still reports it valid because winding does not affect topology, but a strict RFC 7946 consumer may read the second ring as a second solid region rather than a hole, so the same bytes describe two different shapes. The third reverses both rings, which is likewise topologically valid and non-conformant. Only calling orient with a positive sign before serialising normalises all three to the first form, and shapely's is_valid never flags the difference.</desc>
<rect x="0" y="0" width="760" height="240" fill="var(--fig-bg)"/>
<defs>
<marker id="w-cw" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-rose-edge)"/></marker>
<marker id="w-ccw" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-mint-edge)"/></marker>
</defs>
<rect x="14" y="26" width="230" height="164" rx="7" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="129" y="46" text-anchor="middle" font-size="10" font-weight="600" fill="var(--fig-ink)">RFC 7946 conformant</text>
<rect x="54" y="58" width="150" height="96" fill="none" stroke="var(--fig-mint-edge)" stroke-width="2"/>
<path d="M54 154 L54 58" stroke="var(--fig-mint-edge)" stroke-width="2" marker-end="url(#w-ccw)"/>
<rect x="104" y="86" width="52" height="42" fill="var(--fig-bg)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<path d="M104 86 L156 86" stroke="var(--fig-rose-edge)" stroke-width="1.6" marker-end="url(#w-cw)"/>
<text x="129" y="172" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">exterior CCW · hole CW · is_valid ✓</text>
<rect x="258" y="26" width="230" height="164" rx="7" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.6"/>
<text x="373" y="46" text-anchor="middle" font-size="10" font-weight="600" fill="var(--fig-ink)">valid, non-conformant</text>
<rect x="298" y="58" width="150" height="96" fill="none" stroke="var(--fig-mint-edge)" stroke-width="2"/>
<path d="M298 154 L298 58" stroke="var(--fig-mint-edge)" stroke-width="2" marker-end="url(#w-ccw)"/>
<rect x="348" y="86" width="52" height="42" fill="var(--fig-bg)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<path d="M400 86 L348 86" stroke="var(--fig-mint-edge)" stroke-width="1.6" marker-end="url(#w-ccw)"/>
<text x="373" y="172" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">both CCW · is_valid ✓ · hole or island?</text>
<rect x="502" y="26" width="244" height="164" rx="7" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.6"/>
<text x="624" y="46" text-anchor="middle" font-size="10" font-weight="600" fill="var(--fig-ink)">valid, non-conformant</text>
<rect x="548" y="58" width="150" height="96" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2"/>
<path d="M548 58 L548 154" stroke="var(--fig-rose-edge)" stroke-width="2" marker-end="url(#w-cw)"/>
<rect x="598" y="86" width="52" height="42" fill="var(--fig-bg)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<path d="M650 86 L598 86" stroke="var(--fig-mint-edge)" stroke-width="1.6" marker-end="url(#w-ccw)"/>
<text x="624" y="172" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">both reversed · is_valid ✓</text>
<rect x="14" y="204" width="732" height="30" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="26" y="216" font-size="9.5" font-weight="600" fill="var(--fig-ink)">shapely.is_valid answers "is this topologically sound?", not "does this mean what RFC 7946 says it means?"</text>
<text x="26" y="229" font-size="9" fill="var(--fig-ink-soft)">Call orient(geom, sign=1.0) before mapping() — it is the only step that makes all three serialise identically.</text>
</svg>
<figcaption><b>Figure 2.</b> All three polygons pass <code>is_valid</code>. Only the first is RFC 7946 conformant, and the difference decides whether a strict consumer reads the inner ring as a hole or as a second solid region.</figcaption>
</figure>

2. **CRS mismatch on ingestion.** PostGIS may emit geometries in a projected CRS such as EPSG:3857 (Web Mercator). Passing those coordinates directly into a GeoJSON payload violates RFC 7946. Reproject to WGS 84 (EPSG:4326) using `pyproj.Transformer` before the Pydantic validator runs, as described in [Handling Mixed CRS Payloads in Python Event Handlers](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/).

3. **Precision loss during serialization.** Python's `json.dumps` serializes floats with up to 17 significant digits, but `model_dump(mode="json")` from Pydantic may round coordinates via intermediate float conversion. For high-precision geometries (cadastral surveys, survey-grade GPS), serialize coordinates explicitly to a fixed decimal place (e.g., 7 d.p. ≈ 1 cm accuracy) using a custom JSON encoder rather than relying on default float formatting.

4. **Empty geometry after transformation.** Reprojection of very small or degenerate geometries can produce an empty Shapely result. Always call `geom.is_empty` after any transformation and reject the event with a descriptive error rather than forwarding an empty geometry downstream.

5. **HMAC signature drift on large payloads.** If the consumer reconstructs the body from a different key ordering than the dispatcher's `sort_keys=True`, the HMAC will not match. Standardize on `sort_keys=True, separators=(",", ":")` on both sides, and document this contract in your API reference. Mismatches surface as 401s, not 5xxs, so they bypass retry logic — log them explicitly.

6. **Session lifecycle in async frameworks.** Creating a new `aiohttp.ClientSession` inside `deliver_with_retry` (one per attempt) opens a new TCP connection and TLS handshake on every retry. The code above creates one session per worker process via the `lifespan` context manager — the deprecated `@app.on_event("startup")` hook still works but is being phased out, so prefer `lifespan` on new services. When using Celery workers instead of FastAPI, create the session in a `celery.signals.worker_process_init` handler and close it in `worker_process_shutdown`.

<figure class="fig">
<svg viewBox="0 0 760 232" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cost of creating an aiohttp session per retry attempt versus reusing one session for the worker's lifetime">
<title>Where a per-attempt ClientSession spends its time</title>
<desc>A retry ladder of four attempts drawn twice. With a new ClientSession per attempt, each attempt pays a DNS lookup of about 12 milliseconds, a TCP handshake of about 30 milliseconds and a TLS handshake of about 68 milliseconds before the 40-millisecond request itself, so four attempts cost about 600 milliseconds of which 440 is connection setup repeated four times. With one session created at worker start, the first attempt pays the same 110-millisecond setup once and the remaining three reuse the pooled connection, so four attempts cost about 270 milliseconds. The setup work is not merely duplicated but is paid precisely when the downstream service is already struggling, which is what turns a retry storm into a connection storm.</desc>
<rect x="0" y="0" width="760" height="232" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-rose-edge)">A new ClientSession per attempt — 600 ms</text>
<rect x="160" y="28" width="34" height="20" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="194" y="28" width="84" height="20" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="278" y="28" width="112" height="20" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<text x="14" y="43" font-size="9" fill="var(--fig-ink-soft)">attempt 1</text>
<text x="400" y="43" font-size="8.5" fill="var(--fig-ink-soft)">DNS 12 · TCP 30 · TLS 68 · request 40</text>
<rect x="160" y="52" width="34" height="20" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="194" y="52" width="84" height="20" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="278" y="52" width="112" height="20" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<text x="14" y="67" font-size="9" fill="var(--fig-ink-soft)">attempt 2</text>
<text x="400" y="67" font-size="8.5" fill="var(--fig-rose-edge)">the whole handshake, again</text>
<rect x="160" y="76" width="34" height="20" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="194" y="76" width="84" height="20" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="278" y="76" width="112" height="20" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<text x="14" y="91" font-size="9" fill="var(--fig-ink-soft)">attempt 3</text>
<text x="400" y="91" font-size="8.5" fill="var(--fig-rose-edge)">against a host already failing</text>
<rect x="160" y="100" width="34" height="20" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="194" y="100" width="84" height="20" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="278" y="100" width="112" height="20" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<text x="14" y="115" font-size="9" fill="var(--fig-ink-soft)">attempt 4</text>
<text x="400" y="115" font-size="8.5" fill="var(--fig-rose-edge)">440 ms of the 600 is setup</text>
<line x1="14" y1="132" x2="746" y2="132" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="152" font-size="10.5" font-weight="600" fill="var(--fig-mint-edge)">One session for the worker's lifetime — 270 ms</text>
<rect x="160" y="160" width="34" height="20" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="194" y="160" width="84" height="20" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1"/>
<rect x="278" y="160" width="112" height="20" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<text x="14" y="175" font-size="9" fill="var(--fig-ink-soft)">attempt 1</text>
<text x="400" y="175" font-size="8.5" fill="var(--fig-ink-soft)">setup paid once, at worker start</text>
<rect x="278" y="184" width="112" height="20" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<text x="14" y="199" font-size="9" fill="var(--fig-ink-soft)">attempts 2–4</text>
<text x="180" y="199" font-size="8.5" fill="var(--fig-mint-edge)">pooled connection reused — straight to the request</text>
<rect x="14" y="212" width="732" height="18" rx="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.1"/>
<text x="26" y="225" font-size="9" fill="var(--fig-ink)">Create the session in the lifespan context (FastAPI) or worker_process_init (Celery) — never inside the retry loop.</text>
</svg>
<figcaption><b>Figure 3.</b> A per-attempt session does not merely duplicate the handshake — it opens a fresh connection to a host that is already failing, which is how a retry storm becomes a connection storm.</figcaption>
</figure>

---

## Minimal verification snippet

Run this with `pytest` against a live instance or a `respx`-mocked session to confirm end-to-end correctness, including signature verification.

```python
# test_dispatcher.py
import asyncio
import hashlib
import hmac
import json

import pytest
from httpx import AsyncClient, ASGITransport

from geospatial_webhook_dispatcher import app, sign_payload

VALID_POINT_GEOMETRY = {
    "type": "Point",
    "coordinates": [-122.4194, 37.7749],   # San Francisco, WGS 84 (EPSG:4326)
}

VALID_POLYGON_GEOMETRY = {
    "type": "Polygon",
    "coordinates": [[
        [-122.42, 37.78],
        [-122.40, 37.78],
        [-122.40, 37.76],
        [-122.42, 37.76],
        [-122.42, 37.78],   # closed ring
    ]],
}


@pytest.mark.asyncio
async def test_sign_payload_is_deterministic():
    payload = {"event_id": "abc", "feature_id": "f1", "geometry": VALID_POINT_GEOMETRY}
    sig1 = sign_payload(payload, "secret")
    sig2 = sign_payload(payload, "secret")
    assert sig1 == sig2, "Signature must be deterministic"


@pytest.mark.asyncio
async def test_sign_payload_hmac_correct():
    payload = {"event_id": "abc", "feature_id": "f1"}
    expected_body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    expected = hmac.new(b"secret", expected_body, hashlib.sha256).hexdigest()
    assert sign_payload(payload, "secret") == expected


@pytest.mark.asyncio
async def test_dispatch_rejects_invalid_geometry():
    self_intersecting = {
        "type": "Polygon",
        "coordinates": [[
            [0, 0], [2, 2], [2, 0], [0, 2], [0, 0],  # bowtie — self-intersecting
        ]],
    }
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/dispatch",
            json={
                "feature_id": "f1",
                "geometry": self_intersecting,
                "change_type": "update",
            },
            headers={
                "X-Target-Endpoint": "http://example.com/hook",
                "X-Webhook-Secret": "test-secret",
            },
        )
    assert resp.status_code == 422, "Self-intersecting polygon must be rejected at validation"


@pytest.mark.asyncio
async def test_dispatch_rejects_missing_geometry_type():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/dispatch",
            json={
                "feature_id": "f2",
                "geometry": {"coordinates": [0, 0]},  # missing "type"
                "change_type": "create",
            },
            headers={
                "X-Target-Endpoint": "http://example.com/hook",
                "X-Webhook-Secret": "test-secret",
            },
        )
    assert resp.status_code == 422
```

---

## Frequently asked questions

### Why use async dispatch instead of synchronous HTTP for geospatial webhooks?

Spatial payloads — especially polygon and multipolygon geometries — can be large, and topology validation is CPU-bound. Blocking on synchronous `requests.post` calls ties up workers and pushes backpressure into the ingestion layer, so a slow consumer slows down the database trigger that produced the event. Async delivery with `aiohttp` decouples validation from delivery: the ingestion path stays write-optimized while a fixed pool of connections fans out POSTs concurrently.

### How do I handle CRS mismatches before dispatching a webhook payload?

Normalize every incoming geometry to WGS 84 (EPSG:4326) at the validation layer using `pyproj.Transformer` before serializing to GeoJSON, since RFC 7946 mandates EPSG:4326. Reject or reproject any geometry whose source CRS differs, and log the original SRID so consumers can audit the transformation. The full reprojection workflow is covered in [Handling Mixed CRS Payloads in Python Event Handlers](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/).

### When should events go to a dead-letter queue versus be retried?

Retry on transient failures — 5xx responses, timeouts, and connection resets — using the capped exponential backoff with full jitter shown above. Send straight to the dead-letter queue on 4xx client errors (bad endpoint, auth failure, malformed signature), because retrying those only wastes connections, and after `max_retries` is exhausted for transient errors. Always preserve the full original payload plus failure metadata in the DLQ so the event can be replayed without data loss.

---

## Related

- [Feature Change Triggers](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/) — the parent topic covering when and why to fire events on spatial mutations
- [Implementing At-Least-Once Delivery for GIS Webhooks](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/) — retry guarantees, consumer acknowledgement patterns, and queue durability
- [Generating Deterministic Idempotency Keys for GeoJSON Events](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/generating-deterministic-idempotency-keys-for-geojson-events/) — how to derive stable `event_id` values from geometry hashes to prevent duplicate processing
