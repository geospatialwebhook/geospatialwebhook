---
title: "Exponential Backoff & Jitter for Spatial Webhooks"
description: "Retry failed spatial webhook deliveries without retry storms: exponential backoff, full/equal/decorrelated jitter, retry budgets, and idempotent geometry writes."
slug: "exponential-backoff-jitter"
type: "guide"
breadcrumb: "Queue Management, Retries & Delivery Guarantees > Exponential Backoff & Jitter for Spatial Webhooks"
datePublished: "2025-02-10"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Exponential Backoff & Jitter for Spatial Webhooks",
      "description": "A production guide to retry timing for redelivering failed spatial webhook events: why constant retry causes thundering-herd storms, exponential backoff, the full/equal/decorrelated jitter variants, retry budgets, and pairing retries with idempotency so a retried geometry write never double-inserts.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/",
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
        {"@type": "ListItem", "position": 3, "name": "Exponential Backoff & Jitter for Spatial Webhooks", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Retry failed spatial webhook deliveries with exponential backoff and jitter",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Classify the failure as retryable or terminal before scheduling any retry"},
        {"@type": "HowToStep", "position": 2, "name": "Compute the next delay with decorrelated jitter capped at a ceiling"},
        {"@type": "HowToStep", "position": 3, "name": "Enforce a retry budget across all in-flight events"},
        {"@type": "HowToStep", "position": 4, "name": "Re-POST the GeoJSON payload under an idempotency key so a retry cannot double-insert"},
        {"@type": "HowToStep", "position": 5, "name": "Route exhausted events to a dead-letter queue and verify the backoff sequence bounds"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why do retries require idempotency for spatial payloads?",
          "acceptedAnswer": {"@type": "Answer", "text": "A retry happens precisely when the client is unsure the first attempt succeeded — a timeout or dropped connection can occur after the receiver has already written the geometry. Without an idempotency key, the retried POST re-inserts the same feature, producing duplicate polygons, double-counted areas, and corrupted spatial joins. Deriving a deterministic key from the normalised geometry and claiming it atomically before the write makes the retry a no-op instead of a duplicate."}
        },
        {
          "@type": "Question",
          "name": "Which jitter variant should I use for spatial webhook retries?",
          "acceptedAnswer": {"@type": "Answer", "text": "Decorrelated jitter is the best default for most spatial webhook fleets. Full jitter minimises collisions but can retry too eagerly right after a failure; equal jitter guarantees a minimum wait but clusters more tightly; decorrelated jitter walks the delay upward from the previous value, giving both wide spread and a rising floor. AWS load tests found full and decorrelated jitter complete a contended workload in the fewest total calls."}
        },
        {
          "@type": "Question",
          "name": "How do I tell a retryable failure from a non-retryable one?",
          "acceptedAnswer": {"@type": "Answer", "text": "Retry on transient transport and server faults: connection errors, read timeouts, and 5xx responses such as 502, 503, and 504, plus 429 (respecting Retry-After). Do not retry client faults: 400, 401, 403, 404, 409, 422, and any invalid-geometry rejection. A self-intersecting polygon will fail identically on every attempt, so retrying it only wastes the retry budget and delays routing it to a dead-letter queue for inspection."}
        },
        {
          "@type": "Question",
          "name": "What is a retry budget and why does it matter at fleet scale?",
          "acceptedAnswer": {"@type": "Answer", "text": "A retry budget caps retries as a fraction of successful requests — for example, no more than 10 percent additional load from retries. Without a budget, a downstream outage causes every event to exhaust its full retry ladder simultaneously, multiplying load exactly when the receiver is already failing. A token-bucket budget sheds retries once the ratio is exceeded, sending events straight to the dead-letter queue instead of amplifying the outage."}
        }
      ]
    }
  ]
}
</script>

**Exponential backoff with decorrelated jitter is the correct retry timing for redelivering failed spatial webhook events: it spreads retry attempts across time so a recovering receiver is not hit by a synchronised thundering herd, and — paired with an idempotency key derived from the geometry — it guarantees a retried write never double-inserts a feature.**

This topic sits under [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/), the section covering how spatial event pipelines move payloads reliably from producer to consumer. Retry timing is the first line of defence against transient failure; when retries are exhausted, events fall through to [Dead-Letter Queues for Spatial Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/), and the overall correctness contract is set by [Delivery Guarantees & Event Ordering](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/).

---

## Prerequisites

Confirm your stack meets this baseline before wiring retries into a spatial webhook dispatcher. Check off each item as you verify it:

- [ ] **Python 3.11+** — `asyncio.timeout()` and `tomllib` simplify per-attempt deadlines and config loading
- [ ] **`aiohttp` 3.9+** — the async HTTP client used to POST GeoJSON, with fine-grained `ClientTimeout` control
- [ ] **`shapely` 2.0+** — to validate geometry topology so invalid-geometry failures are classified as terminal, not retryable
- [ ] **`redis-py` 5.0+** (`redis.asyncio`) — for the idempotency claim that makes each retry safe, and for a shared retry-budget token bucket
- [ ] **A retry-window SLA from every downstream provider** — you cannot size backoff ceilings or TTLs without knowing how long the receiver stays down
- [ ] **A dead-letter sink** — a place to send events once the retry budget is exhausted, so nothing is silently dropped

---

## Why Constant and Linear Retry Fail at Scale

<figure class="fig">
<svg viewBox="0 0 760 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Retry arrival times for constant, plain exponential and decorrelated-jitter schedules after a synchronised failure">
<title>Retry arrivals after 8,000 events fail at the same instant</title>
<desc>Eight thousand in-flight deliveries fail together when a receiver drops at time zero, and the chart shows when their retries arrive. Constant retry every five seconds recreates the full eight-thousand-event spike at five, ten and fifteen seconds — the receiver is hit with its entire failed load the moment it starts recovering, and knocked over again. Plain exponential backoff without jitter moves the spikes later, to one, two, four and eight seconds, but does not spread them: every client computed the same delay from the same failure instant, so the herd stays synchronised and merely arrives in a different place. Decorrelated jitter draws each delay from a range that widens with the previous value, so the same eight thousand retries spread across the whole window at a few hundred per second, and the receiver sees a load it can absorb while recovering. The lesson is that backoff alone does not desynchronise anything; the randomness is what does, and exponential growth only decides how wide the range it draws from becomes.</desc>
<rect x="0" y="0" width="760" height="250" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">constant, every 5 s</text>
<line x1="150" y1="46" x2="700" y2="46" stroke="var(--fig-line)" stroke-width="1"/>
<rect x="196" y="22" width="8" height="24" fill="var(--fig-rose-edge)"/>
<rect x="346" y="22" width="8" height="24" fill="var(--fig-rose-edge)"/>
<rect x="496" y="22" width="8" height="24" fill="var(--fig-rose-edge)"/>
<text x="14" y="34" font-size="8.5" fill="var(--fig-rose-edge)">8,000 at once, ×3</text>
<text x="14" y="78" font-size="9.5" font-weight="600" fill="var(--fig-gold-edge)">exponential, no jitter</text>
<line x1="150" y1="106" x2="700" y2="106" stroke="var(--fig-line)" stroke-width="1"/>
<rect x="180" y="82" width="8" height="24" fill="var(--fig-gold-edge)"/>
<rect x="210" y="82" width="8" height="24" fill="var(--fig-gold-edge)"/>
<rect x="270" y="82" width="8" height="24" fill="var(--fig-gold-edge)"/>
<rect x="390" y="82" width="8" height="24" fill="var(--fig-gold-edge)"/>
<text x="14" y="94" font-size="8.5" fill="var(--fig-gold-edge)">later, still 8,000 at once</text>
<text x="14" y="138" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">decorrelated jitter</text>
<line x1="150" y1="176" x2="700" y2="176" stroke="var(--fig-line)" stroke-width="1"/>
<rect x="168" y="166" width="5" height="10" fill="var(--fig-mint-edge)"/>
<rect x="188" y="162" width="5" height="14" fill="var(--fig-mint-edge)"/>
<rect x="212" y="164" width="5" height="12" fill="var(--fig-mint-edge)"/>
<rect x="238" y="160" width="5" height="16" fill="var(--fig-mint-edge)"/>
<rect x="266" y="163" width="5" height="13" fill="var(--fig-mint-edge)"/>
<rect x="296" y="161" width="5" height="15" fill="var(--fig-mint-edge)"/>
<rect x="328" y="164" width="5" height="12" fill="var(--fig-mint-edge)"/>
<rect x="360" y="162" width="5" height="14" fill="var(--fig-mint-edge)"/>
<rect x="394" y="165" width="5" height="11" fill="var(--fig-mint-edge)"/>
<rect x="428" y="163" width="5" height="13" fill="var(--fig-mint-edge)"/>
<rect x="462" y="166" width="5" height="10" fill="var(--fig-mint-edge)"/>
<rect x="496" y="164" width="5" height="12" fill="var(--fig-mint-edge)"/>
<rect x="530" y="167" width="5" height="9" fill="var(--fig-mint-edge)"/>
<rect x="564" y="165" width="5" height="11" fill="var(--fig-mint-edge)"/>
<rect x="598" y="168" width="5" height="8" fill="var(--fig-mint-edge)"/>
<rect x="632" y="167" width="5" height="9" fill="var(--fig-mint-edge)"/>
<rect x="666" y="169" width="5" height="7" fill="var(--fig-mint-edge)"/>
<text x="14" y="154" font-size="8.5" fill="var(--fig-mint-edge)">a few hundred per second</text>
<text x="150" y="194" font-size="8.5" fill="var(--fig-ink-soft)">0 s</text>
<text x="350" y="194" font-size="8.5" fill="var(--fig-ink-soft)">10 s</text>
<text x="550" y="194" font-size="8.5" fill="var(--fig-ink-soft)">20 s</text>
<text x="400" y="212" text-anchor="middle" font-size="9" fill="var(--fig-ink-soft)">time since the receiver dropped 8,000 in-flight deliveries</text>
<rect x="14" y="222" width="732" height="24" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="26" y="238" font-size="9.5" fill="var(--fig-ink)">Backoff alone desynchronises nothing — every client computes the same delay from the same instant. The randomness is what spreads the herd.</text>
</svg>
<figcaption><b>Figure 1.</b> The middle row is the common mistake: exponential backoff without jitter moves the thundering herd rather than dispersing it. Exponential growth only widens the range the delay is drawn <em>from</em>.</figcaption>
</figure>

A single client retrying a single failed delivery at a fixed one-second interval is harmless. The danger is correlation. When a shared downstream — a tile server, a PostGIS writer, a routing engine — has a brief outage, every producer that was mid-delivery fails at nearly the same instant. If they all retry on the same fixed schedule, they retry *together*, in a synchronised wave. The receiver comes back up, is immediately hit by the entire backlog at once, tips over again, and the cycle repeats. This is the classic thundering-herd retry storm, and constant or linear backoff actively creates it because it preserves the alignment of the original failure.

Spatial workloads make this worse in three specific ways. First, individual requests are expensive: a webhook carrying a `MultiPolygon` triggers geometry validation, a spatial join, and often a tile invalidation, so a retry storm consumes far more receiver CPU per request than a plain JSON ping. Second, payloads are large — a dense boundary geometry is orders of magnitude bigger than a status event — so synchronised retries saturate bandwidth as well as CPU. Third, spatial events are frequently bursty by nature: a fleet of sensors crossing a region boundary emits correlated events, so the population that fails together is already clustered.

Exponential backoff breaks the synchronisation over *time* by making each successive delay grow multiplicatively (`base · 2^attempt`), which thins the retry rate as an outage lengthens. But pure exponential backoff alone does not break synchronisation *between clients*: a thousand producers that all failed at `t=0` and all use identical exponential delays still retry in lockstep, just at exponentially spaced instants. The fix is **jitter** — randomising each delay so the herd disperses across the interval instead of stacking on its edge.

---

## Architecture Blueprint

The retry path is a small state machine wrapped around a single HTTP POST. Every failure is classified before a delay is ever computed, every retry re-claims an idempotency key, and exhaustion has exactly one destination.

<figure class="fig">
<svg viewBox="0 8 719 290" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Retry state machine for spatial webhook delivery with jittered backoff and dead-letter exit">
  <title>Jittered retry state machine for spatial webhook delivery</title>
  <desc>Flow from an outbound GeoJSON POST through failure classification: terminal 4xx and invalid geometry exit immediately to the dead-letter queue, retryable 5xx and timeout compute a decorrelated-jitter delay under a retry budget and loop back to the POST, and success acknowledges.</desc>
  <rect x="0" y="8" width="719" height="290" fill="var(--fig-bg)"/>
  <defs>
    <marker id="bo-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- 1 POST -->
  <rect x="12" y="120" width="120" height="58" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="72" y="144" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">POST</text>
  <text x="72" y="159" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">GeoJSON</text>
  <text x="72" y="172" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">idempotency key</text>
  <line x1="132" y1="149" x2="162" y2="149" stroke="currentColor" stroke-width="1.5" marker-end="url(#bo-arr)" opacity="0.55"/>
  <!-- 2 Classify (diamond) -->
  <polygon points="240,110 320,149 240,188 160,149" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
  <text x="240" y="146" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Classify</text>
  <text x="240" y="160" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.75">outcome?</text>
  <!-- success up -->
  <line x1="240" y1="110" x2="240" y2="64" stroke="currentColor" stroke-width="1.2" marker-end="url(#bo-arr)" opacity="0.45" stroke-dasharray="4,3"/>
  <text x="240" y="54" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">2xx → ACK</text>
  <!-- terminal down to DLQ -->
  <line x1="240" y1="188" x2="240" y2="232" stroke="currentColor" stroke-width="1.5" marker-end="url(#bo-arr)" opacity="0.55"/>
  <text x="250" y="214" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">4xx / invalid geometry</text>
  <rect x="150" y="232" width="180" height="52" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="240" y="254" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Dead-Letter Queue</text>
  <text x="240" y="269" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">terminal + budget-exhausted</text>
  <!-- retryable right to backoff -->
  <line x1="320" y1="149" x2="360" y2="149" stroke="currentColor" stroke-width="1.5" marker-end="url(#bo-arr)" opacity="0.55"/>
  <text x="340" y="141" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">5xx / timeout</text>
  <!-- 3 budget (diamond) -->
  <polygon points="435,110 515,149 435,188 355,149" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
  <text x="435" y="146" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Budget</text>
  <text x="435" y="160" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.75">token left?</text>
  <!-- budget exhausted down to DLQ -->
  <line x1="435" y1="188" x2="435" y2="258" stroke="currentColor" stroke-width="1.2" marker-end="url(#bo-arr)" opacity="0.45" stroke-dasharray="4,3"/>
  <line x1="435" y1="258" x2="332" y2="258" stroke="currentColor" stroke-width="1.2" marker-end="url(#bo-arr)" opacity="0.45" stroke-dasharray="4,3"/>
  <text x="445" y="220" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">no → shed</text>
  <!-- budget ok to delay -->
  <line x1="515" y1="149" x2="555" y2="149" stroke="currentColor" stroke-width="1.5" marker-end="url(#bo-arr)" opacity="0.55"/>
  <!-- 4 delay -->
  <rect x="555" y="120" width="150" height="58" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="630" y="142" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Sleep delay</text>
  <text x="630" y="157" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">decorrelated jitter</text>
  <text x="630" y="170" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">min(cap, U(base, prev·3))</text>
  <!-- loop back to POST -->
  <line x1="630" y1="120" x2="630" y2="40" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
  <line x1="630" y1="40" x2="72" y2="40" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
  <line x1="72" y1="40" x2="72" y2="118" stroke="currentColor" stroke-width="1.5" marker-end="url(#bo-arr)" opacity="0.5"/>
  <text x="360" y="32" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">retry attempt n+1</text>
</svg>
<figcaption><b>Figure 2.</b> Jittered retry state machine for spatial webhook delivery</figcaption>
</figure>

**Layer breakdown:**

1. **Dispatch** — the payload is POSTed as GeoJSON under a stable idempotency key. The key is derived once and reused for every retry of the same event, so the receiver can recognise a redelivery.
2. **Classification** — the outcome is sorted into three buckets before any timing logic runs: success acknowledges and exits; a terminal fault (4xx or invalid geometry) goes straight to the dead-letter queue; a retryable fault (5xx, timeout, 429) proceeds to timing.
3. **Budget gate** — a shared token bucket decides whether the fleet can afford this retry. If the retry-to-success ratio is already too high, the event is shed to the dead-letter queue instead of amplifying an outage.
4. **Jittered delay** — a decorrelated-jitter delay, capped at a ceiling, is slept before looping back to dispatch for the next attempt.

---

## Step-by-Step Implementation

### Step 1 — Classify the Failure Before Scheduling Anything

Timing logic must never run for a failure that will never succeed. A `422` for a self-intersecting polygon is deterministic: it fails identically on attempt one and attempt fifty. Retrying it burns the budget and delays the moment a human sees it in the dead-letter queue.

```python
from dataclasses import dataclass
from enum import Enum, auto
import aiohttp


class Outcome(Enum):
    SUCCESS = auto()
    RETRYABLE = auto()   # transient: 5xx, timeout, connection reset, 429
    TERMINAL = auto()    # permanent: 4xx, invalid geometry — send to DLQ


# 4xx codes that must never be retried; a retry cannot change the result.
NON_RETRYABLE_STATUS = {400, 401, 403, 404, 409, 410, 422}
# 5xx and 429 are worth another attempt after a backoff delay.
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


def classify_response(status: int) -> Outcome:
    if 200 <= status < 300:
        return Outcome.SUCCESS
    if status in NON_RETRYABLE_STATUS:
        return Outcome.TERMINAL
    if status in RETRYABLE_STATUS or 500 <= status < 600:
        return Outcome.RETRYABLE
    # Unknown 4xx: treat as terminal so we fail fast rather than loop.
    return Outcome.TERMINAL


def classify_exception(exc: Exception) -> Outcome:
    # Transport faults are transient by nature and safe to retry.
    if isinstance(exc, (aiohttp.ClientConnectionError,
                        aiohttp.ServerTimeoutError,
                        TimeoutError)):
        return Outcome.RETRYABLE
    return Outcome.TERMINAL
```

Validate geometry topology *before* the POST so that an invalid ring is classified as terminal locally, never sent over the wire only to bounce back as a `422`. The topology check is the same `shapely` gate used across the pipeline; the CRS must carry its EPSG code (payloads default to EPSG:4326 (WGS84) per [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946)).

```python
from shapely.geometry import shape
from shapely.validation import explain_validity


def is_terminal_geometry(feature: dict) -> str | None:
    """Return a reason string if the geometry can never succeed, else None."""
    geom = shape(feature["geometry"])
    if geom.is_empty:
        return "empty geometry"
    if not geom.is_valid:
        return f"invalid topology: {explain_validity(geom)}"
    return None
```

### Step 2 — Compute the Delay with Decorrelated Jitter

The three jitter strategies differ in how they draw the random delay for attempt `n`, given a `base`, a `cap`, and (for decorrelated) the previous delay:

- **Full jitter** — `delay = uniform(0, min(cap, base · 2^n))`. Widest spread, lowest collision probability, but can retry almost immediately after a failure.
- **Equal jitter** — `half = min(cap, base · 2^n) / 2; delay = half + uniform(0, half)`. Guarantees a minimum wait, so no retry lands too early, at the cost of a narrower spread.
- **Decorrelated jitter** — `delay = min(cap, uniform(base, prev · 3))`. The delay random-walks upward from the previous value, combining a rising floor with a wide ceiling. This is the recommended default.

```python
import random


def full_jitter(attempt: int, base: float, cap: float) -> float:
    return random.uniform(0, min(cap, base * (2 ** attempt)))


def equal_jitter(attempt: int, base: float, cap: float) -> float:
    ceiling = min(cap, base * (2 ** attempt))
    half = ceiling / 2
    return half + random.uniform(0, half)


def decorrelated_jitter(prev_delay: float, base: float, cap: float) -> float:
    """Random-walk the delay upward; independent of an attempt counter."""
    return min(cap, random.uniform(base, prev_delay * 3))
```

The SVG below compares the delay envelopes the three strategies produce across attempts. All grow, but the shaded spread — the range a given attempt can land in — is what disperses the herd.

<figure class="fig">
<svg viewBox="16 26 718 274" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Comparison of retry-time spread for full, equal, and decorrelated jitter across attempts">
  <title>Retry-time spread of the three jitter variants</title>
  <desc>Three horizontal tracks over an attempt axis. No-jitter exponential shows single points doubling each attempt. Full jitter shows wide bars from zero up to the exponential ceiling. Equal jitter shows bars covering the upper half of each ceiling. Decorrelated jitter shows a rising staircase band that widens with each attempt.</desc>
  <rect x="16" y="26" width="718" height="274" fill="var(--fig-bg)"/>
  <!-- axis -->
  <line x1="120" y1="40" x2="120" y2="260" stroke="currentColor" stroke-width="1" opacity="0.4"/>
  <line x1="120" y1="260" x2="720" y2="260" stroke="currentColor" stroke-width="1" opacity="0.4"/>
  <text x="420" y="285" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">retry attempt →</text>
  <text x="60" y="150" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7" transform="rotate(-90 60 150)">delay spread</text>
  <!-- attempt ticks -->
  <text x="200" y="274" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">1</text>
  <text x="320" y="274" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">2</text>
  <text x="440" y="274" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">3</text>
  <text x="560" y="274" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">4</text>
  <text x="680" y="274" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">5</text>
  <!-- No jitter: single points at ceiling -->
  <text x="128" y="52" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8" font-weight="600">no jitter (lockstep)</text>
  <circle cx="200" cy="248" r="3" fill="currentColor" opacity="0.7"/>
  <circle cx="320" cy="236" r="3" fill="currentColor" opacity="0.7"/>
  <circle cx="440" cy="212" r="3" fill="currentColor" opacity="0.7"/>
  <circle cx="560" cy="164" r="3" fill="currentColor" opacity="0.7"/>
  <circle cx="680" cy="70" r="3" fill="currentColor" opacity="0.7"/>
  <!-- Full jitter: bars from baseline(260) up to ceiling -->
  <text x="128" y="66" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.55">full = U(0, ceiling)</text>
  <rect x="194" y="248" width="12" height="12" fill="currentColor" opacity="0.18"/>
  <rect x="314" y="236" width="12" height="24" fill="currentColor" opacity="0.18"/>
  <rect x="434" y="212" width="12" height="48" fill="currentColor" opacity="0.18"/>
  <rect x="554" y="164" width="12" height="96" fill="currentColor" opacity="0.18"/>
  <rect x="674" y="70" width="12" height="190" fill="currentColor" opacity="0.18"/>
  <!-- Equal jitter: bars covering upper half of ceiling -->
  <rect x="210" y="254" width="10" height="6" fill="currentColor" opacity="0.3"/>
  <rect x="330" y="248" width="10" height="12" fill="currentColor" opacity="0.3"/>
  <rect x="450" y="236" width="10" height="24" fill="currentColor" opacity="0.3"/>
  <rect x="570" y="212" width="10" height="48" fill="currentColor" opacity="0.3"/>
  <rect x="690" y="165" width="10" height="95" fill="currentColor" opacity="0.3"/>
  <text x="470" y="150" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.55">equal = ceiling/2 + U(0, ceiling/2)</text>
  <!-- Decorrelated: rising widening band (polyline) -->
  <path d="M180,250 L300,235 L420,205 L540,150 L660,80" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <path d="M180,258 L300,250 L420,232 L540,196 L660,140" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55" stroke-dasharray="3,3"/>
  <text x="360" y="120" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7" font-weight="600">decorrelated band</text>
</svg>
<figcaption><b>Figure 3.</b> Retry-time spread of the three jitter variants</figcaption>
</figure>

### Step 3 — An Async Retry Decorator Around an aiohttp POST

The decorator wraps any coroutine that performs one delivery attempt. It uses decorrelated jitter, classifies every outcome, respects a `Retry-After` header when present, and raises a dedicated exception when the ladder is exhausted so the caller can route to a dead-letter queue.

```python
import asyncio
import functools
import logging
import random
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)


class RetriesExhausted(Exception):
    """All attempts consumed; the caller should dead-letter the event."""


class TerminalFailure(Exception):
    """Non-retryable outcome; fail fast and dead-letter immediately."""


def retry_decorrelated(
    max_attempts: int = 6,
    base: float = 0.5,     # seconds; first-attempt floor
    cap: float = 30.0,     # seconds; ceiling for any single delay
):
    def wrapper(fn: Callable[..., Awaitable]):
        @functools.wraps(fn)
        async def inner(*args, **kwargs):
            prev = base
            for attempt in range(1, max_attempts + 1):
                try:
                    return await fn(*args, **kwargs)
                except TerminalFailure:
                    raise  # never retry a permanent fault
                except Exception as exc:
                    if attempt == max_attempts:
                        raise RetriesExhausted(str(exc)) from exc
                    # Decorrelated jitter: walk upward from the last delay.
                    delay = min(cap, random.uniform(base, prev * 3))
                    prev = delay
                    logger.warning(
                        "attempt %d/%d failed (%s); sleeping %.2fs",
                        attempt, max_attempts, exc, delay,
                    )
                    await asyncio.sleep(delay)
        return inner
    return wrapper


@retry_decorrelated(max_attempts=6, base=0.5, cap=30.0)
async def deliver_geojson(
    session: aiohttp.ClientSession,
    url: str,
    feature: dict,
    idempotency_key: str,
) -> None:
    """Single delivery attempt. Raises to signal the decorator to retry."""
    reason = is_terminal_geometry(feature)
    if reason is not None:
        raise TerminalFailure(f"unshippable geometry: {reason}")

    headers = {
        "Content-Type": "application/geo+json",
        # The same key on every retry lets the receiver dedupe redeliveries.
        "Idempotency-Key": idempotency_key,
    }
    timeout = aiohttp.ClientTimeout(total=10)
    try:
        async with session.post(url, json=feature, headers=headers,
                                timeout=timeout) as resp:
            outcome = classify_response(resp.status)
            if outcome is Outcome.SUCCESS:
                return
            if outcome is Outcome.TERMINAL:
                raise TerminalFailure(f"HTTP {resp.status}")
            # Retryable: honour Retry-After if the server sent one.
            retry_after = resp.headers.get("Retry-After")
            if retry_after and retry_after.isdigit():
                await asyncio.sleep(min(float(retry_after), 30.0))
            raise RuntimeError(f"retryable HTTP {resp.status}")
    except (aiohttp.ClientConnectionError, aiohttp.ServerTimeoutError,
            TimeoutError) as exc:
        raise RuntimeError(f"transport fault: {exc}") from exc
```

### Step 4 — Pair Retries with Idempotency So a Geometry Write Cannot Double-Insert

This is the non-negotiable rule of retries: **a retry fires exactly when the client cannot know whether the first attempt succeeded.** A read timeout can occur after the receiver has already inserted the polygon and committed the transaction — the write landed, but the acknowledgement never made it back. If the retry re-POSTs blindly, the receiver inserts the feature a second time: duplicate geometry, double-counted area, a corrupted spatial join downstream.

The idempotency key sent in Step 3 is what makes the retry a no-op instead of a duplicate. On the receiver side, that key is derived deterministically from the normalised geometry and claimed atomically before the write, exactly as described in [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) within the broader discipline of [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/). Retries and idempotency are two halves of one mechanism: retries provide *liveness* (the event eventually lands), idempotency provides *safety* (it lands at most once).

```python
import hashlib
import json


def idempotency_key_for(feature: dict, device_id: str, event_type: str,
                        precision: int = 7) -> str:
    """
    Deterministic key over the rounded geometry plus a business identifier.
    The SAME event always yields the SAME key, so a retried POST is recognised
    as a redelivery on the receiver and does not double-insert. Coordinates are
    rounded (~1.1 cm at the equator, EPSG:4326) to absorb float drift.
    """
    def _round(coords):
        if coords and isinstance(coords[0], (int, float)):
            return [round(c, precision) for c in coords]
        return [_round(part) for part in coords]

    canonical = {
        "type": feature["geometry"]["type"],
        "coordinates": _round(feature["geometry"]["coordinates"]),
    }
    blob = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    composite = f"{device_id}:{event_type}:{blob}"
    return "idem:v1:" + hashlib.sha256(composite.encode()).hexdigest()
```

### Step 5 — Enforce a Retry Budget Across the Fleet

Per-event backoff disperses a herd in time, but it does not cap *total* retry load. During a long outage, every event still climbs its full ladder, and a fleet of thousands multiplies that into a sustained flood aimed at an already-failing receiver. A retry budget bounds retries as a fraction of successful traffic — a token bucket refilled from successes and drained by retries. When the bucket is empty, retries are shed straight to the dead-letter queue.

```python
import time


class RetryBudget:
    """
    Token-bucket retry budget shared across the dispatcher. Every success adds
    `ratio` tokens (e.g. 0.1 → retries may add at most ~10% extra load); every
    retry costs 1 token. When empty, retries are refused and the event is
    dead-lettered instead of amplifying a downstream outage.
    """
    def __init__(self, ratio: float = 0.1, ceiling: float = 100.0,
                 min_per_sec: float = 1.0):
        self.ratio = ratio
        self.ceiling = ceiling
        self.min_per_sec = min_per_sec
        self.tokens = ceiling
        self._last = time.monotonic()

    def _leak(self) -> None:
        now = time.monotonic()
        self.tokens = min(self.ceiling,
                          self.tokens + self.min_per_sec * (now - self._last))
        self._last = now

    def record_success(self) -> None:
        self._leak()
        self.tokens = min(self.ceiling, self.tokens + self.ratio)

    def try_retry(self) -> bool:
        self._leak()
        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True
        return False  # budget exhausted → caller must dead-letter
```

Sizing the ratio and the ceiling against each provider's published retry window and error-rate SLA is its own discipline, covered in [Tuning Retry Budgets for Webhook Provider SLAs](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/tuning-retry-budgets-for-webhook-provider-slas/).

---

## Delivery Guarantees: What Retries Actually Buy You

Retries move a pipeline from best-effort toward **at-least-once** delivery — with a bounded budget, every event is either acknowledged, dead-lettered, or shed, and none is silently lost. At-least-once is the honest ceiling for a network with timeouts: the client can always be forced to retry after a lost acknowledgement, so duplicates are unavoidable *at the transport layer*. What upgrades the observable behaviour to **effectively-once** is the idempotency key from Step 4 — duplicates still arrive, but the receiver collapses them, so a feature is written at most once regardless of how many times it is delivered.

True exactly-once across a network boundary requires a distributed transaction coordinator and is rarely justified for spatial ingestion given its latency cost. The pragmatic contract for almost every spatial webhook fleet is therefore *at-least-once delivery plus idempotent writes*. Ordering is a separate axis — retries reorder events by construction, since a retried event lands after later events that succeeded first — and reconciling that with spatial correctness is the subject of [Delivery Guarantees & Event Ordering](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/). When the retry ladder and the budget are both exhausted, the event must land somewhere durable and inspectable: [Dead-Letter Queues for Spatial Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/).

---

## Verification

A retry policy is only correct if its delay sequence stays inside the bounds you designed. This test asserts that decorrelated jitter never drops below the base floor, never exceeds the cap, and — over many trials — actually disperses rather than collapsing onto a single value.

```python
import statistics


def decorrelated_sequence(attempts: int, base: float, cap: float,
                          rng_seed: int) -> list[float]:
    rnd = random.Random(rng_seed)
    prev, out = base, []
    for _ in range(attempts):
        delay = min(cap, rnd.uniform(base, prev * 3))
        out.append(delay)
        prev = delay
    return out


def test_backoff_sequence_bounds():
    base, cap = 0.5, 30.0
    for seed in range(500):
        seq = decorrelated_sequence(8, base, cap, seed)
        # Bound 1: no delay is below the base floor.
        assert min(seq) >= base - 1e-9, f"delay below base: {min(seq)}"
        # Bound 2: no delay exceeds the cap.
        assert max(seq) <= cap + 1e-9, f"delay above cap: {max(seq)}"

    # Bound 3: across seeds, attempt-1 delays are dispersed, not constant.
    first_delays = [decorrelated_sequence(1, base, cap, s)[0]
                    for s in range(500)]
    assert statistics.pstdev(first_delays) > 0.1, "jitter is not dispersing"
    print("backoff bounds hold; jitter disperses the herd")


if __name__ == "__main__":
    test_backoff_sequence_bounds()
```

Run it with `pytest -q` or directly with `python`. The third assertion is the one that catches a subtly broken jitter implementation: a delay function that grows correctly but forgets to randomise will pass the bound checks yet still cause a thundering herd, and only the dispersion assertion exposes it. A worked, benchmarked version of this harness — with side-by-side timing of all three variants — lives in [Implementing Exponential Backoff with Jitter in Python](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/implementing-exponential-backoff-with-jitter-in-python/).

---

## Troubleshooting

<div style="overflow-x:auto;">

| Symptom | Likely spatial cause | Fix |
|---------|----------------------|-----|
| Receiver recovers, then immediately falls over again | No jitter — all producers retry in lockstep after the outage | Switch from plain exponential to decorrelated jitter; confirm the dispersion test passes |
| Duplicate polygons appear after a delivery timeout | Retry re-POSTed a write that had already committed, with no idempotency key | Send a stable `Idempotency-Key` derived from normalised geometry; claim it atomically before the write |
| A single malformed geometry retries forever | Invalid-geometry `422` classified as retryable instead of terminal | Run the `shapely` topology check locally; map 4xx and invalid geometry to `TerminalFailure` |
| Retry load spikes and never subsides during an outage | No retry budget — every event climbs its full ladder simultaneously | Add the token-bucket `RetryBudget`; shed to the dead-letter queue when empty |
| Retries fire far faster than expected | `Retry-After` header from a 429 ignored | Honour `Retry-After` and clamp it to the cap before sleeping |
| Delays occasionally exceed the intended ceiling | `cap` applied to the base but not to the jittered result | Wrap the final draw in `min(cap, …)`; assert the upper bound in the verification test |
| Duplicate keys collide across distinct events | Idempotency key omits the business identifier, keying on geometry alone | Include `device_id` and `event_type` in the composite before hashing |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Why do retries require idempotency for spatial payloads?</strong></summary>

A retry happens precisely when the client is unsure the first attempt succeeded — a timeout or dropped connection can occur after the receiver has already written the geometry. Without an idempotency key, the retried POST re-inserts the same feature, producing duplicate polygons, double-counted areas, and corrupted spatial joins. Deriving a deterministic key from the normalised geometry and claiming it atomically before the write makes the retry a no-op instead of a duplicate.

</details>

<details class="faq">
<summary><strong>Which jitter variant should I use for spatial webhook retries?</strong></summary>

Decorrelated jitter is the best default for most spatial webhook fleets. Full jitter minimises collisions but can retry too eagerly right after a failure; equal jitter guarantees a minimum wait but clusters more tightly; decorrelated jitter walks the delay upward from the previous value, giving both wide spread and a rising floor. AWS load tests found full and decorrelated jitter complete a contended workload in the fewest total calls.

</details>

<details class="faq">
<summary><strong>How do I tell a retryable failure from a non-retryable one?</strong></summary>

Retry on transient transport and server faults: connection errors, read timeouts, and 5xx responses such as 502, 503, and 504, plus 429 (respecting Retry-After). Do not retry client faults: 400, 401, 403, 404, 409, 422, and any invalid-geometry rejection. A self-intersecting polygon will fail identically on every attempt, so retrying it only wastes the retry budget and delays routing it to a dead-letter queue for inspection.

</details>

<details class="faq">
<summary><strong>What is a retry budget and why does it matter at fleet scale?</strong></summary>

A retry budget caps retries as a fraction of successful requests — for example, no more than 10 percent additional load from retries. Without a budget, a downstream outage causes every event to exhaust its full retry ladder simultaneously, multiplying load exactly when the receiver is already failing. A token-bucket budget sheds retries once the ratio is exceeded, sending events straight to the dead-letter queue instead of amplifying the outage.

</details>

---

## Related

- [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/) — the parent section covering how spatial event pipelines move payloads reliably from producer to consumer
- [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) — the receiver-side deduplication that makes every retry safe to redeliver
- [Dead-Letter Queues for Spatial Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/) — where events land once the retry ladder and budget are exhausted
- [Delivery Guarantees & Event Ordering](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/) — reconciling at-least-once retries with the ordering constraints of spatial state
- [Implementing Exponential Backoff with Jitter in Python](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/implementing-exponential-backoff-with-jitter-in-python/) — a self-contained, benchmarked implementation of all three jitter variants
- [Tuning Retry Budgets for Webhook Provider SLAs](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/tuning-retry-budgets-for-webhook-provider-slas/) — sizing budget ratios and ceilings against published provider retry windows
