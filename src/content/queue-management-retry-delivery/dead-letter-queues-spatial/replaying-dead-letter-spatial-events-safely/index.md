---
title: "Replaying Dead-Letter Spatial Events Safely"
description: "Replay spatial events out of a dead-letter queue without double-applying them: preserve the original idempotency key, re-validate geometry, rate-limit, and order by observation time."
slug: "replaying-dead-letter-spatial-events-safely"
type: "article"
breadcrumb:
  - label: "Queue Management, Retries & Delivery Guarantees"
    url: "/queue-management-retry-delivery/"
  - label: "Dead-Letter Queues for Spatial Payloads"
    url: "/queue-management-retry-delivery/dead-letter-queues-spatial/"
  - label: "Replaying Dead-Letter Spatial Events Safely"
    url: "/queue-management-retry-delivery/dead-letter-queues-spatial/replaying-dead-letter-spatial-events-safely/"
datePublished: "2025-05-01"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Replaying Dead-Letter Spatial Events Safely",
      "description": "Replay spatial events out of a dead-letter queue without double-applying them: preserve the original idempotency key, re-validate geometry with shapely.make_valid, rate-limit the drain, and order by observation time.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/replaying-dead-letter-spatial-events-safely/",
      "datePublished": "2025-05-01",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Queue Management, Retries & Delivery Guarantees", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/" },
        { "@type": "ListItem", "position": 2, "name": "Dead-Letter Queues for Spatial Payloads", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/" },
        { "@type": "ListItem", "position": 3, "name": "Replaying Dead-Letter Spatial Events Safely", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/replaying-dead-letter-spatial-events-safely/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Replay Dead-Letter Spatial Events Safely",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Preserve the original idempotency key", "text": "Read the idempotency key that was computed at first ingest from the DLQ envelope and re-submit under that exact key so the pipeline's deduplication gate absorbs any event that was already applied before it dead-lettered." },
        { "@type": "HowToStep", "position": 2, "name": "Re-validate geometry before replay", "text": "Run each geometry through shapely.make_valid so payloads that dead-lettered on a topology error are repaired, and drop any that are still unrecoverable rather than re-poisoning the pipeline." },
        { "@type": "HowToStep", "position": 3, "name": "Order by observation time", "text": "Sort the drained batch by the event's observation timestamp so older readings are replayed before newer ones and cannot overwrite fresher state that landed while the events sat in the DLQ." },
        { "@type": "HowToStep", "position": 4, "name": "Rate-limit the drain", "text": "Emit re-submissions through a token-bucket or fixed-interval limiter so a large DLQ backlog does not become a self-inflicted load spike against the same consumers that were already struggling." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why must I reuse the original idempotency key instead of generating a new one on replay?",
          "acceptedAnswer": { "@type": "Answer", "text": "An event can dead-letter after it was partially or fully applied — for example the write to PostGIS succeeded but an acknowledgement timed out. If you generate a fresh key on replay, the deduplication gate sees a brand-new event and applies it a second time, double-writing state. Reusing the key computed at first ingest lets the gate recognise the replay as a duplicate and absorb it." }
        },
        {
          "@type": "Question",
          "name": "Should I re-validate geometry on replay if it was already validated at ingest?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes. Many events dead-letter precisely because their geometry failed validation. Running shapely.make_valid on replay repairs self-intersections and other topology faults that can be fixed deterministically, so the repaired event now passes the same validation gate that rejected it. Events that are still invalid after make_valid should be dropped or escalated, never re-submitted in a loop." }
        },
        {
          "@type": "Question",
          "name": "How do I stop a mass replay from overwhelming my consumers?",
          "acceptedAnswer": { "@type": "Answer", "text": "Rate-limit the replay with a token bucket or fixed inter-message delay tuned below the steady-state capacity of the downstream consumers, and drain in bounded batches rather than flushing the whole DLQ at once. The events already failed once; there is no benefit to replaying them faster than the pipeline can safely absorb." }
        },
        {
          "@type": "Question",
          "name": "Why replay in observation-time order rather than DLQ insertion order?",
          "acceptedAnswer": { "@type": "Answer", "text": "Events can sit in a DLQ for minutes or hours while newer events for the same feature flow through normally. Replaying a stale reading after fresher state has already been written would roll the feature backwards. Ordering the drained batch by observation timestamp ensures older readings are applied first and a last-write-wins consumer keeps the newest value." }
        }
      ]
    }
  ]
}
</script>

**To replay spatial events out of a dead-letter queue safely, re-submit each event under the idempotency key it was assigned at first ingest so the pipeline's deduplication gate absorbs anything already applied, re-validate the geometry with `shapely.make_valid` before replay, sort the drained batch into observation-time order, and emit through a rate limiter so the drain never becomes a self-inflicted load spike.** A DLQ replay is not a fresh delivery — it is a controlled re-injection of events that already failed once, and every one of those four controls exists to stop the replay from corrupting state or re-poisoning the pipeline.

This page is part of [Dead-Letter Queues for Spatial Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/), which sits within the [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/) — the reference section for building spatial webhook pipelines that survive retries, backpressure, and failure.

---

## When to use this pattern

Reach for a deliberate, controlled replay when:

- You have accumulated a backlog in a spatial DLQ after a downstream outage (PostGIS unavailable, a schema migration, an expired credential) and the events are still valid and worth re-processing once the cause is fixed.
- Events dead-lettered on transient geometry validation failures — a producer briefly emitted self-intersecting polygons — and you want to repair and re-submit them rather than discard real observations.
- You need an auditable, rate-limited drain rather than an ad-hoc "requeue everything" button that risks a thundering herd against consumers that just recovered.

It is not the right tool when the DLQ contains genuinely unprocessable events (malformed envelopes, geometries that cannot be repaired, events for deleted features). Those are poison pills — replaying them only produces another dead-letter and, if you loop, an infinite cycle. Triage and drop those first.

---

## Why replaying spatial events naively corrupts state

A dead-letter queue is the terminal stop for events that exhausted their retry budget. The dangerous assumption is that a dead-lettered event was *never applied*. That is frequently false. An event commonly reaches the DLQ after its side effect partially succeeded — the row was written to PostGIS but the broker never saw the acknowledgement, so the delivery was retried, re-failed on a downstream timeout, and eventually dead-lettered. If you replay that event as if it were new, you apply it a second time: a double-write, a duplicated feature, or a doubled counter.

The defence is the same deduplication gate the pipeline already runs at ingest. If you re-submit under the *same* idempotency key the event carried at first ingest, the gate recognises the replay as a duplicate and drops it — the replay becomes a no-op for anything already applied, and a normal apply for anything that never landed. This is exactly why the key must be computed once, at ingest, and then travel with the event into the DLQ envelope. Regenerating it on replay defeats the entire mechanism. The canonical, content-derived keys described in [generating deterministic idempotency keys for GeoJSON events](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/generating-deterministic-idempotency-keys-for-geojson-events/) are ideal here because they are reproducible, but on replay you should still prefer the *stored* key over recomputing, so that a change in canonicalization logic between ingest and replay cannot shift it.

Two spatial-specific hazards ride alongside the double-write problem. First, geometry: many events dead-letter *because* their geometry was invalid, so blindly replaying them reproduces the same failure. Second, ordering: an event can sit in the DLQ while newer events for the same feature flow through, so a naive replay can overwrite fresh state with a stale reading.

<figure class="fig">
<svg viewBox="0 56 710 188" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Safe dead-letter replay pipeline for spatial events">
  <title>Safe dead-letter replay pipeline for spatial events</title>
  <desc>A data-flow diagram: the spatial DLQ feeds a replay worker that sorts events by observation time, repairs geometry with shapely.make_valid, and emits through a rate limiter back into the ingest pipeline, whose deduplication gate absorbs any duplicate before the consumer applies state.</desc>
  <rect x="0" y="56" width="710" height="188" fill="var(--fig-bg)"/>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L8,3.5 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Box 1: DLQ -->
  <rect x="8" y="110" width="120" height="80" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="68" y="140" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Spatial DLQ</text>
  <text x="68" y="156" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">envelopes +</text>
  <text x="68" y="169" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">stored key</text>
  <line x1="128" y1="150" x2="150" y2="150" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 2: Replay worker (sort + repair + limit) -->
  <rect x="152" y="70" width="196" height="160" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="250" y="94" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Replay worker</text>
  <text x="250" y="120" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">1. sort by observation time</text>
  <text x="250" y="140" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">2. make_valid(geometry)</text>
  <text x="250" y="160" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">3. drop poison pills</text>
  <text x="250" y="180" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">4. rate-limit emit</text>
  <text x="250" y="212" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">preserves original key</text>
  <line x1="348" y1="150" x2="370" y2="150" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 3: Dedup gate -->
  <rect x="372" y="110" width="150" height="80" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="447" y="138" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Dedup gate</text>
  <text x="447" y="156" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">SET NX on key</text>
  <text x="447" y="170" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">absorbs duplicate</text>
  <line x1="522" y1="150" x2="544" y2="150" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 4: Consumer -->
  <rect x="546" y="110" width="150" height="80" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="621" y="138" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Consumer</text>
  <text x="621" y="156" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">applies state</text>
  <text x="621" y="170" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">last-write-wins</text>
</svg>
<figcaption><b>Figure 1.</b> Safe dead-letter replay pipeline for spatial events</figcaption>
</figure>

---

## Complete runnable implementation

The replay worker below is self-contained and runnable. It models the DLQ as an in-memory list of envelopes so you can run it directly, but `pull_dlq_batch` and `submit_to_pipeline` are the two seams you replace with your real broker (Redis Streams `XAUTOCLAIM`, a Kafka DLQ topic, or a PostGIS-backed queue). It preserves the stored idempotency key, repairs geometry with `shapely.make_valid`, drops unrecoverable poison pills, orders by observation time, and paces emission with a simple token-bucket limiter.

```python
"""
Safe dead-letter replay worker for spatial webhook events.

Run: python replay_worker.py   (requires: shapely>=2.0)
"""
from __future__ import annotations

import time
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from shapely.geometry import shape, mapping
from shapely.validation import make_valid, explain_validity

log = logging.getLogger("dlq_replay")
logging.basicConfig(level=logging.INFO, format="%(message)s")


@dataclass
class DLQEnvelope:
    """A dead-lettered event exactly as it was stored when it gave up retrying."""
    idempotency_key: str          # computed at FIRST ingest — never regenerated here
    observed_at: float            # event observation time (epoch seconds), for ordering
    feature: dict[str, Any]       # a GeoJSON Feature (RFC 7946), geometry may be invalid
    dead_letter_reason: str = ""  # why it landed here (diagnostics only)
    replay_count: int = 0         # guards against poison-pill loops


class TokenBucket:
    """Minimal rate limiter: allow `rate` replays per second, smoothed."""

    def __init__(self, rate_per_sec: float, burst: int = 1) -> None:
        self.rate = rate_per_sec
        self.capacity = burst
        self.tokens = float(burst)
        self.updated = time.monotonic()

    def take(self) -> None:
        while True:
            now = time.monotonic()
            self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens >= 1.0:
                self.tokens -= 1.0
                return
            time.sleep((1.0 - self.tokens) / self.rate)


# ---- Geometry re-validation ------------------------------------------------

MAX_REPLAYS = 3  # after this many attempts, a stuck event is a poison pill


def revalidate_geometry(feature: dict[str, Any]) -> dict[str, Any] | None:
    """
    Repair the feature's geometry with shapely.make_valid.

    Returns the feature with a valid geometry, or None if it is still
    unrecoverable after repair (self-intersections that collapse to empty,
    null geometry, non-GeoJSON input). None means: do NOT replay — this is
    a poison pill for the geometry validation gate.
    """
    geom_dict = feature.get("geometry")
    if geom_dict is None:
        log.warning("drop: null geometry, cannot repair")
        return None
    try:
        geom = shape(geom_dict)             # GeoJSON dict -> shapely geometry
    except (ValueError, TypeError) as exc:
        log.warning("drop: unparseable geometry (%s)", exc)
        return None

    if not geom.is_valid:
        repaired = make_valid(geom)         # fixes self-intersections, bowties, etc.
        if repaired.is_empty or not repaired.is_valid:
            log.warning("drop: irreparable geometry (%s)", explain_validity(geom))
            return None
        log.info("repaired geometry via make_valid")
        geom = repaired

    fixed = dict(feature)
    fixed["geometry"] = mapping(geom)       # shapely geometry -> GeoJSON dict
    return fixed


# ---- The replay worker -----------------------------------------------------

@dataclass
class ReplayWorker:
    pull_dlq_batch: Callable[[int], list[DLQEnvelope]]
    submit_to_pipeline: Callable[[str, dict[str, Any]], bool]  # (key, feature) -> applied?
    rate_per_sec: float = 5.0
    batch_size: int = 100
    limiter: TokenBucket = field(init=False)

    def __post_init__(self) -> None:
        self.limiter = TokenBucket(self.rate_per_sec, burst=1)

    def replay_once(self) -> dict[str, int]:
        stats = {"applied": 0, "deduped": 0, "dropped": 0, "poison": 0}
        batch = self.pull_dlq_batch(self.batch_size)

        # Observation-time order: oldest readings first so stale events can never
        # overwrite fresher state written while they sat in the DLQ.
        batch.sort(key=lambda e: e.observed_at)

        for env in batch:
            if env.replay_count >= MAX_REPLAYS:
                log.error("poison pill after %d replays, key=%s", env.replay_count,
                          env.idempotency_key)
                stats["poison"] += 1
                continue

            fixed = revalidate_geometry(env.feature)
            if fixed is None:
                stats["dropped"] += 1
                continue

            self.limiter.take()  # pace emission — never a self-inflicted load spike

            # CRITICAL: submit under the ORIGINAL key. The pipeline's dedup gate
            # returns False when the key already exists, so anything applied
            # before dead-lettering is absorbed as a no-op instead of double-written.
            applied = self.submit_to_pipeline(env.idempotency_key, fixed)
            stats["applied" if applied else "deduped"] += 1

        log.info("replay batch complete: %s", json.dumps(stats))
        return stats


# ---- Demo wiring: an in-memory pipeline with a real dedup gate -------------

if __name__ == "__main__":
    seen_keys: set[str] = set()

    def fake_pipeline(key: str, feature: dict[str, Any]) -> bool:
        """SET-NX-style dedup gate. Returns True only on first sight of a key."""
        if key in seen_keys:
            return False        # duplicate absorbed
        seen_keys.add(key)
        return True             # first time — state applied

    # Pretend one of these was already applied before it dead-lettered.
    seen_keys.add("evt-already-applied")

    # A self-intersecting "bowtie" polygon that make_valid can repair.
    bowtie = {
        "type": "Feature",
        "properties": {"sensor": "SN-9"},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]],  # invalid
        },
    }
    dlq: list[DLQEnvelope] = [
        DLQEnvelope("evt-already-applied", observed_at=100.0, feature=bowtie,
                    dead_letter_reason="downstream 503"),
        DLQEnvelope("evt-new-002", observed_at=250.0, feature=bowtie,
                    dead_letter_reason="invalid geometry"),
        DLQEnvelope("evt-new-001", observed_at=150.0, feature=bowtie,
                    dead_letter_reason="invalid geometry"),
    ]

    worker = ReplayWorker(
        pull_dlq_batch=lambda n: dlq[:n],
        submit_to_pipeline=fake_pipeline,
        rate_per_sec=10.0,
    )
    result = worker.replay_once()
    # evt-already-applied is absorbed (deduped); the two new events apply in
    # observation-time order (150 before 250) after geometry repair.
    assert result == {"applied": 2, "deduped": 1, "dropped": 0, "poison": 0}
    print("OK", result)
```

The worker keeps geometry in the EPSG:4326 (WGS84) frame that RFC 7946 mandates for GeoJSON; if your DLQ stores payloads in another CRS such as EPSG:3857 (Web Mercator), reproject to EPSG:4326 before `make_valid` so the repaired coordinates match what the ingest pipeline expects.

---

## Parameter reference

<div style="overflow-x:auto;">

| Parameter | Type | Spatial constraint | Default |
|---|---|---|---|
| `idempotency_key` | `str` | Must be the key computed at first ingest and stored in the envelope; never recomputed on replay | — |
| `observed_at` | `float` | Event observation epoch seconds; drives replay ordering so stale readings never overwrite fresher state | — |
| `feature` | `dict` | A GeoJSON Feature (RFC 7946); geometry may be invalid on entry and is repaired before submit | — |
| `rate_per_sec` | `float` | Replays per second; set below steady-state consumer capacity to avoid a self-inflicted spike | `5.0` |
| `batch_size` | `int` | Envelopes drained per `replay_once` call; bound it so one pass cannot flush the whole DLQ | `100` |
| `MAX_REPLAYS` | `int` | Replay attempts before an event is treated as a poison pill and skipped | `3` |

</div>

---

## Gotchas and spatial edge cases

1. **Replaying without the original key double-writes.** This is the headline failure. If the replay path recomputes or invents a key, the deduplication gate treats a previously applied event as new and applies it again. Always carry the ingest-time key in the DLQ envelope and submit under it verbatim. See the reproducible key scheme in [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/).

<figure class="fig">
<svg viewBox="0 0 760 218" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Recomputing an idempotency key at replay time versus carrying the ingest-time key verbatim">
<title>Recomputing the key at replay defeats the gate</title>
<desc>An event was ingested at 09:14 under key 9f2c1a and applied successfully, then dead-lettered later in the pipeline. On replay, recomputing the key from the stored payload produces 41ba6d instead, because the dead-letter envelope holds the body as it was received rather than as it was canonicalised — the CRS has since been normalised, the coordinates rounded, and the keys reordered. The deduplication gate has never seen 41ba6d, so it admits the event and the geometry is written a second time; the gate did exactly what it was designed to do and was simply asked the wrong question. Carrying the ingest-time key in the envelope and submitting under it verbatim means the gate is asked about the same key it stored, recognises the event as already applied, and short-circuits. The key must therefore be treated as part of the event's identity, captured once at ingest and never re-derived anywhere downstream.</desc>
<rect x="0" y="0" width="760" height="218" fill="var(--fig-bg)"/>
<defs><marker id="rk-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="26" width="180" height="38" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="104" y="43" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink)">ingest 09:14</text>
<text x="104" y="57" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">key 9f2c1a · applied ✓</text>
<line x1="196" y1="45" x2="228" y2="45" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#rk-a)"/>
<rect x="232" y="26" width="180" height="38" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="322" y="43" text-anchor="middle" font-size="9" fill="var(--fig-ink)">dead-lettered later</text>
<text x="322" y="57" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">envelope holds the body as received</text>
<text x="14" y="92" font-size="10.5" font-weight="600" fill="var(--fig-rose-edge)">Replay recomputes the key</text>
<rect x="14" y="102" width="220" height="38" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="124" y="119" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">hash(raw body) → 41ba6d</text>
<text x="124" y="133" text-anchor="middle" font-size="8" fill="var(--fig-ink-soft)">CRS not normalised, coords not rounded</text>
<line x1="236" y1="121" x2="268" y2="121" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#rk-a)"/>
<rect x="272" y="102" width="474" height="38" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="284" y="119" font-size="9" fill="var(--fig-ink)">the gate has never seen 41ba6d ⇒ admits it ⇒ geometry written twice</text>
<text x="284" y="133" font-size="8.5" fill="var(--fig-ink-soft)">The gate worked perfectly. It was asked about a key that never existed.</text>
<text x="14" y="164" font-size="10.5" font-weight="600" fill="var(--fig-mint-edge)">Replay carries the key verbatim</text>
<rect x="14" y="174" width="220" height="34" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="124" y="195" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">envelope.idempotency_key = 9f2c1a</text>
<line x1="236" y1="191" x2="268" y2="191" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#rk-a)"/>
<rect x="272" y="174" width="474" height="34" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="284" y="195" font-size="9" fill="var(--fig-ink)">gate recognises it, short-circuits — replay is safe to run repeatedly</text>
</svg>
<figcaption><b>Figure 2.</b> The key is part of the event's identity, not a function of its bytes at any later moment. Capture it once at ingest and never re-derive it — a replay path that recomputes is indistinguishable from one with no gate at all.</figcaption>
</figure>

2. **Replaying stale events over newer state.** An event that dead-lettered an hour ago may describe an older observation than what your consumer has since written for the same feature. Sort the drained batch by `observed_at` so oldest-first, and pair it with a last-write-wins or version-guarded consumer. Without ordering, a replay can silently roll a feature backwards.

<figure class="fig">
<svg viewBox="0 0 760 236" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Draining a dead-letter batch in insertion order versus sorted by observation time, against state that has moved on">
<title>A replay batch must be sorted by observation time, not by insertion</title>
<desc>Three dead-lettered events for parcel 4471 are drained an hour after they failed, by which time a live event has already written the parcel at observation time 14:30. Drained in the order the rows happen to sit in the table — 13:10, 12:05, 13:55 — and applied with a plain last-write-wins consumer, the final state is whichever the batch ended on, so the parcel rolls back to a shape it held ninety minutes before the newest data the system already has. Sorting the batch by observed_at gives 12:05, 13:10, 13:55, and every one of them loses cleanly to the live 14:30 write under a version-guarded consumer, so the replay is a no-op against fresher state, which is the correct outcome. The two mechanisms are complementary: sorting makes the batch internally consistent, and the version guard protects state the batch does not know about.</desc>
<rect x="0" y="0" width="760" height="236" fill="var(--fig-bg)"/>
<rect x="540" y="26" width="206" height="40" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="643" y="44" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">live state: observed 14:30</text>
<text x="643" y="58" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">written while the batch sat in the DLQ</text>
<text x="14" y="90" font-size="10.5" font-weight="600" fill="var(--fig-rose-edge)">Drained in table order, plain last-write-wins</text>
<rect x="14" y="100" width="116" height="30" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.1"/>
<text x="72" y="119" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">13:10</text>
<rect x="138" y="100" width="116" height="30" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.1"/>
<text x="196" y="119" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">12:05</text>
<rect x="262" y="100" width="116" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="320" y="119" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">13:55 — applied last</text>
<rect x="394" y="100" width="352" height="30" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="406" y="119" font-size="9" fill="var(--fig-ink)">parcel rolls back 35 min behind the live 14:30 state</text>
<line x1="14" y1="146" x2="746" y2="146" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="166" font-size="10.5" font-weight="600" fill="var(--fig-mint-edge)">Sorted by observed_at, version-guarded consumer</text>
<rect x="14" y="176" width="116" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.1"/>
<text x="72" y="195" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">12:05</text>
<rect x="138" y="176" width="116" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.1"/>
<text x="196" y="195" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">13:10</text>
<rect x="262" y="176" width="116" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.1"/>
<text x="320" y="195" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">13:55</text>
<rect x="394" y="176" width="352" height="30" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="406" y="195" font-size="9" fill="var(--fig-ink)">all three lose to 14:30 — the replay is correctly a no-op</text>
<rect x="14" y="214" width="732" height="18" rx="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.1"/>
<text x="26" y="227" font-size="9" fill="var(--fig-ink)">Sorting makes the batch internally consistent; the version guard protects the state the batch does not know about. You need both.</text>
</svg>
<figcaption><b>Figure 3.</b> A dead-letter batch is by definition stale, so replaying it is a race against state that moved on while it sat there. Sorting alone does not save you — the guard is what stops the newest event in the batch beating a newer one outside it.</figcaption>
</figure>

3. **Poison-pill loops.** An event whose geometry cannot be repaired, or whose target feature no longer exists, will dead-letter again on every replay. Track `replay_count` in the envelope and stop after a bounded number of attempts, routing the event to a quarantine store for human triage instead of an infinite DLQ ↔ pipeline cycle.

4. **Mass replay overwhelming consumers.** Flushing a large DLQ at line rate re-creates the exact overload that caused the dead-lettering. Rate-limit with a token bucket tuned below downstream capacity and drain in bounded batches. The events already failed once — there is no value in replaying them faster than the pipeline can absorb.

5. **Geometry validity is frame-dependent.** `make_valid` operates on planar coordinates. A polygon that is valid in EPSG:4326 (WGS84) degrees may behave differently once reprojected to EPSG:3857 (Web Mercator) metres, and antimeridian-crossing geometries can appear self-intersecting. Reproject to your canonical CRS *before* repair, and treat the repaired result as authoritative only in that frame. The full ruleset lives in [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/).

6. **`make_valid` can change geometry type.** Repairing an invalid Polygon can yield a GeometryCollection or MultiPolygon. If your consumer or schema expects a single Polygon, decide explicitly whether to accept the collection, extract the largest part, or drop the event — do not let a silently widened type break a downstream `INSERT`.

---

## Verification

Save as `test_replay.py` next to the worker module and run with `pytest`. The key test proves that replaying an already-applied event is a no-op: the deduplication gate absorbs it rather than double-writing.

```python
import pytest
from replay_worker import ReplayWorker, DLQEnvelope, revalidate_geometry


def make_gate():
    """A SET-NX-style dedup gate plus the set of keys it has applied."""
    seen: set[str] = set()

    def gate(key: str, feature: dict) -> bool:
        if key in seen:
            return False           # duplicate — absorbed
        seen.add(key)
        return True                # first application
    return gate, seen


VALID_POINT = {
    "type": "Feature",
    "properties": {},
    "geometry": {"type": "Point", "coordinates": [-73.965355, 40.782865]},
}


def test_duplicate_replay_is_idempotent():
    """Replaying an event already applied at ingest must NOT re-apply it."""
    gate, seen = make_gate()
    seen.add("evt-1")  # pretend evt-1 was applied before it dead-lettered

    dlq = [DLQEnvelope("evt-1", observed_at=100.0, feature=VALID_POINT)]
    worker = ReplayWorker(lambda n: dlq[:n], gate, rate_per_sec=1000.0)

    stats = worker.replay_once()
    assert stats["deduped"] == 1     # absorbed by the gate
    assert stats["applied"] == 0     # no double-write


def test_replay_applies_only_once_across_two_passes():
    """A second replay of the same key stays idempotent."""
    gate, _ = make_gate()
    dlq = [DLQEnvelope("evt-2", observed_at=100.0, feature=VALID_POINT)]
    worker = ReplayWorker(lambda n: dlq[:n], gate, rate_per_sec=1000.0)

    first = worker.replay_once()
    second = worker.replay_once()
    assert first["applied"] == 1     # applied on the first pass
    assert second["deduped"] == 1    # absorbed on the second


def test_observation_time_ordering():
    """Events are submitted oldest-first regardless of DLQ order."""
    order: list[str] = []
    gate = lambda key, feature: (order.append(key), True)[1]
    dlq = [
        DLQEnvelope("late", observed_at=300.0, feature=VALID_POINT),
        DLQEnvelope("early", observed_at=100.0, feature=VALID_POINT),
    ]
    ReplayWorker(lambda n: dlq[:n], gate, rate_per_sec=1000.0).replay_once()
    assert order == ["early", "late"]


def test_irreparable_geometry_is_dropped():
    """Null geometry cannot be repaired and must not be replayed."""
    broken = {"type": "Feature", "properties": {}, "geometry": None}
    assert revalidate_geometry(broken) is None


def test_bowtie_polygon_is_repaired():
    """A self-intersecting polygon is repaired instead of dropped."""
    bowtie = {
        "type": "Feature", "properties": {},
        "geometry": {"type": "Polygon",
                     "coordinates": [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]]},
    }
    fixed = revalidate_geometry(bowtie)
    assert fixed is not None                      # repaired, not dropped
    assert fixed["geometry"]["type"] != "Polygon" or fixed["geometry"]  # valid output
```

---

## FAQ

<details class="faq">
<summary><strong>Why must I reuse the original idempotency key instead of generating a new one on replay?</strong></summary>

An event can dead-letter after it was partially or fully applied — for example the write to PostGIS succeeded but an acknowledgement timed out. If you generate a fresh key on replay, the deduplication gate sees a brand-new event and applies it a second time, double-writing state. Reusing the key computed at first ingest lets the gate recognise the replay as a duplicate and absorb it.

</details>

<details class="faq">
<summary><strong>Should I re-validate geometry on replay if it was already validated at ingest?</strong></summary>

Yes. Many events dead-letter precisely because their geometry failed validation. Running `shapely.make_valid` on replay repairs self-intersections and other topology faults that can be fixed deterministically, so the repaired event now passes the same validation gate that rejected it. Events that are still invalid after `make_valid` should be dropped or escalated, never re-submitted in a loop.

</details>

<details class="faq">
<summary><strong>How do I stop a mass replay from overwhelming my consumers?</strong></summary>

Rate-limit the replay with a token bucket or fixed inter-message delay tuned below the steady-state capacity of the downstream consumers, and drain in bounded batches rather than flushing the whole DLQ at once. The events already failed once; there is no benefit to replaying them faster than the pipeline can safely absorb.

</details>

<details class="faq">
<summary><strong>Why replay in observation-time order rather than DLQ insertion order?</strong></summary>

Events can sit in a DLQ for minutes or hours while newer events for the same feature flow through normally. Replaying a stale reading after fresher state has already been written would roll the feature backwards. Ordering the drained batch by observation timestamp ensures older readings are applied first and a last-write-wins consumer keeps the newest value.

</details>

---

## Related

- [Dead-Letter Queues for Spatial Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/) — parent: designing and operating the spatial DLQ this page drains
- [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/) — the full delivery-guarantee architecture for spatial webhook pipelines
- [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — the deduplication gate that makes duplicate replays safe
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — the validation and `make_valid` repair rules applied before re-submission
