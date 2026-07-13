---
title: "Protocol Buffers vs GeoJSON for High-Frequency Spatial Events"
description: "A decision guide for choosing GeoJSON or Protocol Buffers as the wire format for high-frequency spatial events, comparing payload size, parse CPU, schema evolution, and interop."
slug: "protocol-buffers-vs-geojson-for-high-frequency-spatial-events"
type: "article"
breadcrumb:
  - label: "Spatial Payload Routing & Parsing"
    url: "/spatial-payload-routing-parsing/"
  - label: "GeoJSON to Protobuf Mapping"
    url: "/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/"
  - label: "Protocol Buffers vs GeoJSON for High-Frequency Spatial Events"
    url: "/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/protocol-buffers-vs-geojson-for-high-frequency-spatial-events/"
datePublished: "2025-05-01"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Protocol Buffers vs GeoJSON for High-Frequency Spatial Events",
      "description": "A decision guide for choosing GeoJSON or Protocol Buffers as the wire format for high-frequency spatial events, comparing payload size, parse CPU, schema evolution, and interop.",
      "url": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/protocol-buffers-vs-geojson-for-high-frequency-spatial-events/",
      "datePublished": "2025-05-01",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Spatial Payload Routing & Parsing", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/" },
        { "@type": "ListItem", "position": 2, "name": "GeoJSON to Protobuf Mapping", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/" },
        { "@type": "ListItem", "position": 3, "name": "Protocol Buffers vs GeoJSON for High-Frequency Spatial Events", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/protocol-buffers-vs-geojson-for-high-frequency-spatial-events/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Choose a wire format for high-frequency spatial events",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Model the geometry both ways", "text": "Express one representative geometry as RFC 7946 GeoJSON and as an equivalent protobuf message with packed double coordinate fields." },
        { "@type": "HowToStep", "position": 2, "name": "Measure serialized size and parse cost", "text": "Serialize both forms, compare byte counts, and estimate parse and serialize CPU at your target events-per-second." },
        { "@type": "HowToStep", "position": 3, "name": "Pick per traffic class", "text": "Route low-frequency administrative webhooks as GeoJSON and high-frequency sensor firehoses as Protobuf, keeping GeoJSON as the canonical internal form." },
        { "@type": "HowToStep", "position": 4, "name": "Verify a lossless round trip", "text": "Assert that encoding then decoding reproduces the original coordinates within a defined tolerance before shipping the format to production." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Is Protocol Buffers always smaller than GeoJSON?",
          "acceptedAnswer": { "@type": "Answer", "text": "For coordinate-heavy geometries Protobuf with packed double fields is typically three to five times smaller than the equivalent RFC 7946 GeoJSON, because it drops key names, quotes, and the decimal-to-ASCII expansion of every number. For tiny payloads dominated by a single point the gap narrows, and gzip over GeoJSON closes much of it, so measure your own geometries before assuming a fixed ratio." }
        },
        {
          "@type": "Question",
          "name": "Why keep GeoJSON as the canonical internal form if Protobuf is on the wire?",
          "acceptedAnswer": { "@type": "Answer", "text": "GeoJSON is human-debuggable, tool-interoperable, and validatable against RFC 7946, which makes it the right shape for storage, logs, and idempotency hashing. Protobuf is a transport optimization. Decode to a canonical GeoJSON representation as soon as a message lands so every downstream stage sees one stable structure regardless of which format arrived on the wire." }
        },
        {
          "@type": "Question",
          "name": "Does switching wire formats break idempotency hashing?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes, if you hash the raw bytes. GeoJSON bytes and protobuf bytes for the same geometry differ completely, so the same event arriving in two formats produces two different keys and defeats deduplication. Hash a canonical decoded representation, not the wire bytes, so the key is format-independent." }
        }
      ]
    }
  ]
}
</script>

**For a low-frequency administrative webhook, send RFC 7946 GeoJSON; for a high-frequency sensor firehose above roughly 10,000 events per second, send Protocol Buffers with packed coordinate fields and keep GeoJSON as your canonical internal form.** This decision guide sits under [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/), part of [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/).

## When to use this pattern

The choice is a throughput and trust decision, not a matter of taste:

- **Reach for GeoJSON** when volume is modest (a few events per second), when third parties or humans read the payload, or when you want RFC 7946 validation and off-the-shelf tooling to work without a `.proto` schema. Feature-edit webhooks, boundary-change notifications, and admin callbacks all fit here.
- **Reach for Protocol Buffers** when you push a firehose of vehicle pings, IoT telemetry, or tracking updates at 10,000+ events per second, where every byte and every CPU cycle spent in the JSON tokenizer is multiplied across the fleet and directly drives your broker and compute bill.
- **This is not the right axis to optimize** when your bottleneck is a slow downstream database or a blocking geometry validator. Compressing the wire format will not help if a single `ST_IsValid` call dominates each event; profile first.

## Why the wire format matters at scale

GeoJSON is text. Every coordinate is written as ASCII digits, wrapped in a `"coordinates"` key, and surrounded by quotes, brackets, and whitespace. A single `[-73.985428, 40.748817]` position costs over twenty bytes and forces the receiver to run a JSON tokenizer and parse each number from a string. Protocol Buffers encodes the same position as two 8-byte IEEE 754 doubles in a packed field with a one-byte tag: no key names, no quotes, no decimal-to-ASCII expansion, and no tokenizer. At 10,000 events per second that structural difference compounds into megabytes per second of network and a measurable share of a CPU core.

The diagram shows the split most production systems converge on: a binary format on the hot path, GeoJSON everywhere a human or a generic tool touches the data, and a single canonical decode step that unifies them.

<svg viewBox="0 0 760 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Dual-format spatial event pipeline with a canonical GeoJSON core" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>Dual-format spatial event pipeline</title>
  <desc>A high-frequency sensor firehose sends Protobuf and a low-frequency admin webhook sends GeoJSON; both are decoded into one canonical GeoJSON form that feeds validation, idempotency hashing, and storage.</desc>
  <defs>
    <marker id="pb-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="8" y="24" width="170" height="52" rx="6" fill="currentColor" opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <text x="93" y="46" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">Sensor firehose</text>
  <text x="93" y="63" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">10k+/s · Protobuf</text>
  <rect x="8" y="200" width="170" height="52" rx="6" fill="currentColor" opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <text x="93" y="222" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">Admin webhook</text>
  <text x="93" y="239" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">low freq · GeoJSON</text>
  <line x1="178" y1="50" x2="288" y2="128" stroke="currentColor" stroke-width="1.5" opacity="0.55" marker-end="url(#pb-arr)"/>
  <line x1="178" y1="226" x2="288" y2="150" stroke="currentColor" stroke-width="1.5" opacity="0.55" marker-end="url(#pb-arr)"/>
  <rect x="292" y="112" width="176" height="56" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="380" y="135" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">Canonical decode</text>
  <text x="380" y="152" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">→ one GeoJSON form</text>
  <line x1="468" y1="140" x2="560" y2="60" stroke="currentColor" stroke-width="1.5" opacity="0.55" marker-end="url(#pb-arr)"/>
  <line x1="468" y1="140" x2="560" y2="140" stroke="currentColor" stroke-width="1.5" opacity="0.55" marker-end="url(#pb-arr)"/>
  <line x1="468" y1="140" x2="560" y2="220" stroke="currentColor" stroke-width="1.5" opacity="0.55" marker-end="url(#pb-arr)"/>
  <rect x="562" y="34" width="190" height="46" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="657" y="61" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif">RFC 7946 validation</text>
  <rect x="562" y="117" width="190" height="46" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="657" y="144" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif">Idempotency hashing</text>
  <rect x="562" y="200" width="190" height="46" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="657" y="227" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif">Storage / PostGIS</text>
</svg>

### Head-to-head comparison

The multipliers below are representative for coordinate-dense geometries (lines and polygons with tens to hundreds of vertices) and are illustrative starting points; your own geometries and CPUs will vary, so treat them as a hypothesis to measure, not a guarantee.

| Dimension | GeoJSON (RFC 7946) | Protocol Buffers (packed / WKB) |
| --- | --- | --- |
| Wire size (uncompressed) | 1.0x baseline | ~0.25x-0.35x (3-4x smaller) |
| Wire size (gzipped) | ~0.35x baseline | ~0.25x-0.30x |
| Parse CPU at 10k+/s | 1.0x baseline | ~0.15x-0.30x (3-6x cheaper) |
| Serialize CPU | 1.0x baseline | ~0.3x-0.5x |
| Schema enforcement | none on the wire; validate against RFC 7946 | strong, compiled from `.proto` |
| Schema evolution | ad hoc, additive by convention | field numbers, reserved tags, backward-compatible |
| Human debuggability | excellent (plain text) | poor (needs the schema to decode) |
| Tool interop | universal (browsers, PostGIS, QGIS) | requires generated stubs on both ends |
| Coordinate fidelity | full double precision as text | full `double`, or lossy if you pick `float` |

The pattern is consistent: Protobuf wins decisively on size and CPU, GeoJSON wins decisively on debuggability, validation-by-standard, and interop. High-frequency machine-to-machine traffic values the former; low-frequency human-facing traffic values the latter.

## Complete runnable implementation

The script below defines one geometry as GeoJSON and as an equivalent protobuf message, then measures serialized sizes. The `.proto` is shown first so you can regenerate the stubs; the runnable Python uses a tiny hand-written encoder so it executes without the `protoc` toolchain while matching the exact wire layout `protoc` would emit for packed `double` fields. For the WKB-inside-Protobuf alternative, see [Converting WKT to Protobuf for Low-Latency Routing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/converting-wkt-to-protobuf-for-low-latency-routing/).

```protobuf
// spatial_event.proto  — compile with: protoc --python_out=. spatial_event.proto
syntax = "proto3";
package spatial;

// A LineString as flat, packed coordinate pairs in EPSG:4326 (WGS84).
// Storing lon/lat as parallel packed doubles keeps the payload dense.
message LineString {
  repeated double lon = 1 [packed = true];  // longitude first, per RFC 7946
  repeated double lat = 2 [packed = true];  // latitude second
}

message SpatialEvent {
  string event_id   = 1;
  int64  emitted_at = 2;   // unix millis
  LineString geometry = 3;
}
```

```python
"""Compare serialized size of one geometry as GeoJSON vs Protobuf.

Runs with only the standard library. The _pack_geometry function emits the
exact bytes proto3 would produce for two packed `double` fields (tag,
length-prefix, then little-endian float64 values), so the size comparison is
faithful without needing the protoc-generated class installed.
"""
import json
import struct

# One geometry: a short LineString in EPSG:4326 (WGS84), lon/lat order.
COORDS = [
    [-73.985428, 40.748817],
    [-73.984100, 40.750500],
    [-73.982900, 40.752100],
    [-73.981700, 40.753800],
]

# --- GeoJSON form (RFC 7946) ---
geojson = {
    "type": "Feature",
    "geometry": {"type": "LineString", "coordinates": COORDS},
    "properties": {"event_id": "evt-42"},
}
geojson_bytes = json.dumps(geojson, separators=(",", ":")).encode("utf-8")

# --- Protobuf form: two packed double fields (field 1 = lon, field 2 = lat) ---
def _packed_double_field(field_number: int, values: list[float]) -> bytes:
    payload = b"".join(struct.pack("<d", v) for v in values)  # little-endian float64
    tag = (field_number << 3) | 2  # wire type 2 = length-delimited
    return bytes([tag]) + _varint(len(payload)) + payload

def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)

def encode_protobuf(coords: list[list[float]]) -> bytes:
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return _packed_double_field(1, lons) + _packed_double_field(2, lats)

protobuf_bytes = encode_protobuf(COORDS)

# --- Decode the protobuf back to coordinates for the round trip ---
def decode_protobuf(buf: bytes) -> list[list[float]]:
    fields: dict[int, list[float]] = {}
    i = 0
    while i < len(buf):
        tag = buf[i]; i += 1
        field_number = tag >> 3
        length, i = _read_varint(buf, i)
        block = buf[i:i + length]; i += length
        fields[field_number] = [
            struct.unpack("<d", block[j:j + 8])[0] for j in range(0, len(block), 8)
        ]
    return [[lon, lat] for lon, lat in zip(fields[1], fields[2])]

def _read_varint(buf: bytes, i: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        b = buf[i]; i += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, i
        shift += 7

if __name__ == "__main__":
    print(f"GeoJSON bytes : {len(geojson_bytes)}")
    print(f"Protobuf bytes: {len(protobuf_bytes)}")
    print(f"ratio         : {len(protobuf_bytes) / len(geojson_bytes):.2f}x")
    # Confirm the binary form is a faithful, lossless carrier of the geometry.
    assert decode_protobuf(protobuf_bytes) == COORDS
    print("round trip OK")
```

Running it prints the two byte counts and their ratio. For this four-vertex line the protobuf form is well under half the GeoJSON size; add vertices and the gap widens because the per-coordinate overhead in text grows while the binary form stays at a flat 8 bytes per ordinate.

## Parameter reference

The settings below change correctness or the size/CPU trade-off, not just style. Coordinate constraints assume RFC 7946, EPSG:4326 (WGS84), longitude first.

| Parameter | Type | Spatial constraint / effect | Default |
| --- | --- | --- | --- |
| coordinate scalar | `double` vs `float` | `double` preserves full GeoJSON precision; `float` halves size but truncates to ~7 significant digits, shifting positions by meters | `double` |
| `packed = true` | proto3 field option | Packs a repeated numeric field into one length-delimited block; without it each value carries its own tag and inflates size | packed for scalars in proto3 |
| coordinate order | field convention | Must be lon then lat to match RFC 7946; swapping silently mirrors geometry across the diagonal | none enforced |
| field numbers | int tags | Immutable once shipped; reuse of a retired number corrupts old readers, so `reserved` retired tags | none |
| `emitted_at` | `int64` millis | Cheaper and unambiguous versus an ISO timestamp string; avoids timezone parsing on the hot path | none |
| gzip on GeoJSON | transport flag | Recovers much of the size gap for text but adds compression CPU per event | off |
| canonical decode target | representation | Decode every wire format to one GeoJSON shape before hashing or storage | none |

## Gotchas and spatial edge cases

1. **Float precision loss in packed fields.** Choosing `float` (32-bit) instead of `double` to save bytes truncates coordinates to roughly seven significant digits. At mid latitudes that is meters of drift, enough to move a point across a parcel boundary. Use `double` for any coordinate you will store or compare, and reserve `float` for disposable low-accuracy telemetry only.
2. **Coordinate order (lon/lat) is unlabeled in binary.** GeoJSON text at least has a spec you can cite; a packed double field is just numbers. If a producer packs lat first, every geometry is mirrored across the diagonal and nothing errors. Pin the order in the `.proto` comment and assert it in a round-trip test.
3. **Losing RFC 7946 validation.** Protobuf enforces field types, not spatial validity. It will happily carry an unclosed polygon ring, a self-intersecting boundary, or a longitude of 500. Keep the standards-based checks from [Parsing GeoJSON Webhooks with FastAPI and Pydantic](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/parsing-geojson-webhooks-with-fastapi-and-pydantic/) on the canonical form after you decode.
4. **Schema migration.** Never renumber or reuse a field tag once a message is in production; readers key on the number, not the name. Add new fields with fresh numbers and mark retired ones `reserved` so an old consumer skips unknown fields instead of misreading them.
5. **Mixing formats breaks idempotency hashing.** If you hash raw wire bytes, the same event arriving once as GeoJSON and once as Protobuf yields two different keys and slips past deduplication. Hash a canonical decoded representation instead, per [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/), so the key is format-independent.
6. **Elevation and the optional third ordinate.** RFC 7946 allows a `[lon, lat, elevation]` position. A rigid two-field packed schema silently drops the elevation. Model the optional third ordinate explicitly if any producer emits 3D positions.

## Verification

The round-trip assertion is the contract that lets you trust a binary wire format: encode, decode, and confirm the geometry is unchanged. Run the following with `pytest`; it reuses the encoder and decoder from the implementation above.

```python
import struct

from spatial_size import COORDS, encode_protobuf, decode_protobuf

def test_protobuf_round_trip_is_lossless():
    # Encoding then decoding must reproduce every ordinate exactly with double.
    assert decode_protobuf(encode_protobuf(COORDS)) == COORDS

def test_float_would_lose_precision():
    # Demonstrates WHY the schema uses double: a 32-bit round trip drifts.
    lon = COORDS[0][0]
    as_float = struct.unpack("<f", struct.pack("<f", lon))[0]  # 32-bit round trip
    assert as_float != lon  # float32 cannot hold the full coordinate
    assert abs(as_float - lon) < 1e-4  # but the error is small and silent

def test_protobuf_is_smaller_than_geojson():
    import json
    gj = json.dumps({"type": "LineString", "coordinates": COORDS}).encode()
    assert len(encode_protobuf(COORDS)) < len(gj)
```

A passing run proves three things at once: the binary form is a lossless carrier of the geometry under `double`, `float` would have introduced silent drift, and the protobuf payload is genuinely smaller for the same coordinates. That is the whole trade-off in three assertions.

## FAQ

<details class="faq">
<summary><strong>Is Protocol Buffers always smaller than GeoJSON?</strong></summary>

For coordinate-heavy geometries Protobuf with packed double fields is typically three to five times smaller than the equivalent RFC 7946 GeoJSON, because it drops key names, quotes, and the decimal-to-ASCII expansion of every number. For tiny payloads dominated by a single point the gap narrows, and gzip over GeoJSON closes much of it, so measure your own geometries before assuming a fixed ratio.

</details>

<details class="faq">
<summary><strong>Why keep GeoJSON as the canonical internal form if Protobuf is on the wire?</strong></summary>

GeoJSON is human-debuggable, tool-interoperable, and validatable against RFC 7946, which makes it the right shape for storage, logs, and idempotency hashing. Protobuf is a transport optimization. Decode to a canonical GeoJSON representation as soon as a message lands so every downstream stage sees one stable structure regardless of which format arrived on the wire.

</details>

<details class="faq">
<summary><strong>Does switching wire formats break idempotency hashing?</strong></summary>

Yes, if you hash the raw bytes. GeoJSON bytes and protobuf bytes for the same geometry differ completely, so the same event arriving in two formats produces two different keys and defeats deduplication. Hash a canonical decoded representation, not the wire bytes, so the key is format-independent.

</details>

## Related

- [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/) — the mapping layer that turns validated GeoJSON into the binary messages this guide benchmarks.
- [Parsing GeoJSON Webhooks with FastAPI and Pydantic](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/parsing-geojson-webhooks-with-fastapi-and-pydantic/) — enforce RFC 7946 validity on the canonical form before or after the wire hop.
- [Converting WKT to Protobuf for Low-Latency Routing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/converting-wkt-to-protobuf-for-low-latency-routing/) — the WKB-inside-Protobuf alternative to packed coordinate fields.
