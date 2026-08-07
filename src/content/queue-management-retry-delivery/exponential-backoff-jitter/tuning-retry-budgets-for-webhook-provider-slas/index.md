---
title: "Tuning Retry Budgets for Webhook Provider SLAs"
description: "Size a webhook retry budget — total window, max attempts, per-attempt timeout — to match your provider's retry SLA and idempotency-key TTL, without replaying past key expiry."
slug: "tuning-retry-budgets-for-webhook-provider-slas"
type: "article"
breadcrumb:
  - label: "Queue Management, Retries & Delivery Guarantees"
    url: "/queue-management-retry-delivery/"
  - label: "Exponential Backoff & Jitter for Spatial Webhooks"
    url: "/queue-management-retry-delivery/exponential-backoff-jitter/"
  - label: "Tuning Retry Budgets for Webhook Provider SLAs"
    url: "/queue-management-retry-delivery/exponential-backoff-jitter/tuning-retry-budgets-for-webhook-provider-slas/"
datePublished: "2025-05-19"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Tuning Retry Budgets for Webhook Provider SLAs",
      "description": "Size a webhook retry budget — total window, max attempts, per-attempt timeout — to match your provider's documented retry SLA and idempotency-key TTL so you neither give up early nor replay after the key expires.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/tuning-retry-budgets-for-webhook-provider-slas/",
      "datePublished": "2025-05-19",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Queue Management, Retries & Delivery Guarantees", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/" },
        { "@type": "ListItem", "position": 2, "name": "Exponential Backoff & Jitter for Spatial Webhooks", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/" },
        { "@type": "ListItem", "position": 3, "name": "Tuning Retry Budgets for Webhook Provider SLAs", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/tuning-retry-budgets-for-webhook-provider-slas/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Tune a Webhook Retry Budget to a Provider SLA",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Read the provider retry SLA", "text": "Extract the documented total retry window (e.g. 72 hours) and any per-attempt timeout from the provider's webhook documentation. This is the ceiling your budget must not exceed." },
        { "@type": "HowToStep", "position": 2, "name": "Set the idempotency-key TTL as the hard bound", "text": "Choose an idempotency-key TTL in Redis that is at least as long as your total retry window plus a safety margin, so a late retry still hits a live key rather than re-processing." },
        { "@type": "HowToStep", "position": 3, "name": "Compute the attempt schedule from the budget", "text": "Generate an exponential-backoff-with-jitter schedule whose cumulative delay plus per-attempt timeouts fits inside the retry window, then cap the attempt count at that ceiling." },
        { "@type": "HowToStep", "position": 4, "name": "Hand off to a dead-letter queue at budget exhaustion", "text": "When the schedule is exhausted before success, route the event to a dead-letter queue before the idempotency key expires so no delivery is silently lost." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should my retry window match the provider's retry window exactly?",
          "acceptedAnswer": { "@type": "Answer", "text": "Your consumer-side retry window should be less than or equal to the provider's documented window, and your idempotency-key TTL should be greater than or equal to it. Matching the window exactly is fine, but the TTL must always outlast the longest possible retry so a late attempt still finds a live key instead of re-processing the event." }
        },
        {
          "@type": "Question",
          "name": "What happens if the retry window exceeds the idempotency-key TTL?",
          "acceptedAnswer": { "@type": "Answer", "text": "The idempotency key expires while retries are still in flight. A retry that arrives after expiry finds no cached key, is treated as a brand-new event, and is processed a second time — double-writing a spatial feature or replaying a tile update. Always set the TTL to the full retry window plus a margin covering clock skew and queue lag." }
        },
        {
          "@type": "Question",
          "name": "How do I stop retry amplification across chained services?",
          "acceptedAnswer": { "@type": "Answer", "text": "Give each hop a strictly smaller retry budget than its caller, so nested retries cannot multiply. If the edge receiver allows 5 attempts and an internal geometry service also allows 5, a single event can trigger 25 downstream calls. Budget the total end-to-end, then divide it across hops rather than assigning each hop the full window." }
        },
        {
          "@type": "Question",
          "name": "Should retry budgets be per-tenant or global?",
          "acceptedAnswer": { "@type": "Answer", "text": "Budget per-tenant. A single noisy tenant emitting failing geometries can exhaust a shared retry pool and starve every other tenant's deliveries. Track attempts and total scheduled retry time per tenant key so one tenant's backlog cannot consume the capacity reserved for others." }
        }
      ]
    }
  ]
}
</script>

**To size a webhook retry budget, read the provider's documented retry window and per-attempt timeout, then choose a total window, a maximum attempt count, and a per-attempt timeout whose cumulative time fits inside that window — while setting your idempotency-key TTL strictly longer than the whole budget so no late retry ever replays an event whose key has expired.** The budget is bounded above by the provider SLA and below by the need to give a struggling downstream enough attempts to recover; the idempotency TTL is the hard ceiling that keeps retries from turning into duplicate processing.

This page is part of [Exponential Backoff & Jitter for Spatial Webhooks](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/), which sits within the [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/) architecture — the reference section for delivering spatial events reliably under failure.

---

## When to use this pattern

Compute an explicit retry budget when:

- Your provider publishes a **finite retry window** (Stripe retries for ~3 days, GitHub for a fixed set of attempts, many GIS platforms document a 24–72 hour window) and you must decide how many consumer-side re-deliveries fit inside it.
- You deduplicate with an **idempotency key stored in Redis with a TTL**, and you need the TTL and the retry schedule to agree so a slow-recovering downstream never causes a replay after expiry.
- You run a **dead-letter queue** and need a precise, testable moment — budget exhaustion — at which an undeliverable spatial event is handed off rather than retried forever.

It is not the right tool when your provider guarantees indefinite retries with a stable event ID and you persist that ID directly — there the sender owns the budget and you only need at-most-once storage, not a computed schedule.

---

## Why an unbudgeted retry loop breaks

A retry loop written as "back off exponentially until it works" has no relationship to the two clocks that actually govern correctness: the provider's retry window and the idempotency-key TTL. When those three timelines drift apart, spatial pipelines fail in two directions.

Give up too early and you drop a delivery the provider still considered in-flight — the sender sees a 5xx, exhausts *its* budget against your prematurely-closed consumer, and a valid tile update or sensor event is lost. Retry too long and the more insidious failure appears: your idempotency key expires mid-retry. Because the key was the only record that this event had been seen, the next attempt looks brand-new. A `Feature` in EPSG:4326 (WGS84) gets written twice, a boundary-change event replays, and downstream spatial indexes diverge. The budget's job is to make the three timelines nest correctly, as the diagram shows.

<figure class="fig">
<svg viewBox="46 0 714 238" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Retry budget nested inside provider retry window and idempotency-key TTL">
  <title>Nesting the retry budget inside the provider window and the idempotency TTL</title>
  <desc>Three stacked horizontal timelines sharing a start. The innermost bar is the consumer retry budget with tick marks for attempts, the middle bar is the provider retry window which is longer, and the outermost bar is the Redis idempotency-key TTL which extends furthest right; a dashed marker shows the dead-letter hand-off occurring before the TTL ends.</desc>
  <rect x="46" y="0" width="714" height="238" fill="var(--fig-bg)"/>
  <defs>
    <marker id="ra" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L8,3.5 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- shared start line -->
  <line x1="70" y1="30" x2="70" y2="210" stroke="currentColor" stroke-opacity="0.3" stroke-width="1" stroke-dasharray="3,3"/>
  <text x="70" y="24" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">t = 0</text>
  <!-- Retry budget bar -->
  <rect x="70" y="45" width="330" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5"/>
  <text x="80" y="66" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Retry budget</text>
  <line x1="130" y1="45" x2="130" y2="79" stroke="currentColor" stroke-opacity="0.4" stroke-width="1"/>
  <line x1="200" y1="45" x2="200" y2="79" stroke="currentColor" stroke-opacity="0.4" stroke-width="1"/>
  <line x1="300" y1="45" x2="300" y2="79" stroke="currentColor" stroke-opacity="0.4" stroke-width="1"/>
  <text x="270" y="95" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">attempts (backoff + jitter)</text>
  <!-- DLQ handoff marker -->
  <line x1="400" y1="40" x2="400" y2="200" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.2" stroke-dasharray="4,3"/>
  <text x="400" y="222" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">DLQ hand-off</text>
  <!-- Provider window bar -->
  <rect x="70" y="110" width="470" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="80" y="131" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Provider retry window (72h)</text>
  <!-- TTL bar -->
  <rect x="70" y="160" width="620" height="34" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="80" y="181" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Idempotency-key TTL (78h)</text>
  <line x1="690" y1="177" x2="720" y2="177" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#ra)"/>
  <text x="726" y="180" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">expiry</text>
</svg>
<figcaption><b>Figure 1.</b> Nesting the retry budget inside the provider window and the idempotency TTL</figcaption>
</figure>

The invariant is simple: **retry budget ≤ provider window ≤ idempotency TTL.** The budget hands off to the dead-letter queue before the key expires, so every event ends in exactly one terminal state.

---

## A worked example: a 72-hour provider window

Suppose your spatial webhook provider documents a **72-hour retry window** and re-delivers failed events on its own schedule during that window. You are the consumer, and each of *your* internal delivery attempts to a downstream geometry service can itself fail. You want to:

1. Retry internally with exponential backoff and jitter so a downstream that is briefly down recovers without a thundering herd.
2. Keep your idempotency key alive in Redis for the **entire** window plus a margin — say **78 hours** — so even the last retry finds a live key. The margin absorbs clock skew and queue lag, the same TTL-alignment reasoning covered in [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/).
3. Stop retrying and hand the event to a dead-letter queue once the budget is spent — well before the 78-hour TTL — so the payload is captured while its key still exists. That hand-off is the entry point to [Dead-Letter Queues for Spatial Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/).

The code below turns a budget into a concrete attempt schedule and proves the schedule fits.

---

## Complete runnable implementation

This module is self-contained and uses only the Python standard library. Given a total budget in seconds it produces an exponential-backoff-with-jitter schedule, caps the attempt count so the cumulative delay plus per-attempt timeouts never exceeds the budget, and derives the idempotency TTL that must accompany it.

```python
import random
from dataclasses import dataclass, field
from typing import List


@dataclass
class RetryBudget:
    """
    A retry budget sized against a webhook provider's documented SLA.

    All durations are in seconds. The core invariant the schedule guarantees:

        sum(delays) + max_attempts * per_attempt_timeout <= total_window

    and separately, callers must set:

        idempotency_ttl >= total_window   (enforced in __post_init__)

    so a late retry always lands on a live idempotency key.
    """
    total_window: float          # provider retry window, e.g. 72h = 259200s
    base_delay: float = 2.0      # first backoff delay, seconds
    factor: float = 2.0          # exponential growth factor
    max_delay: float = 3600.0    # cap on any single backoff (1h)
    per_attempt_timeout: float = 30.0   # request timeout per delivery attempt
    ttl_margin: float = 21600.0  # extra TTL over the window (6h) for skew/lag
    idempotency_ttl: float = field(init=False)

    def __post_init__(self) -> None:
        # The idempotency key must outlive the entire retry window.
        self.idempotency_ttl = self.total_window + self.ttl_margin

    def schedule(self, seed: int | None = None) -> List[float]:
        """
        Build the list of backoff delays (seconds) that fit inside the budget.

        Uses "full jitter": each delay is uniform in [0, capped_exponential].
        Stops adding attempts once the cumulative delay plus the timeout the
        NEXT attempt would consume would breach the total window.
        """
        rng = random.Random(seed)
        delays: List[float] = []
        elapsed = 0.0
        n = 0
        while True:
            capped = min(self.max_delay, self.base_delay * (self.factor ** n))
            delay = rng.uniform(0.0, capped)   # full jitter
            # Reserve room for this attempt's request timeout as well.
            projected = elapsed + delay + self.per_attempt_timeout
            if projected > self.total_window:
                break
            delays.append(delay)
            elapsed = projected
            n += 1
        return delays

    def max_attempts(self, seed: int | None = None) -> int:
        return len(self.schedule(seed))

    def total_scheduled_seconds(self, seed: int | None = None) -> float:
        """Cumulative wall-clock the schedule reserves: delays + timeouts."""
        delays = self.schedule(seed)
        return sum(delays) + len(delays) * self.per_attempt_timeout


if __name__ == "__main__":
    # 72h provider window -> 78h idempotency TTL.
    budget = RetryBudget(total_window=72 * 3600)
    delays = budget.schedule(seed=7)
    print(f"attempts fitted:      {len(delays)}")
    print(f"scheduled seconds:    {budget.total_scheduled_seconds(seed=7):,.0f}")
    print(f"total window:         {budget.total_window:,.0f}")
    print(f"idempotency TTL (s):  {budget.idempotency_ttl:,.0f}")
    # Set the Redis key with exactly this TTL when you first see the event:
    #   redis.set(idem_key, b"1", nx=True, px=int(budget.idempotency_ttl * 1000))
    assert budget.total_scheduled_seconds(seed=7) <= budget.total_window
```

The `total_scheduled_seconds` check is the load-bearing guarantee: it reserves not just the backoff delays but also one `per_attempt_timeout` per attempt, because a downstream that hangs until timeout consumes budget just as surely as a delay does. Feeding the derived `idempotency_ttl` straight into the Redis `SET NX PX` call keys the whole system off one number.

---

## Parameter reference

<div style="overflow-x:auto;">

| Parameter | Type | Constraint | Default |
|---|---|---|---|
| `total_window` | `float` (s) | Must be ≤ the provider's documented retry window; the ceiling for all scheduled time | — |
| `base_delay` | `float` (s) | First backoff; keep ≥ 1 s so early retries do not hammer a recovering geometry service | `2.0` |
| `factor` | `float` | Exponential growth base; `2.0` doubles each step; values > 3 exhaust the window in too few attempts | `2.0` |
| `max_delay` | `float` (s) | Per-attempt backoff cap; prevents multi-hour gaps that waste the tail of the window | `3600.0` |
| `per_attempt_timeout` | `float` (s) | Request timeout per delivery; reserved against the budget so hung calls cannot overrun | `30.0` |
| `ttl_margin` | `float` (s) | Extra idempotency TTL over the window for clock skew and queue lag | `21600.0` |
| `idempotency_ttl` | `float` (s) | Derived, not set: `total_window + ttl_margin`; must exceed the longest possible retry | derived |

</div>

---

## Gotchas and spatial edge cases

1. **Retry window exceeding the idempotency TTL causes re-processing.** This is the headline failure. If the schedule can still fire an attempt after the Redis key has expired, that attempt reads no cached key, treats the delivery as new, and double-writes the spatial feature. Always derive the TTL from the window (`total_window + ttl_margin`) rather than hard-coding both independently, so the two can never drift apart during a config change.

2. **Retry amplification across chained services.** A single edge delivery that fans out to a CRS-normalization service and then a tile builder multiplies attempts: 5 × 5 × 5 = 125 downstream calls for one event. Budget the total end-to-end and divide it across hops — each inner hop must get a strictly smaller window than its caller, or a transient failure deep in the chain melts the pipeline.

3. **Budget per-tenant, not globally.** One tenant emitting invalid polygons (self-intersecting rings, unclosed geometries) can generate a wall of failures that exhausts a shared retry pool and starves every other tenant. Key the attempt counter and scheduled-time accounting on the tenant ID so a noisy neighbour cannot consume capacity reserved for others.

4. **Jitter must not be applied to the TTL.** Add jitter to backoff *delays* to de-correlate retries, but compute the idempotency TTL from the deterministic, un-jittered `total_window`. If jitter shortened the TTL, a worst-case (maximum-delay) retry schedule could outlive the key it depends on.

5. **Per-attempt timeout counts against the budget.** A downstream that hangs for the full `per_attempt_timeout` consumes budget identically to a backoff delay. Heavy EPSG:4326 → EPSG:3857 (Web Mercator) reprojection or large-geometry validation can push real request time toward the timeout, so reserve it explicitly (as the code does) rather than assuming attempts are instantaneous.

6. **Provider windows are documented in wall-clock, your queue runs in processing time.** If events sit in a broker backlog for hours before your consumer first sees them, the provider's window has already partly elapsed. Anchor the budget to the provider's original event timestamp, not to your first processing attempt, or a backlog can push retries past the real deadline.

---

## Verification

Paste this into a test file and run with `pytest`. The critical assertion is that total scheduled time never exceeds the budget, and that the TTL always outlasts the window — the two invariants that keep retries from becoming duplicates.

```python
import pytest
from your_module import RetryBudget  # adjust import path


def test_scheduled_time_never_exceeds_budget():
    """Cumulative delays + per-attempt timeouts must fit inside the window."""
    for seed in range(200):  # exercise many jitter draws
        budget = RetryBudget(total_window=72 * 3600)
        assert budget.total_scheduled_seconds(seed=seed) <= budget.total_window


def test_ttl_strictly_outlasts_window():
    """A late retry must still land on a live idempotency key."""
    budget = RetryBudget(total_window=72 * 3600)
    assert budget.idempotency_ttl > budget.total_window
    # The last possible attempt fires within the window, before TTL expiry.
    assert budget.total_scheduled_seconds() < budget.idempotency_ttl


def test_shorter_window_yields_fewer_attempts():
    """A tighter budget must not produce more attempts than a looser one."""
    small = RetryBudget(total_window=3600).max_attempts(seed=1)
    large = RetryBudget(total_window=72 * 3600).max_attempts(seed=1)
    assert small <= large


def test_chained_hop_budget_is_strictly_smaller():
    """Each downstream hop must get a strictly smaller window to avoid amplification."""
    edge = RetryBudget(total_window=72 * 3600)
    inner = RetryBudget(total_window=edge.total_window / 3)
    assert inner.total_window < edge.total_window
    assert inner.total_scheduled_seconds() <= inner.total_window
```

---

## FAQ

<details class="faq">
<summary><strong>Should my retry window match the provider's retry window exactly?</strong></summary>

Your consumer-side retry window should be less than or equal to the provider's documented window, and your idempotency-key TTL should be greater than or equal to it. Matching the window exactly is fine, but the TTL must always outlast the longest possible retry so a late attempt still finds a live key instead of re-processing the event.

</details>

<details class="faq">
<summary><strong>What happens if the retry window exceeds the idempotency-key TTL?</strong></summary>

The idempotency key expires while retries are still in flight. A retry that arrives after expiry finds no cached key, is treated as a brand-new event, and is processed a second time — double-writing a spatial feature or replaying a tile update. Always set the TTL to the full retry window plus a margin covering clock skew and queue lag.

</details>

<details class="faq">
<summary><strong>How do I stop retry amplification across chained services?</strong></summary>

Give each hop a strictly smaller retry budget than its caller, so nested retries cannot multiply. If the edge receiver allows 5 attempts and an internal geometry service also allows 5, a single event can trigger 25 downstream calls. Budget the total end-to-end, then divide it across hops rather than assigning each hop the full window.

</details>

<details class="faq">
<summary><strong>Should retry budgets be per-tenant or global?</strong></summary>

Budget per-tenant. A single noisy tenant emitting failing geometries can exhaust a shared retry pool and starve every other tenant's deliveries. Track attempts and total scheduled retry time per tenant key so one tenant's backlog cannot consume the capacity reserved for others.

</details>

---

## Related

- [Exponential Backoff & Jitter for Spatial Webhooks](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/) — parent: the backoff and jitter strategy the schedule in this page is built on
- [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) — aligning the Redis idempotency-key TTL with the retry window this budget derives
- [Dead-Letter Queues for Spatial Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/) — where an event goes when the retry budget is exhausted before delivery succeeds
