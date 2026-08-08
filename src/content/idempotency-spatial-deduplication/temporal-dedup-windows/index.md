---
title: "Time-Windowed Deduplication for Moving Assets"
description: "Content hashing cannot deduplicate a moving asset, because every ping is genuinely different. Window the stream by asset and time instead: pick the window shape, size it from the report interval, and expire keys without losing late retries."
slug: "temporal-dedup-windows"
type: "topic"
breadcrumb: "Idempotency & Spatial Deduplication > Time-Windowed Deduplication for Moving Assets"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Time-Windowed Deduplication for Moving Assets",
      "description": "A moving asset emits a stream in which no two events are byte-identical, so content-hash deduplication suppresses nothing. This topic covers choosing a window shape, deriving its size from the measured report interval, and expiring keys in a way that survives a provider's full retry ladder.",
      "url": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/",
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
        {"@type": "ListItem", "position": 3, "name": "Time-Windowed Deduplication for Moving Assets", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Deduplicate a moving-asset stream with time windows",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Separate redelivery from re-observation before choosing any key"},
        {"@type": "HowToStep", "position": 2, "name": "Pick a window shape that matches how the asset reports"},
        {"@type": "HowToStep", "position": 3, "name": "Derive the window size from the measured report interval"},
        {"@type": "HowToStep", "position": 4, "name": "Set the key TTL from the retry horizon, not from the window"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does content hashing fail for vehicle telemetry?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because a moving asset never sends the same content twice. Each ping carries a new timestamp and, usually, a slightly different position, so the digest of the payload changes on every message and the deduplication store never registers a hit. The duplicates that matter in a telemetry stream are not identical payloads but redeliveries of the same observation and re-reports of a stationary asset, and neither is visible to a hash over the whole payload."}
        },
        {
          "@type": "Question",
          "name": "Should the deduplication window be tumbling or sliding?",
          "acceptedAnswer": {"@type": "Answer", "text": "Tumbling for suppressing duplicate observations at a fixed cadence, sliding for suppressing bursts. A tumbling window is a quantised timestamp in the key, which is cheap and stateless but admits two events on either side of a boundary that are milliseconds apart. A sliding window compares against the last accepted event for that asset, which suppresses boundary pairs correctly but requires storing that last event. Most telemetry pipelines want tumbling for the common case and a sliding check only on the streams where boundary duplicates were actually observed."}
        },
        {
          "@type": "Question",
          "name": "How long should a deduplication key live?",
          "acceptedAnswer": {"@type": "Answer", "text": "Longer than the sending system's complete retry ladder, plus its outage tolerance. The TTL exists to catch a redelivery, and a redelivery can arrive at the end of a provider's backoff schedule hours after the original. Sizing the TTL from the deduplication window instead is the most common cause of admitted duplicates: a five-minute window with a five-minute TTL will expire a key well before a provider on a six-hour ladder has finished retrying it."}
        },
        {
          "@type": "Question",
          "name": "What happens to events that arrive out of order?",
          "acceptedAnswer": {"@type": "Answer", "text": "A window keyed on the event's own occurred-at timestamp handles them correctly, because the event lands in the window it belongs to regardless of when it arrived. A window keyed on arrival time does not: a ping delayed by an hour is bucketed into the current window, where it can suppress a genuinely newer observation. Always quantise the timestamp the device recorded, never the one the receiver stamped."}
        },
        {
          "@type": "Question",
          "name": "Does a stationary asset need a different rule?",
          "acceptedAnswer": {"@type": "Answer", "text": "It needs the position component of the key quantised, not removed. A parked vehicle reports GPS jitter of a few metres indefinitely, which is movement to a coordinate comparison and noise to a human. Snapping the position to a grid cell — an H3 cell at a resolution matching the jitter, or coordinates rounded to a fixed precision — collapses that jitter into one key so the repeated reports deduplicate, while a real departure crosses into a new cell and is admitted."}
        }
      ]
    }
  ]
}
</script>

**Deduplicating a moving asset cannot be done by hashing its payloads, because a moving asset never sends the same payload twice — the key has to be the asset plus a quantised time bucket plus a quantised position, and the store's TTL has to outlive the sender's entire retry ladder rather than the window it was derived from.**

This topic sits under [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/), which covers how a spatial pipeline recognises an event it has already handled. The deterministic keying described in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) is the right tool for edits to a feature that has an identity of its own; this page is about the case it does not cover, where the "same" event is defined by a period of time rather than by its content, and where [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/) is too expensive to run per ping.

---

## Prerequisites

- [ ] **Python 3.11+** — `datetime.UTC` and the `timeout` context manager are used below
- [ ] **Redis 6+ with `SET NX PX`** — an atomic set-if-absent with expiry is the whole primitive
- [ ] **`h3` 4.x** — for the position quantisation described under window shape
- [ ] **A device-recorded timestamp in the payload** — not just the receiver's arrival time
- [ ] **A measured report interval** — the distribution, not the vendor's nominal figure
- [ ] **The sending system's published retry schedule** — the TTL floor comes from this

---

## Redelivery, re-observation and jitter are three different duplicates

The word "duplicate" covers three distinct events in a telemetry stream, and a scheme that suppresses one will happily admit the other two.

A **redelivery** is the same observation arriving twice, because a webhook receiver returned 500, or timed out after having committed, or because the broker rebalanced mid-batch. Byte-identical, and the only one a content hash catches.

A **re-observation** is the device reporting again at its normal cadence. Genuinely new information, and suppressing it is data loss — unless the cadence is far higher than the consumer needs, in which case deliberately collapsing several reports into one per window is the point of the exercise.

**Jitter** is a stationary asset reporting positions that differ by a few metres because GPS is not exact. New content, no new information, and unbounded in volume: a parked fleet of five hundred vehicles reporting every ten seconds produces four million events a day that say nothing.

<figure class="fig">
<svg viewBox="0 0 760 244" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Three kinds of duplicate in a telemetry stream and which deduplication scheme catches each">
<title>Three duplicates, three different keys</title>
<desc>A vehicle telemetry stream contains three things that get called duplicates. A redelivery is the same observation arriving twice with identical bytes, and a content hash over the payload catches it. A re-observation is the device reporting again on schedule, with a new timestamp and a new position, which no content hash will ever match because the content genuinely differs; suppressing it requires a time-quantised key, and is only correct when the report cadence exceeds what the consumer needs. Jitter is a stationary asset reporting positions that differ by a few metres of GPS noise, which is again new content and no new information; suppressing it requires quantising position onto a grid so the noise collapses into one cell. A scheme built for any one of the three admits the other two, which is why a pipeline that added content hashing and still sees duplicates has usually diagnosed the wrong duplicate.</desc>
<rect x="0" y="0" width="760" height="244" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-ink)">What "duplicate" means in a moving-asset stream</text>
<rect x="14" y="30" width="732" height="62" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="49" font-size="9.5" font-weight="600" fill="var(--fig-ink)">redelivery — the same observation, twice</text>
<text x="26" y="66" font-size="9" fill="var(--fig-ink-soft)">identical bytes · a 500, a timeout after commit, a consumer rebalance mid-batch</text>
<text x="26" y="82" font-size="9" fill="var(--fig-mint-edge)">caught by a content hash — the only one that is</text>
<rect x="14" y="100" width="732" height="62" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="26" y="119" font-size="9.5" font-weight="600" fill="var(--fig-ink)">re-observation — the device reporting again on schedule</text>
<text x="26" y="136" font-size="9" fill="var(--fig-ink-soft)">new timestamp, new position · genuinely new information</text>
<text x="26" y="152" font-size="9" fill="var(--fig-gold-edge)">needs a time-quantised key, and only when the cadence exceeds what is needed</text>
<rect x="14" y="170" width="732" height="62" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="189" font-size="9.5" font-weight="600" fill="var(--fig-ink)">jitter — a stationary asset, moving by a few metres of GPS noise</text>
<text x="26" y="206" font-size="9" fill="var(--fig-ink-soft)">new content, no new information · unbounded volume from a parked fleet</text>
<text x="26" y="222" font-size="9" fill="var(--fig-rose-edge)">needs position quantised onto a grid before it enters the key</text>
</svg>
<figcaption><b>Figure 1.</b> A pipeline that added content hashing and still sees duplicates has usually diagnosed the wrong one of these three. Each needs a different component in the key.</figcaption>
</figure>

The practical consequence is that a moving-asset key has three parts rather than one: **who** (the asset identifier), **when** (the observation time, quantised), and **where** (the position, quantised). Redelivery is caught because all three parts are identical. Re-observation inside the same bucket is caught because the quantised time matches. Jitter is caught because the quantised position matches. A real departure produces a new cell and is admitted immediately, without waiting for the window to close.

---

## Architecture: four layers from ping to accepted observation

**Layer 1 — normalise.** Parse the device timestamp into an aware UTC datetime and reproject the position to EPSG:4326 if the device reports in a local grid, following [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/). A key built over inconsistent CRS or naive timestamps deduplicates nothing.

**Layer 2 — quantise.** Snap the timestamp to a window boundary and the position to a grid cell. Both quantisations are part of the contract: changing either invalidates every key already in the store.

**Layer 3 — claim.** Attempt an atomic set-if-absent against Redis with a TTL. The return value is the decision: the claim succeeded and this is the first sighting, or it failed and the observation is a duplicate.

**Layer 4 — record.** Increment a counter labelled by the reason for suppression, so the ratio of jitter to redelivery is observable rather than inferred. This feeds the freshness signals in [Consumer Lag & Partition Skew Monitoring](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/).

<figure class="fig">
<svg viewBox="0 0 760 262" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Tumbling, sliding and session windows applied to the same sequence of vehicle pings">
<title>The same pings under three window shapes</title>
<desc>Six pings from one vehicle are shown on a timeline, two of them falling a few seconds apart but on opposite sides of a five-minute boundary. Under a tumbling window the boundary is fixed on the clock, so those two pings land in different buckets and both are admitted even though they are seconds apart — the scheme is stateless and cheap, and this is the price. Under a sliding window each ping is compared against the last accepted ping for that asset, so the pair is correctly collapsed, at the cost of storing the last accepted timestamp per asset and reading it on every event. Under a session window a gap longer than a chosen idle period opens a new session, which suppresses a burst of any length while still admitting the first ping after the vehicle has been quiet — the right shape for assets that report irregularly, in bursts, when they have connectivity rather than on a clock.</desc>
<rect x="0" y="0" width="760" height="262" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one vehicle, six pings — two of them 4 s apart across a 5-minute boundary</text>
<text x="14" y="42" font-size="9.5" font-weight="600" fill="var(--fig-gold-edge)">tumbling · quantise the clock</text>
<line x1="14" y1="62" x2="746" y2="62" stroke="var(--fig-line-soft)" stroke-width="1"/>
<line x1="380" y1="50" x2="380" y2="74" stroke="var(--fig-line)" stroke-width="1.4" stroke-dasharray="3 3"/>
<circle cx="70" cy="62" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<circle cx="200" cy="62" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<circle cx="368" cy="62" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<circle cx="392" cy="62" r="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<circle cx="540" cy="62" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<circle cx="660" cy="62" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="400" y="82" font-size="8.5" fill="var(--fig-rose-edge)">new bucket, so admitted — 4 s after the previous one</text>
<text x="14" y="112" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">sliding · compare against the last accepted ping</text>
<line x1="14" y1="132" x2="746" y2="132" stroke="var(--fig-line-soft)" stroke-width="1"/>
<circle cx="70" cy="132" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<circle cx="200" cy="132" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<circle cx="368" cy="132" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<circle cx="392" cy="132" r="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<circle cx="540" cy="132" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<circle cx="660" cy="132" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="400" y="152" font-size="8.5" fill="var(--fig-ink-soft)">correctly suppressed — costs one read and one write per asset</text>
<text x="14" y="182" font-size="9.5" font-weight="600" fill="var(--fig-peach-edge)">session · a gap longer than the idle period opens a new session</text>
<line x1="14" y1="202" x2="746" y2="202" stroke="var(--fig-line-soft)" stroke-width="1"/>
<rect x="60" y="192" width="150" height="20" rx="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.2"/>
<rect x="358" y="192" width="44" height="20" rx="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.2"/>
<rect x="530" y="192" width="140" height="20" rx="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.2"/>
<text x="216" y="207" font-size="8" fill="var(--fig-ink-soft)">idle gap</text>
<text x="408" y="207" font-size="8" fill="var(--fig-ink-soft)">idle gap</text>
<text x="14" y="230" font-size="9" fill="var(--fig-ink-soft)">Sessions suppress a burst of any length and still admit the first ping after quiet — the right shape for devices that</text>
<text x="14" y="243" font-size="9" fill="var(--fig-ink-soft)">report when they have connectivity rather than on a clock.</text>
</svg>
<figcaption><b>Figure 2.</b> The boundary pair is the whole argument for sliding windows, and the reason tumbling is nonetheless the default: it costs one write and no reads, and a duplicate admitted every five minutes per asset is often cheaper than a read on every event.</figcaption>
</figure>

---

## Step-by-step implementation

### Step 1 — Build the three-part key

The key names an asset, a bucket and a cell. Nothing else belongs in it: adding speed or heading reintroduces exactly the sensitivity to noise the quantisation removed.

```python
import hashlib
from datetime import datetime, UTC

import h3

WINDOW_SECONDS = 300      # tumbling bucket width; part of the contract
CELL_RESOLUTION = 12      # H3 res 12 ≈ 9 m edge — above typical GPS jitter


def window_key(asset_id: str, occurred_at: datetime, lat: float, lon: float) -> str:
    """Key one observation to (asset, time bucket, grid cell).

    occurred_at MUST be the device's own timestamp. Using arrival time buckets
    a delayed ping into the current window, where it can suppress a genuinely
    newer observation that has not been seen yet.
    """
    if occurred_at.tzinfo is None:
        raise ValueError("occurred_at must be timezone-aware")

    epoch = int(occurred_at.astimezone(UTC).timestamp())
    bucket = epoch - (epoch % WINDOW_SECONDS)
    cell = h3.latlng_to_cell(lat, lon, CELL_RESOLUTION)

    raw = f"{asset_id}|{bucket}|{cell}"
    return "dedup:" + hashlib.blake2b(raw.encode(), digest_size=16).hexdigest()
```

The floor division is what makes the bucket stateless: two processes handling the same ping compute the same boundary without coordinating, which is the property that lets the deduplication run on every consumer rather than on a designated one.

### Step 2 — Claim the key atomically

The claim and the check are one operation. Reading first and writing second is a race that admits duplicates precisely when the stream is busiest, which is when redeliveries are most likely.

```python
import redis.asyncio as redis

TTL_SECONDS = 6 * 3600    # from the retry horizon — see Step 3


class WindowedDeduplicator:
    def __init__(self, client: redis.Redis, ttl: int = TTL_SECONDS) -> None:
        self._client = client
        self._ttl = ttl

    async def claim(self, key: str) -> bool:
        """True if this is the first sighting; False if it is a duplicate.

        SET NX PX is a single round trip and is atomic across every consumer,
        so two workers handed the same redelivery cannot both win the claim.
        """
        won = await self._client.set(key, b"1", nx=True, px=self._ttl * 1000)
        return bool(won)
```

`SET NX PX` returns `True` only for the writer that created the key. Every other caller — another worker, a retry, the same ping arriving from a second broker partition — gets `False` and stops. The TTL is set in the same command, so there is no window in which a key exists without an expiry, which is how deduplication stores turn into unbounded memory.

### Step 3 — Size the TTL from the retry horizon

The TTL and the window are unrelated numbers and conflating them is the most common failure in this design. The window says how much re-observation to collapse. The TTL says how long a redelivery can still arrive.

<figure class="fig">
<svg viewBox="0 0 760 216" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A provider retry ladder plotted against two TTL choices, one derived from the window and one from the retry horizon">
<title>The TTL has to outlive the ladder, not the window</title>
<desc>A provider's retry ladder is plotted along a timeline: attempts at one minute, five minutes, thirty minutes, two hours and six hours after the original delivery. A TTL derived from the five-minute deduplication window expires the key after the second attempt, so the third, fourth and fifth attempts all find an empty store, win the claim, and are written as new observations — one logical event becoming four records, and the failure appears hours after the deploy that caused it, in a stream that looked correct all afternoon. A TTL derived from the retry horizon covers the full ladder with margin, so every attempt after the first loses the claim. The window and the TTL answer different questions and there is no reason for them to be the same number.</desc>
<rect x="0" y="0" width="760" height="216" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="10" font-weight="600" fill="var(--fig-ink)">provider retry ladder for one failed delivery</text>
<line x1="30" y1="52" x2="730" y2="52" stroke="var(--fig-line)" stroke-width="1.2"/>
<circle cx="30" cy="52" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="20" y="40" font-size="8" fill="var(--fig-ink-soft)">0</text>
<circle cx="120" cy="52" r="4.5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="110" y="40" font-size="8" fill="var(--fig-ink-soft)">1 m</text>
<circle cx="250" cy="52" r="4.5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="240" y="40" font-size="8" fill="var(--fig-ink-soft)">5 m</text>
<circle cx="400" cy="52" r="4.5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="386" y="40" font-size="8" fill="var(--fig-ink-soft)">30 m</text>
<circle cx="560" cy="52" r="4.5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="550" y="40" font-size="8" fill="var(--fig-ink-soft)">2 h</text>
<circle cx="700" cy="52" r="4.5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="690" y="40" font-size="8" fill="var(--fig-ink-soft)">6 h</text>
<rect x="30" y="72" width="240" height="42" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="42" y="89" font-size="9" font-weight="600" fill="var(--fig-ink)">TTL = window (5 min)</text>
<text x="42" y="105" font-size="8.5" fill="var(--fig-rose-edge)">key gone before attempt 3</text>
<text x="284" y="97" font-size="9" fill="var(--fig-rose-edge)">attempts 3, 4 and 5 all find an empty store and win the claim — one event, four records</text>
<rect x="30" y="126" width="700" height="42" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="42" y="143" font-size="9" font-weight="600" fill="var(--fig-ink)">TTL = retry horizon + margin (6 h 30 m)</text>
<text x="42" y="159" font-size="8.5" fill="var(--fig-mint-edge)">every attempt after the first loses the claim, including the one six hours later</text>
<text x="14" y="188" font-size="9" fill="var(--fig-ink-soft)">The window says how much re-observation to collapse. The TTL says how long a redelivery can still arrive. Deriving one</text>
<text x="14" y="201" font-size="9" fill="var(--fig-ink-soft)">from the other produces a store that is correct all afternoon and wrong at the end of a provider's ladder.</text>
</svg>
<figcaption><b>Figure 3.</b> The duplicates this mistake admits are invisible in testing: they need a failed delivery plus a long ladder, so they first appear in production, hours after the deploy.</figcaption>
</figure>

Take the sending system's documented schedule, sum it, and add the longest outage you intend to survive without duplicates. If the provider does not publish one, measure it: the gap between the first and last delivery attempt of a deliberately failed event is the number you need. The retry ladders themselves are covered in [Exponential Backoff & Jitter for Spatial Webhooks](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/).

### Step 4 — Wire it into the handler

```python
from fastapi import FastAPI, Response
from pydantic import BaseModel, Field

app = FastAPI()


class Ping(BaseModel):
    asset_id: str
    occurred_at: datetime
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


@app.post("/telemetry")
async def receive(ping: Ping, dedup: WindowedDeduplicator) -> Response:
    key = window_key(ping.asset_id, ping.occurred_at, ping.lat, ping.lon)

    if not await dedup.claim(key):
        # 200, not 409: the sender did nothing wrong and must not retry.
        return Response(status_code=200, headers={"X-Dedup": "suppressed"})

    await process(ping)
    return Response(status_code=200, headers={"X-Dedup": "accepted"})
```

Returning 200 for a suppressed duplicate matters. A 409 tells the sender its delivery failed, and a sender that believes a delivery failed retries it — turning every suppression into a fresh round of the ladder, which is the opposite of what deduplication is for.

---

## Spatial validation and error handling

**Reject naive timestamps rather than assuming UTC.** A device reporting local time without an offset produces buckets shifted by the timezone, which deduplicates against the wrong hour. The `ValueError` in `window_key` is deliberate: an event that cannot be bucketed correctly belongs in the dead-letter path described in [Dead-Letter Queues for Spatial Events](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/), not in the stream.

**Validate the coordinate before quantising it.** `h3.latlng_to_cell` accepts a latitude of 91 in some bindings and produces a cell that no real position maps to, so a corrupt reading gets its own key and passes deduplication forever. The Pydantic bounds above catch it at the edge.

**Treat a null island reading as invalid.** A position of exactly (0, 0) is almost always a GPS module reporting before it has a fix. It quantises to one cell shared by every unfixed device in the fleet, so if the asset identifier were ever dropped from the key those readings would deduplicate against each other. Filter them before keying.

**Decide what a Redis outage means.** Failing open admits duplicates; failing closed drops observations. For telemetry, failing open is almost always correct — a duplicate position is recoverable downstream and a lost one is not — but it must be a decision with a metric behind it, not a bare `except`.

---

## Retry, backoff and delivery guarantees

Time-windowed deduplication gives at-most-once semantics inside the window and at-least-once across it, which is the correct trade for telemetry and the wrong one for financial or cadastral events. The asymmetry is deliberate: losing one position from a stream that produces another in ten seconds costs nothing, while double-counting a boundary crossing produces a phantom trip.

The interaction with retries is subtle. A consumer that claims the key, then fails while processing, has consumed its own idempotency: the retry finds the key present and suppresses an observation that was never handled. Two ways out, and the choice depends on how expensive the work is:

- **Claim after processing.** Simple, and admits duplicates when two workers process concurrently.
- **Claim before, release on failure.** Delete the key in an exception handler so the retry can re-claim it. Correct, and requires the delete to be reliable — a worker killed between claim and failure leaves the key behind, so the TTL remains the backstop.

The second is what most pipelines want, and it composes with the idempotent-consumer pattern in [Idempotent Consumers for Out-of-Order Spatial Events](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/idempotent-consumers-for-out-of-order-spatial-events/).

---

## Verification

The property to test is not "duplicates are suppressed" but "the right duplicates are suppressed". Three cases, and a scheme that passes the first two while failing the third is the usual outcome of tuning by hand.

```python
from datetime import datetime, timedelta, UTC

BASE = datetime(2026, 8, 8, 12, 0, 0, tzinfo=UTC)


def test_redelivery_collapses():
    """Identical observation, twice — must produce one key."""
    a = window_key("veh-88", BASE, 52.5200087, 13.4049547)
    b = window_key("veh-88", BASE, 52.5200087, 13.4049547)
    assert a == b


def test_jitter_while_parked_collapses():
    """Five metres of GPS noise is inside one res-12 cell."""
    a = window_key("veh-88", BASE, 52.5200087, 13.4049547)
    b = window_key("veh-88", BASE + timedelta(seconds=20), 52.5200410, 13.4049920)
    assert a == b


def test_real_movement_is_admitted():
    """A vehicle that has actually left must not be suppressed."""
    a = window_key("veh-88", BASE, 52.5200087, 13.4049547)
    b = window_key("veh-88", BASE + timedelta(seconds=20), 52.5241000, 13.4102000)
    assert a != b


def test_two_assets_never_share_a_key():
    """The asset id must dominate — two vehicles in one cell are two events."""
    a = window_key("veh-88", BASE, 52.5200087, 13.4049547)
    b = window_key("veh-91", BASE, 52.5200087, 13.4049547)
    assert a != b
```

The third test is the one that fails when the cell resolution is set too coarse. Resolution 12 has an edge of roughly nine metres; at resolution 8, with an edge near half a kilometre, a vehicle can cross a city block without leaving its cell and the pipeline reports it as parked. Sizing that resolution against measured jitter — rather than picking a round number — is covered in [Choosing an H3 Resolution from Measured Traffic](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/choosing-an-h3-resolution-from-measured-traffic/).

---

## Troubleshooting

<div class="table-scroll">

| Symptom | Likely spatial cause | Fix |
|---|---|---|
| Duplicates appear hours after deploy, never in testing | TTL derived from the window, expiring before the provider's last retry | Set the TTL from the summed retry ladder plus outage margin |
| A parked vehicle produces thousands of events a day | Position not quantised, so GPS jitter reads as movement | Snap to an H3 cell at a resolution above the measured jitter |
| A moving vehicle is reported as stationary | Cell resolution too coarse — real movement stays inside one cell | Raise the resolution until a typical inter-ping displacement crosses cells |
| Two pings seconds apart both admitted | Tumbling boundary fell between them | Add a sliding check against the last accepted ping on that stream |
| A delayed ping suppresses a newer one | Bucketing on arrival time rather than the device timestamp | Quantise `occurred_at`; never `now()` |
| Suppression rate jumps to 100% for one asset | Device stuck reporting a cached fix, or a null-island reading | Alert on per-asset suppression ratio, not just the fleet aggregate |
| Redis memory grows without bound | A code path writing keys without a TTL | Set the expiry in the same command as the write — `SET NX PX`, never `SET` then `EXPIRE` |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Why does content hashing fail for vehicle telemetry?</strong></summary>

Because a moving asset never sends the same content twice. Each ping carries a new timestamp and, usually, a slightly different position, so the digest of the payload changes on every message and the store never registers a hit. The duplicates that matter here are redeliveries of the same observation and re-reports of a stationary asset, and neither is visible to a hash over the whole payload.

</details>

<details class="faq">
<summary><strong>Should the deduplication window be tumbling or sliding?</strong></summary>

Tumbling for suppressing re-observation at a fixed cadence, sliding for suppressing bursts. A tumbling window is a quantised timestamp in the key, which is stateless and costs one write; the price is that two events milliseconds apart across a boundary are both admitted. A sliding window compares against the last accepted event for that asset, which handles the boundary correctly at the cost of a read on every event. Start tumbling, and add the sliding check only on streams where boundary duplicates were actually measured.

</details>

<details class="faq">
<summary><strong>How long should a deduplication key live?</strong></summary>

Longer than the sending system's complete retry ladder, plus whatever outage you intend to survive without admitting duplicates. Sizing the TTL from the window is the most common cause of admitted duplicates, because a five-minute window with a five-minute TTL expires the key long before a provider on a six-hour ladder has finished retrying.

</details>

<details class="faq">
<summary><strong>What happens to events that arrive out of order?</strong></summary>

A window keyed on the device's own timestamp handles them correctly — the event lands in the bucket it belongs to regardless of when it arrived. A window keyed on arrival time does not: a ping delayed by an hour is bucketed into the current window, where it can suppress a genuinely newer observation.

</details>

<details class="faq">
<summary><strong>Does a stationary asset need a different rule?</strong></summary>

It needs the position component quantised, not removed. Snapping to a grid cell sized above the jitter collapses the noise into one key so repeated reports deduplicate, while a real departure crosses into a new cell and is admitted at once, without waiting for the window to close.

</details>

---

## Related

- [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — the section this topic belongs to
- [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — deterministic keys for events that have an identity of their own
- [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) — the Redis-side mechanics of the claim, and what to do when the cache is unavailable
- [Spatial Overlap Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/spatial-overlap-deduplication/) — geometric near-duplicate detection, for when quantisation is too blunt
- [Exponential Backoff & Jitter for Spatial Webhooks](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/) — where the retry horizon that sets the TTL comes from
