---
title: "Debouncing Rapid Feature Edits"
description: "An editor dragging a vertex emits an event per mouse-up. Collapse the burst with a per-feature timer that has a maximum wait, and merge the payloads so the first geometry and the last are both preserved."
slug: "debouncing-rapid-feature-edits"
type: "article"
breadcrumb: "Core Event Fundamentals & Architecture > Feature Change Triggers > Debouncing Rapid Feature Edits"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Debouncing Rapid Feature Edits",
      "description": "A GIS editor reshaping a polygon emits one change event per vertex drag, and downstream every one of them triggers a tile rebuild. This guide implements a per-feature debounce with a maximum wait, and shows why the merged payload must keep the first geometry as well as the last.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/debouncing-rapid-feature-edits/",
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
        {"@type": "ListItem", "position": 3, "name": "Feature Change Triggers", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/"},
        {"@type": "ListItem", "position": 4, "name": "Debouncing Rapid Feature Edits", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/debouncing-rapid-feature-edits/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Debounce a burst of feature edits into one event",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Key the debounce on the feature, never on the stream"},
        {"@type": "HowToStep", "position": 2, "name": "Add a maximum wait so a continuously edited feature still emits"},
        {"@type": "HowToStep", "position": 3, "name": "Merge payloads keeping the first previous-geometry and the last geometry"},
        {"@type": "HowToStep", "position": 4, "name": "Flush pending timers on shutdown, or the last edit of every burst is lost"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does debouncing need a maximum wait?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because a plain debounce timer resets on every edit, so a feature that is edited continuously never emits at all. An operator dragging vertices for four minutes produces no downstream event for four minutes, and a tile pipeline that looked fine in testing goes silent under exactly the workload it exists for. A maximum wait caps that: the event fires once the quiet period elapses, or once the maximum has passed since the first edit in the burst, whichever comes first."}
        },
        {
          "@type": "Question",
          "name": "Why keep the first previous-geometry rather than the last?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because the merged event has to describe the whole burst, and the area affected is the union of where the feature was when the burst started and where it ended. Keeping the last intermediate previous-geometry describes only the final drag, so any tile the feature occupied at the start of the edit and left during it is never invalidated — it keeps serving the old shape until something else happens to touch it."}
        },
        {
          "@type": "Question",
          "name": "Should debouncing happen before or after the broker?",
          "acceptedAnswer": {"@type": "Answer", "text": "After capture and before the expensive consumer, which usually means a small stateful stage in front of the tile or index pipeline rather than in the capture process itself. Debouncing at capture loses the audit trail — the individual edits never reach the log — while debouncing inside the expensive consumer means it has already paid to receive every event. A separate stage keeps the full history in the topic and collapses only what is about to become work."}
        }
      ]
    }
  ]
}
</script>

**Key the debounce on the feature identifier, give it a maximum wait so a continuously edited feature still emits, and merge the burst so the event carries the geometry from before the first edit and after the last — keeping the most recent intermediate geometry leaves every tile the feature has left behind serving a stale shape.**

This guide sits under [Feature Change Triggers](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/), within [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/). It handles the burst that [Capturing PostGIS Changes with Logical Replication](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/capturing-postgis-changes-with-logical-replication/) faithfully produces, one event per vertex drag.

## When to use this pattern

- A human editor or a bulk process produces many edits to the same feature within seconds, and each one currently triggers downstream work.
- The downstream work is expensive relative to the edit — a tile rebuild, a spatial index update, a notification — so collapsing ten events into one is a real saving.
- Losing the intermediate states is acceptable to the consumer. If an audit trail needs every edit, debounce in front of the expensive consumer only, and leave the topic intact.

## What a burst actually looks like

<figure class="fig">
<svg viewBox="0 0 760 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A vertex-drag burst producing eleven change events and eleven tile rebuilds, collapsed to one">
<title>Eleven events, one meaningful change</title>
<desc>An operator reshapes a polygon over about twelve seconds, releasing the mouse eleven times. Each release commits a transaction, so the capture stage emits eleven change events, and a tile pipeline downstream rebuilds every affected tile eleven times — of which ten rebuilds are immediately superseded by the next. The work is not merely wasted: each rebuild also invalidates a cache entry that clients then re-fetch, so a twelve-second edit produces eleven cache-invalidation waves across every viewer of that area. With a debounce keyed on the feature, the eleven events become one, emitted three hundred milliseconds after the operator stops. The saving is proportional to burst length, and burst length is set by how carefully somebody is working — which means the busiest editing sessions produce the largest bursts and the biggest saving, and also that a naive timer without a maximum wait fails hardest on exactly those sessions.</desc>
<rect x="0" y="0" width="760" height="220" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one operator reshaping one polygon · 12 seconds</text>
<text x="14" y="42" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">without debounce</text>
<line x1="120" y1="60" x2="740" y2="60" stroke="var(--fig-line)" stroke-width="1.2"/>
<circle cx="140" cy="60" r="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<circle cx="188" cy="60" r="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<circle cx="230" cy="60" r="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<circle cx="286" cy="60" r="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<circle cx="330" cy="60" r="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<circle cx="392" cy="60" r="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<circle cx="440" cy="60" r="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<circle cx="498" cy="60" r="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<circle cx="556" cy="60" r="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<circle cx="618" cy="60" r="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<circle cx="676" cy="60" r="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="140" y="82" font-size="8.5" fill="var(--fig-rose-edge)">11 change events → 11 tile rebuilds → 11 cache-invalidation waves across every viewer</text>
<text x="14" y="118" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">with a 300 ms per-feature debounce</text>
<line x1="120" y1="136" x2="740" y2="136" stroke="var(--fig-line)" stroke-width="1.2"/>
<rect x="136" y="128" width="546" height="16" rx="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="146" y="140" font-size="8" fill="var(--fig-ink-soft)">timer resets on each edit</text>
<circle cx="706" cy="136" r="5.5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="380" y="158" font-size="8.5" fill="var(--fig-mint-edge)">one event, 300 ms after the operator stops</text>
<rect x="14" y="172" width="732" height="40" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="190" font-size="9" fill="var(--fig-ink-soft)">Burst length is set by how carefully somebody is working, so the busiest sessions produce the biggest saving — and also</text>
<text x="26" y="204" font-size="9" fill="var(--fig-ink-soft)">the longest chains of resets, which is exactly where a timer without a maximum wait goes silent.</text>
</svg>
<figcaption><b>Figure 1.</b> Ten of the eleven rebuilds are superseded before anyone sees them, and each one still costs a cache invalidation for every viewer of that area.</figcaption>
</figure>

## Complete runnable implementation

```python
import asyncio
import time
from dataclasses import dataclass, field

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

QUIET_SECONDS = 0.3      # emit this long after the last edit
MAX_WAIT_SECONDS = 5.0   # …but never hold an edit longer than this


@dataclass(slots=True)
class Pending:
    """State for one feature's in-flight burst."""
    first_seen: float
    event: dict
    handle: asyncio.TimerHandle | None = None
    merged: int = 1


class FeatureDebouncer:
    def __init__(self, emit, quiet: float = QUIET_SECONDS,
                 max_wait: float = MAX_WAIT_SECONDS) -> None:
        self._emit = emit
        self._quiet = quiet
        self._max_wait = max_wait
        self._pending: dict[str, Pending] = {}

    def submit(self, event: dict) -> None:
        """Accept one change event; emit later, merged."""
        loop = asyncio.get_running_loop()
        key = event["feature_id"]
        now = loop.time()
        current = self._pending.get(key)

        if current is None:
            self._pending[key] = current = Pending(first_seen=now, event=event)
        else:
            current.event = _merge(current.event, event)
            current.merged += 1
            if current.handle is not None:
                current.handle.cancel()

        # The maximum wait is measured from the FIRST edit of the burst, so a
        # feature under continuous editing still emits. Without this line a
        # four-minute reshaping session produces nothing for four minutes.
        deadline = min(now + self._quiet, current.first_seen + self._max_wait)
        current.handle = loop.call_at(deadline, self._fire, key)

    def _fire(self, key: str) -> None:
        pending = self._pending.pop(key, None)
        if pending is None:
            return
        pending.event["merged_edits"] = pending.merged
        pending.event["burst_seconds"] = round(
            asyncio.get_running_loop().time() - pending.first_seen, 3
        )
        asyncio.create_task(self._emit(pending.event))

    async def drain(self) -> None:
        """Flush every pending timer. MUST run on shutdown.

        Without it, the last edit of every in-flight burst is dropped — the
        one edit the operator most recently made, and the only one they will
        look for.
        """
        for key in list(self._pending):
            handle = self._pending[key].handle
            if handle is not None:
                handle.cancel()
            self._fire(key)
        await asyncio.sleep(0)


def _merge(old: dict, new: dict) -> dict:
    """Combine two change events for the same feature.

    The geometry is the newest one; the previous_geometry is the OLDEST,
    because the merged event has to describe the whole burst. Taking the
    newest previous_geometry describes only the final drag, leaving every
    tile the feature occupied at the start of the burst uninvalidated.
    """
    merged = dict(new)
    merged["previous_geometry"] = old.get("previous_geometry")
    merged["occurred_at"] = new["occurred_at"]

    # An insert followed by updates is still an insert to anyone downstream.
    if old["action"] == "insert":
        merged["action"] = "insert"
    # …and anything followed by a delete is a delete.
    if new["action"] == "delete":
        merged["action"] = "delete"
        merged["geometry"] = None
    return merged


def affected_area(event: dict):
    """Union of where the feature was and where it is — what to invalidate."""
    parts = [shape(g) for g in (event.get("previous_geometry"), event.get("geometry")) if g]
    return mapping(unary_union(parts)) if parts else None
```

<figure class="fig">
<svg viewBox="0 0 760 218" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A polygon moved across a burst, showing which tiles are invalidated when the merge keeps the first previous-geometry versus the last">
<title>Keep the first previous-geometry, or leave tiles behind</title>
<desc>A polygon is dragged across a tile grid during one editing burst, from the upper-left tiles to the lower-right ones through two intermediate positions. If the merged event keeps the oldest previous-geometry, the affected area is the union of the starting shape and the final shape, so every tile the feature occupied at the start and every tile it occupies now are invalidated, and the map is consistent. If the merge instead keeps the most recent intermediate previous-geometry — which is what a naive last-write-wins merge produces — the affected area covers only the final drag, so the tiles the feature left at the beginning of the burst are never invalidated. Those tiles keep serving the polygon in its original position, and nothing will correct them until some unrelated edit happens to touch the same tile, which for a quiet rural area can be months. The symptom is a feature that appears twice on the map at two different zoom levels, and it is impossible to reproduce from a single edit because it needs a burst.</desc>
<rect x="0" y="0" width="760" height="218" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one polygon dragged across a tile grid during a single burst</text>
<g stroke="var(--fig-line-soft)" stroke-width="1" fill="none">
<rect x="30" y="30" width="60" height="44"/><rect x="90" y="30" width="60" height="44"/><rect x="150" y="30" width="60" height="44"/><rect x="210" y="30" width="60" height="44"/>
<rect x="30" y="74" width="60" height="44"/><rect x="90" y="74" width="60" height="44"/><rect x="150" y="74" width="60" height="44"/><rect x="210" y="74" width="60" height="44"/>
<rect x="30" y="118" width="60" height="44"/><rect x="90" y="118" width="60" height="44"/><rect x="150" y="118" width="60" height="44"/><rect x="210" y="118" width="60" height="44"/>
</g>
<rect x="40" y="40" width="52" height="34" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.4"/>
<text x="44" y="60" font-size="7.5" fill="var(--fig-ink)">start</text>
<rect x="100" y="76" width="52" height="34" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.1" stroke-dasharray="3 2"/>
<rect x="160" y="106" width="52" height="34" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.1" stroke-dasharray="3 2"/>
<rect x="212" y="122" width="52" height="34" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="216" y="142" font-size="7.5" fill="var(--fig-ink)">end</text>
<rect x="300" y="30" width="216" height="132" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="312" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">keep the OLDEST previous_geometry</text>
<text x="312" y="70" font-size="8.5" fill="var(--fig-ink-soft)">affected area = union(start, end)</text>
<text x="312" y="86" font-size="8.5" fill="var(--fig-mint-edge)">every tile it left and every tile it now</text>
<text x="312" y="98" font-size="8.5" fill="var(--fig-mint-edge)">occupies is invalidated</text>
<text x="312" y="120" font-size="8.5" fill="var(--fig-ink-soft)">the map is consistent after one event</text>
<text x="312" y="142" font-size="8.5" fill="var(--fig-ink-soft)">costs one extra geometry in the payload</text>
<rect x="528" y="30" width="218" height="132" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="540" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">keep the NEWEST — last-write-wins</text>
<text x="540" y="70" font-size="8.5" fill="var(--fig-ink-soft)">affected area = union(3rd position, end)</text>
<text x="540" y="86" font-size="8.5" fill="var(--fig-rose-edge)">the two tiles it left at the start of the</text>
<text x="540" y="98" font-size="8.5" fill="var(--fig-rose-edge)">burst are never invalidated</text>
<text x="540" y="120" font-size="8.5" fill="var(--fig-ink-soft)">they keep serving the original shape until</text>
<text x="540" y="132" font-size="8.5" fill="var(--fig-ink-soft)">an unrelated edit touches the same tile</text>
<text x="540" y="152" font-size="8.5" fill="var(--fig-rose-edge)">in a quiet area, that can be months</text>
<rect x="14" y="172" width="732" height="34" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="191" font-size="9" fill="var(--fig-ink-soft)">The symptom is a feature that appears in two places on the map. It cannot be reproduced from a single edit, because it</text>
<text x="26" y="202" font-size="9" fill="var(--fig-ink-soft)">requires a burst — which is why the merge rule is worth a comment in the code rather than a line in a runbook.</text>
</svg>
<figcaption><b>Figure 2.</b> The naive merge is not merely less accurate; it produces map state that will not self-correct, because nothing downstream knows those tiles are wrong.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `QUIET_SECONDS` | `float` | Above the interval between vertex drags (~150–250 ms for a human) | `0.3` |
| `MAX_WAIT_SECONDS` | `float` | Below the freshness objective for the affected tiles | `5.0` |
| Debounce key | `str` | The feature id — never the stream or the tile, or unrelated edits collapse | — |
| `previous_geometry` | GeoJSON | Must be the burst's **first**, so the invalidation area is complete | — |
| `merged_edits` | `int` | Emitted for observability; a value of 1 means the debounce did nothing | `1` |
| `drain()` | coroutine | Must run on shutdown, or the last edit of every burst is lost | — |

</div>

## Gotchas and spatial edge cases

1. **Debouncing on the stream instead of the feature collapses unrelated edits.** With one timer for the whole stream, an operator editing a parcel in Hamburg suppresses an unrelated edit in Munich, and the second feature's event carries the first feature's geometry. The key must be the feature identifier, and the memory cost of one timer per in-flight feature is the price of correctness.

2. **A delete inside a burst wins, and it must null the geometry.** An insert-then-delete pair inside the quiet window collapses to a delete of something no consumer ever saw. That is correct, and it means consumers must tolerate a delete for an unknown feature rather than treating it as an error.

3. **`MAX_WAIT_SECONDS` has to sit below the freshness objective.** Debouncing deliberately delays events, which spends the freshness budget defined in [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/). A five-second maximum against a sixty-second objective is comfortable; a sixty-second maximum against the same objective consumes the entire budget before the pipeline has done any work.

4. **The debouncer is in-memory state, so it changes the delivery guarantee.** A process killed with pending timers loses those bursts unless `drain()` runs. If that is unacceptable, keep the pending state in Redis with a TTL and accept the round trip — but do not pretend an in-memory dictionary survives a deploy.

5. **Union of the before and after geometry is not always the right invalidation area.** For a feature that moved a long way, the union's bounding box covers everything in between, which can be thousands of untouched tiles. Invalidate against the two geometries separately rather than their combined envelope, as [Scoping Tile Invalidation to the Zoom Levels That Changed](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/scoping-tile-invalidation-to-the-zoom-levels-that-changed/) describes.

## Verification

```python
import asyncio
import pytest

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]}
MOVED = {"type": "Polygon", "coordinates": [[[5, 5], [5, 6], [6, 6], [6, 5], [5, 5]]]}


@pytest.mark.asyncio
async def test_burst_collapses_to_one_event():
    out = []
    d = FeatureDebouncer(emit=lambda e: out.append(e) or asyncio.sleep(0), quiet=0.05)
    for i in range(11):
        d.submit({"feature_id": "f-1", "action": "update", "occurred_at": str(i),
                  "geometry": SQUARE, "previous_geometry": SQUARE})
        await asyncio.sleep(0.01)
    await asyncio.sleep(0.1)
    assert len(out) == 1 and out[0]["merged_edits"] == 11


@pytest.mark.asyncio
async def test_max_wait_fires_during_continuous_editing():
    """The failure a plain debounce has: never emitting at all."""
    out = []
    d = FeatureDebouncer(emit=lambda e: out.append(e) or asyncio.sleep(0),
                         quiet=0.05, max_wait=0.2)
    for _ in range(40):                       # 0.4 s of unbroken editing
        d.submit({"feature_id": "f-1", "action": "update", "occurred_at": "t",
                  "geometry": SQUARE, "previous_geometry": SQUARE})
        await asyncio.sleep(0.01)
    assert out, "a continuously edited feature must still emit"


def test_merge_keeps_the_first_previous_geometry():
    """The rule that keeps tiles from being left behind."""
    first = {"feature_id": "f-1", "action": "update", "occurred_at": "t1",
             "geometry": SQUARE, "previous_geometry": SQUARE}
    last = {"feature_id": "f-1", "action": "update", "occurred_at": "t9",
            "geometry": MOVED, "previous_geometry": MOVED}
    merged = _merge(first, last)
    assert merged["previous_geometry"] == SQUARE
    assert merged["geometry"] == MOVED
```

The second test is worth running with a real clock rather than a mocked one. A mocked loop makes the maximum-wait bug invisible, because the reset chain that causes it only appears when the edits genuinely arrive faster than the quiet period.

## Related

- [Feature Change Triggers](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/) — the topic this guide belongs to
- [Capturing PostGIS Changes with Logical Replication](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/capturing-postgis-changes-with-logical-replication/) — the capture stage that produces the burst
- [Tile Update Event Pipelines](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/) — the expensive consumer the debounce protects
- [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/) — the freshness budget the maximum wait spends
