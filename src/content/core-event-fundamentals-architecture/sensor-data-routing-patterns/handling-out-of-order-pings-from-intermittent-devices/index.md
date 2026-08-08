---
title: "Handling Out-of-Order Pings from Intermittent Devices"
description: "A device back from a tunnel dumps an hour of buffered positions at once, newest first. Order by the device clock, reject stale state transitions, and use a watermark so a track is only closed when late data can no longer arrive."
slug: "handling-out-of-order-pings-from-intermittent-devices"
type: "article"
breadcrumb: "Core Event Fundamentals & Architecture > Sensor Data Routing Patterns > Handling Out-of-Order Pings from Intermittent Devices"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Handling Out-of-Order Pings from Intermittent Devices",
      "description": "A device that lost connectivity buffers positions and flushes them in whatever order its queue happened to hold. This guide orders on the device clock, rejects state transitions carrying older observations, and uses a watermark so a track is only finalised once late data can no longer arrive.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/handling-out-of-order-pings-from-intermittent-devices/",
      "datePublished": "2026-08-08",
      "dateModified": "2026-08-08",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Core Event Fundamentals & Architecture", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/"},
        {"@type": "ListItem", "position": 3, "name": "Sensor Data Routing Patterns", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/"},
        {"@type": "ListItem", "position": 4, "name": "Handling Out-of-Order Pings from Intermittent Devices", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/handling-out-of-order-pings-from-intermittent-devices/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Handle out-of-order pings from an intermittent device",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Order every decision on the device clock, never on arrival"},
        {"@type": "HowToStep", "position": 2, "name": "Reject any state transition whose observation is older than the current state"},
        {"@type": "HowToStep", "position": 3, "name": "Buffer to a watermark before finalising a track"},
        {"@type": "HowToStep", "position": 4, "name": "Detect and quarantine devices whose clock is wrong rather than merely late"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why not just sort by arrival time?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because arrival order is decided by the network, not by the world. A device leaving a tunnel flushes its buffer as fast as it can, and whether the oldest or newest position arrives first depends on whether its queue is a queue or a stack — which is a firmware detail that can change in an update. Ordering on arrival makes the vehicle's reconstructed path a function of connectivity, so the same drive produces a different track depending on where the signal dropped."}
        },
        {
          "@type": "Question",
          "name": "How long should the watermark lag behind real time?",
          "acceptedAnswer": {"@type": "Answer", "text": "Long enough to cover the outage the fleet routinely experiences, which is a measured number rather than a chosen one: take the distribution of the gap between a ping's device timestamp and its arrival, and set the watermark near its 99th percentile. Anything later than that is treated as too late and routed to a separate correction path rather than held for indefinitely, because a watermark that waits for the worst device delays every consumer by the worst case."}
        },
        {
          "@type": "Question",
          "name": "What should happen to a ping that arrives after its window closed?",
          "acceptedAnswer": {"@type": "Answer", "text": "Emit it as an explicit correction rather than dropping it or silently rewriting history. A consumer that has already acted on the closed track — billed a trip, sent an arrival notification — needs to know the underlying data changed, and a silent update to a stored track gives it no way to find out. A correction event with the original track identifier lets each consumer decide whether the change matters to it."}
        }
      ]
    }
  ]
}
</script>

**Order every decision on the device's own clock, reject any state transition carrying an observation older than the state it would replace, and hold a track open until a measured watermark has passed — a device leaving a tunnel flushes its buffer in whatever order its firmware happens to use, so arrival order makes the reconstructed path a function of connectivity.**

This guide sits under [Sensor Data Routing Patterns](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/), within [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/). It is the failure mode that breaks the stateful router in [Routing Telemetry by Geofence Membership](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/routing-telemetry-by-geofence-membership/), which assumes each ping is newer than the last.

## When to use this pattern

- Devices buffer locally when they lose connectivity — vehicles in tunnels, vessels out of range, sensors on intermittent power.
- Downstream logic is stateful: geofence membership, trip reconstruction, distance accumulation, arrival detection.
- The device supplies its own timestamp, which is the precondition for any of this working.

## What a buffered flush does to stateful logic

<figure class="fig">
<svg viewBox="0 0 760 236" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A tunnel gap producing a burst of buffered pings in reverse order and the phantom geofence exit it creates">
<title>The path the network produces is not the path the vehicle drove</title>
<desc>A vehicle drives into a tunnel at nine minutes past, losing connectivity for eleven minutes while continuing to record positions every ten seconds. On emerging it flushes sixty-six buffered pings within about two seconds, and its firmware sends the newest first. Downstream, a geofence router that trusts arrival order sees the vehicle apparently teleport to its current position, then walk backwards through the tunnel, then jump forward again when live reporting resumes — producing an exit from the destination zone, a re-entry into the origin zone, and a second exit, none of which happened. A billing rule keyed on zone entries charges twice; an arrival notification fires, then un-fires, then fires again. Ordering on the device clock instead reconstructs the drive exactly as it happened, and the only cost is that the router must hold its decision until the flush has been sorted, which is what the watermark is for.</desc>
<rect x="0" y="0" width="760" height="236" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">11-minute tunnel · 66 buffered pings flushed in ~2 s, newest first</text>
<text x="14" y="42" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">device clock (what happened)</text>
<line x1="200" y1="62" x2="740" y2="62" stroke="var(--fig-line)" stroke-width="1.2"/>
<circle cx="220" cy="62" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="260" cy="62" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<rect x="290" y="54" width="330" height="16" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="380" y="66" font-size="8" fill="var(--fig-ink-soft)">66 pings recorded underground</text>
<circle cx="660" cy="62" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="700" cy="62" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="14" y="104" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">arrival order (what the network delivered)</text>
<line x1="200" y1="124" x2="740" y2="124" stroke="var(--fig-line)" stroke-width="1.2"/>
<circle cx="220" cy="124" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="260" cy="124" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<rect x="290" y="116" width="90" height="16" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="296" y="128" font-size="7.5" fill="var(--fig-ink)">all 66, reversed</text>
<circle cx="420" cy="124" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="460" cy="124" r="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="200" y="148" font-size="8.5" fill="var(--fig-rose-edge)">a router trusting arrival order sees: teleport forward · walk backwards · jump forward again</text>
<rect x="14" y="162" width="366" height="62" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="181" font-size="9.5" font-weight="600" fill="var(--fig-ink)">what downstream emits</text>
<text x="26" y="198" font-size="8.5" fill="var(--fig-ink-soft)">exit destination zone · re-enter origin zone · exit again</text>
<text x="26" y="214" font-size="8.5" fill="var(--fig-rose-edge)">billing charges twice · arrival fires, un-fires, fires</text>
<rect x="392" y="162" width="354" height="62" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="404" y="181" font-size="9.5" font-weight="600" fill="var(--fig-ink)">ordering on the device clock</text>
<text x="404" y="198" font-size="8.5" fill="var(--fig-ink-soft)">reconstructs the drive exactly as it happened</text>
<text x="404" y="214" font-size="8.5" fill="var(--fig-mint-edge)">costs only the delay of holding the decision — the watermark</text>
</svg>
<figcaption><b>Figure 1.</b> Whether the oldest or the newest buffered ping arrives first is a firmware detail that can change in an update, which is why arrival order cannot be the basis of anything.</figcaption>
</figure>

## Complete runnable implementation

Two mechanisms, and they solve different halves. The **monotonic guard** protects state from going backwards, cheaply and immediately. The **watermark buffer** produces a correctly ordered track, at the cost of latency.

```python
import heapq
from dataclasses import dataclass, field
from datetime import datetime, timedelta, UTC

from prometheus_client import Counter, Histogram

LATE = Counter("ping_late_total", "Pings older than the current state", ("asset",))
TOO_LATE = Counter("ping_after_watermark_total", "Pings arriving after close")
SKEW = Histogram(
    "ping_arrival_skew_seconds", "Arrival minus device timestamp",
    buckets=(1, 5, 30, 120, 600, 1800, 3600, float("inf")),
)

# Measured, not chosen: the 99th percentile of observed arrival skew.
WATERMARK_LAG = timedelta(minutes=15)
# A device claiming to be further in the future than this has a broken clock.
MAX_FUTURE_SKEW = timedelta(minutes=2)


class ClockImplausible(Exception):
    """The device timestamp cannot be true, so nothing derived from it can be."""


@dataclass(slots=True)
class AssetState:
    latest_observed: datetime | None = None
    buffer: list = field(default_factory=list)     # min-heap on device time


class OrderedIngest:
    def __init__(self, lag: timedelta = WATERMARK_LAG) -> None:
        self._lag = lag
        self._state: dict[str, AssetState] = {}

    def accept(self, ping: dict, now: datetime | None = None) -> bool:
        """Buffer one ping. Returns False if it is too late to be ordered."""
        now = now or datetime.now(UTC)
        observed = datetime.fromisoformat(ping["occurred_at"]).astimezone(UTC)
        SKEW.observe((now - observed).total_seconds())

        # A future timestamp is a broken clock, not a late ping, and the two
        # need opposite handling: one is quarantined, the other is waited for.
        if observed > now + MAX_FUTURE_SKEW:
            raise ClockImplausible(f"{ping['asset_id']} claims {observed.isoformat()}")

        state = self._state.setdefault(ping["asset_id"], AssetState())
        if observed < now - self._lag:
            TOO_LATE.inc()
            return False

        heapq.heappush(state.buffer, (observed, ping["ping_id"], ping))
        return True

    def release(self, now: datetime | None = None):
        """Yield every ping whose device time is older than the watermark.

        Anything still in the buffer could still be overtaken by a later
        arrival, so releasing it early is exactly the bug this fixes.
        """
        now = now or datetime.now(UTC)
        watermark = now - self._lag

        for asset_id, state in self._state.items():
            while state.buffer and state.buffer[0][0] <= watermark:
                observed, _, ping = heapq.heappop(state.buffer)
                yield ping

    def is_regression(self, asset_id: str, observed: datetime) -> bool:
        """The cheap guard: does this ping predate the state it would change?

        Used by stateful consumers that must act immediately and cannot wait
        for the watermark — a geofence router, for instance.
        """
        state = self._state.setdefault(asset_id, AssetState())
        if state.latest_observed is not None and observed <= state.latest_observed:
            LATE.labels(asset=asset_id).inc()
            return True
        state.latest_observed = observed
        return False
```

The two are used together. A geofence router calls `is_regression` and skips the transition without waiting; a trip reconstructor consumes from `release` and gets a correctly ordered track fifteen minutes behind real time.

<figure class="fig">
<svg viewBox="0 0 760 218" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The latency and correctness trade-off between the monotonic guard and the watermark buffer">
<title>Immediate and approximate, or delayed and correct</title>
<desc>Two consumers of the same ping stream are contrasted. The monotonic guard acts immediately: it compares each ping's device timestamp against the newest already seen for that asset and drops anything older, so state can never go backwards and the decision latency is zero. What it cannot do is use the dropped pings — a geofence crossing that happened inside the tunnel is discarded rather than replayed, so the router's membership is right at the current instant and its history has a hole. The watermark buffer waits fifteen minutes, sorts everything that arrived in that period by device time, and releases a correctly ordered track including the tunnel positions, at the cost of every consumer downstream of it being fifteen minutes behind. Neither is the right answer for both consumers, which is why a pipeline usually runs both: live alerting takes the guard, and anything that reconstructs a path, computes a distance or issues a bill takes the buffer.</desc>
<rect x="0" y="0" width="760" height="218" fill="var(--fig-bg)"/>
<rect x="14" y="26" width="366" height="150" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="26" y="46" font-size="10" font-weight="600" fill="var(--fig-ink)">monotonic guard — decide now</text>
<text x="26" y="68" font-size="8.5" fill="var(--fig-ink-soft)">compare against the newest device time seen</text>
<text x="26" y="82" font-size="8.5" fill="var(--fig-ink-soft)">drop anything older · zero added latency</text>
<text x="26" y="102" font-size="8.5" fill="var(--fig-mint-edge)">+ state can never go backwards</text>
<text x="26" y="116" font-size="8.5" fill="var(--fig-mint-edge)">+ costs one comparison per ping</text>
<text x="26" y="136" font-size="8.5" fill="var(--fig-gold-edge)">− the tunnel positions are discarded, not replayed</text>
<text x="26" y="150" font-size="8.5" fill="var(--fig-gold-edge)">− membership is right now; history has a hole</text>
<text x="26" y="168" font-size="8.5" fill="var(--fig-ink)">for live alerting and geofence routing</text>
<rect x="392" y="26" width="354" height="150" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="404" y="46" font-size="10" font-weight="600" fill="var(--fig-ink)">watermark buffer — decide later</text>
<text x="404" y="68" font-size="8.5" fill="var(--fig-ink-soft)">hold 15 minutes, sort by device time, release</text>
<text x="404" y="82" font-size="8.5" fill="var(--fig-ink-soft)">a min-heap per asset, popped against the watermark</text>
<text x="404" y="102" font-size="8.5" fill="var(--fig-mint-edge)">+ the track is the drive, including the tunnel</text>
<text x="404" y="116" font-size="8.5" fill="var(--fig-mint-edge)">+ distances and durations are computable</text>
<text x="404" y="136" font-size="8.5" fill="var(--fig-ink-soft)">− every consumer behind it is 15 minutes late</text>
<text x="404" y="150" font-size="8.5" fill="var(--fig-ink-soft)">− memory grows with fleet size × lag</text>
<text x="404" y="168" font-size="8.5" fill="var(--fig-ink)">for trip reconstruction, distance and billing</text>
<text x="14" y="196" font-size="9" fill="var(--fig-ink-soft)">Neither is right for both consumers, so a pipeline normally runs both off one stream — the guard in front of anything that</text>
<text x="14" y="209" font-size="9" fill="var(--fig-ink-soft)">alerts, the buffer in front of anything that bills.</text>
</svg>
<figcaption><b>Figure 2.</b> Running both is not redundancy. They answer different questions, and a pipeline that picks one has silently decided that either its alerts are late or its bills are wrong.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `WATERMARK_LAG` | `timedelta` | ~99th percentile of measured arrival skew, not the maximum | `15 min` |
| `MAX_FUTURE_SKEW` | `timedelta` | Above NTP drift, below any plausible buffering delay | `2 min` |
| Heap key | `(datetime, str)` | Ping id breaks ties so two identical timestamps sort deterministically | — |
| `is_regression` | `bool` | Uses `<=`, so a repeated timestamp is a duplicate, not an update | — |
| Buffer memory | — | Grows as fleet size × ping rate × lag; bound it explicitly | — |
| Late path | — | Emit corrections; do not silently rewrite a closed track | — |

</div>

## Gotchas and spatial edge cases

1. **A wrong clock is not a late ping and needs the opposite handling.** A device whose clock is a year fast has every ping released immediately and permanently blocks the monotonic guard — nothing newer can ever arrive. A device a year slow has every ping discarded as too late. Both look like data loss; only the `ClockImplausible` check distinguishes them from a genuine outage, and the correct response is to quarantine the device, not the stream.

2. **Interpolating across a gap invents positions.** It is tempting to draw a straight line across the tunnel, and the line will cross geofences the vehicle never entered. If the reconstructed track is used for anything consequential, mark the gap explicitly and let each consumer decide, rather than producing a track that cannot be distinguished from observed data.

3. **Distance accumulated in arrival order is roughly double.** Summing consecutive distances over a reversed burst counts every leg twice — once forwards and once backwards — so an odometer built naively over an intermittent fleet overstates by the length of every outage. This is usually the first symptom anyone notices.

4. **Deduplication and ordering are different problems with the same smell.** A device that retries its flush sends the same pings again; that is [Time-Windowed Deduplication for Moving Assets](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/), and it must run *before* the heap or the buffer fills with duplicates that all sort to the same position.

5. **The watermark must advance on wall-clock time, not on arrivals.** If it advances only when a ping arrives, an asset that goes quiet never releases its buffer, and the last pings before an outage sit in memory until the device comes back — which for a vessel can be weeks. Drive `release` from a timer.

6. **Per-asset buffers make this stateful, so partition by asset.** The same constraint as the geofence router: two instances each holding half an asset's pings each produce half a track.

<figure class="fig">
<svg viewBox="0 0 760 198" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Distance accumulated in arrival order against distance accumulated in device-clock order">
<title>The odometer doubles, and only for the vehicles that lose signal</title>
<desc>A vehicle drives four kilometres through a tunnel while buffering, then flushes in reverse. A distance accumulator that sums consecutive positions in arrival order walks the route backwards and then forwards again, counting every leg twice, so the trip is reported as roughly eight kilometres. Accumulated in device-clock order the same pings give four. The error is not random noise that averages out across a fleet: it is a systematic overstatement proportional to the length of every connectivity gap, so it lands entirely on the vehicles that drive through tunnels, car parks and rural dead zones, and not at all on the ones that stay connected. Any figure derived from the odometer inherits that bias — fuel efficiency per vehicle, distance-based billing, maintenance intervals — and the affected vehicles are exactly the ones whose data is hardest to sanity-check, because their tracks legitimately have gaps in them.</desc>
<rect x="0" y="0" width="760" height="198" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one 4 km tunnel transit, accumulated two ways</text>
<text x="14" y="42" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">arrival order</text>
<path d="M120,60 L300,60" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2.4"/>
<path d="M300,72 L120,72" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2.4" stroke-dasharray="4 3"/>
<path d="M120,84 L300,84" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2.4"/>
<text x="316" y="76" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">every leg counted twice → ≈ 8 km reported</text>
<text x="14" y="112" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">device-clock order</text>
<path d="M120,130 L300,130" fill="none" stroke="var(--fig-mint-edge)" stroke-width="2.4"/>
<text x="316" y="134" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">4 km — the distance the vehicle drove</text>
<rect x="14" y="150" width="732" height="42" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="168" font-size="9" fill="var(--fig-ink-soft)">Not noise that averages out: a systematic overstatement proportional to every connectivity gap, landing entirely on the</text>
<text x="26" y="182" font-size="9" fill="var(--fig-ink-soft)">vehicles that drive through tunnels and dead zones — and their tracks legitimately have gaps, so it is hard to sanity-check.</text>
</svg>
<figcaption><b>Figure 3.</b> This is usually the first symptom anyone notices, and it points at the ordering rather than at the odometer — which is where the investigation normally starts.</figcaption>
</figure>

## Verification

```python
from datetime import datetime, timedelta, UTC
import pytest

T0 = datetime(2026, 8, 8, 12, 0, tzinfo=UTC)


def ping(asset: str, offset_s: int, n: int) -> dict:
    return {"asset_id": asset, "ping_id": f"p{n}",
            "occurred_at": (T0 + timedelta(seconds=offset_s)).isoformat()}


def test_reversed_burst_is_released_in_device_order():
    """The property the whole design exists for."""
    ingest = OrderedIngest(lag=timedelta(minutes=5))
    now = T0 + timedelta(minutes=20)
    for n, offset in enumerate(reversed(range(0, 600, 10))):     # newest first
        ingest.accept(ping("veh-1", offset, n), now=now)

    released = [p["occurred_at"] for p in ingest.release(now=now)]
    assert released == sorted(released)


def test_guard_rejects_a_ping_older_than_current_state():
    ingest = OrderedIngest()
    assert ingest.is_regression("veh-2", T0 + timedelta(seconds=60)) is False
    assert ingest.is_regression("veh-2", T0 + timedelta(seconds=30)) is True


def test_future_clock_is_quarantined_not_buffered():
    """A year-fast device would otherwise block the guard forever."""
    ingest = OrderedIngest()
    with pytest.raises(ClockImplausible):
        ingest.accept(ping("veh-3", 365 * 24 * 3600, 0), now=T0)
```

The first test is the one to run against a real recorded burst rather than a synthetic reversal. Firmware rarely reverses cleanly — a partial flush interleaved with live reporting produces an order that is neither forwards nor backwards, and a heap handles it while any "detect and reverse" shortcut does not.

## Related

- [Sensor Data Routing Patterns](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/) — the topic this guide belongs to
- [Routing Telemetry by Geofence Membership](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/routing-telemetry-by-geofence-membership/) — the stateful consumer the monotonic guard protects
- [Idempotent Consumers for Out-of-Order Spatial Events](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/idempotent-consumers-for-out-of-order-spatial-events/) — the same problem for feature edits rather than positions
- [Time-Windowed Deduplication for Moving Assets](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/) — what must run before the buffer, so it does not fill with repeats
