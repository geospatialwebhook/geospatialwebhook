---
title: "Implementing a Version Vector for Spatial Features"
description: "Last-write-wins on a timestamp discards concurrent edits and cannot tell them from sequential ones. A version vector per feature makes concurrency detectable, so a real conflict reaches a merge instead of being silently resolved by a clock."
slug: "implementing-a-version-vector-for-spatial-features"
type: "article"
breadcrumb: "Idempotency & Spatial Deduplication > Conflict Resolution Strategies > Implementing a Version Vector for Spatial Features"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Implementing a Version Vector for Spatial Features",
      "description": "A timestamp cannot distinguish a concurrent edit from a sequential one, so last-write-wins silently discards work. This guide implements a per-feature version vector that makes concurrency detectable, and routes only genuine conflicts to a geometric merge.",
      "url": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/implementing-a-version-vector-for-spatial-features/",
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
        {"@type": "ListItem", "position": 3, "name": "Conflict Resolution Strategies", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/"},
        {"@type": "ListItem", "position": 4, "name": "Implementing a Version Vector for Spatial Features", "item": "https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/implementing-a-version-vector-for-spatial-features/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Implement a version vector for spatial features",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Give every writer a stable identifier and a per-feature counter"},
        {"@type": "HowToStep", "position": 2, "name": "Compare vectors to classify each incoming edit as newer, older or concurrent"},
        {"@type": "HowToStep", "position": 3, "name": "Apply newer edits, drop older ones, and route concurrent ones to a merge"},
        {"@type": "HowToStep", "position": 4, "name": "Prune retired writers so the vector does not grow forever"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why is a timestamp not enough to resolve a conflict?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because a timestamp orders every pair of edits, including pairs that were made independently and know nothing about each other. Two editors who both start from version four and each save a different reshaping produce two edits with different timestamps, and last-write-wins discards one of them without anybody being told. A version vector distinguishes the case where one edit genuinely followed the other from the case where neither did, and only the second is a conflict."}
        },
        {
          "@type": "Question",
          "name": "How large does a version vector get?",
          "acceptedAnswer": {"@type": "Answer", "text": "One entry per writer that has ever edited that feature, which is bounded by the number of writers rather than the number of edits. That stays small for a handful of regional services and grows uncomfortably if every mobile client is its own writer. Assign writer identity to the service accepting the edit rather than to the device making it, and prune entries for writers that have been retired and whose counters are dominated everywhere."}
        },
        {
          "@type": "Question",
          "name": "What should happen when two edits are genuinely concurrent?",
          "acceptedAnswer": {"@type": "Answer", "text": "Route them to a resolution step that knows about geometry, and never let the transport layer decide. For attribute changes an application rule usually applies. For geometry, the union of two independent reshapings is often right for coverage areas and always wrong for parcels, where an overlap is a legal dispute rather than a merge. What matters is that the conflict is visible: silently choosing one edit is the failure the vector exists to prevent."}
        }
      ]
    }
  ]
}
</script>

**Give each writer a stable identifier and a per-feature counter, then compare vectors to classify an incoming edit as newer, older or concurrent — a timestamp orders every pair of edits including ones made independently, so last-write-wins discards work without anybody being told it happened.**

This guide sits under [Conflict Resolution Strategies](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/), within [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/). It provides the detection half; the geometric resolution half is [Merging Overlapping Zone Edits with Shapely](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/merging-overlapping-zone-edits-with-shapely/).

## When to use this pattern

- More than one service or region can edit the same feature, and they do not coordinate through a single lock.
- Edits can arrive out of order, either because of retries or because a client was offline — the case covered in [Handling Out-of-Order Pings from Intermittent Devices](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/handling-out-of-order-pings-from-intermittent-devices/) for positions and here for edits.
- Silently discarding an edit is unacceptable, which for anything a human typed it usually is.

## What a timestamp cannot see

<figure class="fig">
<svg viewBox="0 0 760 234" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Two edit histories that produce identical timestamps but different causal structures">
<title>Same timestamps, different truths</title>
<desc>Two scenarios are drawn side by side, and a timestamp cannot tell them apart. In the first, editor A saves a change at twelve oh one, editor B loads that change and refines it, saving at twelve oh three. B's edit is causally after A's: it incorporates A's work, and applying it while discarding A's is exactly right. In the second, both editors load version four at twelve hundred hours. A saves at twelve oh one and B, who never saw A's change, saves at twelve oh three. The timestamps are identical to the first scenario, but B's edit does not incorporate A's — applying B and discarding A destroys A's work with no record that anything was lost. A version vector separates them: in the first case B's vector dominates A's, because B's counter for A's writer identity was advanced by having read A's edit. In the second, neither vector dominates, and the pair is flagged as concurrent so a resolution step can run instead of a clock comparison.</desc>
<rect x="0" y="0" width="760" height="234" fill="var(--fig-bg)"/>
<defs><marker id="vv-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="26" width="366" height="150" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="46" font-size="9.5" font-weight="600" fill="var(--fig-ink)">sequential — B read A's edit</text>
<rect x="30" y="58" width="96" height="30" rx="4" fill="var(--fig-bg)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="40" y="70" font-size="8" fill="var(--fig-ink)">A saves 12:01</text>
<text x="40" y="82" font-size="7.5" font-family="monospace" fill="var(--fig-ink-soft)">{A:5, B:0}</text>
<line x1="130" y1="73" x2="164" y2="73" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#vv-a)"/>
<rect x="168" y="58" width="110" height="30" rx="4" fill="var(--fig-bg)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="178" y="70" font-size="8" fill="var(--fig-ink)">B loads, refines 12:03</text>
<text x="178" y="82" font-size="7.5" font-family="monospace" fill="var(--fig-ink-soft)">{A:5, B:1}</text>
<text x="30" y="112" font-size="8.5" fill="var(--fig-mint-edge)">B's vector dominates A's — B has seen everything A had</text>
<text x="30" y="130" font-size="8.5" fill="var(--fig-ink-soft)">applying B and discarding A is correct: B's edit</text>
<text x="30" y="142" font-size="8.5" fill="var(--fig-ink-soft)">already contains A's work</text>
<text x="30" y="164" font-size="8.5" fill="var(--fig-ink)">last-write-wins gets this case right, by luck</text>
<rect x="392" y="26" width="354" height="150" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="404" y="46" font-size="9.5" font-weight="600" fill="var(--fig-ink)">concurrent — neither saw the other</text>
<rect x="408" y="58" width="96" height="30" rx="4" fill="var(--fig-bg)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="418" y="70" font-size="8" fill="var(--fig-ink)">A saves 12:01</text>
<text x="418" y="82" font-size="7.5" font-family="monospace" fill="var(--fig-ink-soft)">{A:5, B:0}</text>
<rect x="528" y="58" width="96" height="30" rx="4" fill="var(--fig-bg)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="538" y="70" font-size="8" fill="var(--fig-ink)">B saves 12:03</text>
<text x="538" y="82" font-size="7.5" font-family="monospace" fill="var(--fig-ink-soft)">{A:4, B:1}</text>
<text x="640" y="76" font-size="8" fill="var(--fig-rose-edge)">both from v4</text>
<text x="404" y="112" font-size="8.5" fill="var(--fig-rose-edge)">neither vector dominates — flagged concurrent</text>
<text x="404" y="130" font-size="8.5" fill="var(--fig-ink-soft)">identical timestamps to the left-hand case, and a</text>
<text x="404" y="142" font-size="8.5" fill="var(--fig-ink-soft)">completely different meaning</text>
<text x="404" y="164" font-size="8.5" fill="var(--fig-rose-edge)">last-write-wins destroys A's work, silently</text>
<rect x="14" y="188" width="732" height="34" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="206" font-size="9" fill="var(--fig-ink-soft)">The difference is whether B's counter for A was advanced by reading A's edit. That fact is available to the writer and</text>
<text x="26" y="218" font-size="9" fill="var(--fig-ink-soft)">absent from the clock, which is why no amount of clock precision fixes the right-hand case.</text>
</svg>
<figcaption><b>Figure 1.</b> Better clocks do not help. The missing information is causal — whether one editor had seen the other's work — and only the writer knows it.</figcaption>
</figure>

## Complete runnable implementation

```python
from dataclasses import dataclass, field
from enum import Enum


class Relation(Enum):
    NEWER = "newer"           # incoming dominates stored — apply it
    OLDER = "older"           # stored dominates incoming — drop it
    EQUAL = "equal"           # the same edit, redelivered
    CONCURRENT = "concurrent" # neither dominates — a real conflict


@dataclass(slots=True)
class VersionVector:
    """One counter per writer that has edited this feature."""
    counters: dict[str, int] = field(default_factory=dict)

    def advance(self, writer: str) -> "VersionVector":
        """Called when `writer` makes an edit having seen everything in self."""
        merged = dict(self.counters)
        merged[writer] = merged.get(writer, 0) + 1
        return VersionVector(merged)

    def merge(self, other: "VersionVector") -> "VersionVector":
        """Pointwise maximum — the knowledge of both, after a resolution."""
        writers = set(self.counters) | set(other.counters)
        return VersionVector({
            w: max(self.counters.get(w, 0), other.counters.get(w, 0))
            for w in writers
        })

    def compare(self, other: "VersionVector") -> Relation:
        """Classify self (incoming) against other (stored).

        Domination is pointwise: self is newer only if it is >= other for
        EVERY writer and > for at least one. If each has a counter the other
        does not dominate, the edits are concurrent — which is the case a
        timestamp comparison cannot represent at all.
        """
        writers = set(self.counters) | set(other.counters)
        self_ahead = any(self.counters.get(w, 0) > other.counters.get(w, 0)
                         for w in writers)
        other_ahead = any(other.counters.get(w, 0) > self.counters.get(w, 0)
                          for w in writers)

        if self_ahead and other_ahead:
            return Relation.CONCURRENT
        if self_ahead:
            return Relation.NEWER
        if other_ahead:
            return Relation.OLDER
        return Relation.EQUAL

    def prune(self, active_writers: set[str]) -> "VersionVector":
        """Drop retired writers so the vector stays bounded.

        Safe only once no in-flight edit can still carry the retired writer's
        counter — in practice, after the topic's retention has passed.
        """
        return VersionVector({w: n for w, n in self.counters.items()
                              if w in active_writers})


@dataclass(slots=True)
class FeatureEdit:
    feature_id: str
    writer: str
    vector: VersionVector
    geometry: dict
    crs: str = "EPSG:4326"


def apply_edit(stored: FeatureEdit | None, incoming: FeatureEdit,
               resolve) -> FeatureEdit:
    """Apply one edit, routing genuine conflicts to `resolve`."""
    if stored is None:
        return incoming

    match incoming.vector.compare(stored.vector):
        case Relation.NEWER:
            return incoming
        case Relation.OLDER | Relation.EQUAL:
            return stored
        case Relation.CONCURRENT:
            # The transport layer must NOT decide this. `resolve` knows about
            # geometry and about what the feature means; the comparison above
            # only knows that a decision is needed.
            merged_geometry = resolve(stored, incoming)
            return FeatureEdit(
                feature_id=stored.feature_id,
                writer=incoming.writer,
                vector=stored.vector.merge(incoming.vector).advance(incoming.writer),
                geometry=merged_geometry,
                crs=stored.crs,
            )
```

The `EQUAL` case is what makes this idempotent: a redelivered edit carries exactly the vector already stored, so it is dropped without any comparison of geometry or timestamps.

<figure class="fig">
<svg viewBox="0 0 760 206" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The four relations between an incoming vector and a stored one, and the action each implies">
<title>Four relations, four actions, one of which needs a human decision</title>
<desc>An incoming edit's vector is compared pointwise against the stored one, producing four possible relations. If the incoming vector is greater than or equal at every writer and strictly greater at one, it is newer and is applied — the writer had seen everything the stored version contained. If the stored vector dominates in the same way, the incoming edit is older, which happens on a delayed redelivery, and it is dropped. If the two vectors are identical the edit is a duplicate of what is already stored, and dropping it is what makes the whole scheme idempotent under at-least-once delivery. If each vector is ahead of the other at some writer, the edits are concurrent: no ordering exists between them, and any rule that picks one is discarding work. Only the fourth case needs a resolution step, and in a well-behaved system it is rare — which is the point, because a rare case that is visible can be given a careful answer, while a rare case that is invisible gets last-write-wins forever.</desc>
<rect x="0" y="0" width="760" height="206" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">incoming vector compared pointwise against stored</text>
<rect x="14" y="30" width="180" height="120" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">NEWER</text>
<text x="26" y="70" font-size="8" font-family="monospace" fill="var(--fig-ink-soft)">≥ everywhere, &gt; somewhere</text>
<text x="26" y="90" font-size="8.5" fill="var(--fig-ink-soft)">the writer had seen everything</text>
<text x="26" y="102" font-size="8.5" fill="var(--fig-ink-soft)">the stored version contained</text>
<text x="26" y="126" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">apply it</text>
<rect x="202" y="30" width="180" height="120" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.4"/>
<text x="214" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">OLDER</text>
<text x="214" y="70" font-size="8" font-family="monospace" fill="var(--fig-ink-soft)">stored dominates</text>
<text x="214" y="90" font-size="8.5" fill="var(--fig-ink-soft)">a delayed redelivery, or an</text>
<text x="214" y="102" font-size="8.5" fill="var(--fig-ink-soft)">edit overtaken in flight</text>
<text x="214" y="126" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">drop it</text>
<rect x="390" y="30" width="180" height="120" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.4"/>
<text x="402" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">EQUAL</text>
<text x="402" y="70" font-size="8" font-family="monospace" fill="var(--fig-ink-soft)">identical vectors</text>
<text x="402" y="90" font-size="8.5" fill="var(--fig-ink-soft)">the same edit arriving twice</text>
<text x="402" y="110" font-size="8.5" fill="var(--fig-mint-edge)">this case is what makes the</text>
<text x="402" y="122" font-size="8.5" fill="var(--fig-mint-edge)">scheme idempotent</text>
<text x="402" y="140" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">drop it</text>
<rect x="578" y="30" width="168" height="120" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="590" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">CONCURRENT</text>
<text x="590" y="70" font-size="8" font-family="monospace" fill="var(--fig-ink-soft)">each ahead somewhere</text>
<text x="590" y="90" font-size="8.5" fill="var(--fig-ink-soft)">no ordering exists · any rule</text>
<text x="590" y="102" font-size="8.5" fill="var(--fig-ink-soft)">that picks one discards work</text>
<text x="590" y="126" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">resolve, with geometry</text>
<rect x="14" y="162" width="732" height="34" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="26" y="181" font-size="9" fill="var(--fig-ink-soft)">Only the fourth needs a decision, and in a healthy system it is rare. That is the point: a rare case that is visible gets a</text>
<text x="26" y="192" font-size="9" fill="var(--fig-ink-soft)">careful answer, while a rare case that is invisible gets last-write-wins forever.</text>
</svg>
<figcaption><b>Figure 2.</b> Three of the four are mechanical. The value of the scheme is that it isolates the one that is not, instead of resolving it by accident.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| Writer identity | `str` | The service accepting the edit, not the device making it | — |
| `counters` | `dict[str, int]` | One entry per writer that has ever touched this feature | `{}` |
| `advance` | call | Only after reading the current state — advancing blind fabricates causality | — |
| `merge` | call | Pointwise max; used after a resolution to record that both are known | — |
| `prune` | call | Safe only after the retention window has passed | — |
| `resolve` | callable | Must be geometry-aware; the comparison layer must never decide | — |

</div>

## Gotchas and spatial edge cases

1. **Advancing a vector without having read the current state fabricates causality.** A writer that increments its counter from a cached copy claims to have seen edits it has not, so a genuine conflict is classified as `NEWER` and the other edit is discarded — with the vector now asserting that this was correct. Read-then-advance must be atomic, in the same transaction as the write.

2. **Writer identity must be stable across restarts and deploys.** A service that generates a fresh identity on boot adds a new entry to every feature it touches, so vectors grow without bound and every edit after a restart looks concurrent with everything before it. Use a configured name, not a hostname or a process identifier.

3. **Per-device writer identity does not scale.** Ten thousand mobile editors produce vectors with ten thousand entries on popular features, which is larger than the geometry. Assign identity at the service that accepts the edit; the device identity belongs in the audit trail, not in the vector.

4. **Pruning too early resurrects conflicts.** Removing a retired writer's counter while an edit carrying it is still in the log means that edit, on replay, compares as concurrent with everything. Prune only after the retention window has passed, and treat the prune as a schema change rather than a cleanup.

5. **Concurrency is not the same as overlap.** Two concurrent edits to a feature may touch entirely different parts of it — one changing a name and one moving a vertex — and merging those is trivial. Classify by what changed before invoking a geometric merge, or a simple attribute edit ends up resolved by a union of polygons.

6. **A conflict that reaches a merge should be counted.** The rate of `CONCURRENT` outcomes per feature class is the signal that two teams are editing the same data without knowing it, which is an organisational problem the pipeline can detect before anyone reports it.

<figure class="fig">
<svg viewBox="0 0 760 196" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vector growth under per-device writer identity compared with per-service identity">
<title>Who counts as a writer decides how big the vector gets</title>
<desc>The same feature is edited by field staff over a year, under two definitions of writer identity. With per-device identity every phone, tablet and laptop that ever touched the feature gains an entry, so a popular parcel accumulates hundreds of counters and the vector eventually exceeds the geometry it describes in size — and because devices are replaced, most of those entries belong to hardware that no longer exists and can never advance again. With per-service identity, the four regional services that accept edits are the writers, so the vector holds four entries however many people edit through them; the device that made each edit is recorded in the audit trail, where it belongs, and where its cardinality costs nothing. The comparison semantics are identical in both cases: what changes is only how many counters have to be compared, stored and carried on every event.</desc>
<rect x="0" y="0" width="760" height="196" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one parcel, one year of field edits</text>
<rect x="14" y="30" width="366" height="120" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">writer = the device</text>
<text x="26" y="72" font-size="8" font-family="monospace" fill="var(--fig-ink-soft)">{phone-a1:3, tablet-7:1, phone-c9:2, …}</text>
<text x="26" y="94" font-size="8.5" fill="var(--fig-rose-edge)">hundreds of counters on a popular feature</text>
<text x="26" y="110" font-size="8.5" fill="var(--fig-rose-edge)">eventually larger than the geometry it describes</text>
<text x="26" y="132" font-size="8.5" fill="var(--fig-ink-soft)">most entries name hardware that no longer exists</text>
<rect x="392" y="30" width="354" height="120" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="404" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">writer = the service accepting the edit</text>
<text x="404" y="72" font-size="8" font-family="monospace" fill="var(--fig-ink-soft)">{edit-svc-north:14, edit-svc-south:9, …}</text>
<text x="404" y="94" font-size="8.5" fill="var(--fig-mint-edge)">four entries, however many people edit</text>
<text x="404" y="110" font-size="8.5" fill="var(--fig-ink-soft)">the device goes in the audit trail, where it belongs</text>
<text x="404" y="132" font-size="8.5" fill="var(--fig-ink-soft)">and where its cardinality costs nothing</text>
<text x="14" y="176" font-size="9" fill="var(--fig-ink-soft)">The comparison semantics are identical. What changes is how many counters must be compared, stored, and carried on every event.</text>
</svg>
<figcaption><b>Figure 3.</b> Writer identity is the one design choice here that cannot be revisited cheaply, because changing it invalidates every vector already stored.</figcaption>
</figure>

## Verification

```python
import pytest

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]}


def vec(**counters) -> VersionVector:
    return VersionVector(dict(counters))


def test_sequential_edit_is_newer():
    """B read A's edit, so B's vector dominates."""
    assert vec(A=5, B=1).compare(vec(A=5, B=0)) is Relation.NEWER


def test_concurrent_edits_are_detected():
    """Both branched from A=4; neither saw the other."""
    assert vec(A=5, B=0).compare(vec(A=4, B=1)) is Relation.CONCURRENT


def test_redelivery_is_equal_and_dropped():
    """The property that makes at-least-once delivery safe."""
    stored = FeatureEdit("f-1", "A", vec(A=5), SQUARE)
    incoming = FeatureEdit("f-1", "A", vec(A=5), SQUARE)
    assert apply_edit(stored, incoming, resolve=_never) is stored


def test_resolution_records_both_lineages():
    """After a merge, the vector must dominate BOTH inputs."""
    stored = FeatureEdit("f-1", "A", vec(A=5, B=0), SQUARE)
    incoming = FeatureEdit("f-1", "B", vec(A=4, B=1), SQUARE)
    result = apply_edit(stored, incoming, resolve=lambda a, b: a.geometry)

    assert result.vector.compare(stored.vector) is Relation.NEWER
    assert result.vector.compare(incoming.vector) is Relation.NEWER


def _never(a, b):
    raise AssertionError("resolve must not be called for non-concurrent edits")
```

The last test is the one that catches an incomplete resolution. Merging the geometries but forgetting to merge the vectors leaves the result concurrent with one of its own inputs, so the same conflict is rediscovered on every subsequent edit and the merge runs forever.

## Related

- [Conflict Resolution Strategies](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/) — the topic this guide belongs to
- [Merging Overlapping Zone Edits with Shapely](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/merging-overlapping-zone-edits-with-shapely/) — the geometric half, invoked only for the concurrent case
- [Idempotent Consumers for Out-of-Order Spatial Events](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/idempotent-consumers-for-out-of-order-spatial-events/) — applying these decisions safely under at-least-once delivery
- [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — identifying the edit itself, which is a different question from ordering two of them
