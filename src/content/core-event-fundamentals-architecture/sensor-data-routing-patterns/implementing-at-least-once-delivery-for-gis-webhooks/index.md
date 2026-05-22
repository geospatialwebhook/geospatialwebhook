# Implementing at-least-once delivery for GIS webhooks

Implementing at-least-once delivery for GIS webhooks requires a persistent ingestion layer, deterministic idempotency tracking, and exponential backoff retry logic. In production, this means immediately acknowledging the webhook with a `200 OK`, persisting the raw spatial payload alongside a unique event key, and delegating processing to a background worker that retries on `5xx` responses or network timeouts. Because at-least-once semantics guarantee duplicates, your spatial pipeline must enforce strict idempotency using sender-provided `event_id` headers or cryptographic payload hashes, backed by a low-latency state store. Decouple the receiver from the geospatial execution engine, apply bounded retry budgets, and route exhausted events to a dead-letter queue for manual reconciliation.

## Decouple Ingestion from Spatial Execution

At-least-once delivery solves network partitioning and transient upstream failures, but it shifts the burden of consistency to your backend. For real-time spatial applications—whether ingesting IoT sensor coordinates, syncing drone telemetry, or routing feature updates from ArcGIS or Mapbox—duplicate processing corrupts spatial indexes, inflates metric counters, and triggers cascading routing errors. 

Your architecture must separate ingestion from execution. The HTTP endpoint validates the payload schema, logs the event signature, and pushes it to a durable queue. The consumer layer applies coordinate transformations, writes to PostGIS or GeoPackage, and updates routing caches. This decoupling aligns with established [Sensor Data Routing Patterns](/core-event-fundamentals-architecture/sensor-data-routing-patterns/) where spatial payloads require deterministic ordering, strict schema validation, and fault-tolerant handoffs. Without this separation, synchronous webhook handlers will block on heavy geometry operations, causing upstream timeouts and triggering unnecessary retries.

## Enforce Deterministic Idempotency

Underpinning this workflow are the [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/) principles: explicit acknowledgment windows, bounded retry budgets, and state reconciliation. Without persistent tracking, GIS webhooks will silently drop during database connection spikes or overwhelm downstream spatial services with redundant geometry updates.

Idempotency must be enforced before any spatial computation begins:
1. **Extract or derive a unique key:** Prefer the `X-Event-ID` or `Idempotency-Key` header. If absent, generate a SHA-256 hash of the normalized payload (sorted keys, trimmed whitespace, consistent float precision).
2. **Check-and-set in a low-latency store:** Redis, PostgreSQL, or DynamoDB should track processed keys. Use `SETNX` (or equivalent) with a 24–72 hour TTL to bound storage growth.
3. **Fail fast on duplicates:** If the key exists, return `200 OK` immediately. Do not reprocess coordinates or update spatial indexes.

Always validate incoming payloads against a strict GeoJSON or OGC-compliant schema before queuing. Malformed coordinates or invalid CRS declarations will poison spatial indexes and cause silent topology errors downstream.

## Bounded Retries & Dead-Letter Routing

Transient failures are inevitable. Your retry strategy must be predictable and resource-aware:
- **Exponential backoff with jitter:** Prevents thundering herd problems when upstream services recover.
- **Bounded retry budgets:** Cap attempts at 5–7 retries. Beyond that, the event is likely malformed or the downstream service is degraded.
- **Dead-letter queue (DLQ):** Route exhausted events to a separate queue with full payload context for manual reconciliation or automated alerting.

For authoritative guidance on retry strategies and backoff algorithms, consult the [AWS Well-Architected Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/) or standard distributed systems literature.

## Production-Ready Python Implementation

The following FastAPI receiver demonstrates production-ready at-least-once handling with async Redis-backed idempotency, exponential backoff with jitter, and explicit background processing.

```python
import asyncio
import hashlib
import logging
import random
from typing import Dict, Any
from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
import redis.asyncio as redis

app = FastAPI()
redis_client = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)
logger = logging.getLogger("gis_webhook")

IDEMPOTENCY_TTL = 86400  # 24 hours
MAX_RETRIES = 5
BASE_DELAY = 2.0

def derive_idempotency_key(payload: Dict[str, Any], event_id: str | None = None) -> str:
    """Generate a deterministic idempotency key from header or payload hash."""
    if event_id:
        return f"idemp:{event_id}"
    normalized = str(sorted(payload.items())).encode("utf-8")
    return f"idemp:{hashlib.sha256(normalized).hexdigest()}"

def calculate_backoff(attempt: int) -> float:
    """Exponential backoff with full jitter to prevent thundering herds."""
    delay = BASE_DELAY * (2 ** attempt)
    jitter = random.uniform(0, delay)
    return min(delay + jitter, 60.0)  # Cap at 60s

async def process_spatial_event(payload: Dict[str, Any], event_id: str | None = None):
    """Background worker with bounded retries and idempotency enforcement."""
    key = derive_idempotency_key(payload, event_id)
    
    # Check if already processed
    if await redis_client.exists(key):
        logger.info(f"Duplicate event skipped: {key}")
        return

    for attempt in range(MAX_RETRIES):
        try:
            # TODO: Replace with actual GIS processing (e.g., PostGIS write, topology validation)
            await asyncio.sleep(0.1)  # Simulate spatial computation
            
            # Mark as processed
            await redis_client.set(key, "processed", ex=IDEMPOTENCY_TTL)
            logger.info(f"Successfully processed event: {key}")
            return
        except Exception as e:
            wait = calculate_backoff(attempt)
            logger.warning(f"Attempt {attempt + 1}/{MAX_RETRIES} failed for {key}. Retrying in {wait:.2f}s. Error: {e}")
            await asyncio.sleep(wait)
    
    # Exhausted retries -> route to DLQ
    logger.error(f"Event {key} exhausted retries. Routing to DLQ.")
    await redis_client.set(f"dlq:{key}", str(payload), ex=604800)  # 7-day retention

@app.post("/webhooks/gis")
async def receive_gis_webhook(request: Request, background_tasks: BackgroundTasks):
    try:
        payload = await request.json()
        event_id = request.headers.get("X-Event-ID") or request.headers.get("Idempotency-Key")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Immediate 200 OK acknowledgment
    background_tasks.add_task(process_spatial_event, payload, event_id)
    return {"status": "accepted"}
```

## GIS-Specific Validation & Index Safety

Spatial data introduces unique failure modes that standard webhook handlers ignore:
- **Coordinate precision drift:** Floating-point inconsistencies across retries can cause duplicate geometries to fail equality checks. Normalize coordinates to 6–8 decimal places before hashing or storing.
- **CRS mismatches:** Ensure all payloads declare a consistent coordinate reference system (e.g., EPSG:4326). Reject or transform payloads with ambiguous projections before they hit your spatial index.
- **Topology validation:** Use libraries like `shapely` or `geojson` to validate geometry validity before insertion. Invalid polygons will break PostGIS spatial indexes and cause query timeouts.

For the official specification governing GeoJSON structure and coordinate ordering, reference the [IETF RFC 7946 standard](https://datatracker.ietf.org/doc/html/rfc7946). Pair this with strict Pydantic models in your FastAPI layer to catch malformed geometries at the edge.

By combining immediate HTTP acknowledgment, deterministic idempotency tracking, bounded exponential retries, and strict spatial validation, you can safely ingest high-volume GIS webhooks without corrupting downstream indexes or losing critical telemetry data.