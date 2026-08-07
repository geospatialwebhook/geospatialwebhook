---
title: "Deterministic Idempotency Keys for GeoJSON Events"
description: "Canonicalize GeoJSON payloads and hash them into deterministic idempotency keys that survive webhook retries, serializer drift, and float precision variance."
slug: "generating-deterministic-idempotency-keys-for-geojson-events"
type: "article"
breadcrumb:
  - label: "Idempotency & Spatial Deduplication"
    url: "/idempotency-spatial-deduplication/"
  - label: "Event Key Generation for Spatial Data"
    url: "/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/"
  - label: "Generating Deterministic Idempotency Keys for GeoJSON Events"
    url: "/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/generating-deterministic-idempotency-keys-for-geojson-events/"
datePublished: "2025-04-12"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Generating Deterministic Idempotency Keys for GeoJSON Events",
      "description": "Learn how to canonicalize GeoJSON payloads and hash them into deterministic idempotency keys that survive webhook retries, serializer drift, and float precision variance.",
      "url": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/generating-deterministic-idempotency-keys-for-geojson-events/",
      "datePublished": "2025-04-12",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Idempotency & Spatial Deduplication", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/" },
        { "@type": "ListItem", "position": 2, "name": "Event Key Generation for Spatial Data", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/" },
        { "@type": "ListItem", "position": 3, "name": "Generating Deterministic Idempotency Keys for GeoJSON Events", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/generating-deterministic-idempotency-keys-for-geojson-events/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Generate Deterministic Idempotency Keys for GeoJSON Events",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Strip delivery envelope fields", "text": "Remove top-level fields that vary per delivery attempt (webhook_id, delivery_id, received_at, signatures) so they cannot shift the digest between retries." },
        { "@type": "HowToStep", "position": 2, "name": "Normalize float precision", "text": "Recursively round all coordinate floats to a fixed number of decimal places (6–8 for WGS84/EPSG:4326) to neutralize IEEE-754 serialization drift across languages and serializers." },
        { "@type": "HowToStep", "position": 3, "name": "Sort keys and compact-serialize", "text": "Enforce strict alphabetical ordering of all dictionary keys at every nesting level, then dump to JSON with minimal separators and no whitespace to guarantee byte-for-byte consistency before hashing." },
        { "@type": "HowToStep", "position": 4, "name": "Hash with SHA-256 or BLAKE2b", "text": "Feed the canonical UTF-8 string into a collision-resistant hash function to produce the final idempotency key. Optionally truncate to 16 bytes (32 hex chars) for compact storage." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why can't I just hash the raw JSON string from the webhook body?",
          "acceptedAnswer": { "@type": "Answer", "text": "Raw JSON strings carry insertion-order variance, float representation drift, and whitespace differences across serializers. Two payloads that are semantically identical will produce different digests if key order or decimal precision differs, causing false duplicate misses and double-processing." }
        },
        {
          "@type": "Question",
          "name": "How many decimal places should I use for WGS84 coordinates?",
          "acceptedAnswer": { "@type": "Answer", "text": "RFC 7946 recommends 6 decimal places (~0.11 m resolution). Use 7–8 if you need centimetre-level fidelity. Go beyond 8 only when your source data genuinely carries that precision — extra digits amplify float serialization noise without adding accuracy." }
        },
        {
          "@type": "Question",
          "name": "Is SHA-256 or BLAKE2b better for webhook idempotency keys?",
          "acceptedAnswer": { "@type": "Answer", "text": "Both are collision-resistant for this use case. BLAKE2b is 2–4× faster on modern CPUs and is available in Python's standard library (hashlib.blake2b). SHA-256 is more universally recognised and works in all compliance contexts. Pick SHA-256 when auditability matters; BLAKE2b for high-throughput sub-millisecond paths." }
        },
        {
          "@type": "Question",
          "name": "What happens if the same geographic boundary triggers multiple distinct events?",
          "acceptedAnswer": { "@type": "Answer", "text": "Include an event_type field (e.g. 'zone_entry', 'threshold_breach') in the canonical form before hashing. This ensures semantically different events at the same geometry produce different keys and are not collapsed as duplicates." }
        }
      ]
    }
  ]
}
</script>

**To generate a deterministic idempotency key for a GeoJSON event: strip delivery-envelope fields, recursively normalize coordinate float precision, sort all dictionary keys alphabetically, compact-serialize the result, then hash the canonical UTF-8 string with SHA-256 or BLAKE2b.** This produces an identical digest for every structurally equivalent payload regardless of serializer, retry count, or minor formatting drift.

This page is part of [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/), which sits within the [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) architecture — the reference section for building duplicate-safe spatial webhook pipelines.

---

## When to use this pattern

Apply this canonicalization-before-hashing approach when:

- Your webhook provider may deliver the same event multiple times (at-least-once guarantees) and you need to filter duplicates without a unique ID from the sender.
- You consume GeoJSON from multiple upstream systems — different languages, ORMs, or HTTP clients — that serialize coordinate arrays with varying decimal precision or key insertion order.
- You need to compare spatial events across delivery attempts where ephemeral envelope fields (`delivery_id`, `received_at`, `x-signature`) must not influence the key.

It is not the right tool when the webhook provider already guarantees a stable, opaque event ID per logical event — in that case, store that ID directly rather than computing a content digest.

---

## Why naive hashing breaks on spatial payloads

The JSON specification (RFC 8259) defines object key ordering as insignificant, yet serializers preserve insertion order. A webhook provider retrying a failed delivery might send `{"type":"Feature","geometry":{...}}` the first time and `{"geometry":{...},"type":"Feature"}` on the second attempt. Hashing both raw strings yields different digests, triggering double processing, state overwrites, or corrupted spatial indexes.

GeoJSON compounds this further. Coordinates are deeply nested float arrays, and different languages round IEEE-754 values differently during JSON serialization. The coordinate `-122.4194155` may arrive as `-122.41941550000001` from a Java client even though the values represent the same geographic point. Without rounding to a shared precision, your event bus treats two deliveries of the same sensor ping as distinct messages.

Robust [idempotency and spatial deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) requires treating the payload as a mathematical object rather than a raw byte stream. The four-step canonicalization pipeline below eliminates all sources of variance.

---

## Canonicalization pipeline — data flow

The diagram below shows how a raw webhook body moves through each transformation stage before reaching the hash function.

<figure class="fig">
<svg viewBox="0 66 760 132" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GeoJSON idempotency key generation pipeline">
  <title>GeoJSON idempotency key generation pipeline</title>
  <desc>A five-stage data-flow diagram: raw GeoJSON payload passes through an envelope stripper, then a float normaliser, then an alphabetical key sorter with compact serialisation, and finally a SHA-256 or BLAKE2b hash function that outputs the hex idempotency key.</desc>
  <rect x="0" y="66" width="760" height="132" fill="var(--fig-bg)"/>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L8,3.5 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Box 1: Raw GeoJSON -->
  <rect x="8" y="80" width="118" height="80" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="67" y="108" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Raw GeoJSON</text>
  <text x="67" y="124" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">webhook body</text>
  <text x="67" y="139" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">(dict or string)</text>
  <text x="67" y="182" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">INPUT</text>
  <line x1="126" y1="120" x2="148" y2="120" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 2: Strip Envelope -->
  <rect x="150" y="80" width="128" height="80" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="214" y="105" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">1. Strip</text>
  <text x="214" y="120" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Envelope</text>
  <text x="214" y="138" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">delivery_id</text>
  <text x="214" y="152" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">received_at …</text>
  <text x="214" y="182" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">STAGE 1</text>
  <line x1="278" y1="120" x2="300" y2="120" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 3: Float Normalise -->
  <rect x="302" y="80" width="128" height="80" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="366" y="105" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">2. Float</text>
  <text x="366" y="120" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Normalise</text>
  <text x="366" y="138" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">round(coord, 8)</text>
  <text x="366" y="152" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">recursive</text>
  <text x="366" y="182" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">STAGE 2</text>
  <line x1="430" y1="120" x2="452" y2="120" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 4: Key Sort + Compact -->
  <rect x="454" y="80" width="140" height="80" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="524" y="105" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">3. Sort Keys</text>
  <text x="524" y="120" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">+ Compact</text>
  <text x="524" y="138" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">sort_keys=True</text>
  <text x="524" y="152" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">separators=(",",":")</text>
  <text x="524" y="182" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">STAGE 3</text>
  <line x1="594" y1="120" x2="616" y2="120" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 5: Hash -->
  <rect x="618" y="80" width="134" height="80" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="685" y="105" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">4. Hash</text>
  <text x="685" y="120" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">SHA-256 / BLAKE2b</text>
  <text x="685" y="138" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">hex digest →</text>
  <text x="685" y="152" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">idempotency key</text>
  <text x="685" y="182" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">OUTPUT</text>
</svg>
<figcaption><b>Figure 1.</b> GeoJSON idempotency key generation pipeline</figcaption>
</figure>

---

## Complete runnable implementation

The function below is self-contained and uses only the Python standard library. It accepts a raw dict or a JSON string, making it drop-in safe for FastAPI request handlers, Celery tasks, or asyncio message consumers. Before canonicalizing, strip any envelope fields that vary per delivery (webhook gateway metadata, timestamps, signatures) — only the semantic payload should influence the key.

```python
import json
import hashlib
from typing import Any, Union


def _normalize_floats(obj: Any, precision: int) -> Any:
    """
    Recursively round floats to a fixed decimal precision.

    GeoJSON coordinates (EPSG:4326 / WGS84) are deeply nested float arrays.
    Different serializers (Python, Java, Go) produce slightly different
    IEEE-754 string representations for the same geographic value, e.g.
    -122.4194155 vs -122.41941550000001. Rounding to a shared precision
    before hashing neutralises this drift without losing spatial fidelity.
    RFC 7946 recommends 6 decimal places (~0.11 m); use 7–8 for sub-metre work.
    """
    if isinstance(obj, float):
        return round(obj, precision)
    if isinstance(obj, list):
        return [_normalize_floats(v, precision) for v in obj]
    if isinstance(obj, dict):
        return {k: _normalize_floats(v, precision) for k, v in obj.items()}
    return obj  # int, str, bool, None — pass through unchanged


# Fields that vary per delivery attempt and must be excluded before hashing.
# Extend this set for your gateway's envelope schema.
_EPHEMERAL_FIELDS = frozenset({
    "webhook_id", "delivery_id", "received_at", "timestamp",
    "x-signature", "x-hub-signature-256", "attempt",
})


def strip_ephemeral(payload: dict) -> dict:
    """Remove top-level delivery-envelope keys that change on every retry."""
    return {k: v for k, v in payload.items() if k not in _EPHEMERAL_FIELDS}


def generate_geojson_idempotency_key(
    payload: Union[dict, str],
    precision: int = 8,
    algorithm: str = "sha256",
    truncate_bytes: int = 0,
) -> str:
    """
    Return a deterministic hex digest for a GeoJSON payload.

    Args:
        payload:        Raw GeoJSON dict or a JSON string. Mixed CRS payloads
                        should be normalised to EPSG:4326 upstream before
                        calling this function.
        precision:      Decimal places for coordinate rounding (6–8 typical).
                        Values below 6 collapse distinct geographic points.
        algorithm:      Any hashlib name: 'sha256' (safe default) or 'blake2b'
                        (2–4× faster, equally collision-resistant for this use).
        truncate_bytes: Trim digest to this many bytes before hex-encoding.
                        16 bytes (32 hex chars) is safe for practical event
                        volumes while halving index storage.

    Returns:
        Lowercase hex string of the digest (or truncated digest).
    """
    if isinstance(payload, str):
        payload = json.loads(payload)

    # 1. Strip delivery-envelope metadata that changes per attempt.
    payload = strip_ephemeral(payload)

    # 2. Normalize floating-point coordinate precision to remove IEEE-754 drift.
    normalized = _normalize_floats(payload, precision)

    # 3. Produce a canonical JSON string: alphabetically sorted keys, no whitespace.
    #    ensure_ascii=False preserves multi-byte property values (e.g. place names)
    #    without percent-encoding, which could introduce encoding variance.
    canonical = json.dumps(
        normalized,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )

    # 4. Hash the canonical UTF-8 bytes.
    h = hashlib.new(algorithm, canonical.encode("utf-8"))
    digest = h.digest()

    if truncate_bytes > 0:
        digest = digest[:truncate_bytes]

    return digest.hex()
```

### Usage example

```python
# Two representations of the same feature — different key order, float drift.
delivery_1 = {
    "webhook_id": "wh-001",          # ephemeral — stripped before hashing
    "type": "Feature",
    "properties": {"sensor_id": "SN-42", "reading": 17.3},
    "geometry": {
        "type": "Point",
        "coordinates": [-73.96535500000001, 40.78286500000002],  # float drift
    },
}

delivery_2 = {
    "webhook_id": "wh-002",          # different delivery envelope
    "geometry": {                     # keys in a different order
        "coordinates": [-73.965355, 40.782865],
        "type": "Point",
    },
    "properties": {"sensor_id": "SN-42", "reading": 17.3},
    "type": "Feature",
}

key1 = generate_geojson_idempotency_key(delivery_1, precision=7, truncate_bytes=16)
key2 = generate_geojson_idempotency_key(delivery_2, precision=7, truncate_bytes=16)

assert key1 == key2  # identical digest — safe to deduplicate
print(key1)          # e.g. '3f8a92b1c4e7d05a' (32 hex chars)
```

---

## Parameter reference

<div style="overflow-x:auto;">

| Parameter | Type | Spatial constraint | Default |
|---|---|---|---|
| `payload` | `dict \| str` | Must be valid GeoJSON or a superset; geometry must be pre-projected to EPSG:4326 if you need cross-source deduplication | — |
| `precision` | `int` | 6 = ~0.11 m (RFC 7946 minimum); 8 = ~1.1 mm; do not exceed 10 (amplifies float noise) | `8` |
| `algorithm` | `str` | Any `hashlib` name; `sha256` or `blake2b` recommended; avoid MD5/SHA-1 | `"sha256"` |
| `truncate_bytes` | `int` | `0` = full digest; `16` = 128-bit, safe for ≤ 10⁹ events; `32` = full SHA-256 | `0` |

</div>

---

## Gotchas and spatial edge cases

1. **Precision below 6 collapses distinct points.** Rounding to 5 decimal places creates a grid cell ~1.1 m wide. Two sensor readings from opposite sides of a road merge to the same canonical form and produce the same key even though they represent different physical events. Use at least 6 decimal places for EPSG:4326 (WGS84) data.

2. **Mixed CRS payloads break cross-source deduplication.** A feature in EPSG:3857 (Web Mercator) and the same feature in EPSG:4326 will produce different coordinate arrays and therefore different keys, even after float normalization. Normalize all payloads to a single CRS — ideally EPSG:4326 as required by RFC 7946 — before canonicalization. The approach in [handling mixed CRS payloads in Python event handlers](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/) covers reprojection before this step.

3. **Coordinate ring orientation differences (Polygon winding order).** RFC 7946 mandates counter-clockwise exterior rings, but not all producers comply. A clockwise and a counter-clockwise representation of the same polygon produce identical geometry but different coordinate arrays, yielding different digests. Either validate and normalize ring orientation before hashing, or document that your key covers the serialized form, not the geometric shape.

4. **`null` geometry must be preserved, not filtered.** GeoJSON features can have `"geometry": null` (RFC 7946 §3.2). The recursive normalizer preserves `None` → `null` correctly; do not replace it with an empty dict or the key will shift.

5. **Unicode in property strings.** `ensure_ascii=False` lets property values like `"name": "São Paulo"` or `"区域": "北京"` serialize as UTF-8 rather than `\uXXXX` escape sequences. Mixing `ensure_ascii=True` and `ensure_ascii=False` across services produces different byte strings for the same semantic content — pick one and enforce it consistently.

6. **Numeric property values are also normalized.** `_normalize_floats` rounds floats inside `properties` as well as `geometry.coordinates`. If a property value is a measurement like `17.30000000000001` vs `17.3`, they will match after rounding. If you do not want property floats normalized, adapt the function to restrict rounding to coordinate paths only.

7. **Algorithm version changes invalidate all stored keys.** If you migrate from SHA-256 to BLAKE2b, existing keys in Redis or PostgreSQL will not match newly computed ones. Version the algorithm in your key store (e.g. prefix with `sha256:` or store an `algorithm` column), so you can run both in parallel during rollover.

---

## Verification snippet

Paste this into a test file and run with `pytest`:

```python
import pytest
from your_module import generate_geojson_idempotency_key  # adjust import path


FEATURE_A = {
    "type": "Feature",
    "properties": {"id": 1},
    "geometry": {"type": "Point", "coordinates": [-73.965355, 40.782865]},
}

# Same feature — key order shuffled, float drift on coordinates, delivery envelope added.
FEATURE_B = {
    "delivery_id": "retry-99",
    "geometry": {"coordinates": [-73.96535500000001, 40.78286500000002], "type": "Point"},
    "properties": {"id": 1},
    "type": "Feature",
}

# Genuinely different feature — same geometry, different property.
FEATURE_C = {
    "type": "Feature",
    "properties": {"id": 2},  # id differs
    "geometry": {"type": "Point", "coordinates": [-73.965355, 40.782865]},
}


def test_retry_produces_same_key():
    """Key must be identical for semantically equivalent retried deliveries."""
    assert (
        generate_geojson_idempotency_key(FEATURE_A)
        == generate_geojson_idempotency_key(FEATURE_B)
    )


def test_different_feature_produces_different_key():
    """Changing a property value must change the digest."""
    assert (
        generate_geojson_idempotency_key(FEATURE_A)
        != generate_geojson_idempotency_key(FEATURE_C)
    )


def test_truncation_produces_shorter_key():
    full = generate_geojson_idempotency_key(FEATURE_A)
    short = generate_geojson_idempotency_key(FEATURE_A, truncate_bytes=16)
    assert len(short) == 32          # 16 bytes → 32 hex chars
    assert full.startswith(short)    # truncation takes the leading bytes


def test_accepts_json_string():
    import json
    as_str = json.dumps(FEATURE_A)
    assert (
        generate_geojson_idempotency_key(as_str)
        == generate_geojson_idempotency_key(FEATURE_A)
    )


def test_precision_boundary():
    """Points that differ only beyond the precision threshold collapse to the same key."""
    near_a = {
        "type": "Feature", "properties": {},
        "geometry": {"type": "Point", "coordinates": [-73.9653550001, 40.7828650001]},
    }
    near_b = {
        "type": "Feature", "properties": {},
        "geometry": {"type": "Point", "coordinates": [-73.9653550002, 40.7828650002]},
    }
    # At precision=8 these differ; at precision=6 they collapse.
    assert (
        generate_geojson_idempotency_key(near_a, precision=6)
        == generate_geojson_idempotency_key(near_b, precision=6)
    )
    assert (
        generate_geojson_idempotency_key(near_a, precision=8)
        != generate_geojson_idempotency_key(near_b, precision=8)
    )
```

---

## Storing and checking keys in production

Once you have a key, store it in a low-latency idempotency store before processing the event. [Using Redis to cache spatial webhook signatures](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/) walks through the `SET NX PX` atomic check-and-set pattern that prevents race conditions under concurrent delivery. Set the TTL to match your webhook provider's retry window — typically 24–72 hours — and log the key alongside the canonical string length and algorithm version to simplify debugging during payload format migrations.

For payloads where the same geographic boundary may legitimately trigger multiple distinct events (zone entry, sensor threshold breach, status change), add an `event_type` field to the canonical form before hashing so semantically different events at the same geometry produce different keys.

---

## Frequently asked questions

### Why can't I just hash the raw JSON string from the webhook body?

Raw JSON strings carry insertion-order variance, float representation drift, and whitespace differences across serializers. Two payloads that are semantically identical will produce different digests if key order or decimal precision differs, causing false duplicate misses and double-processing.

### How many decimal places should I use for WGS84 coordinates?

RFC 7946 recommends 6 decimal places (~0.11 m resolution). Use 7–8 if you need centimetre-level fidelity. Go beyond 8 only when your source data genuinely carries that precision — extra digits amplify float serialization noise without adding geographic accuracy.

### Is SHA-256 or BLAKE2b better for webhook idempotency keys?

Both are collision-resistant for this use case. BLAKE2b is 2–4× faster on modern CPUs and is available in Python's standard library via `hashlib.blake2b`. SHA-256 is more universally recognised and works in all compliance contexts. Pick SHA-256 when auditability matters; BLAKE2b for high-throughput sub-millisecond paths.

### What if the same geographic boundary triggers multiple distinct events?

Include an `event_type` field (e.g. `"zone_entry"`, `"threshold_breach"`) in the canonical form before hashing. This ensures semantically different events at the same geometry produce different keys and are not collapsed as duplicates by your idempotency store.

---

## Related

- [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — parent: key design strategies across geometry types and event schemas
- [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — the full deduplication architecture for spatial webhook pipelines
- [Using Redis to Cache Spatial Webhook Signatures](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/) — storing and atomically checking the keys this page generates
- [Handling Mixed CRS Payloads in Python Event Handlers](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/) — normalizing EPSG codes before canonicalization
