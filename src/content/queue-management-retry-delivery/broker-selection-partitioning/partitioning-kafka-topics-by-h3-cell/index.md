---
title: "Partitioning Kafka Topics by H3 Cell"
description: "Use a coarse H3 cell id as the Kafka partition key so spatially-adjacent spatial events co-locate on one partition and per-region ordering survives across retries."
slug: "partitioning-kafka-topics-by-h3-cell"
type: "article"
breadcrumb:
  - label: "Queue Management, Retries & Delivery Guarantees"
    url: "/queue-management-retry-delivery/"
  - label: "Broker Selection & Partitioning for Spatial Streams"
    url: "/queue-management-retry-delivery/broker-selection-partitioning/"
  - label: "Partitioning Kafka Topics by H3 Cell"
    url: "/queue-management-retry-delivery/broker-selection-partitioning/partitioning-kafka-topics-by-h3-cell/"
datePublished: "2025-05-20"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Partitioning Kafka Topics by H3 Cell",
      "description": "Use a coarse H3 cell id as the Kafka partition key so spatially-adjacent events co-locate on one partition and per-region ordering survives across retries.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/partitioning-kafka-topics-by-h3-cell/",
      "datePublished": "2025-05-20",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Queue Management, Retries & Delivery Guarantees", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/" },
        { "@type": "ListItem", "position": 2, "name": "Broker Selection & Partitioning for Spatial Streams", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/" },
        { "@type": "ListItem", "position": 3, "name": "Partitioning Kafka Topics by H3 Cell", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/partitioning-kafka-topics-by-h3-cell/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Partition a Kafka Topic by H3 Cell",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Derive the geometry centroid", "text": "Compute a representative point (centroid) for the incoming GeoJSON geometry in EPSG:4326 (WGS84) so that every event resolves to a single latitude/longitude pair." },
        { "@type": "HowToStep", "position": 2, "name": "Index to a coarse H3 cell", "text": "Call h3.latlng_to_cell on the centroid at a deliberately coarse partitioning resolution so that all fine-grained events in a region share one cell id." },
        { "@type": "HowToStep", "position": 3, "name": "Produce with the cell id as the key", "text": "Encode the H3 cell id as the aiokafka message key so Kafka's default murmur2 hashing maps every event in that cell to the same partition, preserving per-cell ordering." },
        { "@type": "HowToStep", "position": 4, "name": "Mitigate hot partitions", "text": "For dense cities that overflow one partition, salt the key with a bounded sub-key so a single hot cell fans out across a fixed number of partitions while keeping ordering per sub-key." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why use a coarse H3 resolution for the partition key instead of the analytics resolution?",
          "acceptedAnswer": { "@type": "Answer", "text": "The partition key controls co-location and ordering, not analytical precision. A coarse resolution (typically 4–6) groups a whole neighbourhood or metro area onto one partition so adjacent events stay ordered together, while a much finer resolution (9–12) is stored in the payload for aggregation. Using the fine resolution as the key would create millions of distinct keys, defeating co-location and spreading a single street across many partitions." }
        },
        {
          "@type": "Question",
          "name": "Does the same H3 cell always map to the same Kafka partition?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes, provided the key bytes and the partition count are stable. Kafka's default partitioner hashes the key with murmur2 and takes it modulo the partition count, so an identical key string deterministically lands on the same partition. If you add partitions to the topic later, the modulo changes and existing keys can move — plan partition count up front." }
        },
        {
          "@type": "Question",
          "name": "How do I stop a dense city like Manhattan from creating a hot partition?",
          "acceptedAnswer": { "@type": "Answer", "text": "Salt the key: append a bounded sub-key (for example event_id modulo N) to the H3 cell id so one hot cell fans out across N partitions instead of one. You keep ordering per sub-key rather than per cell, which is acceptable when your consumer only needs ordering within a device or feature id. Monitor per-partition throughput so you only salt cells that actually overflow." }
        },
        {
          "@type": "Question",
          "name": "What resolution should I choose for the partition key?",
          "acceptedAnswer": { "@type": "Answer", "text": "Start at resolution 5 (average edge ~8.5 km, roughly metro-district sized) and validate the key cardinality against your partition count. Too coarse and a handful of cells carry all traffic; too fine and co-location collapses. Tune with real traffic and watch partition skew rather than guessing." }
        }
      ]
    }
  ]
}
</script>

**To partition a Kafka topic by H3 cell: compute the centroid of each GeoJSON geometry in EPSG:4326 (WGS84), index it to a deliberately coarse H3 cell with `h3.latlng_to_cell`, and use that cell id as the aiokafka message key so Kafka's murmur2 partitioner co-locates every event in the region on one partition and preserves per-cell ordering.** The coarse cell is the routing key only — you keep a finer H3 index in the payload for analytics.

This page sits inside [Broker Selection & Partitioning for Spatial Streams](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/), part of the [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/) architecture — the reference section for moving spatial events through brokers without losing order or overwhelming a single partition.

---

## When to use this pattern

Reach for H3-keyed partitioning when:

- Your consumers depend on **per-region ordering** — for example a stateful geofence engine or map-tile invalidator that must apply events for one area in the sequence they occurred, but does not care about global ordering across the whole planet.
- Spatially-adjacent events should be **processed by the same consumer instance** to exploit warm caches, shared spatial indexes, or per-region rate limits.
- You want a **deterministic, stateless routing rule** — any producer can compute the same partition for the same location without coordinating.

It is not the right tool when every event must be globally ordered (use a single partition and accept the throughput ceiling), or when your workload has no locality at all and you simply want even load — in that case a random or round-robin key spreads traffic more evenly than any spatial scheme.

---

## Why the partitioning resolution differs from the analytics resolution

Kafka guarantees ordering only *within a partition*, and it assigns a message to a partition by hashing the record key. So the key you choose is the unit of ordering and co-location. If you key on a fine-grained H3 cell (resolution 9, edge ~174 m), a single city block becomes its own key: a busy street splinters across dozens of partitions, adjacent events lose their shared order, and consumers can no longer keep regional state warm.

The fix is to decouple the two roles H3 plays. Use a **coarse resolution for the partition key** so a whole neighbourhood or metro district collapses into one cell and one partition, and keep a **fine resolution in the payload** for downstream aggregation and heat-mapping. H3's hierarchy makes this cheap: a fine cell is always fully contained by exactly one coarse parent, so `h3.cell_to_parent` recovers the routing cell from the analytics cell without touching the original coordinates. Choosing the index family itself — H3 versus alternatives — is covered in [H3 vs S2 vs Quadkey for spatial partitioning](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/); this page assumes you have already settled on H3.

<svg viewBox="0 0 760 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="H3-keyed Kafka partitioning data flow" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>H3-keyed Kafka partitioning data flow</title>
  <desc>A GeoJSON event has its centroid computed, is indexed to a coarse H3 cell used as the partition key, and murmur2 hashing maps that key to one of three partitions; two nearby events share a cell and therefore land on the same partition, preserving per-cell order.</desc>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L8,3.5 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Box 1: GeoJSON event -->
  <rect x="8" y="90" width="128" height="80" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="72" y="118" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">GeoJSON event</text>
  <text x="72" y="134" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">geometry →</text>
  <text x="72" y="148" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">centroid (EPSG:4326)</text>
  <text x="72" y="188" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">INPUT</text>
  <line x1="136" y1="130" x2="158" y2="130" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 2: coarse H3 -->
  <rect x="160" y="90" width="150" height="80" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="235" y="114" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Coarse H3 cell</text>
  <text x="235" y="130" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">latlng_to_cell(res=5)</text>
  <text x="235" y="145" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">= partition key</text>
  <text x="235" y="188" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">KEY</text>
  <line x1="310" y1="130" x2="332" y2="130" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 3: murmur2 -->
  <rect x="334" y="90" width="130" height="80" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="399" y="120" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">murmur2 %</text>
  <text x="399" y="136" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">partitions</text>
  <text x="399" y="188" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.45">HASH</text>
  <line x1="464" y1="130" x2="486" y2="130" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Partitions -->
  <rect x="600" y="40" width="150" height="50" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="675" y="70" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">partition 0</text>
  <rect x="600" y="105" width="150" height="50" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.5"/>
  <text x="675" y="128" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">partition 1</text>
  <text x="675" y="143" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">both nearby events</text>
  <rect x="600" y="170" width="150" height="50" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="675" y="200" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">partition 2</text>
  <line x1="488" y1="120" x2="598" y2="70" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="488" y1="130" x2="598" y2="128" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="488" y1="140" x2="598" y2="192" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5" marker-end="url(#arr)"/>
</svg>

---

## Complete runnable implementation

The producer below is self-contained. It takes a GeoJSON feature, derives a centroid in EPSG:4326 (WGS84), indexes it to a coarse H3 cell, and produces to Kafka with that cell id as the key. It uses `h3` (v4 API), `shapely` for the centroid, and `aiokafka` for the async producer. The key is encoded as UTF-8 bytes so Kafka's default murmur2 partitioner hashes it deterministically.

```python
import asyncio
import json
from typing import Any

import h3                          # h3 v4.x
from shapely.geometry import shape  # shapely 2.x
from aiokafka import AIOKafkaProducer

# --- Configuration -----------------------------------------------------------
# Coarse resolution used ONLY for the partition key. Res 5 ~= 8.5 km edge,
# roughly a metro district: fine enough for locality, coarse enough that
# a whole neighbourhood shares one partition and stays ordered together.
PARTITION_RESOLUTION = 5
# Finer resolution carried in the payload for downstream analytics/heatmaps.
ANALYTICS_RESOLUTION = 9
TOPIC = "spatial-events"
BOOTSTRAP = "localhost:9092"


def geometry_centroid_latlng(geometry: dict) -> tuple[float, float]:
    """
    Return (lat, lng) of a GeoJSON geometry's centroid in EPSG:4326 (WGS84).

    h3.latlng_to_cell expects latitude first, longitude second, whereas
    GeoJSON coordinate arrays are [lng, lat] per RFC 7946 — so we swap.
    For a MultiPolygon, shapely's .centroid is the area-weighted centroid of
    all parts, which can fall in open water between islands; see the gotchas.
    """
    geom = shape(geometry)          # accepts any RFC 7946 geometry dict
    c = geom.centroid               # a shapely Point in the same CRS (EPSG:4326)
    return (c.y, c.x)               # (lat, lng)


def partition_key_for(geometry: dict, resolution: int = PARTITION_RESOLUTION) -> str:
    """Coarse H3 cell id (hex string) used as the Kafka partition key."""
    lat, lng = geometry_centroid_latlng(geometry)
    return h3.latlng_to_cell(lat, lng, resolution)


def analytics_cell_for(geometry: dict, resolution: int = ANALYTICS_RESOLUTION) -> str:
    """Fine H3 cell id stored in the payload — never used for partitioning."""
    lat, lng = geometry_centroid_latlng(geometry)
    return h3.latlng_to_cell(lat, lng, resolution)


async def produce_event(producer: AIOKafkaProducer, event: dict[str, Any]) -> None:
    """Serialize an event and produce it keyed by its coarse H3 cell."""
    geometry = event["geometry"]
    key = partition_key_for(geometry)                 # e.g. '85283473fffffff'

    # Enrich the payload with the fine cell so consumers get analytics
    # precision without changing the routing key.
    enriched = {**event, "h3_analytics": analytics_cell_for(geometry)}

    await producer.send_and_wait(
        TOPIC,
        key=key.encode("utf-8"),                      # murmur2 hashes these bytes
        value=json.dumps(enriched).encode("utf-8"),
    )


async def main() -> None:
    # Two distinct fine-grained events in the same coarse cell (both in
    # lower Manhattan) — they must land on the SAME partition.
    feature_a = {
        "type": "Feature",
        "properties": {"device": "sensor-a"},
        "geometry": {"type": "Point", "coordinates": [-74.0060, 40.7128]},
    }
    feature_b = {
        "type": "Feature",
        "properties": {"device": "sensor-b"},
        "geometry": {"type": "Point", "coordinates": [-74.0035, 40.7145]},
    }

    producer = AIOKafkaProducer(bootstrap_servers=BOOTSTRAP)
    await producer.start()
    try:
        await produce_event(producer, feature_a)
        await produce_event(producer, feature_b)
    finally:
        await producer.stop()


if __name__ == "__main__":
    asyncio.run(main())
```

---

## Parameter reference

<div style="overflow-x:auto;">

| Parameter | Type | Spatial constraint / role | Default |
|---|---|---|---|
| `PARTITION_RESOLUTION` | `int` | H3 resolution for the **key**. 4–6 recommended; too fine destroys co-location, too coarse concentrates traffic. Res 5 ≈ 8.5 km edge | `5` |
| `ANALYTICS_RESOLUTION` | `int` | H3 resolution stored in the **payload** only; typically 9–12 for aggregation. Never used to route | `9` |
| `key` (aiokafka) | `bytes` | UTF-8 encoded H3 cell id. Must be stable bytes — the same cell must always encode identically | — |
| centroid CRS | — | Must be EPSG:4326 (WGS84); `h3.latlng_to_cell` assumes degrees, lat before lng | EPSG:4326 |
| topic partition count | `int` | Fixed at creation; murmur2 hash is taken modulo this. Adding partitions later remaps existing keys | set up front |

</div>

---

## Gotchas and spatial edge cases

1. **Too-fine a resolution causes partition skew.** If the key resolution is finer than your traffic locality, most cells hold one event and co-location collapses; if it is coarse but your traffic is concentrated, a few cells carry everything. Both show up as uneven per-partition throughput — track it with [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/) and tune the resolution against real traffic rather than guessing.

2. **Hot partitions over dense cities.** A coarse cell over Manhattan or central Tokyo can out-produce every other partition combined. Salt the key for known-hot cells only: `f"{cell}:{event_id % N}"` fans one cell across `N` partitions. You trade per-cell ordering for per-sub-key ordering, so only do this where the consumer orders by device/feature id, not by whole region.

3. **Boundary-straddling geometries jump cells.** A line or polygon that crosses an H3 cell edge has a centroid that can fall on either side depending on tiny coordinate changes, so two near-identical geometries route to different partitions. If stable routing matters more than geometric accuracy, snap to a canonical anchor (e.g. the first vertex) instead of the centroid, and document the choice.

4. **MultiPolygon centroid can land in the wrong place.** Shapely's area-weighted centroid of a MultiPolygon (say, an archipelago) can fall in open water between the parts, indexing to a cell that contains none of the geometry. For multipart geometries, prefer the centroid of the largest part, or a representative point (`geom.representative_point()`), which is guaranteed to lie inside the geometry.

5. **Key-to-partition hashing must be deterministic across producers.** Kafka's default partitioner uses murmur2 over the raw key bytes. If one producer sends the cell id as a UTF-8 string and another sends it as a packed 64-bit integer, identical cells hash differently and ordering breaks. Standardise the key encoding (this page uses the lowercase hex string) across every producer.

6. **Changing partition count remaps keys.** murmur2 is taken modulo the partition count, so growing a topic from 12 to 24 partitions moves most existing cells to new partitions and can interleave old and new orderings during the transition. Provision partition count for peak up front, or use a sticky consumer-side reshard strategy.

7. **Null or empty geometry has no centroid.** RFC 7946 permits `"geometry": null`. Guard for it before calling `shape()` and route null-geometry events to a dedicated fallback key so they do not crash the producer or silently collapse onto partition 0.

---

## Verification

This snippet asserts the two core invariants: the same coarse cell always yields the same partition, and two nearby fine-grained events share it. It reimplements Kafka's murmur2-modulo mapping so the test runs without a live broker.

```python
import h3

PARTITION_RESOLUTION = 5


def _murmur2(data: bytes) -> int:
    """Kafka's murmur2 (matches the JVM DefaultPartitioner)."""
    length = len(data)
    seed = 0x9747B28C
    m, r = 0x5BD1E995, 24
    h = (seed ^ length) & 0xFFFFFFFF
    for i in range(0, length - length % 4, 4):
        k = (data[i] | data[i + 1] << 8 | data[i + 2] << 16 | data[i + 3] << 24)
        k = (k * m) & 0xFFFFFFFF
        k ^= (k >> r)
        k = (k * m) & 0xFFFFFFFF
        h = (h * m) & 0xFFFFFFFF
        h ^= k
    rem = length % 4
    if rem >= 3:
        h ^= data[length - rem + 2] << 16
    if rem >= 2:
        h ^= data[length - rem + 1] << 8
    if rem >= 1:
        h ^= data[length - rem]
        h = (h * m) & 0xFFFFFFFF
    h ^= (h >> 13)
    h = (h * m) & 0xFFFFFFFF
    h ^= (h >> 15)
    return h


def partition_for(cell: str, num_partitions: int) -> int:
    # Kafka masks the sign bit, then takes modulo the partition count.
    return (_murmur2(cell.encode("utf-8")) & 0x7FFFFFFF) % num_partitions


def cell_for(lng: float, lat: float) -> str:
    return h3.latlng_to_cell(lat, lng, PARTITION_RESOLUTION)


def test_same_cell_same_partition():
    # Two distinct points in lower Manhattan resolve to one coarse cell.
    cell_a = cell_for(-74.0060, 40.7128)
    cell_b = cell_for(-74.0035, 40.7145)
    assert cell_a == cell_b                       # same coarse H3 cell
    assert partition_for(cell_a, 12) == partition_for(cell_b, 12)


def test_distant_cell_may_differ():
    manhattan = cell_for(-74.0060, 40.7128)
    london = cell_for(-0.1278, 51.5074)
    assert manhattan != london                    # different cells entirely


def test_partition_is_deterministic():
    cell = cell_for(-74.0060, 40.7128)
    assert partition_for(cell, 12) == partition_for(cell, 12)
```

---

## FAQ

<details class="faq">
<summary><strong>Why use a coarse H3 resolution for the partition key instead of the analytics resolution?</strong></summary>

The partition key controls co-location and ordering, not analytical precision. A coarse resolution (typically 4–6) groups a whole neighbourhood or metro area onto one partition so adjacent events stay ordered together, while a much finer resolution (9–12) is stored in the payload for aggregation. Using the fine resolution as the key would create millions of distinct keys, defeating co-location and spreading a single street across many partitions.

</details>

<details class="faq">
<summary><strong>Does the same H3 cell always map to the same Kafka partition?</strong></summary>

Yes, provided the key bytes and the partition count are stable. Kafka's default partitioner hashes the key with murmur2 and takes it modulo the partition count, so an identical key string deterministically lands on the same partition. If you add partitions to the topic later, the modulo changes and existing keys can move — plan partition count up front.

</details>

<details class="faq">
<summary><strong>How do I stop a dense city like Manhattan from creating a hot partition?</strong></summary>

Salt the key: append a bounded sub-key (for example `event_id % N`) to the H3 cell id so one hot cell fans out across `N` partitions instead of one. You keep ordering per sub-key rather than per cell, which is acceptable when your consumer only needs ordering within a device or feature id. Monitor per-partition throughput so you only salt cells that actually overflow.

</details>

<details class="faq">
<summary><strong>What resolution should I choose for the partition key?</strong></summary>

Start at resolution 5 (average edge ~8.5 km, roughly metro-district sized) and validate the key cardinality against your partition count. Too coarse and a handful of cells carry all traffic; too fine and co-location collapses. Tune with real traffic and watch partition skew rather than guessing.

</details>

---

## Related

- [Broker Selection & Partitioning for Spatial Streams](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/) — parent: choosing brokers and partition schemes for spatial event streams
- [H3 vs S2 vs Quadkey for Spatial Partitioning](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/) — picking the spatial index family before you key on it
- [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/) — detecting the hot-partition skew this pattern can introduce
