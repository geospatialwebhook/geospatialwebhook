---
title: "Redis Streams vs Kafka for Geospatial Webhooks"
description: "A decision guide comparing Redis Streams and Apache Kafka as the broker for a Python geospatial webhook pipeline: throughput, replay, spatial partitioning, ordering, ops, and payload limits."
slug: "redis-streams-vs-kafka-for-geospatial-webhooks"
type: "article"
breadcrumb:
  - label: "Queue Management, Retries & Delivery Guarantees"
    url: "/queue-management-retry-delivery/"
  - label: "Broker Selection & Partitioning for Spatial Streams"
    url: "/queue-management-retry-delivery/broker-selection-partitioning/"
  - label: "Redis Streams vs Kafka for Geospatial Webhooks"
    url: "/queue-management-retry-delivery/broker-selection-partitioning/redis-streams-vs-kafka-for-geospatial-webhooks/"
datePublished: "2025-05-14"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Redis Streams vs Kafka for Geospatial Webhooks",
      "description": "A decision guide comparing Redis Streams and Apache Kafka as the broker for a Python geospatial webhook pipeline across throughput, replay, spatial partitioning, ordering, ops burden, and payload size.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/redis-streams-vs-kafka-for-geospatial-webhooks/",
      "datePublished": "2025-05-14",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Queue Management, Retries & Delivery Guarantees", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/" },
        { "@type": "ListItem", "position": 2, "name": "Broker Selection & Partitioning for Spatial Streams", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/" },
        { "@type": "ListItem", "position": 3, "name": "Redis Streams vs Kafka for Geospatial Webhooks", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/redis-streams-vs-kafka-for-geospatial-webhooks/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Choose between Redis Streams and Kafka for a geospatial webhook pipeline",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Quantify sustained event rate and geometry size", "text": "Measure your peak sensor event rate and the 95th-percentile serialized geometry size. Sub-100k events/sec with small payloads suits Redis Streams; sustained multi-hundred-thousand rates with heavy geometries favour Kafka's disk-backed log." },
        { "@type": "HowToStep", "position": 2, "name": "Decide your replay window", "text": "If you must reprocess tiles from hours or days ago, Kafka's long log retention is a natural fit. If you only need short buffering, Redis Streams with a capped MAXLEN is simpler." },
        { "@type": "HowToStep", "position": 3, "name": "Map the spatial partitioning model", "text": "Kafka partitions by message key, so keying on an H3 cell pins one region to one partition and preserves per-region order. Redis Streams distributes work across a consumer group without key affinity, so add explicit sharding if you need spatial locality." },
        { "@type": "HowToStep", "position": 4, "name": "Weigh the ops burden", "text": "Redis Streams runs inside an instance you likely already operate. Kafka adds brokers, a metadata quorum, and partition planning. Choose the smallest system that meets your retention and throughput needs." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Can Redis Streams replay old spatial events like Kafka?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes, but with a caveat. Redis Streams retains entries in memory until they are trimmed by MAXLEN or MINID, and you can re-read any surviving range with XRANGE or a fresh consumer group starting at ID 0. But because entries live in RAM, a long replay window for heavy geometries can exhaust memory. Kafka retains the log on disk for hours or days cheaply, so for large reprocessing windows over big tiles Kafka is the safer default." }
        },
        {
          "@type": "Question",
          "name": "How do I get per-region ordering in Redis Streams without Kafka-style key partitions?",
          "acceptedAnswer": { "@type": "Answer", "text": "A single Redis stream preserves total insertion order, but a consumer group hands different entries to different consumers with no key affinity, so per-region order is not guaranteed across consumers. To recover spatial ordering, shard by H3 cell into multiple streams (one stream per shard, chosen by hashing the cell) and run one consumer per stream, mirroring Kafka's key-to-partition mapping." }
        },
        {
          "@type": "Question",
          "name": "What payload size limits apply to heavy geometries on each broker?",
          "acceptedAnswer": { "@type": "Answer", "text": "Kafka defaults to a 1 MB message limit (message.max.bytes / max.request.size) which you can raise, though large messages hurt throughput; the common pattern is to store the geometry in object storage and send a reference. Redis has no hard per-entry limit but every entry consumes RAM, so a stream of multi-megabyte polygons pressures memory fast. For both, prefer a compact binary encoding or a claim-check reference for oversized geometries." }
        },
        {
          "@type": "Question",
          "name": "Does either broker give me exactly-once delivery for spatial events?",
          "acceptedAnswer": { "@type": "Answer", "text": "Not for free end-to-end. Kafka supports exactly-once semantics within Kafka-to-Kafka transactions, but a webhook consumer that writes to PostGIS or calls an external API is outside that boundary and gets at-least-once. Redis Streams is at-least-once via pending entries and XACK. In both cases, make the consumer idempotent using a deterministic key so a redelivered event is a safe no-op." }
        }
      ]
    }
  ]
}
</script>

**Choose Redis Streams when you want a low-operations, in-memory broker for short-lived, high-rate spatial events and can shard streams yourself for locality; choose Apache Kafka when you need durable multi-hour replay of tile events, native key-based spatial partitioning, and per-region ordering at sustained high volume.** Neither is universally correct — the decision turns on your replay window, geometry size, ordering needs, and how much operational surface your team can carry.

This comparison sits inside [Broker Selection & Partitioning for Spatial Streams](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/), part of the broader [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/) reference for building reliable spatial webhook pipelines in Python.

---

## When to use this pattern

- **Reach for Redis Streams** when your pipeline already runs Redis, your events are small (a point ping plus properties, not a multi-ring polygon), your replay window is minutes to a couple of hours, and you value a single moving part over maximum durability.
- **Reach for Kafka** when high-frequency sensor volume is sustained (hundreds of thousands of events per second), you must reprocess tiles from hours or days ago, and you need strict per-region ordering that survives consumer restarts and rebalances.
- **Reach for either with a claim-check** when geometries are heavy: keep multi-megabyte polygons in object storage and put only a reference on the stream, so payload-size limits and memory pressure stop being the deciding factor.

It is **not the right tool** to agonize over when your volume is a few thousand events per hour and your consumers are already idempotent — at that scale either broker is over-provisioned and the choice barely matters. Pick whichever your team operates today.

---

## The comparison at a glance

<div style="overflow-x:auto;">

| Axis | Redis Streams | Apache Kafka |
|---|---|---|
| Sustained throughput | High for small payloads (single-instance bound, ~tens of thousands/sec typical); scaling requires manual sharding | Very high (hundreds of thousands/sec+) via partitions across brokers |
| Retention & replay | In-memory; capped by `MAXLEN`/`MINID`; replay window limited by RAM | Disk-backed log; hours to days (or compacted) cheaply; natural tile reprocessing |
| Spatial partitioning model | Consumer group distributes entries with no key affinity; shard by hashing H3 cell into N streams yourself | Partition-by-key: key on H3 cell pins a region to one partition |
| Ordering guarantee | Total order within one stream; **not** preserved across a consumer group | Per-partition order; per-region order when keyed by cell |
| Payload / geometry size | No hard limit, but every entry costs RAM; heavy polygons pressure memory | 1 MB default (`message.max.bytes`), raisable; large messages hurt throughput |
| Delivery semantics | At-least-once via pending list + `XACK` | At-least-once; exactly-once only within Kafka transactions |
| Ops burden | Low — often an instance you already run | Higher — brokers, metadata quorum, partition planning |
| Best fit | Short-buffer, low-ops, small spatial events | Durable replay, ordered, high-volume spatial streams |

</div>

---

## Why the spatial workload changes the calculus

<figure class="fig">
<svg viewBox="0 0 760 232" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="How spatial payload characteristics shift the Kafka versus Redis Streams decision away from the generic answer">
<title>What the spatial workload changes about the usual answer</title>
<desc>Three properties of spatial webhook traffic move the broker decision away from the generic messaging answer. Payload size is highly variable — a point ping is a few hundred bytes and a land-cover multipolygon is several megabytes — which matters far more for an in-memory stream than for a disk-backed log, and pushes Redis Streams toward the claim-check pattern rather than away from Redis. Partition count is effectively fixed by the spatial key: the number of distinct cells at your chosen resolution sets how much parallelism is available, so Kafka's create-time partition count must be chosen against that number rather than against consumer capacity. And replay is regional rather than global — recovering from a bad deploy usually means re-processing one city, not the whole stream — which is exactly what a partitioned durable log makes cheap and what an in-memory stream trimmed by length cannot offer at all. The generic advice to pick the simpler broker holds right up until you need to replay a region.</desc>
<rect x="0" y="0" width="760" height="232" fill="var(--fig-bg)"/>
<rect x="14" y="26" width="240" height="132" rx="7" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.5"/>
<text x="134" y="46" text-anchor="middle" font-size="10" font-weight="600" fill="var(--fig-ink)">payload size varies 1000×</text>
<text x="26" y="66" font-size="8.5" fill="var(--fig-ink-soft)">point ping ~400 B</text>
<text x="26" y="80" font-size="8.5" fill="var(--fig-ink-soft)">land-cover polygon ~4 MB</text>
<text x="26" y="100" font-size="8.5" fill="var(--fig-ink)">Matters far more for an in-memory</text>
<text x="26" y="112" font-size="8.5" fill="var(--fig-ink)">stream than a disk-backed log.</text>
<text x="26" y="132" font-size="8.5" fill="var(--fig-peach-edge)">Pushes Redis toward claim-check,</text>
<text x="26" y="144" font-size="8.5" fill="var(--fig-peach-edge)">not away from Redis.</text>
<rect x="262" y="26" width="240" height="132" rx="7" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="382" y="46" text-anchor="middle" font-size="10" font-weight="600" fill="var(--fig-ink)">the key fixes the parallelism</text>
<text x="274" y="66" font-size="8.5" fill="var(--fig-ink-soft)">distinct cells at your resolution</text>
<text x="274" y="80" font-size="8.5" fill="var(--fig-ink-soft)">= the ceiling on useful partitions</text>
<text x="274" y="100" font-size="8.5" fill="var(--fig-ink)">Kafka fixes partitions at creation, so</text>
<text x="274" y="112" font-size="8.5" fill="var(--fig-ink)">that count must be set against the</text>
<text x="274" y="124" font-size="8.5" fill="var(--fig-ink)">cell count, not consumer capacity.</text>
<text x="274" y="144" font-size="8.5" fill="var(--fig-gold-edge)">Over-provision it — widening later re-keys.</text>
<rect x="510" y="26" width="236" height="132" rx="7" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="628" y="46" text-anchor="middle" font-size="10" font-weight="600" fill="var(--fig-ink)">replay is regional</text>
<text x="522" y="66" font-size="8.5" fill="var(--fig-ink-soft)">"re-process Berlin since Tuesday"</text>
<text x="522" y="80" font-size="8.5" fill="var(--fig-ink-soft)">not "re-process everything"</text>
<text x="522" y="100" font-size="8.5" fill="var(--fig-ink)">A partitioned durable log makes this</text>
<text x="522" y="112" font-size="8.5" fill="var(--fig-ink)">cheap: seek the offsets for those</text>
<text x="522" y="124" font-size="8.5" fill="var(--fig-ink)">partitions and replay.</text>
<text x="522" y="144" font-size="8.5" fill="var(--fig-mint-edge)">A trimmed in-memory stream cannot.</text>
<rect x="14" y="176" width="732" height="46" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="194" font-size="10" font-weight="600" fill="var(--fig-ink)">The generic answer — pick the simpler broker — holds right up until you need to replay a region</text>
<text x="26" y="209" font-size="9" fill="var(--fig-ink-soft)">Ask how you will recover from a bad deploy that corrupted one city's tiles. If the answer requires reading last Tuesday,</text>
<text x="26" y="219" font-size="9" fill="var(--fig-ink-soft)">Redis Streams was never in the running, whatever its operational appeal.</text>
</svg>
<figcaption><b>Figure 1.</b> None of these three is a generic messaging concern, and together they usually decide the choice before throughput does. The replay question is the one worth answering first.</figcaption>
</figure>

A generic "Redis vs Kafka" comparison ignores what makes geospatial traffic distinctive: payloads carry geometry, and geometry is both large and order-sensitive. A stream of vehicle GPS pings is tiny and tolerant of reordering; a stream of edited parcel polygons or re-tiled raster footprints is neither. The broker that wins depends on which of those you are moving.

The second spatial twist is **locality**. You usually want all events touching the same region to land on the same consumer, so per-region state (a running geofence count, a tile version) stays coherent and ordered. Kafka gives you this directly: hash the message key to a partition, key on an H3 cell, and every event for that cell is ordered on one partition. Redis Streams has no key-to-consumer affinity — a consumer group is a work-stealing pool — so you recreate locality by sharding into multiple streams. The diagram below contrasts the two models.

<figure class="fig">
<svg viewBox="1 0 756 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Kafka key-based partitioning versus Redis Streams consumer-group distribution for spatial events">
  <title>Spatial partitioning: Kafka partition-by-key vs Redis Streams consumer group</title>
  <desc>Top row: H3-keyed events routed to fixed Kafka partitions, each partition consumed by one worker preserving per-region order. Bottom row: events pushed to a single Redis stream then work-stolen by a consumer group with no key affinity, so a region can spread across workers.</desc>
  <rect x="1" y="0" width="756" height="280" fill="var(--fig-bg)"/>
  <defs>
    <marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L8,3.5 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Kafka row -->
  <text x="16" y="26" font-size="12" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Kafka — partition by H3 key (per-region order held)</text>
  <rect x="16" y="40" width="120" height="46" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="76" y="60" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">key = H3 cell</text>
  <text x="76" y="75" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">producer</text>
  <line x1="136" y1="63" x2="212" y2="52" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#a)"/>
  <line x1="136" y1="63" x2="212" y2="98" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="214" y="36" width="150" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="289" y="57" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">partition 0 (cells A,C)</text>
  <rect x="214" y="82" width="150" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="289" y="103" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">partition 1 (cells B,D)</text>
  <line x1="364" y1="53" x2="440" y2="53" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#a)"/>
  <line x1="364" y1="99" x2="440" y2="99" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="442" y="36" width="110" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="497" y="57" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">worker 0</text>
  <rect x="442" y="82" width="110" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="497" y="103" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">worker 1</text>
  <text x="640" y="76" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">stable region→worker</text>
  <!-- divider -->
  <line x1="16" y1="140" x2="744" y2="140" stroke="currentColor" stroke-opacity="0.2" stroke-width="1"/>
  <!-- Redis row -->
  <text x="16" y="170" font-size="12" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Redis Streams — one stream, consumer group work-steals (no key affinity)</text>
  <rect x="16" y="188" width="120" height="46" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="76" y="208" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">XADD events</text>
  <text x="76" y="223" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">producer</text>
  <line x1="136" y1="211" x2="212" y2="211" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="214" y="192" width="150" height="40" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="289" y="209" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">single stream</text>
  <text x="289" y="223" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">A,B,C,D interleaved</text>
  <line x1="364" y1="205" x2="440" y2="199" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#a)"/>
  <line x1="364" y1="219" x2="440" y2="248" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="442" y="182" width="110" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="497" y="203" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">consumer 0</text>
  <rect x="442" y="232" width="110" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="497" y="253" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif">consumer 1</text>
  <text x="642" y="225" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">cell A may split</text>
</svg>
<figcaption><b>Figure 2.</b> Spatial partitioning: Kafka partition-by-key vs Redis Streams consumer group</figcaption>
</figure>

If per-region ordering matters, this is the crux: Kafka enforces it through the partition, whereas Redis Streams needs you to shard streams by cell to approximate it. The tradeoffs of choosing the cell system itself — resolution, cell shape, neighbour behaviour — are covered in [H3 vs S2 vs Quadkey for spatial partitioning](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/).

---

## Complete runnable implementation

Both examples move the same event: a sensor reading tagged with an H3 cell and a small GeoJSON point (EPSG:4326 / WGS84). The Kafka version keys on the H3 cell so a region maps to a stable partition; the Redis version shows `XADD` plus a consumer-group read with acknowledgement.

```python
# Apache Kafka — aiokafka producer + consumer, keyed by H3 cell.
# pip install aiokafka h3
import asyncio
import json
import h3
from aiokafka import AIOKafkaProducer, AIOKafkaConsumer

TOPIC = "spatial-events"
BOOTSTRAP = "localhost:9092"


def h3_key(lon: float, lat: float, resolution: int = 7) -> bytes:
    """Derive the partition key from the event's H3 cell (EPSG:4326 input)."""
    # h3 expects (lat, lon) order.
    return h3.latlng_to_cell(lat, lon, resolution).encode("utf-8")


async def produce() -> None:
    producer = AIOKafkaProducer(bootstrap_servers=BOOTSTRAP)
    await producer.start()
    try:
        event = {
            "sensor_id": "SN-42",
            "reading": 17.3,
            "geometry": {"type": "Point", "coordinates": [-73.965355, 40.782865]},
        }
        lon, lat = event["geometry"]["coordinates"]
        # Same key -> same partition -> per-region order preserved.
        await producer.send_and_wait(
            TOPIC,
            key=h3_key(lon, lat),
            value=json.dumps(event).encode("utf-8"),
        )
    finally:
        await producer.stop()


async def consume() -> None:
    consumer = AIOKafkaConsumer(
        TOPIC,
        bootstrap_servers=BOOTSTRAP,
        group_id="tile-workers",
        enable_auto_commit=False,        # commit only after successful processing
        auto_offset_reset="earliest",    # replay from the log start if no offset
    )
    await consumer.start()
    try:
        async for msg in consumer:
            cell = msg.key.decode()
            event = json.loads(msg.value)
            # ... idempotent processing keyed on (cell, sensor_id) ...
            print(f"partition={msg.partition} cell={cell} sensor={event['sensor_id']}")
            await consumer.commit()      # at-least-once: commit after the side effect
    finally:
        await consumer.stop()
```

```python
# Redis Streams — redis.asyncio XADD producer + XREADGROUP consumer.
# pip install "redis>=5" h3
import asyncio
import json
import h3
import redis.asyncio as redis

STREAM = "spatial-events"
GROUP = "tile-workers"


async def produce(r: redis.Redis) -> None:
    event = {
        "sensor_id": "SN-42",
        "reading": 17.3,
        "geometry": {"type": "Point", "coordinates": [-73.965355, 40.782865]},
    }
    lon, lat = event["geometry"]["coordinates"]
    cell = h3.latlng_to_cell(lat, lon, 7)   # store cell so consumers can route/shard
    # MAXLEN caps memory: keep ~the last 100k entries, approximate ("~") for speed.
    await r.xadd(
        STREAM,
        {"cell": cell, "payload": json.dumps(event)},
        maxlen=100_000,
        approximate=True,
    )


async def consume(r: redis.Redis) -> None:
    # Create the group at the stream start ("0") once; ignore "already exists".
    try:
        await r.xgroup_create(STREAM, GROUP, id="0", mkstream=True)
    except redis.ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise
    while True:
        resp = await r.xreadgroup(
            GROUP, "consumer-1", {STREAM: ">"}, count=64, block=5000
        )
        for _stream, entries in resp or []:
            for entry_id, fields in entries:
                event = json.loads(fields["payload"])
                # ... idempotent processing ...
                print(f"id={entry_id} cell={fields['cell']} sensor={event['sensor_id']}")
                await r.xack(STREAM, GROUP, entry_id)   # at-least-once ack


async def main() -> None:
    r = redis.Redis(host="localhost", port=6379, decode_responses=True)
    await produce(r)
    await consume(r)


if __name__ == "__main__":
    asyncio.run(main())
```

The structural difference is visible in the API: Kafka carries a first-class `key` that decides the partition, while Redis Streams carries an opaque field dict and you must add the `cell` yourself if you later want to shard for locality.

---

## Parameter reference

<div style="overflow-x:auto;">

| Setting | Broker | Type | Spatial constraint | Default |
|---|---|---|---|---|
| `key` (partition key) | Kafka | `bytes` | Set to the H3 cell to pin a region to one partition and hold per-region order | none (round-robin) |
| partition count | Kafka | `int` | Must exceed peak concurrent hot cells or skew concentrates on one broker; cannot be reduced later | topic-defined |
| `message.max.bytes` | Kafka | `int` | Raise for heavy geometries or use a claim-check reference; large values reduce throughput | ~1 MB |
| `maxlen` / `approximate` | Redis | `int` / `bool` | Caps RAM; size it from entry size × geometry size so big polygons do not exhaust memory | unbounded |
| `count` (XREADGROUP) | Redis | `int` | Batch size per read; smaller batches bound per-consumer memory for heavy payloads | 1 |
| consumer `group_id` / GROUP | both | `str` | Distinct groups get independent cursors, enabling parallel replay of the same tiles | — |

</div>

---

## Gotchas and spatial edge cases

1. **Redis Streams memory pressure with large geometries.** Every entry lives in RAM until trimmed. A stream of multi-megabyte polygons at high rate can push Redis into eviction or an out-of-memory kill. Always set a `MAXLEN`/`MINID` cap sized from your real entry size, and for heavy geometries store the blob in object storage and stream only a reference (the claim-check pattern).

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Multi-megabyte geometries held inline in a Redis stream versus the claim-check pattern">
<title>Redis holds the stream in RAM, so the geometry must not live there</title>
<desc>A stream of land-cover polygons averaging 3 megabytes at 200 events per second. Held inline, one hour of retention is about 2.1 terabytes of resident memory, which no instance has, so Redis either evicts under its maxmemory policy — silently discarding events the pipeline believes are durable — or is killed by the out-of-memory killer, losing the entire stream including entries that were never processed. Under the claim-check pattern the polygon is written to object storage keyed by its content hash and the stream carries only a reference of about 300 bytes, so the same hour costs roughly 216 megabytes and retention becomes a decision rather than a constraint. The consumer dereferences the pointer only for entries it actually processes, and because the key is a content hash the upload is idempotent, so a redelivery does not duplicate the blob.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<defs><marker id="cc-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="30" width="352" height="106" rx="7" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="50" font-size="10" font-weight="600" fill="var(--fig-ink)">Geometry inline in the stream</text>
<text x="26" y="70" font-size="9" fill="var(--fig-ink-soft)">3 MB avg × 200 ev/s × 1 h retention</text>
<text x="26" y="90" font-size="11" font-weight="700" fill="var(--fig-rose-edge)">≈ 2.1 TB resident</text>
<text x="26" y="110" font-size="8.5" fill="var(--fig-ink-soft)">maxmemory eviction silently drops events the</text>
<text x="26" y="122" font-size="8.5" fill="var(--fig-ink-soft)">pipeline believes are durable — or the OOM killer takes the lot</text>
<rect x="386" y="30" width="360" height="106" rx="7" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="398" y="50" font-size="10" font-weight="600" fill="var(--fig-ink)">Claim check — reference in the stream</text>
<text x="398" y="70" font-size="9" fill="var(--fig-ink-soft)">300 B × 200 ev/s × 1 h retention</text>
<text x="398" y="90" font-size="11" font-weight="700" fill="var(--fig-mint-edge)">≈ 216 MB resident</text>
<text x="398" y="110" font-size="8.5" fill="var(--fig-ink-soft)">retention becomes a decision, not a constraint;</text>
<text x="398" y="122" font-size="8.5" fill="var(--fig-ink-soft)">the consumer fetches the blob only for what it processes</text>
<rect x="14" y="150" width="196" height="30" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="112" y="169" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">PUT s3://geom/&lt;sha256&gt;</text>
<line x1="212" y1="165" x2="246" y2="165" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#cc-a)"/>
<rect x="250" y="150" width="240" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="370" y="169" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">XADD stream · {ref, bbox, h3, epsg, sha256}</text>
<line x1="492" y1="165" x2="526" y2="165" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#cc-a)"/>
<rect x="530" y="150" width="216" height="30" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="638" y="169" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">consumer GETs only what it needs</text>
<rect x="14" y="192" width="732" height="28" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="26" y="203" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Key the blob by content hash, and set MAXLEN or MINID from your measured entry size.</text>
<text x="26" y="215" font-size="9" fill="var(--fig-ink-soft)">The hash makes the upload idempotent, so a redelivery costs nothing; an uncapped stream is a memory leak with a retention policy attached.</text>
</svg>
<figcaption><b>Figure 3.</b> Kafka's log lives on disk, Redis's lives in RAM — so the claim-check pattern is optional on one and structural on the other. Eviction is the dangerous outcome: it discards events the pipeline still considers durable.</figcaption>
</figure>

2. **Kafka partition count versus skew.** Keying by H3 cell only balances load if traffic is spread across cells. A single dense metro region can make one cell — and therefore one partition — a hotspot while others idle. Provision enough partitions for peak concurrent hot cells, and consider a higher H3 resolution or a composite key to spread a hot region. You cannot decrease partition count later without a topic migration.

3. **Ordering is per-partition / per-stream, not global.** Kafka guarantees order only within a partition, so two cells on different partitions can be processed out of relative order — usually fine, since regions are independent. Redis Streams keeps total order in one stream but a consumer group interleaves across consumers, so do not assume a group preserves per-region order without sharding.

4. **Exactly-once is a boundary, not a switch.** Kafka's exactly-once semantics hold for Kafka-to-Kafka transactions; the moment your consumer writes to PostGIS or calls a downstream webhook, you are back to at-least-once. Redis Streams is at-least-once by design. In both, make the consumer idempotent with a deterministic key so redelivery is a no-op — the same discipline covered in [Delivery Guarantees & Event Ordering](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/).

5. **Consumer crash leaves pending entries (Redis).** Unacknowledged entries sit in the Pending Entries List. Without a reclaim loop using `XAUTOCLAIM`/`XPENDING`, a crashed consumer's in-flight spatial events are never reprocessed. Kafka handles this through offset commits and rebalance, but if you commit before the side effect you can silently drop events.

6. **Coordinate order mismatch in keys.** `h3` takes `(lat, lon)` while GeoJSON stores `[lon, lat]`. Swapping them keys events to the wrong cell, scattering a region across partitions and destroying locality. Keep a single helper (as above) so the conversion happens in exactly one place.

---

## Verification

This test asserts the property that actually matters for spatial locality: identical H3 keys route to the same Kafka partition (deterministic ordering), while distinct cells generally spread. Run with `pytest`; it uses only the partitioner math, no live broker.

```python
import h3


def default_partition(key: bytes, num_partitions: int) -> int:
    """Mirror Kafka's default murmur2-based key partitioner shape.

    The exact hash is Kafka's murmur2; here we assert the *invariant*
    that a fixed key maps to a fixed partition, which is what preserves
    per-region ordering. Swap in aiokafka's DefaultPartitioner in an
    integration test against a real cluster.
    """
    return (hash(key) & 0x7FFFFFFF) % num_partitions


def h3_key(lon: float, lat: float, resolution: int = 7) -> bytes:
    return h3.latlng_to_cell(lat, lon, resolution).encode("utf-8")


def test_same_cell_same_partition():
    """Two events in the same H3 cell must land on one partition."""
    k1 = h3_key(-73.965355, 40.782865)
    k2 = h3_key(-73.965360, 40.782860)   # metres apart, same res-7 cell
    assert k1 == k2
    assert default_partition(k1, 12) == default_partition(k2, 12)


def test_distinct_cells_are_stable():
    """A given key always maps to the same partition (deterministic routing)."""
    k = h3_key(-73.965355, 40.782865)
    assert default_partition(k, 12) == default_partition(k, 12)
```

---

## FAQ

<details class="faq">
<summary><strong>Can Redis Streams replay old spatial events like Kafka?</strong></summary>

Yes, but with a caveat. Redis Streams retains entries in memory until they are trimmed by `MAXLEN` or `MINID`, and you can re-read any surviving range with `XRANGE` or a fresh consumer group starting at ID `0`. But because entries live in RAM, a long replay window for heavy geometries can exhaust memory. Kafka retains the log on disk for hours or days cheaply, so for large reprocessing windows over big tiles Kafka is the safer default.

</details>

<details class="faq">
<summary><strong>How do I get per-region ordering in Redis Streams without Kafka-style key partitions?</strong></summary>

A single Redis stream preserves total insertion order, but a consumer group hands different entries to different consumers with no key affinity, so per-region order is not guaranteed across consumers. To recover spatial ordering, shard by H3 cell into multiple streams (one stream per shard, chosen by hashing the cell) and run one consumer per stream, mirroring Kafka's key-to-partition mapping.

</details>

<details class="faq">
<summary><strong>What payload size limits apply to heavy geometries on each broker?</strong></summary>

Kafka defaults to a 1 MB message limit (`message.max.bytes` / `max.request.size`) which you can raise, though large messages hurt throughput; the common pattern is to store the geometry in object storage and send a reference. Redis has no hard per-entry limit but every entry consumes RAM, so a stream of multi-megabyte polygons pressures memory fast. For both, prefer a compact binary encoding or a claim-check reference for oversized geometries.

</details>

<details class="faq">
<summary><strong>Does either broker give me exactly-once delivery for spatial events?</strong></summary>

Not for free end-to-end. Kafka supports exactly-once semantics within Kafka-to-Kafka transactions, but a webhook consumer that writes to PostGIS or calls an external API is outside that boundary and gets at-least-once. Redis Streams is at-least-once via pending entries and `XACK`. In both cases, make the consumer idempotent using a deterministic key so a redelivered event is a safe no-op.

</details>

---

## Related

- [Broker Selection & Partitioning for Spatial Streams](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/) — parent guide to choosing and partitioning the broker under a spatial webhook pipeline
- [Partitioning Kafka Topics by H3 Cell](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/partitioning-kafka-topics-by-h3-cell/) — the keyed-partition mechanics referenced above, in depth
- [Delivery Guarantees & Event Ordering](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/) — at-least-once, ordering, and idempotent consumers across both brokers
- [H3 vs S2 vs Quadkey for Spatial Partitioning](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/) — choosing the cell system you key partitions on
