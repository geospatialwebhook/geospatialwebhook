---
title: "Idempotent Consumers for Out-of-Order Spatial Events"
description: "Build a spatial event consumer that is safe under at-least-once delivery and out-of-order arrival, so a stale feature update never overwrites a newer geometry."
slug: "idempotent-consumers-for-out-of-order-spatial-events"
type: "long_tail"
breadcrumb:
  - label: "Queue Management, Retries & Delivery Guarantees"
    url: "/queue-management-retry-delivery/"
  - label: "Delivery Guarantees & Event Ordering"
    url: "/queue-management-retry-delivery/delivery-guarantees-ordering/"
  - label: "Idempotent Consumers for Out-of-Order Spatial Events"
    url: "/queue-management-retry-delivery/delivery-guarantees-ordering/idempotent-consumers-for-out-of-order-spatial-events/"
datePublished: "2025-05-14"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Idempotent Consumers for Out-of-Order Spatial Events",
      "description": "Build a spatial event consumer that is safe under at-least-once delivery and out-of-order arrival, so a stale feature update never overwrites a newer geometry.",
      "url": "https://geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/idempotent-consumers-for-out-of-order-spatial-events/",
      "datePublished": "2025-05-14",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Queue Management, Retries & Delivery Guarantees", "item": "https://geospatialwebhook.com/queue-management-retry-delivery/" },
        { "@type": "ListItem", "position": 2, "name": "Delivery Guarantees & Event Ordering", "item": "https://geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/" },
        { "@type": "ListItem", "position": 3, "name": "Idempotent Consumers for Out-of-Order Spatial Events", "item": "https://geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/idempotent-consumers-for-out-of-order-spatial-events/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Build an idempotent consumer for out-of-order spatial events",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Drop exact duplicates by idempotency key", "text": "Check the event's content-derived idempotency key against a Redis store with SET NX. If the key already exists, the event is an exact redelivery and is acknowledged without touching feature state." },
        { "@type": "HowToStep", "position": 2, "name": "Carry a per-feature version or observation time", "text": "Require every event to carry a monotonic version or observation_time for its feature_id. This is the ordering token the consumer compares, independent of arrival order." },
        { "@type": "HowToStep", "position": 3, "name": "Apply as a conditional upsert", "text": "Upsert the feature into PostGIS with a WHERE clause that only overwrites the stored row when the incoming observed_at is strictly greater than the existing observed_at, so stale updates are ignored." },
        { "@type": "HowToStep", "position": 4, "name": "Acknowledge regardless of outcome", "text": "Whether the row was updated, skipped as stale, or dropped as a duplicate, acknowledge the message so the broker does not redeliver it and amplify load." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should I order events by wall-clock arrival time or by observation time?",
          "acceptedAnswer": { "@type": "Answer", "text": "Always by observation time — the moment the sensor or source system recorded the feature state. Wall-clock arrival time reflects network and queue delays, so a stale event that was delayed can arrive after a fresh one. Ordering by received_at would then let the stale event win. Use a source-supplied version or observation_time as the comparison token." }
        },
        {
          "@type": "Question",
          "name": "What happens when two events for the same feature have identical observation times?",
          "acceptedAnswer": { "@type": "Answer", "text": "A strict greater-than comparison treats ties as no-ops: neither overwrites the other, so whichever landed first wins and the result is stable and deterministic. If ties must be broken deterministically, add a secondary tiebreaker such as a monotonic sequence number or the idempotency key, and compare the pair (observed_at, seq) lexicographically." }
        },
        {
          "@type": "Question",
          "name": "Do I still need an idempotency key if I already compare versions?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes. Version comparison makes a redelivered event a harmless no-op at the database, but it still costs a round trip and can mask logic bugs. A Redis idempotency check drops exact duplicates before they reach the database, which is cheaper and gives you a clean duplicate-rate metric. The two mechanisms cover different failure modes and are complementary." }
        },
        {
          "@type": "Question",
          "name": "Why must monotonicity be per feature rather than global?",
          "acceptedAnswer": { "@type": "Answer", "text": "Independent features change independently, and a partitioned broker gives you ordering guarantees only within a partition, not across the whole topic. Requiring a single global sequence would force all events through one partition and destroy throughput. Track the latest version per feature_id so each feature has its own monotonic timeline while features remain independent and parallelisable." }
        }
      ]
    }
  ]
}
</script>

**To make a spatial consumer safe under at-least-once delivery and out-of-order arrival, drop exact redeliveries with an idempotency-key check, then apply every feature update as a conditional upsert that overwrites the stored row only when the incoming `observed_at` is strictly newer than what is already persisted.** Ordering by observation time rather than arrival time guarantees that a delayed, stale feature update can never clobber a newer geometry, no matter what order the broker hands the events to you.

This page sits within [Delivery Guarantees & Event Ordering](/queue-management-retry-delivery/delivery-guarantees-ordering/), part of the broader [Queue Management, Retries & Delivery Guarantees](/queue-management-retry-delivery/) reference for building spatial webhook pipelines that survive redelivery and reordering.

---

## When to use this pattern

Reach for a version-aware conditional upsert when:

- Your broker gives **at-least-once** delivery (Kafka, Redis Streams, SQS, RabbitMQ), so any event may arrive more than once, and reprocessing must be safe.
- Events for the same feature can arrive **out of order** — because of retries, partition rebalances, multiple producers, or a slow consumer catching up after lag — and the newest state must always win.
- You maintain a **current-state table** (the latest known geometry and attributes per feature), not just an append-only log, so a stale write would visibly corrupt what users see.

It is **not** the right tool when you genuinely need a full event history rather than a latest-value projection — there, append every event to an immutable log keyed by `(feature_id, version)` and compute the current state at read time. It is also unnecessary when your broker provides strict total ordering *and* exactly-once semantics end to end, which almost no real webhook pipeline does.

---

## Why out-of-order delivery corrupts spatial state

At-least-once delivery and ordering are two separate guarantees, and most pipelines have neither for free. A feature — a parcel boundary, a vehicle position, a flood-zone polygon — emits an update at 12:00:00 and a correction at 12:00:03. The 12:00:00 event hits a transient failure, gets retried, and lands *after* the 12:00:03 event. If your consumer blindly writes whatever it receives, the last message processed wins, and the stored geometry silently reverts to the older, wrong shape. Nothing errors; the map is just quietly stale.

The fix is to stop trusting arrival order and start trusting an ordering token carried *inside* each event — a per-feature `version` counter or, more commonly for sensor data, the source `observed_at` timestamp. The consumer compares that token against what is already stored and applies the write only if it is strictly newer. This is a form of last-writer-wins conflict resolution where "last" means *newest observation*, not *newest arrival*; the deeper trade-offs of that choice are covered in [Conflict Resolution Strategies](/idempotency-spatial-deduplication/conflict-resolution-strategies/).

<svg viewBox="0 0 760 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Out-of-order spatial event consumer decision flow" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>Idempotent out-of-order consumer decision flow</title>
  <desc>An event arrives and flows through a Redis idempotency-key check that drops exact duplicates, then a PostGIS conditional upsert that compares the incoming observation time against the stored observation time, applying the write only when the incoming event is strictly newer and otherwise skipping it as stale. All three outcomes acknowledge the message.</desc>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L8,3.5 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Incoming event -->
  <rect x="8" y="120" width="120" height="60" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="68" y="146" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Event</text>
  <text x="68" y="162" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">feature + observed_at</text>
  <line x1="128" y1="150" x2="152" y2="150" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Redis idempotency check -->
  <rect x="154" y="120" width="150" height="60" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="229" y="145" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Redis SET NX</text>
  <text x="229" y="161" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">idempotency key</text>
  <!-- duplicate branch -->
  <line x1="229" y1="120" x2="229" y2="70" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="243" y="98" text-anchor="start" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">exact duplicate</text>
  <rect x="154" y="30" width="150" height="40" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="229" y="55" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">DROP → ack</text>
  <line x1="304" y1="150" x2="328" y2="150" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- PostGIS conditional upsert -->
  <rect x="330" y="115" width="180" height="70" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="420" y="140" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">PostGIS upsert</text>
  <text x="420" y="156" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">WHERE incoming.observed_at</text>
  <text x="420" y="170" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">&gt; existing.observed_at</text>
  <!-- stale branch -->
  <line x1="420" y1="115" x2="420" y2="70" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="434" y="98" text-anchor="start" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">older / tie</text>
  <rect x="345" y="30" width="150" height="40" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="420" y="55" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">SKIP stale → ack</text>
  <!-- apply branch -->
  <line x1="510" y1="150" x2="558" y2="150" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="534" y="142" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">newer</text>
  <rect x="560" y="120" width="180" height="60" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="650" y="145" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Row updated</text>
  <text x="650" y="161" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">newest geometry wins → ack</text>
</svg>

---

## Complete runnable implementation

The consumer below is self-contained and async. It reads events from an in-memory queue (swap in your Kafka or Redis Streams client), performs a Redis idempotency check to drop exact duplicates, then issues a single-statement PostGIS conditional upsert that persists the feature only when the incoming observation is strictly newer. Geometry arrives as GeoJSON in EPSG:4326 (WGS84) per RFC 7946 and is handed to PostGIS via `ST_GeomFromGeoJSON`. The idempotency key is assumed to be a content digest computed upstream (see the related links); here we only check and record it.

```python
import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncpg
import redis.asyncio as redis

# --- Event model -----------------------------------------------------------

@dataclass(frozen=True)
class FeatureEvent:
    feature_id: str          # stable identity of the real-world feature
    idempotency_key: str     # content digest, unique per exact payload
    observed_at: datetime    # SOURCE observation time (NOT arrival time)
    geometry: dict           # GeoJSON geometry, EPSG:4326 (WGS84), RFC 7946
    properties: dict         # non-spatial attributes


# --- Schema (run once) -----------------------------------------------------
# CREATE TABLE features (
#     feature_id  text PRIMARY KEY,
#     observed_at timestamptz NOT NULL,
#     geom        geometry(Geometry, 4326) NOT NULL,
#     properties  jsonb NOT NULL DEFAULT '{}'::jsonb,
#     updated_at  timestamptz NOT NULL DEFAULT now()
# );

UPSERT_SQL = """
INSERT INTO features (feature_id, observed_at, geom, properties)
VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4::jsonb)
ON CONFLICT (feature_id) DO UPDATE
    SET observed_at = EXCLUDED.observed_at,
        geom        = EXCLUDED.geom,
        properties  = EXCLUDED.properties,
        updated_at  = now()
    -- The guard: only overwrite when the incoming observation is STRICTLY
    -- newer. A stale (older) or tied event leaves the stored row untouched.
    WHERE features.observed_at < EXCLUDED.observed_at
RETURNING feature_id;
"""


async def is_duplicate(r: redis.Redis, key: str, ttl_seconds: int = 259200) -> bool:
    """Return True if this exact payload was already seen (at-least-once guard).

    SET NX is atomic: the first caller sets the key and gets True back from
    Redis; any concurrent or later redelivery finds the key present and is
    told it is a duplicate. TTL should cover the broker's redelivery window
    (72h default here).
    """
    # `set(..., nx=True)` returns True only if the key did NOT exist.
    was_set = await r.set(f"idem:{key}", "1", nx=True, ex=ttl_seconds)
    return not was_set


async def handle_event(pool: asyncpg.Pool, r: redis.Redis, ev: FeatureEvent) -> str:
    """Process one event idempotently and order-safely. Returns the outcome."""
    # 1. Drop exact redeliveries before touching the database.
    if await is_duplicate(r, ev.idempotency_key):
        return "duplicate"

    # 2. Conditional upsert: newest observation wins, regardless of arrival order.
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            UPSERT_SQL,
            ev.feature_id,
            ev.observed_at,
            json.dumps(ev.geometry),
            json.dumps(ev.properties),
        )
    # RETURNING yields a row only when the WHERE guard passed (insert or newer update).
    return "applied" if row is not None else "stale"


async def consume(pool: asyncpg.Pool, r: redis.Redis, queue: asyncio.Queue) -> None:
    """Main consumer loop. Acknowledge on every outcome so the broker
    does not redeliver a message we have already reasoned about."""
    while True:
        ev, ack = await queue.get()
        try:
            outcome = await handle_event(pool, r, ev)
            print(f"{ev.feature_id} @ {ev.observed_at.isoformat()} -> {outcome}")
            ack()  # duplicate, stale, and applied are all terminal — ack all three
        except Exception:
            # Do NOT ack: let the broker redeliver. The idempotency + version
            # guards make redelivery safe, so transient errors self-heal.
            raise
        finally:
            queue.task_done()


async def main() -> None:
    pool = await asyncpg.create_pool(dsn="postgresql://localhost/geo")
    r = redis.from_url("redis://localhost/0")
    queue: asyncio.Queue = asyncio.Queue()

    # Enqueue an OUT-OF-ORDER pair: the newer correction arrives FIRST.
    t_new = datetime(2026, 7, 13, 12, 0, 3, tzinfo=timezone.utc)
    t_old = datetime(2026, 7, 13, 12, 0, 0, tzinfo=timezone.utc)
    events = [
        FeatureEvent("parcel-42", "key-new", t_new,
                     {"type": "Point", "coordinates": [-73.9857, 40.7484]}, {"v": 2}),
        FeatureEvent("parcel-42", "key-old", t_old,
                     {"type": "Point", "coordinates": [-73.9800, 40.7400]}, {"v": 1}),
    ]
    for ev in events:
        await queue.put((ev, lambda: None))

    worker = asyncio.create_task(consume(pool, r, queue))
    await queue.join()
    worker.cancel()
    await pool.close()
    await r.aclose()


if __name__ == "__main__":
    asyncio.run(main())
```

The entire ordering decision lives in one line of SQL — `WHERE features.observed_at < EXCLUDED.observed_at` — evaluated atomically by PostgreSQL under row locking. There is no read-then-write race: concurrent consumers cannot both read a stale `observed_at` and both decide to write, because the conditional update is a single statement.

---

## Parameter reference

| Parameter | Type | Spatial constraint | Default |
|---|---|---|---|
| `feature_id` | `str` | Stable identity of the real-world feature; the per-feature ordering scope. Not the geometry hash | — |
| `idempotency_key` | `str` | Content digest of the exact payload; two distinct events at one feature must differ | — |
| `observed_at` | `timestamptz` | Source observation time in UTC; the comparison token. Must be monotonic *per `feature_id`* | — |
| `geometry` | `dict` (GeoJSON) | Must be EPSG:4326 (WGS84) per RFC 7946; reproject upstream before ingest | — |
| `ttl_seconds` | `int` | Redis idempotency TTL; set ≥ broker's max redelivery window | `259200` (72h) |
| SRID in `ST_SetSRID` | `int` | Must match the column's declared SRID (`4326`) or PostGIS raises a mixed-SRID error | `4326` |

---

## Gotchas and spatial edge cases

1. **Wall-clock arrival time is not observation time.** Never order by `received_at` or `now()`. A stale event delayed by a retry arrives *later* but describes an *earlier* state; comparing arrival times would let it win. Compare only the source-stamped `observed_at` (or a source `version`), which travels with the payload and reflects when the feature actually held that shape.

2. **Ties are silently dropped by `<`.** With a strict less-than guard, two events sharing an identical `observed_at` never overwrite each other — first write wins, stably. That is usually correct. If you must break ties deterministically (e.g. two producers stamping the same second), compare a composite `(observed_at, sequence)` and guard on `features.observed_at < EXCLUDED.observed_at OR (equal AND features.seq < EXCLUDED.seq)`.

3. **A missing version field defeats the whole scheme.** If some producers omit `observed_at`, you cannot order their events. Reject such events to a dead-letter queue rather than defaulting to `now()` — defaulting silently reintroduces arrival-order semantics and the stale-overwrite bug you are trying to kill.

4. **Monotonicity is per feature, not global.** Each `feature_id` needs its own increasing timeline; there is no requirement that feature A's clock relate to feature B's. Do not force a global sequence — it collapses all traffic onto one partition and destroys throughput. Kafka only orders within a partition, so key your topic by `feature_id` (or its H3 cell) to keep each feature's events on one partition.

5. **Late create after update (the phantom row).** If a `create` for a feature is delayed and its later `update` arrives first, the `INSERT ... ON CONFLICT` still does the right thing: the update inserts the row, and the delayed create — carrying an *older* `observed_at` — hits the `WHERE` guard and is skipped. The newest state survives even when "create" loses the race, provided the create carries the correct earlier `observed_at`.

6. **SRID must match the column.** Feeding a geometry parsed without an SRID, or in a different CRS such as EPSG:3857 (Web Mercator), into a `geometry(Geometry, 4326)` column raises `Operation on mixed SRID geometries`. Always wrap with `ST_SetSRID(..., 4326)` and reproject non-WGS84 sources before they reach the consumer.

7. **Idempotency TTL shorter than the retry window reopens the gap.** If Redis expires the key before the broker stops retrying, a very late redelivery is treated as new. It is still order-safe (the version guard catches it), but you lose the cheap duplicate-drop and the duplicate-rate metric. Size the TTL to exceed your provider's maximum retry horizon.

---

## Verification

This pytest exercises the core invariant: an out-of-order pair — newer event processed first, older event second — must converge to the newer geometry. It uses stub stores so it runs without a live database or Redis, isolating the ordering logic.

```python
import pytest
from datetime import datetime, timezone


class FakeFeatureStore:
    """Emulates the PostGIS conditional upsert: newest observed_at wins."""
    def __init__(self):
        self.rows = {}

    def upsert_if_newer(self, feature_id, observed_at, geom):
        existing = self.rows.get(feature_id)
        if existing is None or existing["observed_at"] < observed_at:
            self.rows[feature_id] = {"observed_at": observed_at, "geom": geom}
            return "applied"
        return "stale"      # strict '<' => older OR tied is skipped


class FakeIdem:
    def __init__(self):
        self.seen = set()

    def is_duplicate(self, key):
        if key in self.seen:
            return True
        self.seen.add(key)
        return False


def process(store, idem, feature_id, key, observed_at, geom):
    if idem.is_duplicate(key):
        return "duplicate"
    return store.upsert_if_newer(feature_id, observed_at, geom)


T_OLD = datetime(2026, 7, 13, 12, 0, 0, tzinfo=timezone.utc)
T_NEW = datetime(2026, 7, 13, 12, 0, 3, tzinfo=timezone.utc)
GEOM_OLD = {"type": "Point", "coordinates": [-73.9800, 40.7400]}
GEOM_NEW = {"type": "Point", "coordinates": [-73.9857, 40.7484]}


def test_out_of_order_converges_to_newest():
    """Newer event arrives first, stale event second: newest geometry must win."""
    store, idem = FakeFeatureStore(), FakeIdem()
    assert process(store, idem, "p-42", "k2", T_NEW, GEOM_NEW) == "applied"
    assert process(store, idem, "p-42", "k1", T_OLD, GEOM_OLD) == "stale"
    assert store.rows["p-42"]["geom"] == GEOM_NEW      # stale did NOT overwrite


def test_in_order_also_converges():
    """Same two events in natural order converge to the same final state."""
    store, idem = FakeFeatureStore(), FakeIdem()
    assert process(store, idem, "p-42", "k1", T_OLD, GEOM_OLD) == "applied"
    assert process(store, idem, "p-42", "k2", T_NEW, GEOM_NEW) == "applied"
    assert store.rows["p-42"]["geom"] == GEOM_NEW


def test_exact_redelivery_is_dropped():
    """At-least-once: the same key twice is a no-op the second time."""
    store, idem = FakeFeatureStore(), FakeIdem()
    assert process(store, idem, "p-42", "k2", T_NEW, GEOM_NEW) == "applied"
    assert process(store, idem, "p-42", "k2", T_NEW, GEOM_NEW) == "duplicate"


def test_tie_does_not_overwrite():
    """Equal observation times: first write wins, tie is skipped."""
    store, idem = FakeFeatureStore(), FakeIdem()
    process(store, idem, "p-42", "a", T_NEW, GEOM_NEW)
    assert process(store, idem, "p-42", "b", T_NEW, GEOM_OLD) == "stale"
    assert store.rows["p-42"]["geom"] == GEOM_NEW
```

Both orderings land on `GEOM_NEW`, which is the definition of convergence: the final state is independent of delivery order and delivery count.

---

## FAQ

<details class="faq">
<summary><strong>Should I order events by wall-clock arrival time or by observation time?</strong></summary>

Always by observation time — the moment the sensor or source system recorded the feature state. Wall-clock arrival time reflects network and queue delays, so a stale event that was delayed can arrive after a fresh one. Ordering by `received_at` would then let the stale event win. Use a source-supplied `version` or `observed_at` as the comparison token.

</details>

<details class="faq">
<summary><strong>What happens when two events for the same feature have identical observation times?</strong></summary>

A strict greater-than comparison treats ties as no-ops: neither overwrites the other, so whichever landed first wins and the result is stable and deterministic. If ties must be broken deterministically, add a secondary tiebreaker such as a monotonic sequence number or the idempotency key, and compare the pair `(observed_at, seq)` lexicographically.

</details>

<details class="faq">
<summary><strong>Do I still need an idempotency key if I already compare versions?</strong></summary>

Yes. Version comparison makes a redelivered event a harmless no-op at the database, but it still costs a round trip and can mask logic bugs. A Redis idempotency check drops exact duplicates before they reach the database, which is cheaper and gives you a clean duplicate-rate metric. The two mechanisms cover different failure modes and are complementary.

</details>

<details class="faq">
<summary><strong>Why must monotonicity be per feature rather than global?</strong></summary>

Independent features change independently, and a partitioned broker gives you ordering guarantees only within a partition, not across the whole topic. Requiring a single global sequence would force all events through one partition and destroy throughput. Track the latest version per `feature_id` so each feature has its own monotonic timeline while features remain independent and parallelisable.

</details>

---

## Related

- [Delivery Guarantees & Event Ordering](/queue-management-retry-delivery/delivery-guarantees-ordering/) — parent: the full picture of at-least-once, exactly-once, and ordering for spatial streams
- [Conflict Resolution Strategies](/idempotency-spatial-deduplication/conflict-resolution-strategies/) — deciding which write wins when versions collide, beyond simple last-writer-wins
- [Cache-Backed Idempotency Checks](/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) — the Redis store and atomic `SET NX` pattern behind the duplicate-drop step
