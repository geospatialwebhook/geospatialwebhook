---
title: "Sizing a Prefetch Window for Mixed Geometry Payloads"
description: "Derive the vertex budget from measured memory per vertex and measured processing rate, then check it against the poll interval — a budget that fits memory but not the deadline still gets the consumer evicted."
slug: "sizing-a-prefetch-window-for-mixed-geometry-payloads"
type: "article"
breadcrumb: "Queue Management, Retries & Delivery Guarantees > Backpressure & Flow Control for Spatial Consumers > Sizing a Prefetch Window for Mixed Geometry Payloads"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Sizing a Prefetch Window for Mixed Geometry Payloads",
      "description": "A vertex budget has to satisfy two independent constraints: the memory the in-flight geometry occupies, and the time it takes to drain within the broker's poll deadline. This guide measures both from real traffic and takes the smaller answer.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/sizing-a-prefetch-window-for-mixed-geometry-payloads/",
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
        {"@type": "ListItem", "position": 4, "name": "Sizing a Prefetch Window for Mixed Geometry Payloads", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/sizing-a-prefetch-window-for-mixed-geometry-payloads/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Size a vertex budget for a mixed geometry stream",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Measure resident bytes per vertex on real payloads"},
        {"@type": "HowToStep", "position": 2, "name": "Measure processed vertices per second on the same payloads"},
        {"@type": "HowToStep", "position": 3, "name": "Compute the memory bound and the poll-deadline bound separately"},
        {"@type": "HowToStep", "position": 4, "name": "Take the smaller, and re-measure when the payload mix changes"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does a vertex budget need two bounds rather than one?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because memory and time constrain it independently, and either can bind first. A budget that fits comfortably in memory can still hold more work than the consumer can drain inside the broker's poll deadline, which gets the member evicted exactly as if there had been no backpressure at all. Conversely a budget sized purely for the deadline can be far more than the process can hold when every message is a large multipolygon. Compute both and take the smaller."}
        },
        {
          "@type": "Question",
          "name": "How many bytes does a vertex actually cost?",
          "acceptedAnswer": {"@type": "Answer", "text": "Far more than the sixteen bytes of two doubles, because the geometry passes through several representations. In serialised JSON a coordinate pair is roughly twenty bytes of text; parsed into Python lists and floats it is well over a hundred; as a shapely geometry it is a compact array again but the intermediate representations coexist during parsing. Measuring resident memory across a real batch is the only reliable way to get the figure, and it is usually between eighty and two hundred bytes per vertex."}
        },
        {
          "@type": "Question",
          "name": "How often does the budget need re-measuring?",
          "acceptedAnswer": {"@type": "Answer", "text": "Whenever the payload mix or the handler changes, which in practice means quarterly and after any deploy that touches geometry processing. A budget derived when the stream was mostly point pings is wrong once a new producer starts sending parcel boundaries, and the symptom is not a failure but a consumer that is either evicted under load or never uses more than a fraction of its memory."}
        }
      ]
    }
  ]
}
</script>

**Compute the memory bound from measured bytes per vertex and the deadline bound from measured vertices per second, then take the smaller — a budget that fits in memory but cannot be drained inside the poll interval gets the consumer evicted exactly as if there were no backpressure at all.**

This guide sits under [Backpressure & Flow Control for Spatial Consumers](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/), within [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/). It produces the `VERTEX_BUDGET` enforced by [Applying Backpressure When a Spatial Consumer Falls Behind](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/applying-backpressure-when-a-spatial-consumer-falls-behind/).

## When to use this pattern

- The budget in production was a round number somebody chose, which is the usual case.
- The consumer is either evicted under load or never approaches its memory limit — the two symptoms of the two bounds being wrong in opposite directions.
- The payload mix has changed since the number was set.

## Two bounds, and either can bind

<figure class="fig">
<svg viewBox="0 0 760 232" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The memory bound and the poll-deadline bound plotted against payload mix, crossing over">
<title>Which constraint binds depends on the payload mix</title>
<desc>Two independent bounds on the vertex budget are plotted against the proportion of heavy geometry in the stream. The memory bound is flat: a container with two gigabytes available for in-flight geometry, at a measured one hundred and forty bytes per vertex, permits about fourteen million vertices in flight regardless of what shape they are in. The poll-deadline bound falls steeply as the mix gets heavier: with a thirty-second deadline and a target of using half of it, a consumer processing eight hundred thousand vertices per second on point-dominated traffic can hold twelve million, but the same consumer processing complex polygons at one hundred and twenty thousand vertices per second can hold only one point eight million. The two curves cross around a mix of fifteen per cent heavy geometry. Below that crossing the memory bound is the binding one; above it the deadline bound is, and by a wide margin. A budget chosen from memory alone is therefore correct for a light stream and catastrophically wrong for a heavy one, which is exactly the direction in which streams drift as producers add richer data.</desc>
<rect x="0" y="0" width="760" height="232" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">vertex budget permitted by each constraint, against payload mix</text>
<line x1="70" y1="160" x2="700" y2="160" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="70" y1="34" x2="70" y2="160" stroke="var(--fig-line)" stroke-width="1.2"/>
<text x="20" y="46" font-size="8" fill="var(--fig-ink-soft)">14 M</text>
<text x="28" y="156" font-size="8" fill="var(--fig-ink-soft)">0</text>
<text x="60" y="176" font-size="8" fill="var(--fig-ink-soft)">0% heavy</text>
<text x="640" y="176" font-size="8" fill="var(--fig-ink-soft)">50% heavy</text>
<line x1="70" y1="46" x2="700" y2="46" stroke="var(--fig-mint-edge)" stroke-width="2"/>
<text x="440" y="40" font-size="8.5" fill="var(--fig-mint-edge)">memory bound — 2 GB ÷ 140 bytes/vertex ≈ 14 M, flat</text>
<path d="M70,56 C140,74 200,110 260,130 C360,148 500,155 700,158" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2.2"/>
<text x="300" y="122" font-size="8.5" fill="var(--fig-rose-edge)">poll-deadline bound — 15 s of headroom × measured vertices/second</text>
<circle cx="190" cy="52" r="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.6"/>
<line x1="190" y1="52" x2="190" y2="160" stroke="var(--fig-gold-edge)" stroke-width="1.2" stroke-dasharray="3 3"/>
<text x="196" y="70" font-size="8.5" font-weight="600" fill="var(--fig-gold-edge)">crossover ≈ 15% heavy</text>
<text x="80" y="100" font-size="8.5" fill="var(--fig-ink-soft)">memory binds</text>
<text x="380" y="80" font-size="8.5" fill="var(--fig-ink-soft)">the deadline binds, by a wide margin</text>
<rect x="14" y="186" width="732" height="38" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="204" font-size="9" fill="var(--fig-ink-soft)">A budget chosen from memory alone is correct for a light stream and catastrophically wrong for a heavy one — which is exactly</text>
<text x="26" y="217" font-size="9" fill="var(--fig-ink-soft)">the direction streams drift as producers add richer data. Compute both and take the smaller.</text>
</svg>
<figcaption><b>Figure 1.</b> The two constraints are not two views of the same number. They cross, and which one binds changes as the stream's content changes underneath a budget nobody revisits.</figcaption>
</figure>

## Complete runnable implementation

```python
import gc
import json
import statistics
import time
import tracemalloc
from dataclasses import dataclass

from shapely.geometry import shape

# Fraction of the broker's poll interval the in-flight work may occupy.
# The rest is headroom for a slow message, a GC pause and the poll itself.
DEADLINE_HEADROOM = 0.5


@dataclass(frozen=True, slots=True)
class BudgetRecommendation:
    bytes_per_vertex: float
    vertices_per_second: float
    memory_bound: int
    deadline_bound: int
    budget: int
    binding: str


def measure_bytes_per_vertex(payloads: list[bytes]) -> float:
    """Resident bytes per vertex, measured on real payloads.

    Not 16 bytes for two doubles: the geometry exists as JSON text, then as
    Python lists and floats, then as a shapely array, and the intermediate
    representations coexist during parsing.
    """
    gc.collect()
    tracemalloc.start()
    geoms, vertices = [], 0
    for raw in payloads:
        geom = shape(json.loads(raw)["geometry"])
        geoms.append(geom)
        vertices += _count_vertices(geom)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    del geoms
    return peak / max(1, vertices)


def measure_vertices_per_second(payloads: list[bytes], handler,
                                repeats: int = 3) -> float:
    """Throughput on the SAME payloads the budget will govern.

    A figure taken from point-ping traffic overstates a polygon workload by
    an order of magnitude, and the budget derived from it evicts the consumer.
    """
    rates = []
    for _ in range(repeats):
        vertices = 0
        start = time.perf_counter()
        for raw in payloads:
            geom = shape(json.loads(raw)["geometry"])
            handler(geom)
            vertices += _count_vertices(geom)
        rates.append(vertices / (time.perf_counter() - start))
    # Median, not mean: one GC pause during a run should not set the budget.
    return statistics.median(rates)


def recommend(payloads: list[bytes], handler,
              memory_bytes_available: int,
              max_poll_interval_seconds: float) -> BudgetRecommendation:
    bpv = measure_bytes_per_vertex(payloads)
    vps = measure_vertices_per_second(payloads, handler)

    memory_bound = int(memory_bytes_available / bpv)
    deadline_bound = int(vps * max_poll_interval_seconds * DEADLINE_HEADROOM)

    budget = min(memory_bound, deadline_bound)
    return BudgetRecommendation(
        bytes_per_vertex=bpv,
        vertices_per_second=vps,
        memory_bound=memory_bound,
        deadline_bound=deadline_bound,
        budget=budget,
        binding="memory" if memory_bound < deadline_bound else "poll deadline",
    )


def _count_vertices(geom) -> int:
    if hasattr(geom, "geoms"):
        return sum(_count_vertices(g) for g in geom.geoms)
    if geom.geom_type == "Polygon":
        return len(geom.exterior.coords) + sum(len(r.coords) for r in geom.interiors)
    return len(getattr(geom, "coords", ()))
```

Reporting which bound binds is the part that makes the recommendation actionable. A budget limited by memory is fixed by a bigger container; one limited by the deadline is fixed by faster processing or a longer `max.poll.interval.ms`, and those are different tickets for different teams.

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A sample dominated by point pings producing a budget that evicts the consumer on polygon traffic">
<title>Measuring on the wrong traffic gives a confidently wrong number</title>
<desc>A budget is derived twice for the same consumer. The first measurement uses a sample taken at three in the morning, which is almost entirely point pings from parked vehicles: the handler processes about nine hundred thousand vertices per second because there is nothing to do per geometry, and the resulting deadline bound is thirteen and a half million vertices. Deployed, that budget lets the consumer accept a batch of parcel boundaries whose processing rate is closer to one hundred thousand vertices per second, so draining thirteen and a half million takes over two minutes against a thirty-second deadline — the member is evicted, the batch is redelivered, and the backpressure mechanism has made no difference at all. The second measurement uses a sample from the busiest hour, containing the real mix of point pings and polygons: the measured rate is one hundred and forty thousand vertices per second and the budget is two point one million, which drains in fifteen seconds. The mechanism was correct in both cases; only the input to the sizing differed, and the failure it produced is indistinguishable from having no backpressure at all.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">same consumer, same mechanism, two sizing samples</text>
<rect x="14" y="30" width="366" height="140" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">sample taken at 03:00 — parked-fleet pings</text>
<text x="26" y="72" font-size="8.5" fill="var(--fig-ink-soft)">measured rate: 900 000 vertices/s</text>
<text x="26" y="88" font-size="8.5" fill="var(--fig-ink-soft)">deadline bound: 13.5 M vertices</text>
<text x="26" y="110" font-size="8.5" fill="var(--fig-rose-edge)">deployed against real polygon traffic at</text>
<text x="26" y="122" font-size="8.5" fill="var(--fig-rose-edge)">100 000 vertices/s → over 2 minutes to drain</text>
<text x="26" y="142" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">evicted at 30 s · batch redelivered</text>
<text x="26" y="160" font-size="8.5" fill="var(--fig-ink-soft)">indistinguishable from having no backpressure</text>
<rect x="392" y="30" width="354" height="140" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="404" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">sample taken during the busiest hour</text>
<text x="404" y="72" font-size="8.5" fill="var(--fig-ink-soft)">the real mix: pings and parcel boundaries</text>
<text x="404" y="88" font-size="8.5" fill="var(--fig-ink-soft)">measured rate: 140 000 vertices/s</text>
<text x="404" y="110" font-size="8.5" fill="var(--fig-mint-edge)">deadline bound: 2.1 M vertices</text>
<text x="404" y="130" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">drains in 15 s · half the deadline, as designed</text>
<text x="404" y="152" font-size="8.5" fill="var(--fig-ink-soft)">the mechanism was identical in both cases —</text>
<text x="404" y="164" font-size="8.5" fill="var(--fig-ink-soft)">only the sizing input differed</text>
<rect x="14" y="184" width="732" height="34" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="26" y="203" font-size="9" fill="var(--fig-ink-soft)">Measure on the traffic the budget will govern, at the hour it will govern it. A benchmark run on convenient data produces a</text>
<text x="26" y="214" font-size="9" fill="var(--fig-ink-soft)">number with a decimal point and no relationship to the workload.</text>
</svg>
<figcaption><b>Figure 2.</b> A wrongly-sized budget does not fail visibly — it produces exactly the eviction the backpressure was added to prevent, which sends the investigation back to the mechanism.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `DEADLINE_HEADROOM` | `float` | Fraction of the poll interval the budget may occupy | `0.5` |
| `memory_bytes_available` | `int` | For in-flight geometry only, not the whole container | — |
| `max_poll_interval_seconds` | `float` | The broker's own setting, read from configuration | `30.0` |
| Sample | list | Real payloads from the busiest hour, not a convenient one | — |
| Rate statistic | — | Median across repeats; a GC pause must not set the budget | median |
| `binding` | `str` | Reported, because the two bounds need different fixes | — |

</div>

## Gotchas and spatial edge cases

1. **`tracemalloc` measures Python allocations, not the whole process.** Shapely's geometry arrays live partly in native memory that `tracemalloc` does not see, so the measured bytes per vertex is a lower bound. Cross-check against the container's resident set under load, and prefer the larger figure — an over-cautious budget costs throughput, an over-confident one costs the container.

2. **The handler must be the real one.** Measuring parse rate alone gives a figure several times higher than a handler that also does a spatial join, writes to PostGIS or reprojects. The budget governs the whole pipeline stage, so the measurement has to as well.

3. **A sample of large geometries alone is as wrong as a sample of small ones.** The budget governs the mix, and a stream that is ninety per cent pings by count but sixty per cent polygon vertices by volume has a rate somewhere between the two extremes. Sample by taking a contiguous window of real traffic rather than by selecting interesting messages.

4. **Vertex count and processing cost decouple for some handlers.** A handler dominated by a per-message database round trip has a cost proportional to message count, not vertices, so a vertex budget lets through thousands of cheap messages that collectively blow the deadline. Where that is the case, charge both and bound both.

5. **Re-measure after any change to the deployment shape.** Halving the container's memory halves the memory bound; moving from four processes to eight halves the memory available to each while leaving the deadline bound unchanged, which can flip which constraint binds.

6. **The measurement must run outside the event loop.** Timing a handler that awaits on a shared loop measures scheduling, not processing. Use the same isolation the production path uses, which for geometry work means a process pool — see [Optimizing Async Geometry Parsing with asyncio](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/optimizing-async-geometry-parsing-with-asyncio/).

<figure class="fig">
<svg viewBox="0 0 760 188" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A deployment change halving per-process memory and flipping which bound binds">
<title>Doubling the process count can flip which constraint binds</title>
<desc>A consumer runs four processes in a container with eight gigabytes available for in-flight geometry, so each process has two gigabytes and a memory bound of about fourteen million vertices — comfortably above the deadline bound of two point one million, which is therefore the binding constraint. Someone doubles the process count to improve throughput. The container's memory is unchanged, so each process now has one gigabyte and a memory bound of about seven million vertices; the deadline bound is unchanged at two point one million per process because each still has a full poll interval. In this case the deadline still binds and nothing breaks. Halve the memory again, to sixteen processes, and the memory bound falls to about one point seven million — below the deadline bound — so memory becomes the binding constraint and a budget still configured at two point one million now permits more in-flight geometry than the process can hold. The scaling change did not touch the budget, the code or the traffic, and it invalidated the sizing.</desc>
<rect x="0" y="0" width="760" height="188" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">8 GB container for in-flight geometry, split N ways</text>
<rect x="14" y="30" width="238" height="102" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="26" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">4 processes · 2 GB each</text>
<text x="26" y="72" font-size="8.5" fill="var(--fig-ink-soft)">memory bound ≈ 14 M vertices</text>
<text x="26" y="88" font-size="8.5" fill="var(--fig-ink-soft)">deadline bound ≈ 2.1 M</text>
<text x="26" y="112" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">the deadline binds</text>
<rect x="262" y="30" width="238" height="102" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="274" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">8 processes · 1 GB each</text>
<text x="274" y="72" font-size="8.5" fill="var(--fig-ink-soft)">memory bound ≈ 7 M vertices</text>
<text x="274" y="88" font-size="8.5" fill="var(--fig-ink-soft)">deadline bound ≈ 2.1 M, unchanged</text>
<text x="274" y="112" font-size="9" font-weight="600" fill="var(--fig-gold-edge)">the deadline still binds — nothing breaks</text>
<rect x="510" y="30" width="236" height="102" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.7"/>
<text x="522" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">16 processes · 0.5 GB each</text>
<text x="522" y="72" font-size="8.5" fill="var(--fig-ink-soft)">memory bound ≈ 1.7 M vertices</text>
<text x="522" y="88" font-size="8.5" fill="var(--fig-ink-soft)">deadline bound ≈ 2.1 M</text>
<text x="522" y="112" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">memory binds — the budget is now too large</text>
<text x="14" y="160" font-size="9" fill="var(--fig-ink-soft)">The scaling change touched neither the budget, the code, nor the traffic — and it invalidated the sizing. Recompute both</text>
<text x="14" y="174" font-size="9" fill="var(--fig-ink-soft)">bounds whenever the deployment shape changes, not only when the payload mix does.</text>
</svg>
<figcaption><b>Figure 3.</b> Scaling out is usually treated as free. For a memory-bounded budget it is a change to one of the two inputs, and only one of them.</figcaption>
</figure>

## Verification

```python
import pytest


def test_the_smaller_bound_wins():
    rec = recommend(_mixed_sample(), _real_handler,
                    memory_bytes_available=2 * 1024**3,
                    max_poll_interval_seconds=30.0)
    assert rec.budget == min(rec.memory_bound, rec.deadline_bound)
    assert rec.binding in ("memory", "poll deadline")


def test_heavy_sample_produces_a_smaller_budget_than_a_light_one():
    """The property that makes the sample choice matter."""
    light = recommend(_point_pings(), _real_handler, 2 * 1024**3, 30.0)
    heavy = recommend(_parcel_boundaries(), _real_handler, 2 * 1024**3, 30.0)
    assert heavy.budget < light.budget


def test_budget_drains_inside_the_deadline():
    """The assertion the deadline bound exists to guarantee."""
    rec = recommend(_mixed_sample(), _real_handler, 2 * 1024**3, 30.0)
    drain_seconds = rec.budget / rec.vertices_per_second
    assert drain_seconds <= 30.0 * DEADLINE_HEADROOM + 0.5


def test_bytes_per_vertex_is_not_the_naive_figure():
    """16 bytes for two doubles would size the budget an order of magnitude high."""
    bpv = measure_bytes_per_vertex(_mixed_sample())
    assert bpv > 40, f"{bpv:.1f} bytes/vertex is implausibly low — check the measurement"
```

The last test guards the measurement rather than the result. If `measure_bytes_per_vertex` is ever changed in a way that reports the serialised size instead of the resident size, every derived budget becomes several times too large and nothing else in the suite notices.

## Related

- [Backpressure & Flow Control for Spatial Consumers](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/) — the topic this guide belongs to
- [Applying Backpressure When a Spatial Consumer Falls Behind](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/applying-backpressure-when-a-spatial-consumer-falls-behind/) — the mechanism this budget feeds
- [Shedding Spatial Load by Geographic Priority](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/shedding-spatial-load-by-geographic-priority/) — what happens when the budget is correct and still not enough
- [Choosing an H3 Resolution from Measured Traffic](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/choosing-an-h3-resolution-from-measured-traffic/) — the same measure-then-decide method applied one layer up
