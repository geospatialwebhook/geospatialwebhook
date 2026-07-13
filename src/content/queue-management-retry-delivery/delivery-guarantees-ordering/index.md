---
title: "Delivery Guarantees & Event Ordering"
description: "Choose delivery semantics (at-most-once, at-least-once, effectively-once) for spatial webhooks and enforce per-feature ordering so geometry states never go stale."
slug: "delivery-guarantees-ordering"
type: "guide"
breadcrumb: "Queue Management, Retries & Delivery Guarantees > Delivery Guarantees & Event Ordering"
datePublished: "2025-02-10"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Delivery Guarantees & Event Ordering",
      "description": "How to pick delivery semantics for spatial webhook pipelines and enforce per-feature and per-cell ordering so out-of-order geospatial events never corrupt geometry state.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/",
      "datePublished": "2025-02-10",
      "dateModified": "2026-07-13",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Queue Management, Retries & Delivery Guarantees", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/"},
        {"@type": "ListItem", "position": 3, "name": "Delivery Guarantees & Event Ordering", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Enforce delivery guarantees and ordering for spatial webhooks",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Choose a delivery guarantee and a stable ordering key"},
        {"@type": "HowToStep", "position": 2, "name": "Stamp every event with an observation time and monotonic version"},
        {"@type": "HowToStep", "position": 3, "name": "Reject stale events in an idempotent consumer by comparing version"},
        {"@type": "HowToStep", "position": 4, "name": "Buffer and reorder near-simultaneous events per key"},
        {"@type": "HowToStep", "position": 5, "name": "Handle redelivery, backoff, and reconciliation"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Do I need global ordering across all spatial webhook events?",
          "acceptedAnswer": {"@type": "Answer", "text": "Almost never. Global ordering forces a single partition, which caps throughput at one consumer and destroys the parallelism that spatial pipelines depend on. What matters is per-key ordering: all events for one feature ID or one H3 cell must be applied in the order they occurred. Events for unrelated features can be processed concurrently and out of order with no correctness impact, because their state is disjoint."}
        },
        {
          "@type": "Question",
          "name": "Why can an at-least-once pipeline still corrupt geometry state?",
          "acceptedAnswer": {"@type": "Answer", "text": "At-least-once guarantees an event is delivered, not that it is delivered in order or only once. A retried create event can arrive after the update that superseded it, so a naive consumer overwrites current geometry with a resurrected older shape. The fix is not stronger delivery but a stale-write guard: compare each event's version or observation_time against the version already stored, and drop anything older."}
        },
        {
          "@type": "Question",
          "name": "Should I use event time or arrival time to order spatial events?",
          "acceptedAnswer": {"@type": "Answer", "text": "Order by the observation_time recorded at the source (when the sensor measured the geometry), never by broker arrival time. Arrival time reflects network and retry jitter, not the real-world sequence of edits. Pair observation_time with a monotonic per-feature version counter so that two edits sharing a millisecond timestamp still have a deterministic order."}
        },
        {
          "@type": "Question",
          "name": "What is effectively-once and is it enough for spatial webhooks?",
          "acceptedAnswer": {"@type": "Answer", "text": "Effectively-once means the broker delivers at-least-once and the consumer is idempotent, so duplicate and out-of-order deliveries produce the same final state as a single in-order delivery. For the vast majority of geospatial pipelines this is the correct target: it needs no distributed transaction coordinator, tolerates retries, and — when combined with a per-key version guard — makes phantom geometry states impossible."}
        }
      ]
    }
  ]
}
</script>

**Spatial webhook pipelines rarely need global ordering, but they always need per-feature ordering: a feature-update event applied before its create, or an old create replayed after a delete, silently resurrects stale geometry — and the fix is a version-guarded idempotent consumer, not a stronger broker.**

This topic sits within [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/), the section covering how spatial events move reliably from producer to consumer once you accept that networks drop, reorder, and duplicate messages.

---

## Prerequisites

Before wiring ordering guarantees into your consumer, confirm your stack and mental model are in place. Check off each item:

- [ ] **Python 3.11+** — required for `tomllib`, precise `datetime` handling, and modern `asyncio` task groups
- [ ] **A partitioned broker** — Kafka 3.x, Redis Streams, or equivalent that preserves order *within* a partition
- [ ] **A stable ordering key per event** — a feature ID, asset ID, or H3 cell that groups all mutations of one spatial entity
- [ ] **`pydantic` 2.x** — strict validation of `observation_time` and `version` before any state write
- [ ] **A versioned state store** — PostgreSQL/PostGIS row with a `version` column, or any store supporting conditional writes
- [ ] **Clock discipline at the source** — producers stamp `observation_time`; consumers never trust arrival time for ordering
- [ ] **An idempotency layer** — see [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) for the duplicate-suppression half of the problem

---

## Architecture

The design separates three concerns that are often conflated: the *delivery guarantee* (how many times an event may arrive), the *ordering key* (which events must be sequenced relative to each other), and the *staleness guard* (how the consumer decides an arriving event is older than current state). Get these three right and the specific broker becomes an implementation detail.

<svg viewBox="0 0 760 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Two producers publish feature events into a partition keyed by feature ID; the partition preserves per-key order, and an out-of-order create arriving after an update is rejected by a version guard" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>Per-key ordering with a version guard reconciling an out-of-order arrival</title>
  <desc>Two producers emit events for feature F7. A partition keyed by feature ID preserves order for events that travel together, but a retried create v1 arrives after update v2. The consumer's version guard compares versions and rejects the stale create, keeping the stored geometry at v2.</desc>
  <defs>
    <marker id="dg-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Producers -->
  <rect x="12" y="40" width="120" height="46" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="72" y="60" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Producer A</text>
  <text x="72" y="76" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">F7 create · v1</text>
  <rect x="12" y="120" width="120" height="46" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="72" y="140" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Producer B</text>
  <text x="72" y="156" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">F7 update · v2</text>
  <!-- Arrows into partition -->
  <line x1="134" y1="63" x2="228" y2="95" stroke="currentColor" stroke-width="1.4" marker-end="url(#dg-arr)" opacity="0.5"/>
  <line x1="134" y1="143" x2="228" y2="112" stroke="currentColor" stroke-width="1.4" marker-end="url(#dg-arr)" opacity="0.5"/>
  <!-- Partition (keyed by feature id) -->
  <rect x="232" y="70" width="180" height="70" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="322" y="92" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Partition</text>
  <text x="322" y="108" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.75">key = hash(feature_id)</text>
  <text x="322" y="124" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">preserves per-key order</text>
  <text x="322" y="60" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.5">SAME KEY → SAME PARTITION</text>
  <!-- Out-of-order note -->
  <line x1="412" y1="105" x2="500" y2="105" stroke="currentColor" stroke-width="1.5" marker-end="url(#dg-arr)" opacity="0.55"/>
  <text x="456" y="97" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">retry reorders:</text>
  <text x="456" y="124" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">v2 then v1</text>
  <!-- Consumer / version guard -->
  <rect x="504" y="60" width="150" height="90" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="579" y="84" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Consumer</text>
  <text x="579" y="100" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">version guard</text>
  <text x="579" y="116" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">apply if v &gt; stored</text>
  <text x="579" y="132" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">else drop as stale</text>
  <!-- Outcomes -->
  <line x1="579" y1="150" x2="579" y2="196" stroke="currentColor" stroke-width="1.5" marker-end="url(#dg-arr)" opacity="0.55"/>
  <rect x="470" y="200" width="100" height="46" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="520" y="220" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">v2 applied</text>
  <text x="520" y="235" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">state = v2</text>
  <line x1="579" y1="150" x2="640" y2="196" stroke="currentColor" stroke-width="1.2" marker-end="url(#dg-arr)" opacity="0.45" stroke-dasharray="4,3"/>
  <rect x="588" y="200" width="120" height="46" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.4"/>
  <text x="648" y="220" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">v1 rejected</text>
  <text x="648" y="235" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">stale create dropped</text>
  <text x="380" y="290" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.55">Result: stored geometry stays at v2 despite the create arriving last — no phantom resurrection.</text>
</svg>

**Layer breakdown:**

1. **Delivery guarantee** — the broker and consumer contract on how many times an event may surface: *at-most-once* (fire-and-forget, may lose events), *at-least-once* (retried until acknowledged, may duplicate), or *effectively-once* (at-least-once delivery plus an idempotent consumer). Spatial ingestion almost always targets effectively-once; losing a parcel edit is worse than reprocessing one.
2. **Partitioning and ordering key** — the producer sets a partition key equal to the spatial entity's stable identifier (feature ID or H3 cell). All events for one entity land on one partition and preserve relative order there. Unrelated entities scale out across partitions. Partition strategy is covered in [Broker Selection & Partitioning for Spatial Streams](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/).
3. **Staleness guard** — even within a partition, a retry can reorder events across a rebalance or across two producers. The consumer stamps and compares a monotonic `version` (and `observation_time` as a tiebreaker) and applies an event only if it is newer than stored state.
4. **Reconciliation buffer** — for the narrow window where two events for the same key arrive nearly simultaneously and slightly out of order, a short per-key buffer sorts them before they hit the state store, avoiding needless rejections and re-fetches.

---

## Step-by-Step Implementation

### Step 1 — Model the Event with Ordering Metadata

Every spatial event must carry the two fields ordering depends on: `observation_time` (when the source measured the geometry, per the sensor clock) and `version` (a monotonic counter per feature). Validate both before the event reaches any state logic. Coordinates are EPSG:4326 (WGS84) per RFC 7946 ([spec](https://datatracker.ietf.org/doc/html/rfc7946)).

```python
from datetime import datetime, timezone
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator


class SpatialEvent(BaseModel):
    feature_id: str                      # stable ordering key for one entity
    version: int = Field(ge=0)           # monotonic per feature_id
    op: Literal["create", "update", "delete"]
    observation_time: datetime           # source clock, NOT arrival time
    crs: str = "EPSG:4326"               # WGS84 per RFC 7946
    geometry: dict[str, Any] | None      # None only for delete

    @field_validator("observation_time")
    @classmethod
    def must_be_tz_aware(cls, v: datetime) -> datetime:
        # Naive timestamps make cross-source ordering ambiguous; force UTC.
        if v.tzinfo is None:
            raise ValueError("observation_time must be timezone-aware (UTC)")
        return v.astimezone(timezone.utc)

    @field_validator("geometry")
    @classmethod
    def geometry_present_unless_delete(cls, v, info):
        if info.data.get("op") != "delete" and not v:
            raise ValueError("geometry required for create/update")
        return v
```

The `version` field is what makes ordering deterministic when timestamps collide. Two edits made in the same millisecond by different operators still have a strict order if the producer assigns versions from a per-feature counter.

---

### Step 2 — Publish with a Partition Key Equal to the Ordering Key

Ordering is only preserved *within* a partition, so the producer must route every event for one feature to the same partition by keying on `feature_id`. Using the H3 cell as the key instead groups all edits within a cell — appropriate when your consumer's state is per-cell rather than per-feature. H3, S2, and Quadkey tradeoffs are compared in [H3 vs S2 vs Quadkey for Spatial Partitioning](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/).

```python
import json
from aiokafka import AIOKafkaProducer


async def publish_event(producer: AIOKafkaProducer, event: SpatialEvent) -> None:
    """
    Publish keyed by feature_id so all mutations of one entity share a
    partition and therefore a preserved relative order. Kafka hashes the
    key to select the partition; the same key always maps to the same one.
    """
    payload = event.model_dump_json().encode("utf-8")
    key = event.feature_id.encode("utf-8")   # <-- ordering key == partition key
    await producer.send_and_wait("spatial-events", value=payload, key=key)
```

Do not key on a random UUID or the event ID — that scatters a feature's events across partitions and destroys any ordering the broker could have given you. The single most common ordering bug is a partition key that is finer-grained than the entity you actually need ordered.

---

### Step 3 — Reject Stale Events in an Idempotent Consumer

The core of the design: before applying an event, compare its `version` (with `observation_time` as a tiebreaker) against the version already stored for that feature. Apply only if strictly newer; otherwise drop it as stale. This single guard neutralizes both duplicates and out-of-order arrivals, and it is the pattern detailed further in [Idempotent Consumers for Out-of-Order Spatial Events](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/idempotent-consumers-for-out-of-order-spatial-events/).

```python
import asyncpg


async def apply_event(pool: asyncpg.Pool, event: SpatialEvent) -> str:
    """
    Conditionally upsert feature state. The WHERE clause makes the write a
    no-op when an equal-or-newer version already exists, so a replayed
    create (v1) arriving after an update (v2) cannot resurrect old geometry.
    Returns 'applied' or 'stale'.
    """
    geom_json = json.dumps(event.geometry) if event.geometry else None
    row = await pool.fetchrow(
        """
        INSERT INTO feature_state
            (feature_id, version, op, observation_time, geometry)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (feature_id) DO UPDATE
            SET version          = EXCLUDED.version,
                op               = EXCLUDED.op,
                observation_time = EXCLUDED.observation_time,
                geometry         = EXCLUDED.geometry
            WHERE EXCLUDED.version > feature_state.version
               OR (EXCLUDED.version = feature_state.version
                   AND EXCLUDED.observation_time > feature_state.observation_time)
        RETURNING version
        """,
        event.feature_id, event.version, event.op,
        event.observation_time, geom_json,
    )
    return "applied" if row is not None else "stale"
```

The conditional `WHERE` on the `ON CONFLICT` branch is doing the real work: PostgreSQL performs the comparison and the write atomically, so two concurrent consumers processing the same feature cannot interleave a lost update. When `apply_event` returns `"stale"`, the event was older than current state and was correctly ignored — this is the moment a phantom geometry state would otherwise have been created.

---

### Step 4 — Buffer Near-Simultaneous Events per Key

A version guard rejects genuinely stale events, but for two events that arrive within milliseconds slightly out of order, rejection forces the producer to re-send. A short per-key reordering buffer sorts a small window by `version` before applying, so the natural case resolves without redelivery.

```python
import asyncio
from collections import defaultdict


class PerKeyOrderingBuffer:
    """
    Holds events per feature_id for up to `window` seconds, then flushes them
    in version order. Bounds reordering work to one small buffer per active
    key rather than sorting the whole stream (which would need global order).
    """

    def __init__(self, window: float = 0.25) -> None:
        self.window = window
        self._buffers: dict[str, list[SpatialEvent]] = defaultdict(list)
        self._timers: dict[str, asyncio.Task] = {}

    async def submit(self, event: SpatialEvent, apply) -> None:
        key = event.feature_id
        self._buffers[key].append(event)
        # (Re)start the flush timer for this key only.
        if key in self._timers:
            self._timers[key].cancel()
        self._timers[key] = asyncio.create_task(self._flush_later(key, apply))

    async def _flush_later(self, key: str, apply) -> None:
        try:
            await asyncio.sleep(self.window)
        except asyncio.CancelledError:
            return
        events = sorted(
            self._buffers.pop(key, []),
            key=lambda e: (e.version, e.observation_time),
        )
        self._timers.pop(key, None)
        for event in events:          # apply() is itself the Step 3 guard
            await apply(event)
```

Keep the window tight — 100-500 ms is typical. The buffer is an optimization that reduces redelivery churn, not a correctness mechanism: the Step 3 version guard remains the authority, so even if the buffer flushes out of order, stale events are still rejected downstream.

---

## Spatial Validation and Error Handling

Ordering metadata can be valid while the geometry is not. Validate topology and CRS *after* the version guard admits an event but *before* it becomes stored state, so you never persist an invalid shape or waste validation cycles on events you will reject.

```python
from shapely.geometry import shape
from shapely.validation import explain_validity
from pyproj import CRS


def validate_spatial_payload(event: SpatialEvent) -> None:
    """
    Confirm CRS is the expected EPSG:4326 (WGS84) and the geometry is
    topologically valid before it is written as current feature state.
    Deletes carry no geometry and are skipped.
    """
    if event.op == "delete":
        return
    if CRS.from_user_input(event.crs).to_epsg() != 4326:
        raise ValueError(f"expected EPSG:4326 (WGS84), got {event.crs!r}")

    geom = shape(event.geometry)
    if geom.is_empty:
        raise ValueError("geometry empty after parsing")
    if not geom.is_valid:
        raise ValueError(f"invalid topology: {explain_validity(geom)}")
```

Route validation failures to a dead-letter path rather than dropping them, so a malformed producer does not silently lose data. A rejected-as-*stale* event is a normal, expected outcome and should be counted, not alerted on; a rejected-as-*invalid* event is a producer defect and deserves an alert. Distinguishing the two in your metrics is what keeps on-call noise low.

---

## Retry, Backoff, and Delivery Guarantees

At-least-once delivery means the broker will redeliver on any un-acknowledged event, and those redeliveries are exactly what reorder your stream. The consumer must therefore be safe to run repeatedly on the same event — which the Step 3 guard already guarantees — and retries of *processing* failures should use exponential backoff with jitter to avoid synchronized retry storms across partitions. The dedicated mechanics live in [Exponential Backoff & Jitter for Spatial Webhooks](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/).

```python
import random


async def consume_with_retry(buffer: PerKeyOrderingBuffer, pool, event: SpatialEvent,
                             max_attempts: int = 5, base: float = 0.3) -> None:
    """
    Apply an event through the ordering buffer with retry. Because apply_event
    is version-guarded, re-running it after a transient failure is safe:
    a duplicate or reordered redelivery converges to the same final state.
    """
    for attempt in range(1, max_attempts + 1):
        try:
            validate_spatial_payload(event)
            await buffer.submit(event, lambda e: apply_event(pool, e))
            return
        except ValueError:
            raise                                   # invalid payload: do not retry, dead-letter
        except (asyncpg.PostgresError, ConnectionError) as exc:
            if attempt == max_attempts:
                raise
            delay = random.uniform(0, base * (2 ** attempt))   # full jitter
            await asyncio.sleep(delay)
```

The guarantees form a ladder — pick the lowest rung that meets your correctness bar, since each step up costs latency or throughput:

<div style="overflow-x:auto;">

| Guarantee | Mechanism | Ordering behaviour for spatial state |
|-----------|-----------|--------------------------------------|
| At-most-once | Fire-and-forget, no ack, no retry | Lost edits leave stale geometry with no recovery; unacceptable for authoritative feature stores |
| At-least-once | Redeliver until acked, no dedup | Retries reorder and duplicate; a replayed create can resurrect deleted geometry unless guarded |
| Effectively-once | At-least-once + version-guarded idempotent consumer | Duplicates and reorderings converge to the correct final state per key; the right default |
| Exactly-once | Broker transactions + transactional sink | Strong, but couples producer, broker, and sink; latency rarely justified for spatial ingestion |

</div>

For nearly every geospatial webhook pipeline, effectively-once with a per-key version guard is the correct target. It requires no distributed transaction coordinator, tolerates the reordering that retries inevitably introduce, and — crucially for spatial data — makes it impossible for an old create or update to overwrite newer geometry. When two *concurrent* edits genuinely conflict (not merely arrive out of order), version comparison alone is insufficient and you must escalate to a merge policy; those semantics are covered in [Conflict Resolution Strategies](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/).

---

## Verification

Prove the guard behaves under the exact failure it exists to stop: a create arriving *after* the update that superseded it. The final state must reflect the newest version regardless of arrival order.

```python
import pytest
from datetime import datetime, timezone


def _evt(version: int, op: str, secs: int) -> SpatialEvent:
    return SpatialEvent(
        feature_id="F7",
        version=version,
        op=op,
        observation_time=datetime(2026, 7, 13, 12, 0, secs, tzinfo=timezone.utc),
        geometry={"type": "Point", "coordinates": [-0.1276, 51.5074]},  # EPSG:4326
    )


@pytest.mark.asyncio
async def test_stale_create_after_update_is_rejected(pg_pool):
    # In-order: create v1 then update v2 both apply.
    assert await apply_event(pg_pool, _evt(1, "create", 0)) == "applied"
    assert await apply_event(pg_pool, _evt(2, "update", 1)) == "applied"

    # Out-of-order redelivery: the create (v1) arrives LAST.
    assert await apply_event(pg_pool, _evt(1, "create", 0)) == "stale"

    row = await pg_pool.fetchrow(
        "SELECT version, op FROM feature_state WHERE feature_id = 'F7'"
    )
    assert row["version"] == 2 and row["op"] == "update", (
        "stored state must remain at v2 — the late create must not resurrect old geometry"
    )


@pytest.mark.asyncio
async def test_duplicate_delivery_is_idempotent(pg_pool):
    assert await apply_event(pg_pool, _evt(3, "update", 2)) == "applied"
    assert await apply_event(pg_pool, _evt(3, "update", 2)) == "stale"  # exact dup
```

Run with `pytest -v --asyncio-mode=auto` against a containerized PostgreSQL with the `feature_state` table and its `feature_id` primary key. The first test is the one that matters: without the conditional `WHERE`, the replayed create returns `"applied"` and the assertion on the stored version fails — the precise signature of a phantom geometry state reaching production.

---

## Troubleshooting

<div style="overflow-x:auto;">

| Symptom | Likely spatial cause | Fix |
|---------|----------------------|-----|
| Deleted features reappear on the map | Replayed create/update arrives after the delete and overwrites tombstone | Store deletes as a version bump (tombstone row), not a physical delete; keep the version guard on the delete path |
| Feature "flickers" between two geometries | Two producers assign overlapping versions for the same `feature_id` | Assign versions from a single authority per feature, or use `(version, observation_time, producer_id)` as the ordering tuple |
| Throughput collapses to one consumer | Everything keyed to a single partition chasing global ordering | Key by `feature_id` or H3 cell so unrelated entities parallelize across partitions |
| High rate of events rejected as stale | Ordering key finer than the entity (e.g. keyed on event ID) so retries scatter across partitions | Set the partition key equal to the entity you need ordered; re-check the producer key |
| Ordering wrong despite one partition | Consumer orders by broker arrival time, not source `observation_time` | Order and compare on `observation_time` + `version`; never trust arrival time |
| Two same-millisecond edits apply in wrong order | Timestamp collision with no tiebreaker | Add the monotonic `version` counter as the primary comparison key |
| Stale-rejection metric spikes after a rebalance | In-flight events redelivered and reordered during partition reassignment | Expected; confirm final state is correct and suppress alerting on stale rejections |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Do I need global ordering across all spatial webhook events?</strong></summary>

Almost never. Global ordering forces a single partition, which caps throughput at one consumer and destroys the parallelism that spatial pipelines depend on. What matters is per-key ordering: all events for one feature ID or one H3 cell must be applied in the order they occurred. Events for unrelated features can be processed concurrently and out of order with no correctness impact, because their state is disjoint.

</details>

<details class="faq">
<summary><strong>Why can an at-least-once pipeline still corrupt geometry state?</strong></summary>

At-least-once guarantees an event is delivered, not that it is delivered in order or only once. A retried create event can arrive after the update that superseded it, so a naive consumer overwrites current geometry with a resurrected older shape. The fix is not stronger delivery but a stale-write guard: compare each event's version or observation_time against the version already stored, and drop anything older.

</details>

<details class="faq">
<summary><strong>Should I use event time or arrival time to order spatial events?</strong></summary>

Order by the observation_time recorded at the source (when the sensor measured the geometry), never by broker arrival time. Arrival time reflects network and retry jitter, not the real-world sequence of edits. Pair observation_time with a monotonic per-feature version counter so that two edits sharing a millisecond timestamp still have a deterministic order.

</details>

<details class="faq">
<summary><strong>What is effectively-once and is it enough for spatial webhooks?</strong></summary>

Effectively-once means the broker delivers at-least-once and the consumer is idempotent, so duplicate and out-of-order deliveries produce the same final state as a single in-order delivery. For the vast majority of geospatial pipelines this is the correct target: it needs no distributed transaction coordinator, tolerates retries, and — when combined with a per-key version guard — makes phantom geometry states impossible.

</details>

---

## Related

- [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/) — the parent section covering reliable movement of spatial events from producer to consumer
- [Idempotent Consumers for Out-of-Order Spatial Events](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/idempotent-consumers-for-out-of-order-spatial-events/) — a deep dive on the version-guarded consumer pattern used in Step 3
- [Broker Selection & Partitioning for Spatial Streams](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/) — choosing a broker and a partition key that preserves per-key order at scale
- [Conflict Resolution Strategies](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/) — merge policies for genuinely concurrent edits that a version guard alone cannot resolve
- [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — the duplicate-suppression discipline that pairs with ordering to reach effectively-once
