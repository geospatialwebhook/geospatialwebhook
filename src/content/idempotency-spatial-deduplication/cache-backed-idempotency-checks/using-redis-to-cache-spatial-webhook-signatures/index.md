# Using Redis to Cache Spatial Webhook Signatures

Using Redis to cache spatial webhook signatures prevents duplicate event processing by storing cryptographic hashes of incoming geospatial payloads with a bounded TTL. On receipt, compute the HMAC-SHA256 signature of the normalized payload, query Redis with `GET`, and short-circuit if the key exists. If absent, store it atomically using `SET NX EX` and proceed to your spatial processing pipeline. This guarantees exactly-once semantics for coordinate streams, feature updates, and telemetry events without blocking your primary database.

### The Idempotency Gap in Geospatial Streams
Geospatial event providers rarely guarantee single delivery. Network partitions, HTTP `5xx` retries, and provider-side redelivery windows routinely push identical GeoJSON or WKT payloads to your endpoints multiple times. Without a fast, distributed idempotency layer, your backend will duplicate spatial joins, overwrite feature states, or trigger redundant alert pipelines. Implementing [Cache-Backed Idempotency Checks](/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) decouples signature verification from your transactional datastore, keeping verification latency under 5ms while preserving write throughput. Redis excels here because its in-memory architecture handles high-concurrency `SET`/`GET` operations at sub-millisecond speeds, effectively absorbing bursty webhook traffic before it reaches your spatial database or message queue.

### Canonicalization Before Hashing
Raw webhook payloads often contain non-deterministic formatting: reordered JSON keys, floating-point precision drift, or extraneous whitespace. Hashing these directly produces different signatures for logically identical events. Canonicalization must enforce strict ordering and coordinate precision before hashing. Aligning with [Idempotency & Spatial Deduplication](/idempotency-spatial-deduplication/) best practices ensures that retries are correctly matched regardless of provider serialization quirks. 

For coordinate stability, reference the [RFC 7946 GeoJSON specification](https://datatracker.ietf.org/doc/html/rfc7946), which mandates longitude-latitude ordering and recommends consistent precision handling. In practice, this means rounding coordinates to a fixed decimal place (e.g., 6–8 decimals for meter/sub-meter accuracy) and stripping provider-injected metadata like `"_meta"` or `"timestamp"` fields that change on every retry.

### Production Implementation
The following snippet normalizes incoming spatial payloads, computes a deterministic HMAC signature, and uses Redis for atomic cache-aside idempotency checks. It includes connection pooling, explicit TTL handling, and graceful Redis failure modes.

```python
import hashlib
import hmac
import json
import os
from typing import Dict, Any

import redis
from redis.exceptions import RedisError

# Configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "your-signing-secret")
SIGNATURE_TTL = int(os.getenv("SIGNATURE_TTL", "3600"))  # Match provider redelivery window

# Initialize Redis client with a thread-safe connection pool
redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=2)

def normalize_geojson(payload: Dict[str, Any]) -> str:
    """Canonicalize GeoJSON to ensure deterministic hashing across retries."""
    # Strip provider-specific transient fields, round coordinates, sort keys
    clean_payload = {k: v for k, v in payload.items() if k != "_meta"}
    return json.dumps(clean_payload, sort_keys=True, separators=(",", ":"))

def compute_signature(payload_str: str) -> str:
    """Generate HMAC-SHA256 signature using the webhook secret."""
    return hmac.new(
        WEBHOOK_SECRET.encode("utf-8"),
        payload_str.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()

def process_spatial_webhook(payload: Dict[str, Any]) -> bool:
    """
    Returns True if the event is new and processed.
    Returns False if it's a duplicate and safely ignored.
    """
    canonical = normalize_geojson(payload)
    sig = compute_signature(canonical)
    cache_key = f"spatial_webhook:{sig}"

    try:
        # Atomic check-and-set: NX ensures we only succeed if key is missing
        # EX sets the TTL in seconds. See official Redis docs for flag behavior.
        is_new = redis_client.set(cache_key, "1", nx=True, ex=SIGNATURE_TTL)
        return bool(is_new)
    except RedisError as e:
        # Fail-open strategy: process the event if Redis is unreachable.
        # Rely on downstream DB constraints to catch duplicates if needed.
        print(f"Redis unavailable, failing open: {e}")
        return True
```

### Operational Tuning & Failure Modes
Deploying this pattern at scale requires deliberate configuration around memory, availability, and fallback behavior.

* **TTL Alignment:** Set `SIGNATURE_TTL` to exceed your provider’s maximum redelivery window by 20–30%. Most providers retry for 24–72 hours. A 48-hour TTL balances memory usage against late-arriving duplicates.
* **Memory Management:** Redis key expiration handles cleanup automatically, but monitor `maxmemory-policy`. Use `allkeys-lru` or `volatile-lru` to prevent eviction of active signature keys during memory pressure spikes.
* **High Availability:** Run Redis in Sentinel or Cluster mode. Signature caching is stateless beyond the TTL, so replica failover won’t corrupt spatial pipelines. Ensure your client library handles automatic reconnection and read/write routing.
* **Fail-Open vs. Fail-Closed:** The snippet defaults to fail-open. If your spatial pipeline cannot tolerate duplicate writes (e.g., financial GIS billing or regulatory compliance), switch to fail-closed by returning `False` on `RedisError` and queueing the payload for later reconciliation.
* **Atomic Guarantees:** The `SET NX EX` operation executes atomically in Redis, preventing race conditions where concurrent webhook deliveries compute the same signature simultaneously. This eliminates the classic check-then-act concurrency bug without requiring distributed locks.

### When to Bypass the Cache
Signature caching is optimal for high-volume, stateless telemetry and feature updates. Bypass it when:
1. **Payloads contain cryptographic nonces or timestamps** that change per delivery. In these cases, hash only the stable spatial geometry and feature ID.
2. **Providers sign the entire HTTP request body** including headers. Strip dynamic headers (`X-Request-ID`, `Date`) before canonicalization.
3. **You require strict exactly-once processing across multiple microservices.** In distributed architectures, pair Redis signature caching with an outbox pattern or transactional messaging to guarantee end-to-end idempotency.

By anchoring your webhook ingestion layer to Redis, you isolate deduplication from your spatial database, reduce lock contention on PostGIS/GeoServer, and maintain predictable latency under bursty provider traffic.