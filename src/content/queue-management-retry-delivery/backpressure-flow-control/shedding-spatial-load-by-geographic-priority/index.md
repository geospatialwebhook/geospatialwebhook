---
title: "Shedding Spatial Load by Geographic Priority"
description: "Shed only events a later one supersedes, and decide by stream class rather than by geography alone — a rural boundary edit is not less important than an urban vehicle ping, it is merely rarer."
slug: "shedding-spatial-load-by-geographic-priority"
type: "article"
breadcrumb: "Queue Management, Retries & Delivery Guarantees > Backpressure & Flow Control for Spatial Consumers > Shedding Spatial Load by Geographic Priority"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Shedding Spatial Load by Geographic Priority",
      "description": "Load shedding is acceptable only for streams whose events supersede one another, and geographic priority is a second filter rather than the first. This guide classifies streams by supersession, ranks within them by area, and makes every shed decision countable.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/shedding-spatial-load-by-geographic-priority/",
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
        {"@type": "ListItem", "position": 4, "name": "Shedding Spatial Load by Geographic Priority", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/shedding-spatial-load-by-geographic-priority/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Shed spatial load by geographic priority",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Classify every stream by whether a later event supersedes an earlier one"},
        {"@type": "HowToStep", "position": 2, "name": "Never shed a stream whose events are not self-superseding"},
        {"@type": "HowToStep", "position": 3, "name": "Within sheddable streams, rank by area priority and event age"},
        {"@type": "HowToStep", "position": 4, "name": "Count every shed decision by stream and area, and alert on the rate"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Which spatial events are safe to shed?",
          "acceptedAnswer": {"@type": "Answer", "text": "Only those a later event replaces. A vehicle position ping is safe because another arrives within seconds and is strictly more useful; a sensor reading on a fixed cadence is usually safe for the same reason. A cadastral boundary edit is not, because nothing will resend it — shedding it is data loss with no recovery path. The test is not how important the event feels but whether the information it carries will arrive again on its own."}
        },
        {
          "@type": "Question",
          "name": "Is it fair to prioritise dense urban areas over rural ones?",
          "acceptedAnswer": {"@type": "Answer", "text": "Only within a stream whose events supersede one another, and even then it needs stating explicitly. Prioritising by traffic volume systematically degrades service to sparse regions, and because those regions generate few events the degradation is invisible in fleet-wide metrics. If area priority is used, it should come from a business decision recorded in configuration — a named list of priority areas — rather than from event density, which quietly encodes 'busy' as 'important'."}
        },
        {
          "@type": "Question",
          "name": "What has to be recorded when an event is shed?",
          "acceptedAnswer": {"@type": "Answer", "text": "The stream, the area, the reason and the count — at minimum. Shedding is deliberate data loss, and the only thing separating it from a bug is that somebody can see it happening and knows why. A counter labelled by stream and area class lets an operator answer whether the pipeline shed anything during an incident, which is the first question asked afterwards and one that logs alone answer poorly."}
        }
      ]
    }
  ]
}
</script>

**Classify streams by whether a later event supersedes an earlier one, shed only within that set, and rank by a configured area priority rather than by event density — prioritising by traffic volume encodes "busy" as "important" and degrades sparse regions invisibly, because they generate too few events to move a fleet-wide metric.**

This guide sits under [Backpressure & Flow Control for Spatial Consumers](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/), within [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/). It is the escalation after pausing, and it should be rare enough that its rate is itself an alert.

## When to use this pattern

- Pausing has been sustained long enough that the backlog will not clear on its own, which is the precondition — shedding before pausing is throwing away work you had capacity for.
- At least one stream in the mix is genuinely self-superseding, or there is nothing safe to shed.
- The alternative is worse: a backlog that grows until the consumer is evicted, taking every stream with it.

## Supersession first, geography second

<figure class="fig">
<svg viewBox="0 0 760 234" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Streams classified by supersession, with geographic priority applied only within the sheddable set">
<title>Two filters, and the order matters</title>
<desc>Streams flowing into a saturated consumer are sorted by a first test: does a later event replace this one? Vehicle position pings pass — another arrives in seconds and is strictly more useful — as do fixed-cadence sensor readings and tile-render requests, which can be regenerated on demand. Cadastral boundary edits fail the test, as do geofence entry and exit transitions and dead-letter replays: nothing resends them, so shedding one is permanent loss with no recovery path. Only the streams that pass the first test reach the second, where a configured area priority decides which to drop first within them. Applying the filters in the other order — ranking everything by area and shedding the lowest-priority events regardless of stream — drops boundary edits from rural areas, which is data loss dressed up as a capacity decision. The area priority itself comes from configuration rather than from measured density, because ranking by event volume means the regions that generate the fewest events are always shed first, and their degradation never shows up in an aggregate.</desc>
<rect x="0" y="0" width="760" height="234" fill="var(--fig-bg)"/>
<defs><marker id="sh-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">filter 1: does a later event replace this one?</text>
<rect x="14" y="30" width="200" height="104" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="26" y="50" font-size="9" font-weight="600" fill="var(--fig-ink)">yes — sheddable</text>
<text x="26" y="70" font-size="8.5" fill="var(--fig-ink-soft)">vehicle position pings</text>
<text x="26" y="86" font-size="8.5" fill="var(--fig-ink-soft)">fixed-cadence sensor readings</text>
<text x="26" y="102" font-size="8.5" fill="var(--fig-ink-soft)">tile render requests</text>
<text x="26" y="122" font-size="8" fill="var(--fig-mint-edge)">the information arrives again on its own</text>
<rect x="228" y="30" width="200" height="104" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="240" y="50" font-size="9" font-weight="600" fill="var(--fig-ink)">no — never shed</text>
<text x="240" y="70" font-size="8.5" fill="var(--fig-ink-soft)">cadastral boundary edits</text>
<text x="240" y="86" font-size="8.5" fill="var(--fig-ink-soft)">geofence entry and exit</text>
<text x="240" y="102" font-size="8.5" fill="var(--fig-ink-soft)">dead-letter replays</text>
<text x="240" y="122" font-size="8" fill="var(--fig-rose-edge)">nothing resends these — loss is permanent</text>
<line x1="114" y1="138" x2="114" y2="158" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#sh-a)"/>
<text x="14" y="176" font-size="10" font-weight="600" fill="var(--fig-ink)">filter 2, applied only to the left column: configured area priority</text>
<rect x="14" y="186" width="200" height="38" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="26" y="203" font-size="8.5" fill="var(--fig-ink)">priority areas from configuration</text>
<text x="26" y="217" font-size="8.5" fill="var(--fig-ink-soft)">a business decision, written down</text>
<rect x="452" y="30" width="294" height="194" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.4"/>
<text x="464" y="52" font-size="9.5" font-weight="600" fill="var(--fig-ink)">why the order matters</text>
<text x="464" y="74" font-size="8.5" fill="var(--fig-ink-soft)">Rank everything by area first, and the lowest-</text>
<text x="464" y="86" font-size="8.5" fill="var(--fig-ink-soft)">priority events shed include rural boundary edits</text>
<text x="464" y="100" font-size="8.5" fill="var(--fig-rose-edge)">— data loss dressed as a capacity decision</text>
<text x="464" y="126" font-size="9.5" font-weight="600" fill="var(--fig-ink)">why priority is configured, not measured</text>
<text x="464" y="148" font-size="8.5" fill="var(--fig-ink-soft)">Ranking by event density means sparse regions</text>
<text x="464" y="160" font-size="8.5" fill="var(--fig-ink-soft)">are always shed first, and because they generate</text>
<text x="464" y="172" font-size="8.5" fill="var(--fig-ink-soft)">few events their degradation never moves an</text>
<text x="464" y="184" font-size="8.5" fill="var(--fig-ink-soft)">aggregate metric.</text>
<text x="464" y="206" font-size="8.5" fill="var(--fig-mint-edge)">"Busy" is not "important" — and encoding it that</text>
<text x="464" y="218" font-size="8.5" fill="var(--fig-mint-edge)">way makes the bias invisible to the dashboards.</text>
</svg>
<figcaption><b>Figure 1.</b> Reversing the two filters produces a system that sheds rural boundary edits under load and reports it as successful capacity management.</figcaption>
</figure>

## Complete runnable implementation

```python
import time
from dataclasses import dataclass
from enum import IntEnum

import h3
from prometheus_client import Counter

SHED = Counter("events_shed_total", "Events deliberately dropped",
               ("stream", "area_class", "reason"))


class Supersession(IntEnum):
    """Whether a later event makes this one redundant."""
    SELF_SUPERSEDING = 0     # another arrives shortly and is strictly better
    NEVER = 1                # nothing will resend this


# Explicit per stream. A stream absent from this table is NEVER, because the
# safe default for "somebody added a topic and forgot" is to keep the data.
STREAM_POLICY: dict[str, Supersession] = {
    "vehicle.position": Supersession.SELF_SUPERSEDING,
    "sensor.reading": Supersession.SELF_SUPERSEDING,
    "tile.render": Supersession.SELF_SUPERSEDING,
    "feature.boundary_edit": Supersession.NEVER,
    "geofence.transition": Supersession.NEVER,
    "dlq.replay": Supersession.NEVER,
}

# Area priority from configuration — a business decision, not event density.
# Lower rank sheds first.
AREA_PRIORITY: dict[str, int] = {}     # H3 res-4 cell -> rank
DEFAULT_AREA_RANK = 50

# A ping already older than this is worthless: its successor has arrived.
STALE_AFTER_SECONDS = 30.0


@dataclass(frozen=True, slots=True)
class ShedDecision:
    shed: bool
    reason: str


def area_class(lat: float, lon: float) -> tuple[str, int]:
    cell = h3.latlng_to_cell(lat, lon, 4)
    return cell, AREA_PRIORITY.get(cell, DEFAULT_AREA_RANK)


def decide(stream: str, lat: float, lon: float, occurred_at: float,
           pressure: float, now: float | None = None) -> ShedDecision:
    """Shed or keep one event. `pressure` is 0.0-1.0 from the work budget."""
    now = now or time.time()
    policy = STREAM_POLICY.get(stream, Supersession.NEVER)

    # Filter 1. A stream whose events do not supersede is never shed, at any
    # pressure — the alternative to keeping it is permanent loss.
    if policy is Supersession.NEVER:
        return ShedDecision(False, "not-superseding")

    cell, rank = area_class(lat, lon)

    # A superseded event is free to drop regardless of pressure: its
    # replacement has already arrived, so processing it is pure waste.
    if now - occurred_at > STALE_AFTER_SECONDS:
        SHED.labels(stream=stream, area_class=cell, reason="stale").inc()
        return ShedDecision(True, "stale")

    # Filter 2. Under pressure, shed from the lowest-priority areas first.
    # Pressure 0.8 sheds rank > 80; pressure 1.0 sheds everything sheddable.
    if pressure > 0.5 and rank > (1.0 - pressure) * 100:
        SHED.labels(stream=stream, area_class=cell, reason="pressure").inc()
        return ShedDecision(True, "pressure")

    return ShedDecision(False, "kept")
```

The default of `NEVER` for an unknown stream is the decision that makes this safe to operate. A topic added by another team inherits the conservative policy rather than the convenient one, and the cost of that mistake is a slower consumer instead of missing cadastral edits.

<figure class="fig">
<svg viewBox="0 0 760 218" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="How much of the stream is shed as pressure rises, by area rank band">
<title>Shedding graduates rather than switching on</title>
<desc>The proportion of sheddable events dropped is plotted against consumer pressure, split by area priority rank. Below a pressure of zero point five nothing is shed at all except events already stale — the consumer is under load but coping, and discarding work it has capacity for would be pure loss. As pressure rises past zero point five, the lowest-priority areas begin to shed: at pressure zero point seven, areas ranked above thirty are dropped, which in a typical configuration is the long tail of low-priority regions. At pressure zero point nine only areas ranked ten or better survive. At pressure one point zero every sheddable stream is dropped in every area, and only the never-shed streams are still processed — which is the intended floor, because those are the events that cannot be recovered. The graduation matters because a binary switch means the consumer is either wasting capacity or discarding a third of the fleet's telemetry, with nothing in between, and because a gradual curve makes the shed counter a usable pressure gauge rather than an alarm bell.</desc>
<rect x="0" y="0" width="760" height="218" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">proportion of sheddable events dropped, against consumer pressure</text>
<line x1="70" y1="150" x2="700" y2="150" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="70" y1="34" x2="70" y2="150" stroke="var(--fig-line)" stroke-width="1.2"/>
<text x="30" y="46" font-size="8" fill="var(--fig-ink-soft)">100%</text>
<text x="46" y="156" font-size="8" fill="var(--fig-ink-soft)">0</text>
<text x="60" y="172" font-size="8" fill="var(--fig-ink-soft)">pressure 0.0</text>
<text x="330" y="172" font-size="8" fill="var(--fig-ink-soft)">0.5</text>
<text x="650" y="172" font-size="8" fill="var(--fig-ink-soft)">1.0</text>
<line x1="385" y1="34" x2="385" y2="150" stroke="var(--fig-line-soft)" stroke-width="1.2" stroke-dasharray="3 3"/>
<path d="M70,148 L385,148 L450,120 L540,80 L620,52 L700,42" fill="none" stroke="var(--fig-gold-edge)" stroke-width="2"/>
<text x="440" y="112" font-size="8.5" fill="var(--fig-gold-edge)">rank &gt; 30 — the long tail of low-priority areas</text>
<path d="M70,148 L520,148 L600,110 L700,44" fill="none" stroke="var(--fig-peach-edge)" stroke-width="2"/>
<text x="530" y="140" font-size="8.5" fill="var(--fig-peach-edge)">rank 10–30</text>
<path d="M70,148 L640,148 L700,48" fill="none" stroke="var(--fig-mint-edge)" stroke-width="2"/>
<text x="600" y="140" font-size="8.5" fill="var(--fig-mint-edge)">rank ≤ 10 — priority areas, shed last</text>
<text x="120" y="120" font-size="8.5" fill="var(--fig-ink-soft)">nothing shed but stale events — the consumer is loaded and coping</text>
<rect x="14" y="182" width="732" height="30" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="196" font-size="9" fill="var(--fig-ink-soft)">A binary switch leaves the consumer either wasting capacity or discarding a third of the fleet's telemetry.</text>
<text x="26" y="208" font-size="9" fill="var(--fig-ink-soft)">The graduated curve also makes the shed counter a pressure gauge rather than an alarm bell.</text>
</svg>
<figcaption><b>Figure 2.</b> Never-superseding streams are absent from this chart entirely — they sit at zero across the whole range, which is the property the first filter guarantees.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `STREAM_POLICY` | dict | Explicit per stream; unknown streams default to `NEVER` | — |
| `AREA_PRIORITY` | dict | H3 res-4 cell to rank, from configuration not density | `{}` |
| `DEFAULT_AREA_RANK` | `int` | Applied to unconfigured areas; mid-range, not lowest | `50` |
| `STALE_AFTER_SECONDS` | `float` | Above the stream's report interval, so only superseded events qualify | `30.0` |
| `pressure` | `float` | From the work budget, 0.0–1.0 | — |
| Shed counter labels | — | Stream, area and reason — shedding must be countable | — |

</div>

## Gotchas and spatial edge cases

1. **An unknown stream must default to never-shed.** The convenient default is the dangerous one: a topic added by another team would silently become sheddable, and the first anyone knows is a gap in a dataset nobody was watching. The cost of the safe default is a consumer that sheds less than it could.

2. **Area rank at resolution 4 is coarse, deliberately.** A configuration file listing millions of cells is not maintainable, and priority is a regional decision rather than a neighbourhood one. Cells at resolution 4 are roughly the size of a metropolitan area, which matches how the decision is actually made.

3. **Staleness is not the same as pressure shedding, and both need separate counters.** A stale event is free to drop at any pressure because its successor has already arrived; a pressure shed is a deliberate sacrifice. Merging them into one counter makes it impossible to tell a healthy pipeline discarding superseded pings from one in distress.

4. **Shedding interacts with deduplication.** An event shed at the consumer may already have claimed its deduplication key if the claim happens before dispatch, so the retry finds the key present and suppresses an event that was never processed. Shed before claiming, or release the key on shed — the same ordering problem described in [Time-Windowed Deduplication for Moving Assets](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/).

5. **The shed rate belongs in the error budget, not beside it.** Shedding is deliberate incompleteness, so it spends the completeness objective defined in [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/). A pipeline that sheds routinely without that showing up in an objective has hidden a capacity problem in a feature.

6. **Sustained shedding is a capacity decision, not an operational one.** If pressure sits above the shed threshold for hours every day, the correct response is more consumers or a finer partitioning, not a lower threshold. Alert on the duration of shedding rather than only on its occurrence.

<figure class="fig">
<svg viewBox="0 0 760 188" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="An event shed after claiming its deduplication key, suppressing the retry that would have processed it">
<title>Shed before the claim, or the retry is suppressed too</title>
<desc>An event arrives, claims its deduplication key, and is then shed under pressure. The claim is now held by an event that was never processed, and because the key's lifetime is the retry horizon, every redelivery of that event for the next several hours finds the key present and is suppressed as a duplicate. The shedding decision, which was meant to drop one instance of a self-superseding event, has instead dropped the event permanently — including the retry that the pipeline would otherwise have handled once pressure eased. Ordering the shed decision before the claim avoids it entirely: a shed event never touches the deduplication store, so a redelivery is treated as a first sighting and processed normally. If the ordering cannot be changed, releasing the key on shed achieves the same thing at the cost of one extra round trip and a failure mode when the release itself fails.</desc>
<rect x="0" y="0" width="760" height="188" fill="var(--fig-bg)"/>
<defs><marker id="sh3-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">claim, then shed</text>
<rect x="30" y="28" width="110" height="24" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="40" y="44" font-size="8" fill="var(--fig-ink)">claim dedup key</text>
<line x1="144" y1="40" x2="172" y2="40" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sh3-a)"/>
<rect x="176" y="28" width="110" height="24" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="186" y="44" font-size="8" fill="var(--fig-ink)">shed under pressure</text>
<line x1="290" y1="40" x2="318" y2="40" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sh3-a)"/>
<rect x="322" y="28" width="240" height="24" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="332" y="44" font-size="8" fill="var(--fig-ink)">every retry for hours finds the key and is suppressed</text>
<text x="30" y="70" font-size="8.5" fill="var(--fig-rose-edge)">a decision meant to drop one instance has dropped the event permanently</text>
<line x1="14" y1="86" x2="746" y2="86" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="108" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">shed, then claim</text>
<rect x="30" y="118" width="110" height="24" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="40" y="134" font-size="8" fill="var(--fig-ink)">shed decision</text>
<line x1="144" y1="130" x2="172" y2="130" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sh3-a)"/>
<rect x="176" y="118" width="240" height="24" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="186" y="134" font-size="8" fill="var(--fig-ink)">a shed event never touches the dedup store</text>
<text x="430" y="134" font-size="8.5" fill="var(--fig-mint-edge)">a redelivery is a first sighting, and is processed</text>
<text x="14" y="168" font-size="9" fill="var(--fig-ink-soft)">If the ordering cannot be changed, release the key on shed — one extra round trip, and a new failure mode when the release itself fails.</text>
</svg>
<figcaption><b>Figure 3.</b> Shedding and deduplication are independently correct and wrong together, which is why their order is part of the shedding design rather than an implementation detail.</figcaption>
</figure>

## Verification

```python
import time
import pytest

NOW = 1_780_000_000.0
BERLIN = (52.5200, 13.4049)


def test_boundary_edits_are_never_shed_at_any_pressure():
    """The property the first filter exists to guarantee."""
    for pressure in (0.0, 0.5, 0.9, 1.0):
        decision = decide("feature.boundary_edit", *BERLIN,
                          occurred_at=NOW, pressure=pressure, now=NOW)
        assert decision.shed is False


def test_unknown_stream_defaults_to_never_shed():
    """A topic somebody forgot to classify must keep its data."""
    decision = decide("some.new.topic", *BERLIN,
                      occurred_at=NOW, pressure=1.0, now=NOW)
    assert decision.shed is False


def test_stale_pings_are_shed_even_at_zero_pressure():
    """Its successor already arrived; processing it is pure waste."""
    decision = decide("vehicle.position", *BERLIN,
                      occurred_at=NOW - 120, pressure=0.0, now=NOW)
    assert decision.shed and decision.reason == "stale"


def test_priority_areas_survive_longer_than_default_ones():
    AREA_PRIORITY[h3.latlng_to_cell(*BERLIN, 4)] = 5
    priority = decide("vehicle.position", *BERLIN,
                      occurred_at=NOW, pressure=0.75, now=NOW)
    default = decide("vehicle.position", 48.1372, 11.5756,
                     occurred_at=NOW, pressure=0.75, now=NOW)
    assert not priority.shed and default.shed


def test_nothing_is_shed_below_the_pressure_floor():
    """Shedding work you have capacity for is loss, not management."""
    decision = decide("vehicle.position", *BERLIN,
                      occurred_at=NOW, pressure=0.4, now=NOW)
    assert decision.shed is False
```

The second test is the one worth keeping visible in review. It asserts a default rather than a behaviour, and defaults are what get changed by someone tidying a configuration table who does not know that the conservative value was the point.

## Related

- [Backpressure & Flow Control for Spatial Consumers](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/) — the topic this guide belongs to
- [Applying Backpressure When a Spatial Consumer Falls Behind](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/applying-backpressure-when-a-spatial-consumer-falls-behind/) — the step that must be exhausted before shedding starts
- [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/) — where the shed rate spends the completeness budget
- [Dead-Letter Queues for Spatial Events](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/) — the alternative to shedding for events that cannot be lost
