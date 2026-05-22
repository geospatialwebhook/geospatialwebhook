# Generating Deterministic Idempotency Keys for GeoJSON Events

To generate deterministic idempotency keys for GeoJSON events, canonicalize the payload by recursively normalizing floating-point coordinate precision, stripping insignificant whitespace, enforcing alphabetical key ordering, and hashing the resulting UTF-8 string with a collision-resistant algorithm like SHA-256 or BLAKE3. This pipeline guarantees that structurally identical spatial payloads produce identical digests regardless of webhook retry order, serializer differences, or minor formatting drift, enabling safe exactly-once processing in event-driven architectures.

## Why Naive Hashing Fails in Production

Raw JSON hashing breaks immediately under real-world conditions. The [JSON specification (RFC 8259)](https://www.rfc-editor.org/info/rfc8259/) explicitly defines object key ordering as insignificant, yet most serializers preserve insertion order. A webhook provider might deliver `{"type": "Feature", "geometry": {...}}` on the first attempt and `{"geometry": {...}, "type": "Feature"}` on a retry. Hashing these strings directly yields different digests, triggering duplicate processing, state overwrites, or corrupted spatial indexes.

GeoJSON compounds this problem. Coordinates are deeply nested arrays of floats, and different languages or HTTP clients serialize them with varying decimal precision. A coordinate like `-122.4194155` might arrive as `-122.41941550000001` due to IEEE-754 representation drift. Without strict normalization, your event bus treats identical spatial updates as distinct messages. Implementing robust [Idempotency & Spatial Deduplication](/idempotency-spatial-deduplication/) requires treating the payload as a mathematical object rather than a raw byte stream.

## Canonicalization Pipeline

Deterministic key generation relies on three sequential transformations that strip away serialization artifacts while preserving spatial semantics:

1. **Recursive Float Normalization**: Traverse the payload and round all numeric values in coordinate arrays to a fixed precision (typically 6–8 decimals for WGS84). This neutralizes cross-language floating-point representation drift. The [GeoJSON specification (RFC 7946)](https://www.rfc-editor.org/info/rfc7946/) recommends 6 decimal places (~0.11m accuracy) for most web mapping use cases.
2. **Deterministic Key Ordering**: Enforce strict alphabetical sorting of all dictionary keys at every nesting level. This eliminates insertion-order variance introduced by different JSON parsers or webhook gateways.
3. **Compact Serialization**: Strip all whitespace using minimal separators (`(",", ":")`). This ensures byte-for-byte consistency before hashing and reduces memory overhead during digest computation.

The resulting canonical string is passed through a cryptographic or fast non-cryptographic hash. For high-throughput webhook pipelines, BLAKE3 or SHA-256 truncated to 16–32 bytes provides an optimal balance of collision resistance and CPU efficiency. When designing [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/), always hash the canonical string, never the raw payload.

## Production-Ready Python Implementation

The following implementation handles nested GeoJSON structures, respects precision boundaries, and supports both zero-dependency SHA-256 and BLAKE3. It accepts raw dictionaries or JSON strings, making it safe for middleware, FastAPI/Flask handlers, or Celery workers.

```python
import json
import hashlib
from typing import Any, Union

def _normalize_floats(obj: Any, precision: int) -> Any:
    """Recursively round floats to prevent IEEE-754 serialization drift."""
    if isinstance(obj, float):
        return round(obj, precision)
    if isinstance(obj, list):
        return [_normalize_floats(v, precision) for v in obj]
    if isinstance(obj, dict):
        return {k: _normalize_floats(v, precision) for k, v in obj.items()}
    return obj

def generate_geojson_idempotency_key(
    payload: Union[dict, str],
    precision: int = 8,
    algorithm: str = "sha256",
    truncate_bytes: int = 0
) -> str:
    """
    Generate a deterministic idempotency key for a GeoJSON payload.
    
    Args:
        payload: Raw GeoJSON dict or JSON string.
        precision: Decimal places for coordinate normalization.
        algorithm: Hash algorithm supported by hashlib (e.g., 'sha256', 'blake2b').
        truncate_bytes: Optional byte truncation for shorter keys (e.g., 16).
    """
    if isinstance(payload, str):
        payload = json.loads(payload)
        
    # 1. Normalize floating-point precision
    normalized = _normalize_floats(payload, precision)
    
    # 2. Canonicalize: sort keys recursively, strip whitespace
    canonical = json.dumps(
        normalized, 
        sort_keys=True, 
        separators=(",", ":"),
        ensure_ascii=False
    )
    
    # 3. Hash
    digest = hashlib.new(algorithm, canonical.encode("utf-8")).digest()
    
    if truncate_bytes > 0:
        digest = digest[:truncate_bytes]
        
    return digest.hex()
```

### Usage Example
```python
geojson_feature = {
    "type": "Feature",
    "properties": {"name": "Central Park"},
    "geometry": {
        "type": "Point",
        "coordinates": [-73.965355, 40.782865]
    }
}

# Produces identical keys across retries, even if key order or float precision shifts
key = generate_geojson_idempotency_key(geojson_feature, precision=7)
print(key)  # e.g., 'a1b2c3...'
```

## Integration & Operational Best Practices

**Storage Strategy**: Store generated keys in a low-latency datastore (Redis, DynamoDB, or PostgreSQL with a unique constraint). Set a TTL aligned with your webhook retry window (typically 24–72 hours). Once a key is recorded, reject subsequent events with the same digest.

**Algorithm Selection**: SHA-256 is universally available and cryptographically secure. For sub-millisecond throughput at scale, BLAKE3 (`pip install blake3`) outperforms SHA-256 by 3–5x on modern CPUs while maintaining equivalent collision resistance. Truncate to 16 bytes (32 hex chars) to reduce index bloat without sacrificing safety.

**Edge Cases**: 
- Handle `null` geometries gracefully. The recursive normalizer preserves `None` values, which serialize to `null` consistently.
- Exclude ephemeral fields like `received_at`, `webhook_id`, or `signature` before canonicalization. These vary per delivery and will break idempotency.
- Validate payloads against the GeoJSON schema before hashing to prevent malformed coordinates from generating misleading keys.

**Monitoring**: Track key collision rates and deduplication hit ratios. A sudden spike in duplicate keys often indicates upstream serializer changes or webhook gateway misconfiguration. Log the canonical string length and hash algorithm version to simplify debugging during payload migrations.

By enforcing strict canonicalization before hashing, you decouple idempotency from transport-layer quirks. This approach scales cleanly across microservices, supports exactly-once spatial event processing, and eliminates the silent data corruption that plagues naive JSON hashing.