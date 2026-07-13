---
title: "Broker Selection & Partitioning for Spatial Streams"
description: "Choose a message broker for geospatial webhook streams and partition spatial events by H3, geohash, or S2 so related events preserve ordering without hot partitions."
slug: "broker-selection-partitioning"
type: "cluster"
breadcrumb: "Queue Management, Retries & Delivery Guarantees > Broker Selection & Partitioning for Spatial Streams"
datePublished: "2025-02-10"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Broker Selection & Partitioning for Spatial Streams",
      "description": "How to select a message broker for geospatial webhook streams and partition spatial events by H3 cell, geohash prefix, S2 token, or admin region so geographically related events preserve per-locality ordering without creating hot partitions.",
      "url": "https://geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/",
      "datePublished": "2025-02-10",
      "dateModified": "2026-07-13",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Queue Management, Retries & Delivery Guarantees", "item": "https://geospatialwebhook.com/queue-management-retry-delivery/"},
        {"@type": "ListItem", "position": 3, "name": "Broker Selection & Partitioning for Spatial Streams", "item": "https://geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Select and partition a broker for geospatial webhook streams",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Profile throughput, ordering, and ops requirements to shortlist a broker"},
        {"@type": "HowToStep", "position": 2, "name": "Derive a spatial partition key from an H3 cell, geohash prefix, or S2 token"},
        {"@type": "HowToStep", "position": 3, "name": "Publish events with an aiokafka producer keyed by the spatial partition key"},
        {"@type": "HowToStep", "position": 4, "name": "Consume with a Redis Streams consumer group and acknowledge per message"},
        {"@type": "HowToStep", "position": 5, "name": "Detect and remedy hot partitions caused by dense geographies"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should I partition spatial streams by raw latitude/longitude instead of an index cell?",
          "acceptedAnswer": {"@type": "Answer", "text": "No. Raw coordinates are effectively unique per event, so hashing them scatters events for one locality across every partition and destroys per-locality ordering and cache locality. Quantise the coordinate to a discrete cell first — an H3 cell at resolution 5 to 7, a geohash prefix, or an S2 token — and use that stable cell id as the partition key so all events in the same area land on the same partition."}
        },
        {
          "@type": "Question",
          "name": "How do I stop a dense city from creating a hot partition?",
          "acceptedAnswer": {"@type": "Answer", "text": "Coarse cells concentrate load. Use a finer resolution so a single dense metro spreads across many cells, or apply a salted composite key of the form cell:bucket for the hottest cells only, sizing the bucket count to the skew you observe. Salting trades strict per-cell ordering for load balance, so apply it selectively to cells that exceed a load threshold rather than uniformly across the keyspace."}
        },
        {
          "@type": "Question",
          "name": "Does keying by partition guarantee global ordering across the whole stream?",
          "acceptedAnswer": {"@type": "Answer", "text": "No broker offers cheap total ordering across partitions. Kafka, Redis Streams, and NATS JetStream all guarantee ordering only within a single partition or shard. Keying by spatial cell gives you per-locality ordering, which is what most geospatial pipelines actually need — the order of events within one H3 cell — while allowing partitions to be consumed in parallel for throughput."}
        },
        {
          "@type": "Question",
          "name": "Can I change the number of partitions after I have started keying by H3 cell?",
          "acceptedAnswer": {"@type": "Answer", "text": "Increasing Kafka partitions changes the modulo mapping of key hash to partition, so a given H3 cell moves to a different partition and its historical ordering relative to older messages is broken. Plan partition count up front with headroom, or route through an explicit cell-to-partition lookup table you control so you can add partitions without remapping existing cells."}
        }
      ]
    }
  ]
}
</script>

**The right broker plus a spatial partition key derived from an H3 cell, geohash prefix, or S2 token keeps geographically related webhook events on the same partition — preserving per-locality ordering and cache locality — while a fine-enough resolution and selective salting stop dense regions from melting a single partition.**

This topic is part of [Queue Management, Retries & Delivery Guarantees](/queue-management-retry-delivery/), the discipline of moving geospatial webhook events through a durable pipeline without losing, reordering, or duplicating them. Broker choice and partition-key design are the two decisions that most shape a spatial stream's throughput and correctness, and they interact: the partitioning model a broker offers determines which spatial keying strategies are even available to you.

---

## Prerequisites

Before choosing a broker and designing a partition key, confirm your stack and your requirements. Check off each item:

- [ ] **Python 3.11+** — required for `TaskGroup` and the async patterns used in the producer and consumer examples
- [ ] **`aiokafka` 0.10+** — async Kafka producer/consumer with pluggable partitioner support
- [ ] **`redis-py` 5.0+** — the async client (`redis.asyncio`) exposes `XADD`, `XREADGROUP`, and `XACK`
- [ ] **`h3` 4.x** — the current Python bindings (`latlng_to_cell`, `grid_disk`) for deriving partition keys from coordinates
- [ ] **A running broker** — Kafka 3.x (KRaft mode), Redis 6.2+ / Valkey, RabbitMQ 3.12+, or NATS JetStream 2.10+
- [ ] **A defined ordering requirement** — know whether you need per-locality ordering, global ordering, or none, before you pick a partition count
- [ ] **A load profile** — an estimate of event density per region so you can size resolution and detect skew early

---

## Choosing a Broker

There is no universally correct broker for spatial webhook streams; there is only the broker whose ordering guarantees, partitioning model, and operational cost match your event profile. The four brokers below cover the realistic option space for a Python-first geospatial pipeline.

<div style="overflow-x:auto;">

| Broker | Sustained throughput | Ordering guarantee | Partitioning model | Ops cost |
|--------|---------------------|--------------------|--------------------|----------|
| Redis Streams | High (single node, memory-bound) | Per-stream (per-key if you shard streams) | Manual: one stream key per shard, consumer groups per stream | Low — one process, but durability tuning (AOF) is on you |
| Apache Kafka | Very high (horizontally scalable) | Per-partition, strict | Hash of message key modulo partition count | High — ZooKeeper-free KRaft still needs broker fleet, rebalancing care |
| RabbitMQ | Moderate | Per-queue (FIFO) unless consistent-hash exchange used | Consistent-hash or direct exchange to bind keys to queues | Moderate — mature tooling, but throughput ceiling is lower |
| NATS JetStream | High | Per-subject / per-consumer sequence | Subject-based; partition via subject token or explicit partitioning | Low-to-moderate — single binary, clustering is straightforward |

</div>

The practical decision usually collapses to two candidates. If your stream is memory-resident, single-region, and you want the lightest operational footprint, Redis Streams with one stream per shard is hard to beat. If you need multi-consumer replay, retention measured in days, and partition counts in the hundreds, Kafka's hash-based partitioning is the natural fit. The head-to-head between these two for webhook workloads specifically — retention, replay, consumer-group semantics, and memory cost — is examined in [Redis Streams vs Kafka for Geospatial Webhooks](/queue-management-retry-delivery/broker-selection-partitioning/redis-streams-vs-kafka-for-geospatial-webhooks/).

Whatever broker you choose, the partition key is where the spatial correctness lives. The broker only knows how to hash and route a key; making that key *spatially coherent* is your job.

---

## Architecture

The pipeline routes every event through a keying stage before it touches the broker. Coordinates are quantised to a discrete spatial cell, the cell becomes the partition key, and the broker's partitioner maps that key to a fixed partition. Events sharing a cell therefore share a partition and are consumed in order by a single consumer.

<svg viewBox="0 0 760 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Spatial events routed to broker partitions by H3 cell key" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>Spatial events routed to partitions by H3 cell</title>
  <desc>Diagram showing four incoming spatial events being quantised to H3 cells, hashed to a partition key, and routed so that events in the same cell land on the same broker partition while a dense cell fans out across two partitions via salting.</desc>
  <defs>
    <marker id="bp-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Incoming events -->
  <text x="70" y="24" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.5">SPATIAL EVENTS</text>
  <rect x="14" y="36" width="112" height="34" rx="6" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.55"/>
  <text x="70" y="57" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">lat,lng → cell A</text>
  <rect x="14" y="96" width="112" height="34" rx="6" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.55"/>
  <text x="70" y="117" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">lat,lng → cell A</text>
  <rect x="14" y="156" width="112" height="34" rx="6" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.55"/>
  <text x="70" y="177" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">lat,lng → cell B</text>
  <rect x="14" y="234" width="112" height="34" rx="6" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.55"/>
  <text x="70" y="251" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">lat,lng → cell C</text>
  <text x="70" y="266" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">(dense metro)</text>
  <!-- Keyer -->
  <rect x="250" y="120" width="120" height="80" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
  <text x="310" y="150" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Keyer</text>
  <text x="310" y="167" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">H3 cell → key</text>
  <text x="310" y="182" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">salt hot cells</text>
  <!-- arrows events -> keyer -->
  <line x1="126" y1="53" x2="248" y2="140" stroke="currentColor" stroke-width="1.3" marker-end="url(#bp-arr)" opacity="0.5"/>
  <line x1="126" y1="113" x2="248" y2="150" stroke="currentColor" stroke-width="1.3" marker-end="url(#bp-arr)" opacity="0.5"/>
  <line x1="126" y1="173" x2="248" y2="165" stroke="currentColor" stroke-width="1.3" marker-end="url(#bp-arr)" opacity="0.5"/>
  <line x1="126" y1="251" x2="248" y2="185" stroke="currentColor" stroke-width="1.3" marker-end="url(#bp-arr)" opacity="0.5"/>
  <!-- Partitions -->
  <text x="600" y="24" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.5">BROKER PARTITIONS</text>
  <rect x="500" y="40" width="200" height="46" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="600" y="60" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Partition 0</text>
  <text x="600" y="76" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.75">cell A, cell A (ordered)</text>
  <rect x="500" y="100" width="200" height="46" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="600" y="120" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Partition 1</text>
  <text x="600" y="136" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.75">cell B</text>
  <rect x="500" y="182" width="200" height="46" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="600" y="202" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Partition 2</text>
  <text x="600" y="218" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.75">cell C:0 (salted)</text>
  <rect x="500" y="242" width="200" height="46" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="600" y="262" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Partition 3</text>
  <text x="600" y="278" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.75">cell C:1 (salted)</text>
  <!-- arrows keyer -> partitions -->
  <line x1="370" y1="150" x2="498" y2="63" stroke="currentColor" stroke-width="1.3" marker-end="url(#bp-arr)" opacity="0.5"/>
  <line x1="370" y1="158" x2="498" y2="123" stroke="currentColor" stroke-width="1.3" marker-end="url(#bp-arr)" opacity="0.5"/>
  <line x1="370" y1="172" x2="498" y2="205" stroke="currentColor" stroke-width="1.3" marker-end="url(#bp-arr)" opacity="0.5"/>
  <line x1="370" y1="178" x2="498" y2="265" stroke="currentColor" stroke-width="1.3" marker-end="url(#bp-arr)" opacity="0.5"/>
</svg>

**Layer breakdown:**

1. **Ingestion** — the webhook receiver validates the payload and extracts a representative coordinate (a Point, or the centroid of a Polygon in EPSG:4326 (WGS84)).
2. **Quantisation** — the coordinate is mapped to a discrete spatial cell: an H3 cell at a chosen resolution, a truncated geohash, or an S2 cell token. This is the step that turns a near-unique coordinate into a stable, shared key.
3. **Keying and routing** — the cell id becomes the partition key. The broker hashes it to a partition; the same cell always hashes to the same partition, so per-cell ordering is preserved. Hot cells are salted into `cell:bucket` keys that fan out across a bounded set of partitions.
4. **Consumption** — one consumer per partition (or per stream shard) processes events in arrival order, benefiting from cache locality because consecutive events describe nearby geography.

The full menu of quantisation schemes and their ordering-versus-balance tradeoffs is developed in [Spatial Partitioning Strategies for Event Streams](/core-event-fundamentals-architecture/spatial-partitioning-strategies/); the index-by-index comparison of the cell systems themselves lives in [H3 vs S2 vs Quadkey for Spatial Partitioning](/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/).

---

## Partition-Key Strategies

Every strategy below converts a coordinate into a discrete token. They differ in how evenly that token spreads load and how well it preserves locality.

<div style="overflow-x:auto;">

| Key strategy | How it groups | Load balance | Best when |
|--------------|---------------|--------------|-----------|
| H3 cell (resolution N) | Hexagonal cell, uniform-ish area | Good; tune N to spread dense areas | You want even neighbour distances and easy `grid_disk` fan-out |
| Geohash prefix (length L) | Rectangular cell, base-32 prefix | Fair; longitude cells distort near poles | You already store geohashes or want lexicographic range scans |
| S2 cell token (level L) | Spherical quad cell, Hilbert-curve id | Good; Hilbert curve keeps neighbours adjacent | You need efficient range covers over regions |
| Admin region id | Political/statistical boundary | Poor; population-skewed by definition | Ordering must align with jurisdiction, not geometry |

</div>

H3 is the default recommendation for streaming because a single resolution parameter lets you dial the tradeoff: a coarse resolution (say 4) groups aggressively and risks hot partitions over metros, while a fine resolution (7 or 8) spreads a dense city across hundreds of cells. Geohash prefixes are attractive when your storage layer already indexes them, but their cells distort with latitude, so a fixed prefix length produces uneven areas. Admin-region keys are the only strategy that guarantees a jurisdiction's events stay together, but population skew makes them the worst for load balance — one metropolitan region can dwarf an entire rural state.

---

## Step-by-Step Implementation

### Step 1 — Derive the Spatial Partition Key

Quantise the coordinate to an H3 cell and, for cells you know are hot, append a bounded salt. The salt is the escape hatch for load balance; keep it off for ordinary cells so their ordering stays strict.

```python
import h3

# Cells that empirically exceed the load threshold get salted. In production this
# set is populated from your skew monitor, not hand-maintained. See the monitoring
# cluster for how to detect these automatically.
HOT_CELLS: set[str] = set()
SALT_BUCKETS = 4  # a hot cell fans out across at most this many partitions


def spatial_partition_key(lat: float, lng: float, resolution: int = 6,
                          event_seq: int = 0) -> str:
    """
    Map an EPSG:4326 (WGS84) coordinate to a stable partition key.

    Ordinary cells return the bare H3 cell id, so every event in that cell
    shares one partition and preserves per-locality ordering. Hot cells return
    a salted key of the form '<cell>:<bucket>' to spread load, trading strict
    per-cell ordering for balance.
    """
    cell = h3.latlng_to_cell(lat, lng, resolution)
    if cell in HOT_CELLS:
        bucket = event_seq % SALT_BUCKETS
        return f"{cell}:{bucket}"
    return cell
```

Choosing `resolution` up front matters: it fixes the granularity of ordering. At resolution 6 an H3 cell is roughly 3.2 km across, which keeps a neighbourhood's events together; drop to resolution 4 (roughly 22 km) only if your ordering requirement is genuinely regional.

---

### Step 2 — Publish with an aiokafka Producer Keyed by H3 Cell

Pass the spatial key as the Kafka message `key`. aiokafka's default partitioner hashes the key with murmur2 and takes it modulo the partition count, so identical cell ids deterministically land on the same partition.

```python
import asyncio
import json
from aiokafka import AIOKafkaProducer


async def publish_spatial_event(producer: AIOKafkaProducer, event: dict) -> None:
    """
    Publish one spatial webhook event keyed by its H3 cell. The key bytes drive
    Kafka's partition assignment, so all events for a cell share a partition and
    are delivered to a single consumer in order.
    """
    lat = event["geometry"]["coordinates"][1]  # GeoJSON is [lng, lat] per RFC 7946
    lng = event["geometry"]["coordinates"][0]
    key = spatial_partition_key(lat, lng, resolution=6,
                                event_seq=event.get("seq", 0))

    await producer.send_and_wait(
        topic="spatial-events",
        key=key.encode("utf-8"),      # partition key: the H3 cell (or salted cell)
        value=json.dumps(event).encode("utf-8"),
    )


async def main() -> None:
    producer = AIOKafkaProducer(
        bootstrap_servers="localhost:9092",
        acks="all",                    # wait for all in-sync replicas: durable writes
        enable_idempotence=True,       # dedupe producer retries, preserve order
        linger_ms=5,                   # small batching window for throughput
    )
    await producer.start()
    try:
        sample = {
            "event_id": "evt-9001",
            "seq": 0,
            "event_type": "vehicle_position",
            "geometry": {"type": "Point", "coordinates": [-0.1276, 51.5074]},
        }
        await publish_spatial_event(producer, sample)
    finally:
        await producer.stop()


if __name__ == "__main__":
    asyncio.run(main())
```

`enable_idempotence=True` with `acks="all"` is the combination that keeps producer retries from reordering or duplicating messages within a partition — the foundation on which any spatial ordering guarantee rests. The concrete mechanics of laying out a Kafka topic this way, including partition-count sizing and custom partitioners, are covered in [Partitioning Kafka Topics by H3 Cell](/queue-management-retry-delivery/broker-selection-partitioning/partitioning-kafka-topics-by-h3-cell/).

---

### Step 3 — Consume with a Redis Streams Consumer Group

For a lighter-weight deployment, Redis Streams shards by stream *key*: create one stream per spatial shard and a consumer group per stream. Within a stream, `XREADGROUP` delivers entries in insertion order, and `XACK` marks them processed.

```python
import asyncio
import json
import redis.asyncio as aioredis

GROUP = "spatial-workers"


async def ensure_group(client: aioredis.Redis, stream: str) -> None:
    """Create the consumer group at the stream's start; ignore 'already exists'."""
    try:
        await client.xgroup_create(stream, GROUP, id="0", mkstream=True)
    except aioredis.ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise


async def consume_shard(client: aioredis.Redis, stream: str,
                        consumer: str) -> None:
    """
    Read and acknowledge entries for one spatial shard stream. Entries within a
    stream are ordered, so per-locality ordering holds as long as each H3 cell
    maps to exactly one stream shard.
    """
    await ensure_group(client, stream)
    while True:
        resp = await client.xreadgroup(
            GROUP, consumer, streams={stream: ">"}, count=64, block=5000,
        )
        if not resp:
            continue
        for _stream_name, entries in resp:
            for entry_id, fields in entries:
                event = json.loads(fields[b"data"])
                try:
                    await handle_spatial_event(event)
                    await client.xack(stream, GROUP, entry_id)
                except Exception:
                    # Leave unacked: it stays in the Pending Entries List for
                    # claim-and-retry by another consumer via XAUTOCLAIM.
                    raise


async def handle_spatial_event(event: dict) -> None:
    # Spatial join, tile invalidation, DB write — nearby events hit warm caches.
    ...
```

Because Redis Streams has no automatic hash partitioner, you choose the shard explicitly on write — for example `XADD spatial:{h3_cell_prefix}` — which gives you total control over the cell-to-shard mapping and sidesteps the repartitioning problem Kafka has when you add partitions.

---

### Step 4 — Validate the Coordinate Before Keying

A malformed or missing coordinate must never reach the keyer: `h3.latlng_to_cell` will happily accept out-of-range values and hand you a nonsensical cell, silently misrouting the event. Validate CRS and bounds first.

```python
from pydantic import BaseModel, field_validator
from typing import Literal


class PointGeometry(BaseModel):
    type: Literal["Point"]
    coordinates: tuple[float, float]  # [lng, lat] per RFC 7946

    @field_validator("coordinates")
    @classmethod
    def within_wgs84_bounds(cls, v: tuple[float, float]) -> tuple[float, float]:
        lng, lat = v
        # EPSG:4326 (WGS84) valid ranges
        if not -180.0 <= lng <= 180.0:
            raise ValueError(f"longitude {lng} out of EPSG:4326 range")
        if not -90.0 <= lat <= 90.0:
            raise ValueError(f"latitude {lat} out of EPSG:4326 range")
        return v


class SpatialEvent(BaseModel):
    event_id: str
    event_type: str
    seq: int = 0
    crs: str = "EPSG:4326"
    geometry: PointGeometry

    @field_validator("crs")
    @classmethod
    def require_wgs84(cls, v: str) -> str:
        if v not in {"EPSG:4326", "CRS84"}:
            raise ValueError(f"CRS {v!r} must be normalised to EPSG:4326 before keying")
        return v
```

Reject invalid events with `422` before publishing. Keying on an unnormalised CRS is a subtle correctness bug: the same physical location expressed in EPSG:3857 (Web Mercator) metres versus EPSG:4326 (WGS84) degrees produces two different H3 cells and therefore two different partitions, breaking ordering for that locality.

---

### Step 5 — Detect and Remedy Hot Partitions

Balanced partitioning is not a set-and-forget decision; event density shifts as coverage grows and as real-world activity clusters. Measure per-partition throughput and promote cells into the salted set when they cross a threshold.

```python
from collections import Counter


def recommend_hot_cells(cell_counts: Counter, total: int,
                        skew_factor: float = 4.0) -> set[str]:
    """
    Flag cells whose share of traffic exceeds skew_factor times the fair share.
    A cell carrying 4x its even allocation is a hot-partition risk and should be
    salted. Feed the returned set into HOT_CELLS on the producer.
    """
    if total == 0:
        return set()
    n_cells = max(len(cell_counts), 1)
    fair_share = total / n_cells
    threshold = fair_share * skew_factor
    return {cell for cell, count in cell_counts.items() if count > threshold}
```

Salting is deliberately selective: applying it to every cell would destroy per-locality ordering everywhere for the sake of a few hot spots. Continuously watching partition throughput and lag is a monitoring concern covered in [Consumer Lag & Partition Skew Monitoring](/monitoring-observability-spatial/consumer-lag-partition-skew/), which shows how to alert before a hot partition turns into unbounded consumer lag.

---

## Delivery Guarantees and Ordering

Partitioning is only half the ordering story; the delivery guarantee is the other half. Every broker in the comparison table offers ordering *within* a partition or shard, and none offers cheap total ordering across the whole stream. Keying by spatial cell converts that per-partition guarantee into a per-locality guarantee, which is almost always the property a geospatial pipeline actually needs — you care that the three updates to *this* parcel arrive in order, not that a parcel in London is ordered against one in Tokyo.

The interaction between the three delivery modes and spatial ordering:

<div style="overflow-x:auto;">

| Guarantee | Mechanism | Effect on spatial ordering |
|-----------|-----------|----------------------------|
| At-most-once | Fire-and-forget, no retries | Events lost silently; a locality's history has gaps |
| At-least-once | Retry until acknowledged | Duplicates possible; per-cell order preserved if the producer is idempotent |
| Effectively-once | At-least-once + idempotent consumer | Duplicates absorbed downstream; per-cell order intact |

</div>

Because upstream providers retry, at-least-once is the realistic floor. Combine it with an idempotent producer (as in Step 2) so retries do not reorder a partition, and with an idempotent consumer so a redelivered event does not double-apply a spatial mutation. The full treatment of ordering semantics, sequence tracking, and out-of-order handling is in [Delivery Guarantees & Event Ordering](/queue-management-retry-delivery/delivery-guarantees-ordering/).

---

## Verification

Confirm two properties: identical cells route to identical partitions, and distinct cells spread across partitions. This test exercises the keying and the murmur2-modulo mapping Kafka uses, without needing a live broker.

```python
import pytest
from aiokafka.partitioner import DefaultPartitioner


def kafka_partition_for(key: str, num_partitions: int) -> int:
    """Reproduce aiokafka's key-based partition assignment for a given key."""
    partitioner = DefaultPartitioner()
    all_partitions = list(range(num_partitions))
    return partitioner(key.encode("utf-8"), all_partitions, all_partitions)


def test_same_cell_same_partition():
    """Two events in the same H3 cell must map to the same partition."""
    key_a = spatial_partition_key(51.5074, -0.1276, resolution=6)
    key_b = spatial_partition_key(51.5075, -0.1277, resolution=6)  # ~15 m away
    assert key_a == key_b, "nearby points should share an H3 cell at res 6"
    assert kafka_partition_for(key_a, 12) == kafka_partition_for(key_b, 12)


def test_distant_cells_spread():
    """Widely separated localities should not all collapse onto one partition."""
    cities = [(51.5074, -0.1276), (48.8566, 2.3522), (40.7128, -74.0060),
              (35.6762, 139.6503), (-33.8688, 151.2093)]
    keys = [spatial_partition_key(lat, lng, resolution=6) for lat, lng in cities]
    partitions = {kafka_partition_for(k, 12) for k in keys}
    assert len(partitions) >= 3, "distinct cities should use several partitions"


def test_salted_cell_fans_out():
    """A hot cell must distribute across multiple bucketed keys."""
    HOT_CELLS.add(h3.latlng_to_cell(51.5074, -0.1276, 6))
    try:
        keys = {spatial_partition_key(51.5074, -0.1276, 6, event_seq=i)
                for i in range(SALT_BUCKETS)}
        assert len(keys) == SALT_BUCKETS
    finally:
        HOT_CELLS.discard(h3.latlng_to_cell(51.5074, -0.1276, 6))
```

Run with `pytest -v`. The first test is the load-bearing assertion: if nearby points ever produce different keys, per-locality ordering is silently broken and no downstream fix will restore it.

---

## Troubleshooting

<div style="overflow-x:auto;">

| Symptom | Likely spatial cause | Fix |
|---------|----------------------|-----|
| One partition's lag grows unboundedly while others idle | Coarse resolution concentrates a dense metro on one cell | Raise H3 resolution, or add the cell to the salted set with a bounded bucket count |
| Events for one location arrive out of order | Coordinate keyed in EPSG:3857 (Web Mercator) not EPSG:4326 (WGS84) | Normalise CRS before `latlng_to_cell`; reject non-WGS84 payloads at validation |
| Ordering broke after scaling the topic | Added Kafka partitions changed the key-to-partition modulo | Use a fixed cell-to-partition lookup table, or provision partitions with headroom up front |
| Load balances well but caches stay cold | Salting applied to all cells, scattering neighbours | Restrict salting to cells above the skew threshold only |
| Producer duplicates appear within a partition | Idempotence disabled, retries re-sent messages | Set `enable_idempotence=True` and `acks="all"` on the producer |
| Redis shard grows without bound | No consumer acking; Pending Entries List accumulates | Ensure `XACK` runs on success and reclaim stuck entries with `XAUTOCLAIM` |
| A whole region's events vanish | `[lat, lng]` swapped for `[lng, lat]` before keying | Follow RFC 7946 ordering (`[lng, lat]`); assert bounds in the validator |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Should I partition spatial streams by raw latitude/longitude instead of an index cell?</strong></summary>

No. Raw coordinates are effectively unique per event, so hashing them scatters events for one locality across every partition and destroys per-locality ordering and cache locality. Quantise the coordinate to a discrete cell first — an H3 cell at resolution 5 to 7, a geohash prefix, or an S2 token — and use that stable cell id as the partition key so all events in the same area land on the same partition.

</details>

<details class="faq">
<summary><strong>How do I stop a dense city from creating a hot partition?</strong></summary>

Coarse cells concentrate load. Use a finer resolution so a single dense metro spreads across many cells, or apply a salted composite key of the form `cell:bucket` for the hottest cells only, sizing the bucket count to the skew you observe. Salting trades strict per-cell ordering for load balance, so apply it selectively to cells that exceed a load threshold rather than uniformly across the keyspace.

</details>

<details class="faq">
<summary><strong>Does keying by partition guarantee global ordering across the whole stream?</strong></summary>

No broker offers cheap total ordering across partitions. Kafka, Redis Streams, and NATS JetStream all guarantee ordering only within a single partition or shard. Keying by spatial cell gives you per-locality ordering, which is what most geospatial pipelines actually need — the order of events within one H3 cell — while allowing partitions to be consumed in parallel for throughput.

</details>

<details class="faq">
<summary><strong>Can I change the number of partitions after I have started keying by H3 cell?</strong></summary>

Increasing Kafka partitions changes the modulo mapping of key hash to partition, so a given H3 cell moves to a different partition and its historical ordering relative to older messages is broken. Plan partition count up front with headroom, or route through an explicit cell-to-partition lookup table you control so you can add partitions without remapping existing cells.

</details>

---

## Related

- [Queue Management, Retries & Delivery Guarantees](/queue-management-retry-delivery/) — the parent section covering durable delivery, retries, and ordering for geospatial event pipelines
- [Redis Streams vs Kafka for Geospatial Webhooks](/queue-management-retry-delivery/broker-selection-partitioning/redis-streams-vs-kafka-for-geospatial-webhooks/) — a head-to-head on retention, replay, and cost for webhook workloads
- [Partitioning Kafka Topics by H3 Cell](/queue-management-retry-delivery/broker-selection-partitioning/partitioning-kafka-topics-by-h3-cell/) — topic layout, partition sizing, and custom partitioners for H3 keys
- [Spatial Partitioning Strategies for Event Streams](/core-event-fundamentals-architecture/spatial-partitioning-strategies/) — the full menu of quantisation schemes and their ordering-versus-balance tradeoffs
- [Delivery Guarantees & Event Ordering](/queue-management-retry-delivery/delivery-guarantees-ordering/) — sequence tracking and out-of-order handling across delivery modes
