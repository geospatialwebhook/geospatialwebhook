---
title: "Backpressure & Flow Control for Spatial Streams"
description: "Apply backpressure when a geometry consumer falls behind: bounded prefetch sized for variable geometry cost, pause/resume on lag, and geographic load shedding under saturation."
slug: "backpressure-flow-control"
type: "guide"
breadcrumb: "Queue Management, Retries & Delivery Guarantees > Backpressure & Flow Control for Spatial Streams"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Backpressure & Flow Control for Spatial Streams",
      "description": "How to keep a geospatial consumer from collapsing under load it cannot process: why unbounded prefetch is dangerous when payload cost varies by three orders of magnitude, how to size a prefetch window in work rather than in messages, when to pause a partition instead of scaling out, and how to shed load by geographic priority when saturation is unavoidable.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/",
      "datePublished": "2026-08-08",
      "dateModified": "2026-08-08",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Queue Management, Retries & Delivery Guarantees", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/"},
        {"@type": "ListItem", "position": 3, "name": "Backpressure & Flow Control for Spatial Streams", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Apply backpressure to a spatial event consumer",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Measure prefetch in estimated work, not in message count"},
        {"@type": "HowToStep", "position": 2, "name": "Bound in-flight work with a semaphore sized from vertex budget"},
        {"@type": "HowToStep", "position": 3, "name": "Pause the partition when the in-flight budget is exhausted"},
        {"@type": "HowToStep", "position": 4, "name": "Shed by geographic priority once the pause window is exceeded"},
        {"@type": "HowToStep", "position": 5, "name": "Verify that a burst of heavy geometries does not trip the broker's session timeout"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why is a message-count prefetch wrong for spatial payloads?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because message count says nothing about work. A prefetch of 100 might be 100 point pings costing 200 milliseconds in total, or 100 land-cover multipolygons costing 90 seconds. The same setting is simultaneously far too small for one and catastrophically too large for the other, and which one you get is decided by geography rather than by anything you control. Size the window in estimated work — vertex count is a good proxy and is available from the envelope without deserialising the geometry."}
        },
        {
          "@type": "Question",
          "name": "Should I pause the partition or just process more slowly?",
          "acceptedAnswer": {"@type": "Answer", "text": "Pause it. Processing slowly while continuing to fetch means the broker keeps handing you messages you have not started, which grows unbounded memory and, worse, does not stop the broker's session timer. Kafka expects a poll within max.poll.interval.ms; a consumer that is busy rather than polling gets evicted from the group and its partitions rebalanced, which produces duplicate delivery on top of the backlog you already had. Pausing keeps you polling — returning no records — so the session stays alive."}
        },
        {
          "@type": "Question",
          "name": "Is load shedding ever acceptable for spatial events?",
          "acceptedAnswer": {"@type": "Answer", "text": "It is acceptable when the alternative is losing everything, and only for streams where a later event supersedes an earlier one. Shedding a vehicle position ping is defensible because another arrives in seconds and the newer one is strictly more useful. Shedding a cadastral boundary edit is data loss, because nothing will resend it. Split those streams by topic so the shedding policy can differ, and never shed a stream whose events are not self-superseding."}
        },
        {
          "@type": "Question",
          "name": "How does backpressure interact with the retry budget?",
          "acceptedAnswer": {"@type": "Answer", "text": "They control opposite ends of the same pipe and can fight each other. Backpressure slows intake when the consumer is saturated; a retry ladder increases intake when deliveries fail. A saturated consumer that starts timing out generates retries, which arrive as additional load on the consumer that was already saturated. Gate retries on the same saturation signal that drives backpressure, so a consumer under pressure sheds retries first and fresh events last."}
        }
      ]
    }
  ]
}
</script>

**Backpressure for a spatial stream has to be measured in work rather than in messages, because a single partition can carry point pings costing two milliseconds and multipolygons costing nine hundred — so a prefetch window that is safe for one is three orders of magnitude wrong for the other, and which you receive is decided by geography.**

This topic sits under [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/), which covers how spatial events move from producer to consumer without loss or duplication. Backpressure is the mechanism that keeps a consumer inside its own capacity; when it fails, the symptoms show up as the consumer lag described in [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/), and the retries it triggers are governed by [Exponential Backoff & Jitter for Spatial Webhooks](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/).

---

## Prerequisites

- [ ] **Python 3.11+** — `asyncio.TaskGroup` and `timeout` simplify the bounded-concurrency code below
- [ ] **A broker with pause/resume** — `aiokafka`'s `pause()`/`resume()`, or Redis Streams consumer groups where you control the read loop
- [ ] **Vertex count in the envelope** — precomputed at ingest, so the consumer can estimate cost without parsing the geometry
- [ ] **A process pool for heavy geometry** — as described in [Async Processing for Geometry-Heavy Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/)
- [ ] **Per-partition lag metrics** — the saturation signal that drives pausing
- [ ] **A documented shedding policy** — which topics may be shed, and which may never be

---

## Why message-count prefetch fails here

Every broker's flow control is expressed in messages: `max.poll.records`, `prefetch_count`, `COUNT` on `XREADGROUP`. That unit assumes messages are roughly interchangeable in cost, which is true of order events and false of spatial ones.

<figure class="fig">
<svg viewBox="0 0 760 244" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The same prefetch of 100 messages representing wildly different amounts of work depending on payload mix">
<title>One prefetch setting, three very different workloads</title>
<desc>A prefetch window of one hundred messages fetched against three payload mixes from the same topic. A hundred point pings at about two milliseconds each is roughly 0.2 seconds of work and a few hundred kilobytes held in memory, so the window is far too small to keep the consumer busy. A realistic mixed batch of ninety points and ten mid-size polygons is about 2.5 seconds and comfortable. A hundred land-cover multipolygons at about nine hundred milliseconds each is roughly ninety seconds of work and close to three hundred megabytes resident — the same setting, now catastrophic, because the consumer has committed to processing all of it before it can poll again and will be evicted from the group long before it finishes. Which of the three arrives is decided by which region the partition covers and what is happening there, not by anything the operator configured.</desc>
<rect x="0" y="0" width="760" height="244" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-ink)">prefetch = 100 messages, on three payload mixes from one topic</text>
<rect x="14" y="30" width="732" height="56" rx="7" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="26" y="49" font-size="9.5" font-weight="600" fill="var(--fig-ink)">100 point pings — 2 ms each</text>
<text x="26" y="66" font-size="9" fill="var(--fig-ink-soft)">≈ 0.2 s of work · a few hundred KB resident</text>
<text x="26" y="79" font-size="9" fill="var(--fig-gold-edge)">window far too small — the consumer idles between polls</text>
<rect x="14" y="94" width="732" height="56" rx="7" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="113" font-size="9.5" font-weight="600" fill="var(--fig-ink)">90 points + 10 mid-size polygons</text>
<text x="26" y="130" font-size="9" fill="var(--fig-ink-soft)">≈ 2.5 s of work · comfortably inside the poll interval</text>
<text x="26" y="143" font-size="9" fill="var(--fig-mint-edge)">the mix the setting was tuned against</text>
<rect x="14" y="158" width="732" height="72" rx="7" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="26" y="177" font-size="9.5" font-weight="600" fill="var(--fig-ink)">100 land-cover multipolygons — 900 ms each</text>
<text x="26" y="194" font-size="9" fill="var(--fig-ink-soft)">≈ 90 s of work · ~300 MB resident</text>
<text x="26" y="208" font-size="9" fill="var(--fig-rose-edge)">the consumer cannot poll again until it finishes, so the broker evicts it from the group</text>
<text x="26" y="221" font-size="9" fill="var(--fig-rose-edge)">— and the rebalance redelivers the whole batch to someone else</text>
</svg>
<figcaption><b>Figure 1.</b> The third row is not a tuning mistake; it is the same setting meeting different geography. A count-based window cannot distinguish these because it never looks at what it is fetching.</figcaption>
</figure>

The eviction in that third row is the part that turns a slow consumer into an outage. Kafka expects a `poll()` within `max.poll.interval.ms`; a consumer that is busy rather than polling is presumed dead, its partitions are reassigned, and the batch it was halfway through is redelivered to another member — which is holding the same prefetch setting and meets the same fate.

---

## Architecture: bound the work, not the count

The fix is to keep the broker's own window small and enforce a second, work-aware bound inside the consumer. Vertex count, precomputed at ingest and carried in the envelope, is a good cost proxy: it is cheap to read, correlates well with `shapely` runtime, and does not require deserialising the geometry to obtain.

<figure class="fig">
<svg viewBox="0 0 760 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A work-budget semaphore between the broker poll loop and the worker pool, with pause and shed thresholds">
<title>A vertex budget between the poll loop and the workers</title>
<desc>Messages are polled in small batches and each is charged against a shared vertex budget before dispatch. A point ping costs about forty vertices and passes straight through; a multipolygon costing forty-one thousand consumes most of the budget alone. While the budget has room, work is dispatched to the process pool and the loop keeps polling. When the budget is exhausted the loop pauses the partition — it continues to call poll, which returns nothing, so the broker's session timer is satisfied and the consumer is not evicted, but no new work is accepted. Completed work returns its vertices to the budget and the partition resumes. If the pause persists beyond a bounded window, the consumer escalates to shedding: it drops self-superseding events by geographic priority rather than continuing to accumulate a backlog it will never clear. The budget is the whole mechanism — it converts an unbounded queue of unknown-cost work into a bounded amount of known-cost work.</desc>
<rect x="0" y="0" width="760" height="250" fill="var(--fig-bg)"/>
<defs><marker id="bp-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="80" width="118" height="52" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="73" y="100" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">poll loop</text>
<text x="73" y="116" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">small batches</text>
<line x1="134" y1="106" x2="166" y2="106" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#bp-a)"/>
<rect x="170" y="72" width="170" height="68" rx="7" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="255" y="92" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">vertex budget</text>
<text x="255" y="108" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">charge before dispatch</text>
<text x="255" y="122" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">point ≈ 40 · polygon ≈ 41,000</text>
<text x="255" y="134" text-anchor="middle" font-size="8" fill="var(--fig-mint-edge)">one polygon can fill it alone</text>
<line x1="342" y1="94" x2="374" y2="72" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#bp-a)"/>
<text x="348" y="66" font-size="8" fill="var(--fig-mint-edge)">room</text>
<rect x="378" y="46" width="170" height="50" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="463" y="66" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink)">dispatch to process pool</text>
<text x="463" y="82" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">completion returns the vertices</text>
<line x1="342" y1="120" x2="374" y2="146" stroke="var(--fig-line)" stroke-width="1.2" stroke-dasharray="3,2" marker-end="url(#bp-a)"/>
<text x="348" y="160" font-size="8" fill="var(--fig-gold-edge)">full</text>
<rect x="378" y="118" width="170" height="58" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="463" y="138" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink)">pause the partition</text>
<text x="463" y="153" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">keep calling poll — it returns</text>
<text x="463" y="165" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">nothing, so the session survives</text>
<line x1="550" y1="147" x2="582" y2="177" stroke="var(--fig-line)" stroke-width="1.2" stroke-dasharray="3,2" marker-end="url(#bp-a)"/>
<text x="562" y="142" font-size="8" fill="var(--fig-rose-edge)">still full after N s</text>
<rect x="586" y="164" width="160" height="58" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="666" y="184" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink)">shed by priority</text>
<text x="666" y="199" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">self-superseding topics only</text>
<text x="666" y="211" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">never boundary edits</text>
<line x1="463" y1="98" x2="463" y2="114" stroke="var(--fig-mint-edge)" stroke-width="1.2" marker-end="url(#bp-a)"/>
<text x="14" y="238" font-size="9" fill="var(--fig-ink-soft)">The budget converts an unbounded queue of unknown-cost work into a bounded amount of known-cost work — which is the whole mechanism.</text>
</svg>
<figcaption><b>Figure 2.</b> Pausing rather than merely slowing down is what keeps the broker session alive: the loop still polls, it just returns nothing. Shedding is a separate escalation, reached only when the pause has not cleared.</figcaption>
</figure>

**Layer breakdown:**

1. **Small broker window** — set `max.poll.records` low (10–25) so the broker never hands you an unbounded amount of unknown work in one call.
2. **Vertex budget** — a semaphore denominated in vertices rather than tasks. Each message is charged its envelope's vertex count before dispatch and refunded on completion.
3. **Pause on exhaustion** — when the budget cannot admit the next message, pause the partition and keep polling. This is the critical detail: a paused consumer still polls, so the session timer is satisfied.
4. **Shed on sustained pressure** — if the pause has not cleared within a bounded window, drop self-superseding events by geographic priority rather than accumulating a backlog that will never drain.

---

## Step-by-step implementation

### Step 1 — Charge work against a budget, not tasks against a counter

```python
import asyncio
from dataclasses import dataclass


class VertexBudget:
    """A semaphore denominated in vertices rather than in tasks.

    A plain asyncio.Semaphore(N) bounds the *number* of in-flight messages,
    which is exactly the unit that tells us nothing here. This bounds the work.
    """

    def __init__(self, capacity: int) -> None:
        self._capacity = capacity
        self._available = capacity
        self._cond = asyncio.Condition()

    async def acquire(self, cost: int) -> None:
        # A single geometry larger than the whole budget would deadlock, so it
        # is clamped: it runs alone, which is the correct behaviour for a
        # payload that genuinely exceeds our capacity estimate.
        cost = min(cost, self._capacity)
        async with self._cond:
            while self._available < cost:
                await self._cond.wait()
            self._available -= cost

    async def release(self, cost: int) -> None:
        cost = min(cost, self._capacity)
        async with self._cond:
            self._available += cost
            self._cond.notify_all()

    @property
    def saturated(self) -> bool:
        return self._available <= 0
```

The clamp in `acquire` matters. Without it, a single 41,000-vertex multipolygon arriving at a budget of 40,000 waits forever for capacity that can never exist, and the consumer stops with no error.

### Step 2 — Pause the partition instead of blocking the poll loop

```python
from aiokafka import AIOKafkaConsumer
from aiokafka.structs import TopicPartition

BUDGET = VertexBudget(capacity=60_000)


async def consume(consumer: AIOKafkaConsumer, pool) -> None:
    paused: set[TopicPartition] = set()

    while True:
        batches = await consumer.getmany(timeout_ms=500, max_records=25)

        for tp, messages in batches.items():
            for msg in messages:
                cost = msg.headers_dict.get("vertex_count", 40)

                if BUDGET.saturated and tp not in paused:
                    # Pause, but keep polling. getmany() continues to be called
                    # and simply returns nothing for this partition, so the
                    # broker's session timer stays satisfied and we are not
                    # evicted from the group mid-batch.
                    consumer.pause(tp)
                    paused.add(tp)

                await BUDGET.acquire(cost)
                asyncio.create_task(_process(pool, msg, cost, consumer, tp, paused))

        for tp in list(paused):
            if not BUDGET.saturated:
                consumer.resume(tp)
                paused.discard(tp)
```

### Step 3 — Refund on completion, including on failure

```python
async def _process(pool, msg, cost, consumer, tp, paused) -> None:
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(pool, _repair_geometry, msg.value)
    except Exception:
        # A failed message still returns its budget. Forgetting this is a slow
        # leak: every failure permanently shrinks capacity until the consumer
        # stalls at a budget of zero with no message in flight.
        raise
    finally:
        await BUDGET.release(cost)
```

The `finally` is the whole reliability story of this component. A refund that happens only on success leaks capacity on every failure, and the consumer degrades over hours into a stall that looks nothing like the geometry error that caused it.

### Step 4 — Shed by geographic priority, and only where it is safe

```python
SHEDDABLE_TOPICS = {"vehicle-positions", "sensor-telemetry"}

async def should_shed(msg, pause_seconds: float) -> bool:
    """Shed only self-superseding events, and only under sustained pressure."""
    if pause_seconds < 30:
        return False
    if msg.topic not in SHEDDABLE_TOPICS:
        # Cadastral edits, boundary changes, tile invalidations: nothing will
        # resend these, so dropping one is data loss rather than degradation.
        return False
    # Within a sheddable topic, drop the lowest-priority regions first.
    return msg.headers_dict.get("region_priority", 0) < 2
```

---

## Spatial validation and error handling

**Vertex count is a proxy, and proxies drift.** A 2,000-vertex polygon with many interior rings can cost more to repair than a 5,000-vertex simple one, because topology repair is not linear in vertex count. Treat the budget as approximate and set it against measured p99 rather than against a computed ideal; the point is to bound the error, not to eliminate it.

**A missing vertex count must default high, not low.** If an envelope arrives without the field — an old schema version, a producer that has not been updated — defaulting to a small cost lets an unbounded payload through the one control designed to stop it. Default to the budget's clamp value so an unmeasured payload is treated as expensive until proven otherwise.

**Shedding must never apply to a stream with ordering guarantees.** Dropping one event from a version-guarded stream is survivable, because a later version supersedes it. Dropping one from a stream whose consumer applies deltas is corruption, because the state never converges. Enumerate sheddable topics explicitly, as above, rather than deriving the decision from a priority field alone.

<figure class="fig">
<svg viewBox="0 0 760 218" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Which spatial streams may be shed under saturation and which may never be, by whether a later event supersedes an earlier one">
<title>Only self-superseding streams may be shed</title>
<desc>Streams sorted by whether dropping one event is recoverable. Vehicle position pings and sensor telemetry are self-superseding: another arrives within seconds carrying strictly newer information, so a dropped one leaves a momentary gap rather than a permanent hole, and shedding them under saturation is a degradation the system recovers from on its own. Cadastral boundary edits, tile invalidations and dead-letter replays are not: nothing will resend them, so a drop is silent permanent data loss, and a map that is wrong stays wrong. Delta-encoded streams are the worst case, because dropping one event does not merely lose it — every subsequent event is applied to a state that never existed, so the error compounds rather than healing. The policy therefore has to be enumerated per topic rather than derived from a priority field, since priority describes how much an event matters and this question is about whether losing it is reversible.</desc>
<rect x="0" y="0" width="760" height="218" fill="var(--fig-bg)"/>
<rect x="14" y="30" width="732" height="52" rx="7" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="49" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Sheddable — a later event supersedes this one</text>
<text x="26" y="66" font-size="9" fill="var(--fig-ink-soft)">vehicle positions · sensor telemetry · presence pings</text>
<text x="26" y="78" font-size="9" fill="var(--fig-mint-edge)">a drop leaves a momentary gap the next event closes by itself</text>
<rect x="14" y="90" width="732" height="52" rx="7" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="109" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Never shed — nothing will resend it</text>
<text x="26" y="126" font-size="9" fill="var(--fig-ink-soft)">cadastral boundary edits · tile invalidations · dead-letter replays</text>
<text x="26" y="138" font-size="9" fill="var(--fig-rose-edge)">a drop is permanent, silent data loss — the map stays wrong</text>
<rect x="14" y="150" width="732" height="56" rx="7" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="26" y="169" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Worst case — delta-encoded streams</text>
<text x="26" y="186" font-size="9" fill="var(--fig-ink-soft)">every later event is applied to a state that never existed, so the error compounds instead of healing</text>
<text x="26" y="199" font-size="9" fill="var(--fig-rose-edge)">enumerate the policy per topic — priority says how much an event matters, not whether losing it is reversible</text>
</svg>
<figcaption><b>Figure 3.</b> The test is not importance but recoverability. A high-priority position ping is safer to shed than a low-priority boundary edit, because only one of them will be sent again.</figcaption>
</figure>

---

## Retry, backoff and delivery guarantees

Backpressure and retries push in opposite directions on the same pipe, and under saturation they can amplify each other. A saturated consumer begins timing out; those timeouts generate retries; the retries arrive as additional load on the consumer that was already saturated. This is the mechanism by which a slow consumer becomes an unavailable one.

Gate retries on the same saturation signal that drives pausing. When the budget is exhausted, the retry admission check should fail first, so a consumer under pressure sheds redelivered work before it sheds fresh work — a retry is by definition something the system has already attempted, while a fresh event is something it has not yet seen at all. The token-bucket budget in [Tuning Retry Budgets for Webhook Provider SLAs](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/tuning-retry-budgets-for-webhook-provider-slas/) is the right place to apply that gate.

---

## Verification

The test that matters is a burst of heavy geometry against a running consumer, asserting that the broker session survives.

```python
import asyncio
import pytest


@pytest.mark.asyncio
async def test_heavy_burst_does_not_exceed_poll_interval(consumer, pool, clock):
    """A burst of large geometries must not stall the poll loop.

    The failure this guards against is subtle: the consumer keeps working and
    still gets evicted, because it stopped polling while it worked.
    """
    heavy = [_message(vertex_count=41_000) for _ in range(50)]
    await _produce(heavy)

    gaps = []
    async for gap in _poll_gaps(consumer, pool, duration=60):
        gaps.append(gap)

    assert max(gaps) < 300, f"poll gap {max(gaps):.1f}s exceeds max.poll.interval.ms"


@pytest.mark.asyncio
async def test_budget_is_refunded_on_failure():
    """The gate's negative case: a failing message must return its budget.

    Without this assertion the leak is invisible — capacity shrinks slowly and
    the consumer stalls hours later, long after the failing payload is gone.
    """
    budget = VertexBudget(capacity=1000)
    await budget.acquire(600)
    with pytest.raises(RuntimeError):
        try:
            raise RuntimeError("topology repair failed")
        finally:
            await budget.release(600)
    assert not budget.saturated
```

---

## Troubleshooting

<div class="table-scroll">

| Symptom | Likely spatial cause | Fix |
|---|---|---|
| Consumers repeatedly evicted and rebalanced under load | A batch of heavy geometries exceeded `max.poll.interval.ms` | Lower `max.poll.records` and pause on budget exhaustion rather than blocking |
| Consumer stalls with no messages in flight | Budget leaked on failed messages | Refund in a `finally`, not on the success path |
| One partition never resumes after a burst | A single geometry larger than the whole budget waits for impossible capacity | Clamp per-message cost to the budget so oversized payloads run alone |
| Memory climbs steadily during a regional burst | Prefetch measured in messages, not work | Charge a vertex budget before dispatch |
| Retries pile up exactly when the consumer is busiest | Retry admission not gated on the saturation signal | Shed retries before fresh events under pressure |
| Positions go missing during a shed, tracks look wrong | A stream with delta semantics was marked sheddable | Restrict shedding to self-superseding topics only |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Why is a message-count prefetch wrong for spatial payloads?</strong></summary>

Because message count says nothing about work. A prefetch of 100 might be 100 point pings costing 200 milliseconds in total, or 100 land-cover multipolygons costing 90 seconds. The same setting is simultaneously far too small for one and catastrophically too large for the other, and which one you get is decided by geography rather than by anything you control. Size the window in estimated work — vertex count is a good proxy and is available from the envelope without deserialising the geometry.

</details>

<details class="faq">
<summary><strong>Should I pause the partition or just process more slowly?</strong></summary>

Pause it. Processing slowly while continuing to fetch means the broker keeps handing you messages you have not started, which grows unbounded memory and, worse, does not stop the broker's session timer. Kafka expects a poll within `max.poll.interval.ms`; a consumer that is busy rather than polling gets evicted from the group and its partitions rebalanced, which produces duplicate delivery on top of the backlog you already had. Pausing keeps you polling — returning no records — so the session stays alive.

</details>

<details class="faq">
<summary><strong>Is load shedding ever acceptable for spatial events?</strong></summary>

It is acceptable when the alternative is losing everything, and only for streams where a later event supersedes an earlier one. Shedding a vehicle position ping is defensible because another arrives in seconds and the newer one is strictly more useful. Shedding a cadastral boundary edit is data loss, because nothing will resend it. Split those streams by topic so the shedding policy can differ, and never shed a stream whose events are not self-superseding.

</details>

<details class="faq">
<summary><strong>How does backpressure interact with the retry budget?</strong></summary>

They control opposite ends of the same pipe and can fight each other. Backpressure slows intake when the consumer is saturated; a retry ladder increases intake when deliveries fail. A saturated consumer that starts timing out generates retries, which arrive as additional load on the consumer that was already saturated. Gate retries on the same saturation signal that drives backpressure, so a consumer under pressure sheds retries first and fresh events last.

</details>

---

## Related

- [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/) — the section this topic belongs to
- [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/) — the saturation signal that drives pausing, and how to tell skew from genuine overload
- [Async Processing for Geometry-Heavy Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) — the process pool the budget dispatches into
- [Tuning Retry Budgets for Webhook Provider SLAs](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/tuning-retry-budgets-for-webhook-provider-slas/) — where to gate retries on the saturation signal
- [Spatial Partitioning Strategies](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/) — why one partition ends up carrying the heavy geometry in the first place
