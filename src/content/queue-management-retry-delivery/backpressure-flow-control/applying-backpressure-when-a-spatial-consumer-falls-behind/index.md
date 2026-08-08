---
title: "Applying Backpressure When a Spatial Consumer Falls Behind"
description: "Pause the partition rather than slowing the loop: a consumer that is busy instead of polling gets evicted, and the rebalance redelivers the batch it was halfway through to someone with the same settings."
slug: "applying-backpressure-when-a-spatial-consumer-falls-behind"
type: "article"
breadcrumb: "Queue Management, Retries & Delivery Guarantees > Backpressure & Flow Control for Spatial Consumers > Applying Backpressure When a Spatial Consumer Falls Behind"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Applying Backpressure When a Spatial Consumer Falls Behind",
      "description": "Slowing a saturated consumer's processing does not slow its intake, and a consumer that stops polling is presumed dead. This guide pauses the partition while continuing to poll, releases on a measured signal, and shows why the naive fix causes a rebalance storm.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/applying-backpressure-when-a-spatial-consumer-falls-behind/",
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
        {"@type": "ListItem", "position": 3, "name": "Backpressure & Flow Control for Spatial Consumers", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/"},
        {"@type": "ListItem", "position": 4, "name": "Applying Backpressure When a Spatial Consumer Falls Behind", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/applying-backpressure-when-a-spatial-consumer-falls-behind/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Apply backpressure to a saturated spatial consumer",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Charge dispatched work against a vertex budget rather than a message count"},
        {"@type": "HowToStep", "position": 2, "name": "Pause the partition when the budget is exhausted, and keep polling"},
        {"@type": "HowToStep", "position": 3, "name": "Refund on completion, including on failure"},
        {"@type": "HowToStep", "position": 4, "name": "Resume with hysteresis so the partition does not oscillate"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why not just process more slowly?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because processing speed and intake speed are independent. A consumer that slows its handlers while continuing to fetch accumulates unprocessed messages in memory without bound, and — worse — a consumer that is busy rather than polling misses the broker's session deadline. Kafka presumes it dead, reassigns its partitions, and the batch it was halfway through is redelivered to another member that holds the same settings and meets the same fate."}
        },
        {
          "@type": "Question",
          "name": "Does pausing a partition stop the heartbeat?",
          "acceptedAnswer": {"@type": "Answer", "text": "No, and that is exactly why pausing is the right mechanism. A paused partition still participates in the poll loop; poll returns no records for it while continuing to satisfy the broker's liveness expectation. The consumer stays in the group, keeps its assignment, and simply stops accepting new work — which is the behaviour you want and the one that blocking inside a handler does not provide."}
        },
        {
          "@type": "Question",
          "name": "Why does resuming need hysteresis?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because resuming at the same threshold that triggered the pause makes the partition oscillate. One task completes, the budget crosses back above the line, the partition resumes, the next fetched multipolygon consumes the budget again, and the partition pauses — several times a second, each cycle costing a broker round trip. Resuming only once the budget has recovered to a comfortable fraction rather than to the exact threshold removes the oscillation for the cost of slightly lower utilisation."}
        }
      ]
    }
  ]
}
</script>

**Pause the partition while continuing to poll, rather than slowing the handlers — a consumer that is busy instead of polling is presumed dead, so the naive fix trades a backlog for a rebalance that redelivers the batch to a member with identical settings.**

This guide sits under [Backpressure & Flow Control for Spatial Consumers](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/), within [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/). That topic explains why work rather than message count is the right unit; this guide is the pause-and-resume mechanism built on it.

## When to use this pattern

- Consumer lag on one partition grows while others are idle, which for a geographically partitioned stream is the normal shape of trouble.
- Rebalances happen under load, which is the signature of a consumer that stopped polling.
- Payload cost varies by orders of magnitude, so no static prefetch is right.

## Slowing down is not backpressure

<figure class="fig">
<svg viewBox="0 0 760 234" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A saturated consumer blocking in its handler, missing the poll deadline and triggering a rebalance loop">
<title>The rebalance storm, and how it sustains itself</title>
<desc>A consumer meets a batch of heavy multipolygons and responds by processing them slowly, blocking inside its handler. Its next poll call therefore does not happen for ninety seconds, which exceeds the broker's maximum poll interval of thirty seconds. The broker presumes the member dead and triggers a rebalance, reassigning its partitions. The batch it was part-way through is uncommitted, so it is redelivered — to another member of the same group, running the same code with the same settings, which meets the same batch and blocks in the same way. That member is then evicted too, and the cycle continues: each rebalance costs the whole group a pause while assignments are recomputed, so total throughput falls while the backlog that caused the problem keeps growing. Nothing in this loop is a bug in the broker or in the batch; it is entirely a consequence of treating slow processing as a form of flow control. Pausing the partition instead keeps the poll loop running, so the member stays alive, keeps its assignment, and simply stops accepting new work until it has capacity.</desc>
<rect x="0" y="0" width="760" height="234" fill="var(--fig-bg)"/>
<defs><marker id="bp2-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-rose-edge)">blocking in the handler · max.poll.interval.ms = 30 s</text>
<rect x="30" y="30" width="150" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="40" y="50" font-size="8.5" fill="var(--fig-ink)">handler busy 90 s</text>
<line x1="184" y1="45" x2="214" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#bp2-a)"/>
<rect x="218" y="30" width="150" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="228" y="50" font-size="8.5" fill="var(--fig-ink)">poll deadline missed</text>
<line x1="372" y1="45" x2="402" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#bp2-a)"/>
<rect x="406" y="30" width="150" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="416" y="50" font-size="8.5" fill="var(--fig-ink)">member evicted, rebalance</text>
<line x1="560" y1="45" x2="590" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#bp2-a)"/>
<rect x="594" y="30" width="150" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="604" y="50" font-size="8.5" fill="var(--fig-ink)">batch redelivered</text>
<path d="M669,62 C669,92 105,92 105,64" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.8" stroke-dasharray="4 3" marker-end="url(#bp2-a)"/>
<text x="290" y="88" font-size="8.5" font-weight="600" fill="var(--fig-rose-edge)">…to a member with the same code and the same settings</text>
<rect x="14" y="102" width="732" height="46" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="26" y="121" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Each cycle pauses the whole group while assignments are recomputed</text>
<text x="26" y="139" font-size="9" fill="var(--fig-ink-soft)">Throughput falls while the backlog keeps growing. This is not a broker bug or a bad batch — it is treating slow processing as flow control.</text>
<line x1="14" y1="160" x2="746" y2="160" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="180" font-size="10" font-weight="600" fill="var(--fig-mint-edge)">pausing the partition</text>
<rect x="30" y="190" width="200" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="40" y="210" font-size="8.5" fill="var(--fig-ink)">poll() still called, returns nothing</text>
<line x1="234" y1="205" x2="264" y2="205" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#bp2-a)"/>
<rect x="268" y="190" width="200" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="278" y="210" font-size="8.5" fill="var(--fig-ink)">session stays alive, assignment kept</text>
<text x="484" y="209" font-size="8.5" fill="var(--fig-mint-edge)">no new work accepted until there is capacity</text>
</svg>
<figcaption><b>Figure 1.</b> The loop is self-sustaining: every eviction hands the same batch to a member that will be evicted by it. Nothing stops until the batch is smaller than the poll interval, which is what backpressure arranges.</figcaption>
</figure>

## Complete runnable implementation

```python
import asyncio
from dataclasses import dataclass, field

from aiokafka import AIOKafkaConsumer, TopicPartition
from prometheus_client import Counter, Gauge

PAUSED = Gauge("consumer_partitions_paused", "Partitions currently paused")
BUDGET_USED = Gauge("consumer_vertex_budget_used", "Vertices in flight")
REFUNDS = Counter("consumer_budget_refunds_total", "Refunds", ("outcome",))

# Vertices, not messages. A partition can carry 40-vertex pings and
# 41 000-vertex multipolygons, and no count is right for both.
VERTEX_BUDGET = 250_000
# Resume only once the budget has genuinely recovered, not at the same line
# that triggered the pause — otherwise the partition oscillates.
RESUME_AT = 0.6


@dataclass(slots=True)
class WorkBudget:
    total: int
    in_flight: int = 0
    _waiters: list = field(default_factory=list)

    @property
    def exhausted(self) -> bool:
        return self.in_flight >= self.total

    @property
    def recovered(self) -> bool:
        return self.in_flight <= self.total * RESUME_AT

    def charge(self, vertices: int) -> None:
        self.in_flight += vertices
        BUDGET_USED.set(self.in_flight)

    def refund(self, vertices: int, outcome: str) -> None:
        # Refund on failure too. A handler that raises without refunding
        # leaks budget, and the partition stays paused forever — a stall
        # that looks exactly like a slow consumer.
        self.in_flight = max(0, self.in_flight - vertices)
        REFUNDS.labels(outcome=outcome).inc()
        BUDGET_USED.set(self.in_flight)


class BackpressuredConsumer:
    def __init__(self, consumer: AIOKafkaConsumer, process,
                 budget: int = VERTEX_BUDGET) -> None:
        self._consumer = consumer
        self._process = process
        self._budget = WorkBudget(total=budget)
        self._paused: set[TopicPartition] = set()

    async def run(self) -> None:
        while True:
            # Poll ALWAYS, even while paused. This is the call that keeps the
            # member alive; a paused partition simply returns no records.
            batch = await self._consumer.getmany(timeout_ms=500, max_records=50)

            for tp, records in batch.items():
                for record in records:
                    cost = _vertex_count(record)
                    self._budget.charge(cost)
                    asyncio.create_task(self._handle(record, cost))

            self._reconcile_pauses()

    async def _handle(self, record, cost: int) -> None:
        try:
            await self._process(record)
            self._budget.refund(cost, "ok")
        except Exception:
            self._budget.refund(cost, "failed")
            raise

    def _reconcile_pauses(self) -> None:
        assigned = self._consumer.assignment()

        if self._budget.exhausted:
            to_pause = assigned - self._paused
            if to_pause:
                self._consumer.pause(*to_pause)
                self._paused |= to_pause
        elif self._budget.recovered and self._paused:
            self._consumer.resume(*self._paused)
            self._paused.clear()

        PAUSED.set(len(self._paused))


def _vertex_count(record) -> int:
    """Read the precomputed count from the envelope.

    Deserialising the geometry to measure it defeats the purpose: the whole
    point is to decide before paying the parsing cost.
    """
    return int(record.headers_dict.get("vertex-count", 1000))
```

<figure class="fig">
<svg viewBox="0 0 760 218" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Budget occupancy oscillating at a single threshold versus settling with a resume band">
<title>One threshold oscillates; two settle</title>
<desc>Budget occupancy is traced over time for a consumer under sustained heavy load. With a single threshold, the partition pauses the moment the budget is exhausted, one task completes, occupancy drops just below the line, the partition resumes, the next fetched multipolygon consumes the freed budget immediately, and the partition pauses again — several cycles a second, each one a broker round trip, and the pause metric becomes unreadable noise. With a resume band set at sixty per cent, the partition stays paused until enough work has genuinely completed, then resumes and takes a substantial batch before pausing again. The cycle period goes from milliseconds to seconds, the broker round trips fall by orders of magnitude, and the paused metric becomes something an operator can interpret. The cost is slightly lower average utilisation, because the consumer sometimes has spare budget it is not using — which is a good trade for a signal that means something and a broker that is not being asked to pause and resume a partition forty times a second.</desc>
<rect x="0" y="0" width="760" height="218" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">budget occupancy under sustained heavy load</text>
<line x1="60" y1="150" x2="740" y2="150" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="60" y1="34" x2="60" y2="150" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="60" y1="44" x2="740" y2="44" stroke="var(--fig-rose-edge)" stroke-width="1.2" stroke-dasharray="4 3"/>
<text x="660" y="40" font-size="8" fill="var(--fig-rose-edge)">exhausted</text>
<line x1="60" y1="86" x2="740" y2="86" stroke="var(--fig-mint-edge)" stroke-width="1.2" stroke-dasharray="4 3"/>
<text x="668" y="82" font-size="8" fill="var(--fig-mint-edge)">resume at 60%</text>
<path d="M60,120 L110,44 L118,50 L126,44 L134,50 L142,44 L150,50 L158,44 L166,50 L174,44 L182,50 L190,44 L198,50 L206,44 L214,50 L222,44 L230,50 L238,44 L246,50 L254,44 L262,50 L270,44 L278,50 L286,44 L294,50 L302,44 L310,50 L318,44" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="120" y="70" font-size="8.5" fill="var(--fig-rose-edge)">single threshold — pause/resume several times a second</text>
<text x="120" y="132" font-size="8.5" fill="var(--fig-rose-edge)">each cycle is a broker round trip; the paused metric is unreadable noise</text>
<path d="M380,120 L420,44 L460,44 L470,86 L500,44 L540,44 L550,86 L580,44 L620,44 L630,86 L660,44 L710,44" fill="none" stroke="var(--fig-mint-edge)" stroke-width="2"/>
<text x="400" y="108" font-size="8.5" fill="var(--fig-mint-edge)">resume band — the cycle period goes from milliseconds to seconds</text>
<rect x="14" y="166" width="732" height="42" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="185" font-size="9" fill="var(--fig-ink-soft)">The cost is slightly lower average utilisation — the consumer sometimes holds spare budget it is not using. In exchange the</text>
<text x="26" y="198" font-size="9" fill="var(--fig-ink-soft)">broker is not asked to pause and resume forty times a second, and the paused gauge becomes something an operator can read.</text>
</svg>
<figcaption><b>Figure 2.</b> The oscillation is not merely inefficient — it destroys the one metric that tells an operator the consumer is under pressure.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `VERTEX_BUDGET` | `int` | Vertices in flight, measured against resident memory per vertex | `250000` |
| `RESUME_AT` | `float` | Fraction of budget; equal to 1.0 means oscillation | `0.6` |
| `vertex-count` header | `int` | Precomputed at ingest — measuring it here defeats the purpose | `1000` |
| `max_records` | `int` | Small; the budget is the real bound, this just caps one fetch | `50` |
| Refund on failure | — | Mandatory, or a raising handler leaks budget and stalls forever | — |
| `poll` while paused | — | Required; it is what keeps the member in the group | — |

</div>

## Gotchas and spatial edge cases

1. **A handler that raises without refunding stalls the consumer permanently.** The budget never recovers, the partition never resumes, and the symptom is a consumer that stopped consuming with no error after the first one. The `try/except` around the refund is the whole safety mechanism, and it must refund before re-raising.

2. **Pausing every assigned partition is coarse but usually right.** The budget is a property of the process, so a heavy geometry on one partition legitimately blocks the others. Per-partition budgets are possible and rarely worth the complexity, because the memory that runs out is shared.

3. **A single message larger than the budget deadlocks.** If one multipolygon has more vertices than the whole budget, it can never be charged, the partition pauses, and nothing ever completes to refund it. Either allow one over-budget message through when nothing is in flight, or route oversized geometry through the claim check in [Streaming & Chunking Large Geometry Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/).

4. **Vertex count is a proxy, not a cost.** It correlates well with `shapely` runtime and poorly with anything involving a spatial join against a large index. If the handler's cost is dominated by something else, charge that instead — the mechanism does not care what the unit is, only that it is knowable before dispatch.

5. **Pause state is lost across a rebalance.** New assignments arrive unpaused, so the reconcile step must run against the current assignment rather than a remembered set — which is why `_reconcile_pauses` reads `assignment()` every cycle rather than caching it.

6. **Backpressure and retries push in opposite directions.** A saturated consumer that starts timing out generates retries that arrive as additional load on the consumer that was already saturated. Gate retries on the same signal, as [Tuning Retry Budgets for Webhook Provider SLAs](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/tuning-retry-budgets-for-webhook-provider-slas/) describes.

<figure class="fig">
<svg viewBox="0 0 760 190" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A handler raising without refunding its charge, leaking budget until the partition never resumes">
<title>A missing refund is a stall with no error after the first one</title>
<desc>Four heavy messages are dispatched and charged against the budget. Three complete and refund. The fourth raises — a corrupt geometry, a timeout, anything — and if the refund happens only on the success path, its charge stays in flight forever. The budget is now permanently short by that amount. A few more failures over the following hours and the in-flight total never falls below the pause threshold again, so the partition is paused indefinitely with no work actually running. What an operator sees is a consumer that stopped consuming, with one exception in the log from hours earlier and nothing since — because the consumer is not doing anything to fail at. The lag graph rises steadily and the error rate is zero. Refunding in a finally-style path before re-raising costs one line and turns the whole class of failure into an ordinary error the retry machinery already handles.</desc>
<rect x="0" y="0" width="760" height="190" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">budget in flight, with a refund only on the success path</text>
<line x1="60" y1="130" x2="720" y2="130" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="60" y1="34" x2="60" y2="130" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="60" y1="46" x2="720" y2="46" stroke="var(--fig-rose-edge)" stroke-width="1.2" stroke-dasharray="4 3"/>
<text x="600" y="42" font-size="8.5" fill="var(--fig-rose-edge)">pause threshold</text>
<path d="M60,124 L120,60 L180,110 L240,52 L300,102 L360,50 L420,94 L480,44 L720,44" fill="none" stroke="var(--fig-ink)" stroke-width="2.2"/>
<circle cx="480" cy="44" r="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="360" y="152" font-size="8.5" fill="var(--fig-rose-edge)">a handler raises and its charge is never refunded</text>
<text x="330" y="70" font-size="8.5" fill="var(--fig-rose-edge)">in-flight never falls again · paused indefinitely, with nothing running</text>
<rect x="14" y="160" width="732" height="24" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="176" font-size="9" fill="var(--fig-ink-soft)">What an operator sees: lag rising steadily, error rate zero, one exception hours earlier — because the consumer has nothing left to fail at.</text>
</svg>
<figcaption><b>Figure 3.</b> The consumer is not broken in any way it can report. Refunding before re-raising costs one line and turns this into an ordinary retryable error.</figcaption>
</figure>

## Verification

```python
import asyncio
import pytest


def test_budget_pauses_and_recovers_with_hysteresis():
    budget = WorkBudget(total=1000)
    budget.charge(1000)
    assert budget.exhausted and not budget.recovered

    budget.refund(100, "ok")            # 900 in flight — still above 60%
    assert not budget.recovered

    budget.refund(500, "ok")            # 400 in flight — below 60%
    assert budget.recovered


def test_failed_work_is_refunded():
    """The leak that stalls a consumer with no error after the first."""
    budget = WorkBudget(total=1000)

    async def failing(_record):
        raise ValueError("bad geometry")

    consumer = BackpressuredConsumer(_FakeKafka(), failing)
    consumer._budget = budget
    budget.charge(400)

    with pytest.raises(ValueError):
        asyncio.run(consumer._handle(_record(vertices=400), 400))
    assert budget.in_flight == 0


@pytest.mark.asyncio
async def test_poll_continues_while_paused():
    """The property that keeps the member in the group."""
    kafka = _FakeKafka(records=_heavy_batch(vertices=300_000))
    consumer = BackpressuredConsumer(kafka, _slow_process)

    task = asyncio.create_task(consumer.run())
    await asyncio.sleep(0.3)
    task.cancel()

    assert kafka.paused, "the partition should be paused"
    assert kafka.polls > 3, "poll must keep being called while paused"
```

The last test is the one that distinguishes this design from the naive one. A consumer that blocks in its handler also stops accepting work — the difference is entirely in whether `poll` keeps being called, and nothing else in the code makes that visible.

## Related

- [Backpressure & Flow Control for Spatial Consumers](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/) — the topic this guide belongs to
- [Sizing a Prefetch Window for Mixed Geometry Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/sizing-a-prefetch-window-for-mixed-geometry-payloads/) — choosing the budget this mechanism enforces
- [Shedding Spatial Load by Geographic Priority](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/shedding-spatial-load-by-geographic-priority/) — what to do when pausing is no longer enough
- [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/) — the signal that says a consumer is behind rather than merely busy
