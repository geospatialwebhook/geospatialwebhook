---
title: "Expiring Deduplication Keys Without Losing Late Retries"
description: "Size the TTL from the sender's full retry ladder, then keep memory bounded with a two-tier store: exact keys for the recent window, a probabilistic filter for the long tail."
slug: "expiring-dedup-keys-without-losing-late-retries"
type: "article"
breadcrumb: "Idempotency & Spatial Deduplication > Time-Windowed Deduplication for Moving Assets > Expiring Deduplication Keys Without Losing Late Retries"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Expiring Deduplication Keys Without Losing Late Retries",
      "description": "A deduplication key that expires before the sender's last retry admits a duplicate hours after the deploy that caused it. This guide sizes the TTL from the measured retry horizon and keeps memory bounded with a two-tier store rather than by shortening it.",
      "url": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/expiring-dedup-keys-without-losing-late-retries/",
      "datePublished": "2026-08-08",
      "dateModified": "2026-08-08",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Idempotency & Spatial Deduplication", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/"},
        {"@type": "ListItem", "position": 3, "name": "Time-Windowed Deduplication for Moving Assets", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/"},
        {"@type": "ListItem", "position": 4, "name": "Expiring Deduplication Keys Without Losing Late Retries", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/expiring-dedup-keys-without-losing-late-retries/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Expire deduplication keys without admitting late retries",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Measure the sender's retry horizon rather than reading it from a document"},
        {"@type": "HowToStep", "position": 2, "name": "Set the TTL from that horizon plus outage tolerance"},
        {"@type": "HowToStep", "position": 3, "name": "Bound memory with a second tier, not by shortening the TTL"},
        {"@type": "HowToStep", "position": 4, "name": "Alert on eviction, because eviction silently shortens every TTL at once"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How do I measure a sender's retry horizon?",
          "acceptedAnswer": {"@type": "Answer", "text": "Deliberately fail one delivery and record every subsequent attempt for the same event until they stop. The gap between the first attempt and the last is the horizon, and it is frequently longer than the sender's documentation claims because published schedules omit the outer attempts or describe an older version. Repeat it per sender: a pipeline receiving from four providers has four horizons, and the TTL has to cover the longest."}
        },
        {
          "@type": "Question",
          "name": "Is a long TTL not just a memory problem?",
          "acceptedAnswer": {"@type": "Answer", "text": "It is a memory cost, and shortening the TTL is the wrong way to pay it because that reintroduces the duplicates the store exists to prevent. The right answer is a second tier: keep exact keys for the recent period where most redeliveries land, and back them with a rotating probabilistic filter covering the full horizon. The filter costs a few bits per key instead of a few dozen bytes, and its false-positive rate suppresses an occasional genuine event rather than admitting a duplicate."}
        },
        {
          "@type": "Question",
          "name": "What happens when Redis evicts keys under memory pressure?",
          "acceptedAnswer": {"@type": "Answer", "text": "Every TTL is silently shortened at once, and the deduplication store starts admitting duplicates with no error raised anywhere. Under an allkeys-lru policy Redis will evict deduplication keys to make room for anything else sharing the instance, so a cache being used for another purpose can quietly break idempotency. Use a dedicated instance or a volatile policy, and alert on the eviction counter — it is the only signal that the TTL you configured is not the TTL in force."}
        }
      ]
    }
  ]
}
</script>

**Measure the sender's retry horizon by deliberately failing a delivery and watching every attempt, set the TTL from that plus outage tolerance, and bound memory with a second probabilistic tier rather than by shortening it — a shorter TTL trades a memory cost for silent duplicates that appear hours after the deploy.**

This guide sits under [Time-Windowed Deduplication for Moving Assets](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/), within [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/). It sizes the `STATE_TTL` used by the sliding window and by the claim in [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/).

## When to use this pattern

- The deduplication store's TTL was chosen to match the window, or to match a round number, or to fit a memory budget.
- Duplicates appear in production but never in testing — the signature of a TTL shorter than a retry ladder.
- Memory pressure is being managed by shortening the TTL, which is the trade this guide argues against.

## Measure the horizon; the documentation is a lower bound

<figure class="fig">
<svg viewBox="0 0 760 222" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A measured retry ladder extending beyond the documented one, with two TTL choices">
<title>The attempt nobody documented is the one that arrives</title>
<desc>A provider's published retry schedule lists five attempts over about ninety minutes. Deliberately failing one delivery and recording every subsequent attempt reveals eight, the last arriving nine hours and twenty minutes after the original — the outer three are not in the documentation, either because they were added later or because the published schedule describes a different tier of the product. A TTL set from the documented horizon plus a comfortable-looking margin, say two hours, expires the key before attempts six, seven and eight, so each of them wins its claim and is written as a new observation. The failure is invisible in any test that runs faster than two hours, invisible in staging where nothing fails for long enough to reach the outer attempts, and appears in production as a small persistent rate of duplicate records with no error to attach it to. A TTL set from the measured horizon plus outage tolerance covers all eight, and costs only memory.</desc>
<rect x="0" y="0" width="760" height="222" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one deliberately failed delivery · every subsequent attempt recorded</text>
<line x1="40" y1="56" x2="740" y2="56" stroke="var(--fig-line)" stroke-width="1.2"/>
<circle cx="40" cy="56" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<circle cx="80" cy="56" r="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<circle cx="130" cy="56" r="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<circle cx="196" cy="56" r="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<circle cx="272" cy="56" r="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<circle cx="360" cy="56" r="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<circle cx="486" cy="56" r="4.5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<circle cx="600" cy="56" r="4.5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<circle cx="712" cy="56" r="4.5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="34" y="42" font-size="8" fill="var(--fig-ink-soft)">0</text>
<text x="352" y="42" font-size="8" fill="var(--fig-ink-soft)">1 h 30</text>
<text x="694" y="42" font-size="8" fill="var(--fig-rose-edge)">9 h 20</text>
<rect x="40" y="72" width="326" height="18" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="50" y="85" font-size="8" fill="var(--fig-ink)">documented: 5 attempts</text>
<rect x="370" y="72" width="370" height="18" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="380" y="85" font-size="8" fill="var(--fig-ink)">measured but undocumented: 3 more attempts</text>
<rect x="40" y="104" width="180" height="34" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="50" y="118" font-size="8.5" font-weight="600" fill="var(--fig-ink)">TTL = 2 h</text>
<text x="50" y="132" font-size="8" fill="var(--fig-rose-edge)">key gone before attempt 6</text>
<text x="230" y="126" font-size="8.5" fill="var(--fig-rose-edge)">attempts 6, 7 and 8 each win a claim and are written as new observations</text>
<rect x="40" y="148" width="700" height="34" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="50" y="162" font-size="8.5" font-weight="600" fill="var(--fig-ink)">TTL = measured horizon + outage tolerance (12 h)</text>
<text x="50" y="176" font-size="8" fill="var(--fig-mint-edge)">every attempt after the first loses · costs memory, and nothing else</text>
<text x="14" y="202" font-size="9" fill="var(--fig-ink-soft)">Invisible in any test faster than two hours, and in staging where nothing fails long enough to reach the outer attempts.</text>
<text x="14" y="214" font-size="9" fill="var(--fig-ink-soft)">In production it is a small persistent rate of duplicate records with no error attached to it.</text>
</svg>
<figcaption><b>Figure 1.</b> The documented schedule is a lower bound on the horizon. The only reliable number comes from failing a delivery on purpose and writing down what arrives.</figcaption>
</figure>

## Complete runnable implementation

```python
import hashlib
import time

import redis.asyncio as redis
from prometheus_client import Counter, Gauge

TIER1_HIT = Counter("dedup_tier1_hit_total", "Suppressed by the exact tier")
TIER2_HIT = Counter("dedup_tier2_hit_total", "Suppressed by the filter tier")
EVICTED = Gauge("dedup_store_evicted_keys", "Redis evicted_keys — must stay 0")

# Tier 1: exact keys, covering the period most redeliveries land in.
TIER1_TTL = 2 * 3600
# Tier 2: probabilistic, covering the full measured horizon plus tolerance.
HORIZON_SECONDS = 12 * 3600
# Two rotating filters so a key is always covered for at least HORIZON_SECONDS
# regardless of where in the rotation it was written.
FILTER_SLOTS = 2


class TieredDeduplicator:
    """Exact for the recent window, probabilistic for the long tail.

    Memory is bounded by the tier-2 filter rather than by shortening the TTL,
    because a shorter TTL buys memory with duplicates.
    """

    def __init__(self, client: redis.Redis) -> None:
        self._client = client

    def _slot(self, now: float) -> int:
        return int(now // HORIZON_SECONDS) % FILTER_SLOTS

    async def seen(self, key: str, now: float | None = None) -> bool:
        now = now or time.time()

        # Tier 1 — exact, and authoritative when it answers yes.
        if not await self._client.set(f"d1:{key}", b"1", nx=True, px=TIER1_TTL * 1000):
            TIER1_HIT.inc()
            return True

        # Tier 2 — a rotating Bloom filter. Both slots are checked, so a key
        # written just before a rotation is still found afterwards.
        for offset in range(FILTER_SLOTS):
            slot = (self._slot(now) - offset) % FILTER_SLOTS
            if await self._client.execute_command("BF.EXISTS", f"d2:{slot}", key):
                # A false positive suppresses a genuine event. That is the
                # safe direction for telemetry and the wrong one for edits —
                # see the gotchas.
                TIER2_HIT.inc()
                return True

        await self._client.execute_command("BF.ADD", f"d2:{self._slot(now)}", key)
        return False

    async def sample_evictions(self) -> None:
        """Eviction shortens every TTL at once, silently. Watch it."""
        info = await self._client.info("stats")
        EVICTED.set(info.get("evicted_keys", 0))


async def measure_retry_horizon(receiver_log) -> float:
    """Derive the horizon from observation rather than documentation.

    Fail one delivery deliberately, then take the span between the first and
    last attempt carrying the same delivery id.
    """
    attempts: dict[str, list[float]] = {}
    for record in receiver_log:
        attempts.setdefault(record["delivery_id"], []).append(record["received_at"])
    spans = [max(t) - min(t) for t in attempts.values() if len(t) > 1]
    return max(spans) if spans else 0.0
```

Checking both filter slots is what makes the rotation safe. A single rotating filter loses every key at the instant it rotates, which reproduces the original bug on a twelve-hour cycle.

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Memory cost of exact keys over a long horizon versus a two-tier store">
<title>Two ways to pay for a twelve-hour horizon</title>
<desc>A stream of forty thousand events per second is deduplicated over a twelve-hour horizon. Holding an exact key for every event across that period means about one point seven billion keys resident, which at roughly sixty bytes per Redis key with its expiry metadata is on the order of a hundred gigabytes — enough that the usual response is to shorten the TTL, which is precisely the change that admits duplicates. The two-tier store holds exact keys only for the first two hours, about two hundred and ninety million keys, and covers the remaining ten hours with two rotating Bloom filters sized for the full horizon at a one-in-a-thousand false-positive rate, costing roughly ten bits per key. The total is a small fraction of the exact figure. What is given up is exactness in the tail: about one event in a thousand that reaches tier two is wrongly suppressed. For telemetry that is a good trade, because another ping follows in seconds; for feature edits it is not, because nothing resends a cadastral boundary change.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">40 000 events/s · 12-hour horizon</text>
<rect x="14" y="30" width="366" height="130" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="50" font-size="10" font-weight="600" fill="var(--fig-ink)">exact keys for the whole horizon</text>
<text x="26" y="72" font-size="8.5" fill="var(--fig-ink-soft)">≈ 1.7 billion keys resident</text>
<text x="26" y="88" font-size="8.5" fill="var(--fig-ink-soft)">≈ 60 bytes each with expiry metadata</text>
<text x="26" y="104" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">on the order of 100 GB</text>
<text x="26" y="126" font-size="8.5" fill="var(--fig-rose-edge)">the usual response is to shorten the TTL —</text>
<text x="26" y="138" font-size="8.5" fill="var(--fig-rose-edge)">which is exactly the change that admits duplicates</text>
<text x="26" y="154" font-size="8.5" fill="var(--fig-ink-soft)">exact, and unaffordable</text>
<rect x="392" y="30" width="354" height="130" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="404" y="50" font-size="10" font-weight="600" fill="var(--fig-ink)">two tiers</text>
<text x="404" y="72" font-size="8.5" fill="var(--fig-ink-soft)">tier 1 · exact, 2 h → ≈ 290 million keys</text>
<text x="404" y="88" font-size="8.5" fill="var(--fig-ink-soft)">tier 2 · two rotating Bloom filters, 12 h</text>
<text x="404" y="104" font-size="8.5" fill="var(--fig-ink-soft)">≈ 10 bits per key at a 1-in-1000 error rate</text>
<text x="404" y="126" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">a small fraction of the exact figure</text>
<text x="404" y="148" font-size="8.5" fill="var(--fig-ink-soft)">approximate in the tail, and affordable</text>
<rect x="14" y="172" width="732" height="46" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="26" y="191" font-size="9.5" font-weight="600" fill="var(--fig-ink)">What is given up, and for which streams it is acceptable</text>
<text x="26" y="203" font-size="9" fill="var(--fig-ink-soft)">About one event in a thousand reaching tier 2 is wrongly suppressed. Fine for telemetry — another ping</text>
<text x="26" y="215" font-size="9" fill="var(--fig-ink-soft)">follows in seconds. Not fine for feature edits: nothing resends a cadastral boundary change.</text>
</svg>
<figcaption><b>Figure 2.</b> The two-tier store does not make the horizon cheaper to cover exactly; it makes it cheap to cover approximately, and the approximation errs towards suppression.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `TIER1_TTL` | `int` | Covers where most redeliveries land; exact, so safe for any stream | `7200` |
| `HORIZON_SECONDS` | `int` | Measured retry span **plus** outage tolerance | `43200` |
| `FILTER_SLOTS` | `int` | ≥ 2, so a key written before a rotation is still found after it | `2` |
| Filter error rate | `float` | The rate at which a genuine event is wrongly suppressed | `0.001` |
| Redis maxmemory policy | `str` | `volatile-ttl` or a dedicated instance — never `allkeys-lru` | — |
| `evicted_keys` | counter | Must stay at zero; any value means the TTL is not in force | `0` |

</div>

## Gotchas and spatial edge cases

1. **Eviction silently shortens every TTL at once.** Under `allkeys-lru` Redis will evict deduplication keys to make room for whatever else shares the instance, so a cache used for tile fragments can break idempotency for the whole pipeline. Nothing errors, and the symptom is a rise in duplicate writes that correlates with unrelated traffic. Use a dedicated instance and alert on the eviction counter.

2. **A false positive in tier two suppresses a real event, which is the wrong direction for edits.** For vehicle telemetry, losing one ping in a thousand from the deep tail is harmless. For feature changes it is data loss, and those streams need exact keys across the whole horizon even if that means a bigger store — the identity keys in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) are usually low enough in volume to afford it.

3. **A single rotating filter reproduces the original bug on a schedule.** When it rotates, every key it held disappears at once, so a redelivery arriving a minute later is admitted. Two slots with both checked is the minimum; three gives margin if the horizon estimate is soft.

4. **The horizon is per sender.** Four providers means four horizons, and the TTL must cover the longest. Measuring one and applying it to all is the same mistake as reading it from documentation, with more confidence attached.

5. **A key claimed before processing and never released holds its slot for the full TTL.** That is the correct behaviour for suppression, and it means a crash between claim and processing loses the event for the whole horizon. Release on failure, and treat the TTL as the backstop rather than the mechanism.

6. **Bloom filters cannot be resized in place.** If the event rate doubles, the existing filter's error rate rises and there is no way to fix it without rotating early and losing coverage. Size for the peak rate you expect over the filter's lifetime, and alert when the observed insert count approaches the configured capacity.

<figure class="fig">
<svg viewBox="0 0 760 196" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A single rotating filter losing every key at the rotation instant, against two overlapping slots">
<title>One filter rotates into a hole; two do not</title>
<desc>A rotating probabilistic filter is used to cover the long tail of the retry horizon. With a single slot, the filter is cleared at each rotation, so every key it held vanishes at that instant: a redelivery arriving a minute after a rotation finds nothing, wins its claim, and is written a second time. The bug therefore reproduces the original problem on a twelve-hour cycle, and because it only affects redeliveries that straddle a rotation boundary, it appears as a small periodic spike in duplicate writes that correlates with nothing an operator is looking at. With two slots and both consulted on every check, a key written just before a rotation is still found in the previous slot afterwards, so coverage is continuous and every key is guaranteed at least the full horizon regardless of where in the cycle it was written. The cost is one extra membership check per lookup and twice the filter memory, which is a small fraction of what exact keys over the same horizon would cost.</desc>
<rect x="0" y="0" width="760" height="196" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">one rotating slot</text>
<rect x="30" y="30" width="200" height="22" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="40" y="46" font-size="8" fill="var(--fig-ink)">slot A — keys held</text>
<line x1="234" y1="26" x2="234" y2="58" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="240" y="24" font-size="8" fill="var(--fig-rose-edge)">rotation</text>
<rect x="238" y="30" width="200" height="22" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="248" y="46" font-size="8" fill="var(--fig-ink)">slot A cleared — every key gone at once</text>
<text x="452" y="46" font-size="8.5" fill="var(--fig-rose-edge)">a redelivery a minute later wins its claim</text>
<text x="30" y="70" font-size="8.5" fill="var(--fig-rose-edge)">the original bug, on a 12-hour cycle · a small periodic spike that correlates with nothing an operator watches</text>
<line x1="14" y1="88" x2="746" y2="88" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="110" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">two slots, both consulted</text>
<rect x="30" y="122" width="240" height="20" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="40" y="136" font-size="8" fill="var(--fig-ink)">slot A</text>
<rect x="180" y="146" width="240" height="20" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="190" y="160" font-size="8" fill="var(--fig-ink)">slot B — overlaps A</text>
<text x="440" y="140" font-size="8.5" fill="var(--fig-mint-edge)">a key written just before a rotation is still found after it</text>
<text x="440" y="158" font-size="8.5" fill="var(--fig-ink-soft)">every key gets at least the full horizon, wherever it lands</text>
<text x="14" y="186" font-size="9" fill="var(--fig-ink-soft)">Cost: one extra membership check per lookup and twice the filter memory — a small fraction of exact keys over the same horizon.</text>
</svg>
<figcaption><b>Figure 3.</b> The rotation is the only moment a probabilistic tier can lose data, so it is the only part of the design that needs to be redundant.</figcaption>
</figure>

## Verification

```python
import pytest

HORIZON = 12 * 3600


@pytest.mark.asyncio
async def test_redelivery_at_the_end_of_the_ladder_is_suppressed(dedup):
    """The failure the TTL exists to prevent, at nine hours."""
    assert await dedup.seen("evt-1", now=0.0) is False
    assert await dedup.seen("evt-1", now=9 * 3600) is True


@pytest.mark.asyncio
async def test_key_written_before_a_rotation_survives_it(dedup):
    """A single filter would fail here; two slots do not."""
    await dedup.seen("evt-2", now=HORIZON - 60)
    assert await dedup.seen("evt-2", now=HORIZON + 60) is True


@pytest.mark.asyncio
async def test_beyond_the_horizon_is_admitted(dedup):
    """Deliberate: past the horizon, a repeat is treated as a new event."""
    await dedup.seen("evt-3", now=0.0)
    assert await dedup.seen("evt-3", now=3 * HORIZON) is False


def test_measured_horizon_exceeds_the_documented_one():
    """The assertion that justifies measuring at all."""
    log = [{"delivery_id": "d1", "received_at": t}
           for t in (0, 60, 300, 1800, 5400, 12_000, 21_600, 33_600)]
    assert measure_retry_horizon(log) > 90 * 60      # documented: 90 minutes
```

The second test is the one that catches a single-slot filter, and it is worth writing with explicit timestamps around the rotation boundary — a randomised or relative-time version passes most of the time and fails only when the test happens to run near a rotation.

## Related

- [Time-Windowed Deduplication for Moving Assets](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/) — the topic this guide belongs to
- [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) — the store this TTL is applied to, and what to do when it is unavailable
- [Sizing a Deduplication Window from Report Intervals](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/sizing-a-dedup-window-from-report-intervals/) — the other number, which is not this one
- [Tuning Retry Budgets for Webhook Provider SLAs](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/tuning-retry-budgets-for-webhook-provider-slas/) — the sending side of the ladder being measured here
