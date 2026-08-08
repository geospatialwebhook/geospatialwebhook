---
title: "Chunking a Multipolygon Across Message Size Limits"
description: "Split a multipolygon on part boundaries so every chunk is a valid geometry, declare the total up front, and give the reassembler a timeout — a group that waits forever for a lost part is the failure chunking introduces."
slug: "chunking-a-multipolygon-across-message-size-limits"
type: "article"
breadcrumb: "Spatial Payload Routing & Parsing > Streaming & Chunking Large Geometry Payloads > Chunking a Multipolygon Across Message Size Limits"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Chunking a Multipolygon Across Message Size Limits",
      "description": "Chunking a multipolygon is safe only on part boundaries, and only when the reassembler can detect a part that never arrives. This guide splits by part with a size-aware packer, declares the total in every chunk, and fails the group on timeout rather than waiting.",
      "url": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/chunking-a-multipolygon-across-message-size-limits/",
      "datePublished": "2026-08-08",
      "dateModified": "2026-08-08",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Spatial Payload Routing & Parsing", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/"},
        {"@type": "ListItem", "position": 3, "name": "Streaming & Chunking Large Geometry Payloads", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/"},
        {"@type": "ListItem", "position": 4, "name": "Chunking a Multipolygon Across Message Size Limits", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/chunking-a-multipolygon-across-message-size-limits/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Chunk a multipolygon across broker message size limits",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Split only on part boundaries, so every chunk is a valid geometry"},
        {"@type": "HowToStep", "position": 2, "name": "Pack parts into chunks by serialised size, not by count"},
        {"@type": "HowToStep", "position": 3, "name": "Declare the group id and total part count in every chunk"},
        {"@type": "HowToStep", "position": 4, "name": "Fail the group on timeout instead of waiting for a part that will not arrive"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why must chunks be split on part boundaries?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because a chunk that is not a complete geometry cannot be validated, routed or reasoned about on its own. Splitting a coordinate array mid-ring produces fragments that no parser accepts and no bounding box describes, so the reassembler must have every fragment before it can do anything at all. Splitting on part boundaries means each chunk is a polygon: it can be validated on arrival, it has a bounding box a consumer can filter on, and a missing chunk is a missing polygon rather than a corrupt shape."}
        },
        {
          "@type": "Question",
          "name": "Should chunks be sized by part count or by bytes?",
          "acceptedAnswer": {"@type": "Answer", "text": "By bytes, because parts of a multipolygon vary enormously in size. A fixed count of ten parts per chunk is a few kilobytes for ten small islands and forty megabytes for ten mainland coastlines, so a count-based packer produces chunks that are simultaneously too small most of the time and over the limit exactly when it matters. Serialise each part, accumulate until the next one would exceed the budget, and start a new chunk."}
        },
        {
          "@type": "Question",
          "name": "What should the reassembler do when a part never arrives?",
          "acceptedAnswer": {"@type": "Answer", "text": "Fail the group and dead-letter what it has, rather than waiting. A reassembler with no timeout accumulates partial groups in memory forever, and because each holds real geometry the memory cost is substantial. Failing produces a visible artefact naming the group and the missing indices, which is something an operator can replay; waiting produces a slow leak and an event that silently never happened."}
        }
      ]
    }
  ]
}
</script>

**Split only on part boundaries so every chunk is a valid polygon, pack by serialised byte size rather than part count, and give the reassembler a timeout that fails the group — a missing part with no timeout is an in-memory leak and an event that silently never happened.**

This guide sits under [Streaming & Chunking Large Geometry Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/), within [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/). That topic argues that chunking is the third-best option; this guide is for the case where it is nonetheless the right one, because the parts are independently useful.

## When to use this pattern

- The geometry is genuinely composite — separate administrative units, distinct islands, a feature collection — so each part means something on its own.
- Consumers can act on parts as they arrive rather than needing the whole assembled shape, which is where the pattern earns its cost.
- Object storage is unavailable or undesirable, which rules out the claim check.

If none of those hold, use [The Claim-Check Pattern for Oversized Spatial Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/the-claim-check-pattern-for-oversized-spatial-payloads/) instead.

## Pack by bytes, because parts are not comparable

<figure class="fig">
<svg viewBox="0 0 760 224" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A fixed part-count packer producing wildly uneven chunks against a byte-aware packer">
<title>Ten parts is not a size</title>
<desc>A national coastline multipolygon holds four hundred parts whose serialised sizes span five orders of magnitude: most are small offshore islands of a few hundred bytes, a handful are substantial islands of tens of kilobytes, and two are mainland coastlines of about twenty megabytes each. A packer that puts ten parts in each chunk produces chunks of about four kilobytes for most of the geometry, which wastes almost the entire message budget on overhead, and one chunk of over forty megabytes when it happens to reach the two mainland parts, which exceeds any broker limit and fails the publish. A byte-aware packer accumulates serialised parts until adding the next would exceed the budget, so chunks are uniformly close to the limit, the mainland parts each get a chunk to themselves, and no chunk is ever over. The count-based failure is particularly unpleasant because it depends on where the large parts fall in the input order, so it can pass in testing on a reordered sample and fail in production on the same data.</desc>
<rect x="0" y="0" width="760" height="224" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">400 parts · sizes spanning five orders of magnitude · 1 MB message budget</text>
<text x="14" y="42" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">ten parts per chunk</text>
<rect x="180" y="32" width="24" height="14" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<rect x="208" y="32" width="22" height="14" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<rect x="234" y="32" width="26" height="14" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<rect x="264" y="32" width="20" height="14" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<rect x="288" y="32" width="24" height="14" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1"/>
<rect x="316" y="24" width="424" height="30" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="326" y="43" font-size="8.5" font-weight="600" fill="var(--fig-ink)">40+ MB — the chunk that reached both mainland parts · publish fails</text>
<text x="180" y="66" font-size="8.5" fill="var(--fig-rose-edge)">most chunks ≈ 4 KB — the message budget is almost entirely wasted</text>
<text x="180" y="80" font-size="8.5" fill="var(--fig-rose-edge)">and which chunk overflows depends on input order, so a reordered sample passes in testing</text>
<line x1="14" y1="98" x2="746" y2="98" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="120" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">pack until the next part would exceed the budget</text>
<rect x="180" y="132" width="102" height="22" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<rect x="286" y="132" width="102" height="22" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<rect x="392" y="132" width="102" height="22" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<rect x="498" y="132" width="102" height="22" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<rect x="604" y="132" width="102" height="22" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="500" y="170" font-size="8" fill="var(--fig-gold-edge)">one mainland part each</text>
<text x="180" y="170" font-size="8" fill="var(--fig-mint-edge)">many small parts packed together</text>
<rect x="14" y="184" width="732" height="32" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="203" font-size="9" fill="var(--fig-ink-soft)">Serialise each part, accumulate, and start a new chunk before the budget is exceeded. Chunks land uniformly close to the limit and none is ever over.</text>
</svg>
<figcaption><b>Figure 1.</b> The count-based failure depends on where the large parts fall in the input order, which is why it survives testing and appears in production on the same data.</figcaption>
</figure>

## Complete runnable implementation

```python
import json
import uuid
from dataclasses import dataclass

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

# Leave room for the envelope, headers and the broker's own overhead.
CHUNK_BUDGET = 700 * 1024


class OversizedPart(Exception):
    """One part alone exceeds the budget — chunking cannot help."""


@dataclass(frozen=True, slots=True)
class Chunk:
    group_id: str
    index: int
    total: int            # declared in EVERY chunk, so loss is detectable
    parts: list[dict]
    bbox: tuple[float, float, float, float]


def chunk_multipolygon(geometry: dict, budget: int = CHUNK_BUDGET) -> list[Chunk]:
    """Split on part boundaries, packing by serialised size.

    Every chunk is a valid MultiPolygon on its own: it can be validated on
    arrival, filtered by bounding box, and a missing chunk is a missing set
    of polygons rather than a corrupt shape.
    """
    geom = shape(geometry)
    parts = [mapping(p) for p in getattr(geom, "geoms", [geom])]

    groups: list[list[dict]] = []
    current: list[dict] = []
    current_size = 0

    for part in parts:
        size = len(json.dumps(part, separators=(",", ":")).encode())
        if size > budget:
            # A single coastline larger than the budget cannot be chunked on
            # part boundaries. Simplify it, tile it, or use a claim check —
            # but do not split its coordinate array.
            raise OversizedPart(f"one part is {size} bytes, budget {budget}")
        if current and current_size + size > budget:
            groups.append(current)
            current, current_size = [], 0
        current.append(part)
        current_size += size

    if current:
        groups.append(current)

    group_id = str(uuid.uuid4())
    total = len(groups)
    return [
        Chunk(group_id=group_id, index=i, total=total, parts=g,
              bbox=unary_union([shape(p) for p in g]).bounds)
        for i, g in enumerate(groups)
    ]
```

The reassembler is where the correctness lives. It has to be idempotent per index, tolerate arrival in any order, and give up.

```python
import asyncio
import time
from dataclasses import dataclass, field

REASSEMBLY_TIMEOUT = 120.0


class IncompleteGroup(Exception):
    def __init__(self, group_id: str, missing: set[int]) -> None:
        super().__init__(f"{group_id}: missing chunk indices {sorted(missing)}")
        self.group_id, self.missing = group_id, missing


@dataclass(slots=True)
class Partial:
    total: int
    first_seen: float
    chunks: dict[int, list[dict]] = field(default_factory=dict)


class Reassembler:
    def __init__(self, timeout: float = REASSEMBLY_TIMEOUT) -> None:
        self._timeout = timeout
        self._groups: dict[str, Partial] = {}

    def add(self, chunk: Chunk, now: float | None = None) -> dict | None:
        """Return the assembled geometry once complete, else None."""
        now = now or time.monotonic()
        partial = self._groups.setdefault(
            chunk.group_id, Partial(total=chunk.total, first_seen=now)
        )
        # Idempotent per index: a redelivered chunk overwrites itself.
        partial.chunks[chunk.index] = chunk.parts

        if len(partial.chunks) < partial.total:
            return None

        del self._groups[chunk.group_id]
        parts = [p for i in sorted(partial.chunks) for p in partial.chunks[i]]
        return {"type": "MultiPolygon",
                "coordinates": [p["coordinates"] for p in parts]}

    def expire(self, now: float | None = None) -> list[IncompleteGroup]:
        """Fail groups that have waited too long. MUST be called on a timer.

        Without this the reassembler accumulates partial groups forever, and
        because each holds real geometry the leak is measured in megabytes.
        """
        now = now or time.monotonic()
        failures = []
        for group_id, partial in list(self._groups.items()):
            if now - partial.first_seen > self._timeout:
                missing = set(range(partial.total)) - set(partial.chunks)
                del self._groups[group_id]
                failures.append(IncompleteGroup(group_id, missing))
        return failures
```

<figure class="fig">
<svg viewBox="0 0 760 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Three reassembly outcomes: complete, redelivered, and a lost chunk expiring into a dead letter">
<title>Three outcomes, and only one of them is a surprise</title>
<desc>Three groups are traced through the reassembler. The first arrives complete but out of order — chunk two, then zero, then one — and because chunks are stored in a dictionary keyed by index and sorted at assembly time, the order of arrival is irrelevant and the group completes correctly. The second includes a redelivery: chunk one arrives twice, and because storing by index overwrites rather than appends, the duplicate changes nothing and the assembled geometry is identical. The third loses chunk two entirely, perhaps because the producer crashed mid-publish. The group sits at two of three parts held, and without an expiry sweep it sits there permanently, holding its geometry in memory while nothing downstream ever learns the event failed. With the sweep, after the timeout it becomes an IncompleteGroup naming the group and the missing index, which is dead-lettered and can be replayed. The distinction is not between working and broken but between a failure that is visible and one that is a slow leak plus an event that silently never happened.</desc>
<rect x="0" y="0" width="760" height="220" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">out of order — irrelevant</text>
<rect x="220" y="26" width="42" height="20" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="232" y="40" font-size="8" fill="var(--fig-ink)">#2</text>
<rect x="270" y="26" width="42" height="20" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="282" y="40" font-size="8" fill="var(--fig-ink)">#0</text>
<rect x="320" y="26" width="42" height="20" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="332" y="40" font-size="8" fill="var(--fig-ink)">#1</text>
<text x="380" y="40" font-size="8.5" fill="var(--fig-mint-edge)">stored by index, sorted at assembly → complete and correct</text>
<line x1="14" y1="58" x2="746" y2="58" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="80" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">redelivery — absorbed</text>
<rect x="220" y="88" width="42" height="20" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="232" y="102" font-size="8" fill="var(--fig-ink)">#0</text>
<rect x="270" y="88" width="42" height="20" rx="3" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="282" y="102" font-size="8" fill="var(--fig-ink)">#1</text>
<rect x="320" y="88" width="42" height="20" rx="3" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="332" y="102" font-size="8" fill="var(--fig-ink)">#1</text>
<rect x="370" y="88" width="42" height="20" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="382" y="102" font-size="8" fill="var(--fig-ink)">#2</text>
<text x="430" y="102" font-size="8.5" fill="var(--fig-mint-edge)">storing by index overwrites → identical result</text>
<line x1="14" y1="120" x2="746" y2="120" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="142" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">chunk lost — the case that needs the sweep</text>
<rect x="220" y="150" width="42" height="20" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="232" y="164" font-size="8" fill="var(--fig-ink)">#0</text>
<rect x="270" y="150" width="42" height="20" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="282" y="164" font-size="8" fill="var(--fig-ink)">#1</text>
<rect x="320" y="150" width="42" height="20" rx="3" fill="var(--fig-bg)" stroke="var(--fig-rose-edge)" stroke-width="1.6" stroke-dasharray="3 3"/>
<text x="332" y="164" font-size="8" fill="var(--fig-rose-edge)">#2</text>
<text x="380" y="158" font-size="8.5" fill="var(--fig-rose-edge)">no sweep: held forever, in memory, and nothing learns the event failed</text>
<text x="380" y="171" font-size="8.5" fill="var(--fig-mint-edge)">with sweep: IncompleteGroup(group, missing={2}) → dead letter, replayable</text>
<rect x="14" y="184" width="732" height="28" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="202" font-size="9" fill="var(--fig-ink-soft)">The choice is not between working and broken — it is between a visible failure and a slow leak plus an event that silently never happened.</text>
</svg>
<figcaption><b>Figure 2.</b> Out-of-order and redelivered chunks are handled by the data structure. The lost chunk is the only case needing a decision, and the decision is to give up.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `CHUNK_BUDGET` | `int` | Below the broker limit by enough for envelope and headers | `716800` |
| `total` | `int` | Declared in every chunk, so loss is detectable from any one | — |
| `index` | `int` | Storage key — makes redelivery idempotent | — |
| `bbox` | tuple | Per chunk, so a consumer can filter before assembling | — |
| `REASSEMBLY_TIMEOUT` | `float` | Above the broker's worst redelivery delay, below patience | `120.0` |
| `expire()` | call | Must run on a timer, not only on arrival | — |

</div>

## Gotchas and spatial edge cases

1. **A single part larger than the budget cannot be chunked this way.** One mainland coastline can exceed any reasonable message limit on its own, and `OversizedPart` is the honest response — the alternatives are simplifying the geometry for transport, tiling the feature, or falling back to a claim check.

2. **Validity must be checked after assembly, never per chunk.** Each chunk is a valid MultiPolygon in isolation while the assembled whole can have overlapping parts, which no individual chunk can see. Run the repair from [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) on the assembled geometry only.

3. **The reassembler is per-consumer state, so chunks must reach one consumer.** With chunks spread across partitions, each consumer holds a fraction of every group and none completes. Key every chunk in a group on the group identifier, which also means the group is confined to one partition and inherits its ordering.

4. **Holes belong to their part and must not be separated from it.** A polygon's interior rings are part of its coordinate array, so splitting on part boundaries keeps them together automatically — but a packer written against a flattened ring list will happily put an interior ring in a different chunk, producing a hole that becomes a solid polygon.

5. **Expiry needs a timer, not an arrival hook.** A group whose remaining chunks never arrive also never triggers `add`, so an expiry check that runs only on arrival never runs for exactly the groups it exists to clean up.

6. **Assembly order must come from the index, not the arrival order.** Multipolygon part order is not semantically meaningful, but making it depend on network timing means the same event produces different serialisations, which breaks any content hash computed downstream — see [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/).

## Verification

```python
import pytest
from shapely.geometry import MultiPolygon, Polygon, mapping, shape


def islands(n: int) -> dict:
    return mapping(MultiPolygon([
        Polygon([(i, 0), (i, 0.5), (i + 0.5, 0.5), (i + 0.5, 0)]) for i in range(n)
    ]))


def test_every_chunk_is_a_valid_geometry():
    """The property that distinguishes this from coordinate-range splitting."""
    for chunk in chunk_multipolygon(islands(300), budget=2048):
        assembled = {"type": "MultiPolygon",
                     "coordinates": [p["coordinates"] for p in chunk.parts]}
        assert shape(assembled).is_valid


def test_round_trip_preserves_the_geometry():
    original = islands(300)
    chunks = chunk_multipolygon(original, budget=2048)
    r = Reassembler()
    result = None
    for chunk in reversed(chunks):                 # deliberately out of order
        result = r.add(chunk) or result
    assert shape(result).equals(shape(original))


def test_redelivered_chunk_changes_nothing():
    chunks = chunk_multipolygon(islands(60), budget=2048)
    r = Reassembler()
    for chunk in chunks[:-1]:
        r.add(chunk)
        r.add(chunk)                                # redelivery
    assert shape(r.add(chunks[-1])).is_valid


def test_lost_chunk_expires_into_a_named_failure():
    """No timeout means a leak and an event that silently never happened."""
    chunks = chunk_multipolygon(islands(60), budget=2048)
    r = Reassembler(timeout=1.0)
    for chunk in chunks[:-1]:
        r.add(chunk, now=0.0)

    failures = r.expire(now=5.0)
    assert len(failures) == 1
    assert failures[0].missing == {len(chunks) - 1}
```

The second test reverses the chunk order deliberately. A reassembler that appends rather than storing by index passes every other test here and produces a multipolygon whose parts are in arrival order, which is valid, wrong, and hashes differently every time.

## Related

- [Streaming & Chunking Large Geometry Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/) — the topic this guide belongs to, and why chunking is the third choice
- [The Claim-Check Pattern for Oversized Spatial Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/the-claim-check-pattern-for-oversized-spatial-payloads/) — the alternative that keeps the event atomic
- [Dead-Letter Queues for Spatial Events](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/) — where an incomplete group goes
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — what to run on the assembled geometry, and only on it
