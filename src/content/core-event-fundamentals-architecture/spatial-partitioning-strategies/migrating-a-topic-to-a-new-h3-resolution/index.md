---
title: "Migrating a Topic to a New H3 Resolution"
description: "Changing the H3 resolution changes every partition key at once. Run both schemes side by side, let consumers key on the resolution carried in the envelope, and cut over per shard rather than per fleet."
slug: "migrating-a-topic-to-a-new-h3-resolution"
type: "article"
breadcrumb: "Core Event Fundamentals & Architecture > Spatial Partitioning Strategies > Migrating a Topic to a New H3 Resolution"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Migrating a Topic to a New H3 Resolution",
      "description": "A resolution change rewrites every partition key simultaneously, so events for one area move partition mid-stream and per-cell consumer state is orphaned. This guide runs both schemes concurrently, keys consumer state on the resolution in the envelope, and cuts over one parent cell at a time.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/migrating-a-topic-to-a-new-h3-resolution/",
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
        {"@type": "ListItem", "position": 3, "name": "Spatial Partitioning Strategies", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/"},
        {"@type": "ListItem", "position": 4, "name": "Migrating a Topic to a New H3 Resolution", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/migrating-a-topic-to-a-new-h3-resolution/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Migrate a spatial topic to a new H3 resolution",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Put the resolution in the envelope so a key is self-describing"},
        {"@type": "HowToStep", "position": 2, "name": "Teach consumers to hold state under both schemes, related by parent and children"},
        {"@type": "HowToStep", "position": 3, "name": "Cut over one parent cell at a time, not the whole fleet"},
        {"@type": "HowToStep", "position": 4, "name": "Fold the old state into the new keys before deleting it"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why is a resolution change harder than adding partitions?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because adding partitions changes where a key lands while the key itself stays the same, so per-key consumer state remains valid. A resolution change replaces every key at once: the cell that identified an area is gone and seven new ones take its place, so every piece of state filed under the old cell is orphaned and no consumer can find it by looking up the new one. It is a data migration wearing the costume of a configuration change."}
        },
        {
          "@type": "Question",
          "name": "Can I just let the old state expire?",
          "acceptedAnswer": {"@type": "Answer", "text": "Only if the state is genuinely regenerable and short-lived — a rolling count over the last five minutes, for example, which will be correct again within five minutes of the cutover. Anything cumulative or long-lived is not: a per-cell running total, a last-seen position, a deduplication key set or a tile version map will be silently reset to empty, and the symptom is not an error but a metric that starts again from zero."}
        },
        {
          "@type": "Question",
          "name": "Should I migrate the whole fleet at once or region by region?",
          "acceptedAnswer": {"@type": "Answer", "text": "Region by region, cutting over whole parent cells so that a child cell and its parent are never live at the same time for the same area. Doing it fleet-wide means every consumer rebalances simultaneously, every piece of per-cell state migrates simultaneously, and if any of it is wrong the whole stream is affected. Cutting over one parent cell exposes exactly one region to the change, which is a rollback rather than an incident."}
        }
      ]
    }
  ]
}
</script>

**Carry the resolution in the envelope so every key is self-describing, keep consumer state under both schemes during the overlap, and cut over one parent cell at a time — a resolution change replaces every partition key simultaneously, which orphans all per-cell state and is a data migration rather than a configuration change.**

This guide sits under [Spatial Partitioning Strategies](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/), within [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/). It is what to do once [Choosing an H3 Resolution from Measured Traffic](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/choosing-an-h3-resolution-from-measured-traffic/) says the current resolution has aged out.

## When to use this pattern

- Measured traffic says the hottest cell no longer fits a consumer, or that cardinality has grown past what the monitoring stack can carry.
- Consumers hold per-cell state — counters, last-seen positions, deduplication sets, tile version maps.
- The stream cannot be paused, which is the case that makes this hard; a stream that can be drained needs none of this.

## What a resolution change actually breaks

<figure class="fig">
<svg viewBox="0 0 760 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Per-cell consumer state orphaned when one parent cell is replaced by seven child cells">
<title>Seven new keys, and none of them is the old one</title>
<desc>A consumer holds state under a resolution 7 cell: a running event count of two point one million, a last-seen timestamp, and a set of deduplication keys. The resolution changes to 8, and that parent cell is replaced by seven child cells whose identifiers share no prefix a lookup can use — H3 identifiers are not hierarchical strings, so finding the parent of a cell requires a library call rather than a substring. The next event arrives keyed to one of the children. The consumer looks up that child, finds nothing, and initialises fresh state: the count restarts at one, the last-seen timestamp is now, and the deduplication set is empty so every event in the retry window is admitted a second time. Nothing raises. The count graph shows a cliff to zero that looks exactly like an outage, the deduplication failure appears as a burst of duplicate writes with no error attached, and both are attributed to whatever else happened to deploy that day. The fix is to fold the parent's state into its children before the first child event arrives, which requires knowing the mapping — which the H3 library provides and a substring comparison does not.</desc>
<rect x="0" y="0" width="760" height="240" fill="var(--fig-bg)"/>
<defs><marker id="hr-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="30" width="220" height="96" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.5"/>
<text x="26" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">state under res-7 cell 871f1d4ffff</text>
<text x="26" y="70" font-size="8.5" fill="var(--fig-ink-soft)">event count: 2 100 000</text>
<text x="26" y="86" font-size="8.5" fill="var(--fig-ink-soft)">last seen: 12:04:31Z</text>
<text x="26" y="102" font-size="8.5" fill="var(--fig-ink-soft)">dedup key set: 48 000 entries</text>
<text x="26" y="118" font-size="8.5" fill="var(--fig-ink-soft)">tile version map: 900 tiles</text>
<line x1="238" y1="78" x2="272" y2="78" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#hr-a)"/>
<text x="240" y="70" font-size="8" fill="var(--fig-ink-soft)">res 7 → 8</text>
<rect x="276" y="30" width="200" height="96" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="288" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">seven res-8 children</text>
<text x="288" y="70" font-size="8" font-family="monospace" fill="var(--fig-ink-soft)">881f1d4d61fffff …and six more</text>
<text x="288" y="88" font-size="8.5" fill="var(--fig-rose-edge)">no shared prefix a lookup can use —</text>
<text x="288" y="100" font-size="8.5" fill="var(--fig-rose-edge)">H3 ids are not hierarchical strings</text>
<text x="288" y="118" font-size="8.5" fill="var(--fig-ink-soft)">the parent is a library call away</text>
<line x1="480" y1="78" x2="514" y2="78" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#hr-a)"/>
<rect x="518" y="30" width="228" height="96" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="530" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">what the consumer does next</text>
<text x="530" y="70" font-size="8.5" fill="var(--fig-ink-soft)">looks up the child · finds nothing</text>
<text x="530" y="86" font-size="8.5" fill="var(--fig-rose-edge)">count restarts at 1 · last seen = now</text>
<text x="530" y="102" font-size="8.5" fill="var(--fig-rose-edge)">dedup set empty — the retry window is</text>
<text x="530" y="114" font-size="8.5" fill="var(--fig-rose-edge)">admitted a second time</text>
<rect x="14" y="140" width="732" height="86" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="26" y="160" font-size="10" font-weight="600" fill="var(--fig-ink)">Nothing raises, which is why this is worth the ceremony</text>
<text x="26" y="180" font-size="9" fill="var(--fig-ink-soft)">The count graph shows a cliff to zero that is indistinguishable from an outage. The deduplication failure appears as a burst</text>
<text x="26" y="194" font-size="9" fill="var(--fig-ink-soft)">of duplicate writes with no error attached to it. Both get attributed to whatever else deployed that day.</text>
<text x="26" y="216" font-size="9" fill="var(--fig-gold-edge)">Fold the parent's state into its children BEFORE the first child event arrives — the mapping is h3.cell_to_children(), not a substring.</text>
</svg>
<figcaption><b>Figure 1.</b> The state is not corrupted; it is unreachable, filed under a key nothing will ever ask for again. That distinction is what makes it survivable if handled before the cutover.</figcaption>
</figure>

## Complete runnable implementation

```python
import h3
from prometheus_client import Counter

MIGRATED = Counter("h3_state_migrated_total", "Parent cells folded into children")

OLD_RESOLUTION = 7
NEW_RESOLUTION = 8


def partition_key(lat: float, lon: float, resolution: int) -> bytes:
    """The key, and the resolution that produced it, together.

    Encoding the resolution means a consumer reading a key can tell which
    scheme it belongs to without consulting configuration that may have
    changed since the event was written.
    """
    return f"{resolution}:{h3.latlng_to_cell(lat, lon, resolution)}".encode()


def parse_key(key: bytes) -> tuple[int, str]:
    resolution, cell = key.decode().split(":", 1)
    return int(resolution), cell


class DualResolutionState:
    """Per-cell state that can answer under either scheme during the overlap."""

    def __init__(self, store, cutover: set[str]) -> None:
        self._store = store
        # Parent cells (at OLD_RESOLUTION) already migrated. Cutting over by
        # parent cell means a parent and its children are never both live.
        self._cutover = cutover

    def resolution_for(self, lat: float, lon: float) -> int:
        parent = h3.latlng_to_cell(lat, lon, OLD_RESOLUTION)
        return NEW_RESOLUTION if parent in self._cutover else OLD_RESOLUTION

    async def migrate_parent(self, parent: str) -> None:
        """Fold one parent's state into its children, then mark it cut over.

        Runs BEFORE any event is keyed to a child, so no consumer ever sees
        an empty child. Order matters more than speed here.
        """
        state = await self._store.get(f"{OLD_RESOLUTION}:{parent}")
        if state is None:
            self._cutover.add(parent)
            return

        children = h3.cell_to_children(parent, NEW_RESOLUTION)

        # Counts must be SPLIT, not copied: copying a parent's 2.1M count into
        # seven children invents 12.6M events. Splitting is also approximate —
        # which is why a count that must be exact should be recomputed rather
        # than folded, and the metric below exists to make the choice visible.
        share = state.get("event_count", 0) // len(children)

        for child in children:
            await self._store.set(f"{NEW_RESOLUTION}:{child}", {
                "event_count": share,
                "last_seen": state.get("last_seen"),        # copied: per-area fact
                "dedup_keys": state.get("dedup_keys", []),  # copied: a superset is safe
                "migrated_from": parent,
            })

        self._cutover.add(parent)
        MIGRATED.inc()
        # Delete the parent only after the children are durable. The reverse
        # order loses everything if the process dies between the two.
        await self._store.delete(f"{OLD_RESOLUTION}:{parent}")
```

Copying the deduplication set into every child is deliberately over-inclusive: a child inherits keys for events that happened in its siblings, which can only cause extra suppression, never extra admission. Erring in the other direction admits duplicates, so the asymmetry decides the design.

<figure class="fig">
<svg viewBox="0 0 760 216" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Fleet-wide cutover compared with a parent-cell-at-a-time rollout">
<title>Blast radius is the only real difference</title>
<desc>Two rollout shapes are compared for the same resolution change. A fleet-wide cutover flips every producer at once: every consumer rebalances simultaneously, every piece of per-cell state migrates simultaneously, and the whole stream is exposed to any mistake in the fold logic at the same moment. Recovery means reverting producers and hoping the old state was not deleted. A parent-cell rollout migrates one region at a time — fold that parent's state, add it to the cutover set, watch its consumers for a reporting period, then take the next. Any mistake affects one region, the rollback is removing one entry from a set, and the fold logic is exercised against real data dozens of times before the busiest region reaches it. The total work is the same and the elapsed time is longer; what changes is that a bug is a rollback instead of an incident, which for a change that silently resets counters is the difference that matters.</desc>
<rect x="0" y="0" width="760" height="216" fill="var(--fig-bg)"/>
<rect x="14" y="26" width="366" height="146" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="46" font-size="10" font-weight="600" fill="var(--fig-ink)">fleet-wide cutover</text>
<text x="26" y="68" font-size="8.5" fill="var(--fig-ink-soft)">every producer flips at one instant</text>
<text x="26" y="84" font-size="8.5" fill="var(--fig-ink-soft)">every consumer rebalances at once</text>
<text x="26" y="100" font-size="8.5" fill="var(--fig-ink-soft)">every cell's state migrates at once</text>
<text x="26" y="122" font-size="8.5" fill="var(--fig-rose-edge)">any error in the fold hits the whole stream</text>
<text x="26" y="138" font-size="8.5" fill="var(--fig-rose-edge)">rollback = revert producers and hope the</text>
<text x="26" y="150" font-size="8.5" fill="var(--fig-rose-edge)">old state was not already deleted</text>
<text x="26" y="166" font-size="8.5" fill="var(--fig-ink-soft)">fastest, and untestable at scale</text>
<rect x="392" y="26" width="354" height="146" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="404" y="46" font-size="10" font-weight="600" fill="var(--fig-ink)">one parent cell at a time</text>
<text x="404" y="68" font-size="8.5" fill="var(--fig-ink-soft)">fold that parent · add it to the cutover set</text>
<text x="404" y="84" font-size="8.5" fill="var(--fig-ink-soft)">watch its consumers for a reporting period</text>
<text x="404" y="100" font-size="8.5" fill="var(--fig-ink-soft)">take the next region</text>
<text x="404" y="122" font-size="8.5" fill="var(--fig-mint-edge)">an error affects one region</text>
<text x="404" y="138" font-size="8.5" fill="var(--fig-mint-edge)">rollback = remove one entry from a set</text>
<text x="404" y="154" font-size="8.5" fill="var(--fig-mint-edge)">the fold runs dozens of times before the</text>
<text x="404" y="166" font-size="8.5" fill="var(--fig-mint-edge)">busiest region reaches it</text>
<text x="14" y="194" font-size="9" fill="var(--fig-ink-soft)">Same total work, longer elapsed time. What changes is that a bug is a rollback rather than an incident — which for a change</text>
<text x="14" y="207" font-size="9" fill="var(--fig-ink-soft)">whose failure mode is a counter silently resetting to zero is the only difference worth paying for.</text>
</svg>
<figcaption><b>Figure 2.</b> Ordering the regions from quietest to busiest means the fold logic has been exercised against real traffic many times before it meets the region that matters.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| Key format | `bytes` | `"<resolution>:<cell>"` — self-describing, so a key needs no config to read | — |
| Cutover unit | H3 cell | A parent at `OLD_RESOLUTION`; never a bounding box or a country name | — |
| `cell_to_children` | call | Exactly 7 children per step, except around the 12 pentagons | — |
| Count fold | strategy | Split, never copy; copying multiplies totals by the child count | split |
| Dedup fold | strategy | Copy to every child — over-suppression is safe, over-admission is not | copy |
| Delete order | — | Children durable **before** the parent is removed | — |

</div>

## Gotchas and spatial edge cases

1. **H3 identifiers are not hierarchical strings.** A child does not begin with its parent's identifier, so no prefix scan, no `LIKE` query and no key-range operation will find related cells. Every relationship needs `cell_to_parent` or `cell_to_children`, which means the migration cannot be done in the database with a wildcard.

2. **Pentagons do not have seven children.** Twelve cells per resolution are pentagonal and produce six children instead of seven. Code that hard-codes seven — to split a count, to size a batch, to assert a test — is wrong exactly twelve times per resolution, in places that are usually ocean and occasionally not.

3. **Splitting a count is an estimate and should be labelled as one.** Seven equal shares of a parent's total is almost certainly not how the events were distributed. If a count feeds billing or reporting, recompute it from the source rather than folding it, and use the fold only for state that is merely an optimisation.

4. **A moving asset can cross the cutover boundary mid-journey.** With region-by-region rollout, a vehicle driving from a migrated region into an unmigrated one produces events keyed at resolution 8 then resolution 7. Consumers must handle both, which is what the resolution prefix is for — and it is why the prefix cannot be dropped the moment the last region cuts over.

5. **Partition count and cell count are different numbers.** Changing the resolution does not change how many Kafka partitions exist; it changes how keys hash into them. A finer resolution spreads load better only if the partition count is high enough to receive it, so check both together against [Detecting Partition Skew in H3-Sharded Streams](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/detecting-partition-skew-in-h3-sharded-streams/).

6. **Events already in the log keep their old keys forever.** A replay after the migration reads resolution 7 keys, so the old reader path must survive as long as the retention window and any replayable archive — the same rule as [Migrating a Spatial Stream Between Schema Versions](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/migrating-a-spatial-stream-between-schema-versions/).

## Verification

```python
import h3
import pytest

PARENT = h3.latlng_to_cell(53.5400, 9.9300, 7)


@pytest.mark.asyncio
async def test_children_inherit_before_any_event_arrives(store):
    """No consumer may ever see an empty child cell."""
    await store.set(f"7:{PARENT}", {"event_count": 2_100_000,
                                    "last_seen": "2026-08-08T12:04:31Z",
                                    "dedup_keys": ["a", "b", "c"]})
    state = DualResolutionState(store, cutover=set())
    await state.migrate_parent(PARENT)

    children = h3.cell_to_children(PARENT, 8)
    for child in children:
        loaded = await store.get(f"8:{child}")
        assert loaded is not None
        assert loaded["dedup_keys"] == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_counts_are_split_not_copied(store):
    """Copying would turn 2.1M events into 14.7M."""
    await store.set(f"7:{PARENT}", {"event_count": 2_100_000})
    state = DualResolutionState(store, cutover=set())
    await state.migrate_parent(PARENT)

    children = h3.cell_to_children(PARENT, 8)
    total = sum((await store.get(f"8:{c}"))["event_count"] for c in children)
    assert total <= 2_100_000


def test_pentagon_children_are_not_assumed_to_be_seven():
    """Twelve cells per resolution have six children, not seven."""
    pentagon = next(c for c in h3.get_pentagons(7))
    assert len(h3.cell_to_children(pentagon, 8)) == 6


@pytest.mark.asyncio
async def test_uncut_region_still_keys_at_the_old_resolution(store):
    """A vehicle crossing the boundary must produce both key shapes."""
    state = DualResolutionState(store, cutover={PARENT})
    assert state.resolution_for(53.5400, 9.9300) == 8      # migrated region
    assert state.resolution_for(48.1372, 11.5756) == 7     # not yet
```

The count test uses `<=` rather than `==` because integer division loses a remainder — which is itself worth noticing, since the missing events are exactly the kind of small permanent discrepancy that shows up in a reconciliation report months later.

## Related

- [Spatial Partitioning Strategies](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/) — the topic this guide belongs to
- [Choosing an H3 Resolution from Measured Traffic](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/choosing-an-h3-resolution-from-measured-traffic/) — the measurement that decides the target resolution
- [Partitioning Kafka Topics by H3 Cell](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/partitioning-kafka-topics-by-h3-cell/) — how the key reaches a partition, and why partition count is a separate lever
- [Detecting Partition Skew in H3-Sharded Streams](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/detecting-partition-skew-in-h3-sharded-streams/) — confirming the migration achieved what it was for
