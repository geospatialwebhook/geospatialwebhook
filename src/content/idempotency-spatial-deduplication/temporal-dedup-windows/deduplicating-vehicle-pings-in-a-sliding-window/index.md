---
title: "Deduplicating Vehicle Pings in a Sliding Window"
description: "A tumbling bucket admits two pings four seconds apart across its boundary. Replace it with a per-asset sliding comparison in Redis — one Lua script that reads the last accepted ping, decides, and writes atomically."
slug: "deduplicating-vehicle-pings-in-a-sliding-window"
type: "article"
breadcrumb: "Idempotency & Spatial Deduplication > Time-Windowed Deduplication for Moving Assets > Deduplicating Vehicle Pings in a Sliding Window"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Deduplicating Vehicle Pings in a Sliding Window",
      "description": "A tumbling deduplication bucket admits pairs of pings that straddle its boundary. This guide implements a sliding window as a single atomic Redis Lua script that compares each ping against the last accepted one for that asset and decides in one round trip.",
      "url": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/deduplicating-vehicle-pings-in-a-sliding-window/",
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
        {"@type": "ListItem", "position": 4, "name": "Deduplicating Vehicle Pings in a Sliding Window", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/deduplicating-vehicle-pings-in-a-sliding-window/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Deduplicate vehicle pings with a sliding window",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Store one last-accepted record per asset rather than one key per bucket"},
        {"@type": "HowToStep", "position": 2, "name": "Compare on both elapsed time and ground distance, not time alone"},
        {"@type": "HowToStep", "position": 3, "name": "Make read, decide and write one atomic Lua script"},
        {"@type": "HowToStep", "position": 4, "name": "Refuse to let a late ping overwrite a newer accepted one"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does a sliding window need a Lua script rather than two commands?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because read-then-write is a race, and the race loses precisely when the stream is busiest. Two consumers handling a redelivery of the same ping both read the same last-accepted record, both decide the ping is novel, and both write — admitting the duplicate the mechanism exists to suppress. A Lua script executes on the Redis server as a single unit, so the read, the comparison and the write cannot be interleaved by another client."}
        },
        {
          "@type": "Question",
          "name": "Should the comparison use time or distance?",
          "acceptedAnswer": {"@type": "Answer", "text": "Both, joined by OR: admit the ping if enough time has passed OR the asset has moved far enough. Time alone suppresses a vehicle that accelerated away within the window, losing a real movement. Distance alone never emits anything for a parked vehicle, so a consumer tracking dwell time sees no heartbeat and cannot distinguish parked from disconnected. Either condition alone fails a case that the pair handles."}
        },
        {
          "@type": "Question",
          "name": "What happens when a delayed ping arrives after a newer one?",
          "acceptedAnswer": {"@type": "Answer", "text": "It must be suppressed and it must not overwrite the stored record. A late ping that replaces a newer last-accepted entry rewinds the comparison baseline, so the next genuine ping is measured against a position the asset had already left, and the window silently stops working for that asset until the next admitted event resets it. The script guards this by refusing to write when the incoming timestamp is older than the stored one."}
        }
      ]
    }
  ]
}
</script>

**Keep one last-accepted record per asset, compare each ping against it on elapsed time OR ground distance, and do the read, the decision and the write in a single Lua script — two round trips lose the race exactly when redeliveries are most likely, and a late ping allowed to overwrite a newer record silently disables the window for that asset.**

This guide sits under [Time-Windowed Deduplication for Moving Assets](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/), within [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/). It is the sliding alternative to the tumbling bucket that topic describes, and it costs one read per event to remove the boundary pair.

## When to use this pattern

- Boundary duplicates have actually been measured — pairs of pings seconds apart that both got admitted because a bucket edge fell between them.
- A read per event is affordable, which for a Redis instance co-located with the consumer usually means it is.
- The stream is high-volume enough that the tumbling scheme's admitted duplicates cost more than the read.

## Where the tumbling bucket lets a pair through

<figure class="fig">
<svg viewBox="0 0 760 216" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A tumbling bucket boundary admitting two pings four seconds apart, and the sliding comparison suppressing them">
<title>The boundary is a fixed clock, and the vehicle does not know about it</title>
<desc>A vehicle reports at eleven fifty-nine and fifty-eight seconds, and again at twelve hundred hours and two seconds. Under a five-minute tumbling window those two pings quantise to different buckets, so both win their claim and both are admitted, even though they are four seconds apart and describe essentially the same moment. The rate of this failure is fixed and predictable: for a fleet reporting every ten seconds it happens roughly once per asset per bucket, which for ten thousand vehicles on five-minute buckets is about two thousand admitted duplicates an hour, permanently, regardless of tuning. Under a sliding comparison the incoming ping is measured against the last one actually accepted for that asset rather than against a clock, so four seconds is four seconds wherever it falls, and the pair collapses. The cost is one stored record per active asset and one read per event; the benefit is that the failure mode disappears rather than being reduced.</desc>
<rect x="0" y="0" width="760" height="216" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">two pings, four seconds apart, either side of 12:00:00</text>
<text x="14" y="42" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">tumbling — quantise the clock</text>
<line x1="200" y1="66" x2="740" y2="66" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="470" y1="52" x2="470" y2="80" stroke="var(--fig-line)" stroke-width="1.6" stroke-dasharray="4 3"/>
<text x="440" y="48" font-size="8" fill="var(--fig-ink-soft)">12:00:00</text>
<circle cx="452" cy="66" r="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<circle cx="488" cy="66" r="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="300" y="86" font-size="8.5" fill="var(--fig-ink-soft)">bucket 11:55–12:00</text>
<text x="520" y="86" font-size="8.5" fill="var(--fig-ink-soft)">bucket 12:00–12:05</text>
<text x="200" y="106" font-size="8.5" fill="var(--fig-rose-edge)">different buckets → both admitted · ~2 000 duplicates/hour for 10 000 vehicles on 5-minute buckets</text>
<text x="14" y="136" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">sliding — compare against the last accepted ping</text>
<line x1="200" y1="160" x2="740" y2="160" stroke="var(--fig-line)" stroke-width="1.2"/>
<circle cx="452" cy="160" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<circle cx="488" cy="160" r="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<path d="M452,172 Q470,186 488,172" fill="none" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="500" y="180" font-size="8.5" fill="var(--fig-mint-edge)">4 s since the last accepted ping — suppressed, wherever the clock happens to be</text>
<text x="14" y="204" font-size="9" fill="var(--fig-ink-soft)">Cost: one stored record per active asset, one read per event. Benefit: the failure mode disappears rather than shrinking.</text>
</svg>
<figcaption><b>Figure 1.</b> The tumbling failure rate is not a tuning problem — it is fixed by the ratio of report interval to bucket width, and it does not improve with any choice of bucket.</figcaption>
</figure>

## Complete runnable implementation

```python
import math

import redis.asyncio as redis

MIN_SECONDS = 60.0        # emit at most once a minute while stationary
MIN_METRES = 25.0         # …but emit immediately if the asset has moved
STATE_TTL = 6 * 3600      # must outlive the sender's full retry ladder

# One atomic unit: read the last accepted ping, decide, write if accepted.
# Splitting this into GET and SET is a race that admits duplicates exactly
# when two workers are handed the same redelivery.
_SLIDING = """
local raw = redis.call('GET', KEYS[1])
local t   = tonumber(ARGV[1])
local lat = tonumber(ARGV[2])
local lon = tonumber(ARGV[3])
local min_s = tonumber(ARGV[4])
local min_m = tonumber(ARGV[5])
local ttl   = tonumber(ARGV[6])

if raw then
  local prev_t, prev_lat, prev_lon = string.match(raw, '([^|]+)|([^|]+)|([^|]+)')
  prev_t, prev_lat, prev_lon = tonumber(prev_t), tonumber(prev_lat), tonumber(prev_lon)

  -- A ping older than the stored one is late. Suppress it AND leave the
  -- record alone: overwriting rewinds the baseline, so the next genuine
  -- ping is compared against a position the vehicle already left.
  if t <= prev_t then return 0 end

  local dt = t - prev_t
  -- Equirectangular approximation: exact enough below a few kilometres and
  -- far cheaper than haversine at this call rate.
  local x = math.rad(lon - prev_lon) * math.cos(math.rad((lat + prev_lat) / 2))
  local y = math.rad(lat - prev_lat)
  local dm = 6371000 * math.sqrt(x * x + y * y)

  -- OR, not AND. Time alone loses a vehicle that accelerated away inside
  -- the window; distance alone never emits for a parked vehicle, so a
  -- consumer cannot tell parked from disconnected.
  if dt < min_s and dm < min_m then return 0 end
end

redis.call('SET', KEYS[1], ARGV[1] .. '|' .. ARGV[2] .. '|' .. ARGV[3], 'EX', ttl)
return 1
"""


class SlidingWindowDeduplicator:
    def __init__(self, client: redis.Redis) -> None:
        self._script = client.register_script(_SLIDING)

    async def accept(self, asset_id: str, epoch: float,
                     lat: float, lon: float) -> bool:
        """True if this ping should be processed; False if it is a duplicate."""
        result = await self._script(
            keys=[f"slide:{asset_id}"],
            args=[epoch, lat, lon, MIN_SECONDS, MIN_METRES, STATE_TTL],
        )
        return bool(result)
```

The `t <= prev_t` guard is the part that is easy to leave out and hard to notice missing. Without it a late ping suppresses correctly but still writes, so the baseline moves backwards and the *next* ping — a genuine one — is compared against stale state.

<figure class="fig">
<svg viewBox="0 0 760 224" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The four outcomes of comparing a ping against the last accepted one, on time and distance axes">
<title>Four quadrants, and only one of them suppresses</title>
<desc>Each incoming ping is placed on two axes: seconds elapsed since the last accepted ping, and metres moved since it. The lower-left quadrant — less than sixty seconds and less than twenty-five metres — is the only region that suppresses, and it corresponds to a vehicle that has neither waited nor moved, which is either a redelivery or a stationary asset reporting again. The upper-left quadrant is a vehicle that moved far in little time, which is exactly the acceleration case a time-only rule would wrongly suppress. The lower-right is a parked vehicle whose heartbeat interval has elapsed, admitted so that a consumer can distinguish parked from disconnected — a distance-only rule would never emit here and a dwell-time consumer would see the vehicle vanish. The upper-right is unambiguous movement. Using OR rather than AND is what makes only the lower-left suppress; using AND would suppress three of the four quadrants and lose most of the stream.</desc>
<rect x="0" y="0" width="760" height="224" fill="var(--fig-bg)"/>
<line x1="90" y1="180" x2="470" y2="180" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="90" y1="30" x2="90" y2="180" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="240" y1="30" x2="240" y2="180" stroke="var(--fig-line-soft)" stroke-width="1.2" stroke-dasharray="3 3"/>
<line x1="90" y1="110" x2="470" y2="110" stroke="var(--fig-line-soft)" stroke-width="1.2" stroke-dasharray="3 3"/>
<text x="228" y="196" font-size="8" fill="var(--fig-ink-soft)">60 s</text>
<text x="300" y="196" font-size="8.5" fill="var(--fig-ink-soft)">seconds since last accepted →</text>
<text x="34" y="106" font-size="8" fill="var(--fig-ink-soft)">25 m</text>
<text x="14" y="46" font-size="8.5" fill="var(--fig-ink-soft)">metres</text>
<text x="14" y="58" font-size="8.5" fill="var(--fig-ink-soft)">moved ↑</text>
<rect x="92" y="112" width="146" height="66" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="100" y="134" font-size="8.5" font-weight="600" fill="var(--fig-ink)">SUPPRESS</text>
<text x="100" y="150" font-size="8" fill="var(--fig-ink-soft)">neither waited</text>
<text x="100" y="162" font-size="8" fill="var(--fig-ink-soft)">nor moved</text>
<rect x="92" y="32" width="146" height="76" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="100" y="54" font-size="8.5" font-weight="600" fill="var(--fig-ink)">admit</text>
<text x="100" y="70" font-size="8" fill="var(--fig-ink-soft)">accelerated away</text>
<text x="100" y="82" font-size="8" fill="var(--fig-mint-edge)">time-only would lose this</text>
<rect x="242" y="112" width="226" height="66" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="250" y="134" font-size="8.5" font-weight="600" fill="var(--fig-ink)">admit</text>
<text x="250" y="150" font-size="8" fill="var(--fig-ink-soft)">parked heartbeat — lets a consumer</text>
<text x="250" y="162" font-size="8" fill="var(--fig-mint-edge)">tell parked from disconnected</text>
<rect x="242" y="32" width="226" height="76" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="250" y="54" font-size="8.5" font-weight="600" fill="var(--fig-ink)">admit</text>
<text x="250" y="70" font-size="8" fill="var(--fig-ink-soft)">unambiguous movement</text>
<rect x="492" y="40" width="254" height="138" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.4"/>
<text x="504" y="62" font-size="9.5" font-weight="600" fill="var(--fig-ink)">why OR and not AND</text>
<text x="504" y="84" font-size="8.5" fill="var(--fig-ink-soft)">OR suppresses one quadrant — the one</text>
<text x="504" y="96" font-size="8.5" fill="var(--fig-ink-soft)">that carries no new information</text>
<text x="504" y="118" font-size="8.5" fill="var(--fig-rose-edge)">AND would suppress three of four,</text>
<text x="504" y="130" font-size="8.5" fill="var(--fig-rose-edge)">discarding most of the stream</text>
<text x="504" y="152" font-size="8.5" fill="var(--fig-ink-soft)">The operator is the whole design; the</text>
<text x="504" y="164" font-size="8.5" fill="var(--fig-ink-soft)">two thresholds are just tuning.</text>
</svg>
<figcaption><b>Figure 2.</b> Swapping the <code>and</code> for an <code>or</code> in the Lua script is a one-character change that turns a working deduplicator into a filter discarding three quarters of the stream.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `MIN_SECONDS` | `float` | The stationary heartbeat interval; below the consumer's staleness tolerance | `60.0` |
| `MIN_METRES` | `float` | Above measured GPS jitter, below the shortest movement that matters | `25.0` |
| `STATE_TTL` | `int` | The sender's full retry ladder, not the window | `21600` |
| Distance formula | — | Equirectangular; error under 0.5% below ~5 km, so unusable for long gaps | — |
| Combining operator | — | `OR` — `AND` discards three of the four quadrants | `OR` |
| `t <= prev_t` guard | — | Suppress **and** do not write, or the baseline rewinds | — |

</div>

## Gotchas and spatial edge cases

1. **The equirectangular approximation degrades over long gaps.** It is accurate below a few kilometres and increasingly wrong beyond that, especially at high latitude. For a deduplication threshold of tens of metres this never matters — but if someone later reuses the same script with a five-kilometre threshold, it does. Keep the threshold and the formula documented together.

2. **A vehicle crossing the antimeridian produces a longitude difference of 360 degrees.** The subtraction gives an enormous distance, so the ping is admitted. That is the safe direction — a false admission rather than a false suppression — but it means the metric for suppression rate will show a spike for any fleet operating in the Pacific.

3. **One key per asset means memory scales with the active fleet, not with events.** That is the mechanism's main advantage over a bucket-per-window scheme, and it depends on the TTL actually being set on every write; the `EX` in the script is what stops a churning fleet leaking keys forever.

4. **`register_script` uses `EVALSHA` with a fallback, which matters across a restart.** After a Redis restart the script cache is empty and the first call falls back to `EVAL`; that is handled by the client, but a proxy that does not implement `SCRIPT LOAD` correctly will fail every call. Test against the deployment topology, not against a local Redis.

5. **The record is a comparison baseline, not an audit log.** It holds only the last accepted ping, so it cannot answer "how many were suppressed" — that needs a counter, and the ratio of suppressed to accepted per asset is the signal that catches a device stuck reporting a cached fix.

6. **This suppresses re-observation, not redelivery of an already-accepted ping.** A redelivery arriving with the same timestamp is caught by `t <= prev_t`, but one arriving after a genuinely newer ping is not — that needs the identity key from [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) alongside this window.

## Verification

```python
import pytest

BASE = 1_780_000_000.0
LAT, LON = 52.5200087, 13.4049547


@pytest.mark.asyncio
async def test_boundary_pair_collapses(dedup):
    """The failure the tumbling scheme has, four seconds apart."""
    assert await dedup.accept("veh-1", BASE, LAT, LON) is True
    assert await dedup.accept("veh-1", BASE + 4, LAT, LON) is False


@pytest.mark.asyncio
async def test_movement_inside_the_window_is_admitted(dedup):
    """Distance is an OR, so acceleration is not suppressed."""
    await dedup.accept("veh-2", BASE, LAT, LON)
    assert await dedup.accept("veh-2", BASE + 5, LAT + 0.002, LON) is True


@pytest.mark.asyncio
async def test_parked_vehicle_still_heartbeats(dedup):
    """Time is an OR too, so a stationary asset is not silent forever."""
    await dedup.accept("veh-3", BASE, LAT, LON)
    assert await dedup.accept("veh-3", BASE + 30, LAT, LON) is False
    assert await dedup.accept("veh-3", BASE + 61, LAT, LON) is True


@pytest.mark.asyncio
async def test_late_ping_does_not_rewind_the_baseline(dedup):
    """The guard that is easy to omit and hard to notice missing."""
    await dedup.accept("veh-4", BASE + 100, LAT, LON)
    assert await dedup.accept("veh-4", BASE, LAT, LON) is False       # late
    # If the late ping had overwritten the record, this would be admitted.
    assert await dedup.accept("veh-4", BASE + 130, LAT, LON) is False
```

The last test is the one that distinguishes a correct implementation from one that merely returns the right boolean. Both suppress the late ping; only the correct one still has the right baseline afterwards.

## Related

- [Time-Windowed Deduplication for Moving Assets](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/) — the topic this guide belongs to, and the tumbling alternative
- [Sizing a Deduplication Window from Report Intervals](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/sizing-a-dedup-window-from-report-intervals/) — where the two thresholds come from
- [Expiring Deduplication Keys Without Losing Late Retries](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/expiring-dedup-keys-without-losing-late-retries/) — sizing the TTL that the script sets
- [Using Redis to Cache Spatial Webhook Signatures](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/) — the same store, used for the identity half of the problem
