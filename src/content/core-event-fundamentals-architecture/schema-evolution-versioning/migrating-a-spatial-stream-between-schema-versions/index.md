---
title: "Migrating a Spatial Stream Between Schema Versions"
description: "Run both schema versions at once and let the old one drain. Dual-write, translate on read, watch the per-version counter reach zero, and only then delete the old branch."
slug: "migrating-a-spatial-stream-between-schema-versions"
type: "article"
breadcrumb: "Core Event Fundamentals & Architecture > Schema Evolution & Versioning for Spatial Events > Migrating a Spatial Stream Between Schema Versions"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Migrating a Spatial Stream Between Schema Versions",
      "description": "A breaking schema change to a live spatial stream cannot be deployed atomically, because the events already in the broker were written under the old contract. This guide covers the overlap period: dual-writing, translating on read, and using the per-version counter as the signal that the old branch can go.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/migrating-a-spatial-stream-between-schema-versions/",
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
        {"@type": "ListItem", "position": 3, "name": "Schema Evolution & Versioning for Spatial Events", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/"},
        {"@type": "ListItem", "position": 4, "name": "Migrating a Spatial Stream Between Schema Versions", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/migrating-a-spatial-stream-between-schema-versions/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Migrate a live spatial stream to a new schema version",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Teach every consumer to read both versions before any producer writes the new one"},
        {"@type": "HowToStep", "position": 2, "name": "Translate on read into one internal representation, so business logic never branches on version"},
        {"@type": "HowToStep", "position": 3, "name": "Cut producers over and watch the per-version counter drain to zero"},
        {"@type": "HowToStep", "position": 4, "name": "Delete the old branch only after the retention window has fully passed"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How long does the overlap period have to last?",
          "acceptedAnswer": {"@type": "Answer", "text": "At least as long as the topic's retention, because a consumer that resets its offset to the earliest available position will read events written before the cutover. If the topic retains seven days, the old branch must survive seven days after the last old-version event was produced, not seven days after the deploy. Replay changes this too: if dead-letter events can be replayed from an archive older than retention, the translator has to outlive the archive."}
        },
        {
          "@type": "Question",
          "name": "Should the version live in the payload or in a message header?",
          "acceptedAnswer": {"@type": "Answer", "text": "In a header, and in the payload as well if you can afford the bytes. A header lets a consumer route or reject an event without deserialising it, which matters when the new version is unparseable by the old reader — a consumer that must parse the body to discover it cannot parse the body has no safe failure path. The payload copy is the one that survives being written to storage, replayed, or moved between transports that do not preserve headers."}
        },
        {
          "@type": "Question",
          "name": "Can I migrate by publishing to a new topic instead?",
          "acceptedAnswer": {"@type": "Answer", "text": "Yes, and it trades one problem for another. A new topic gives a clean break with no in-band version branching, but it splits ordering: two events for the same feature, one on each topic, have no defined order relative to each other, so a consumer reading both can apply an old edit after a new one. That is acceptable for streams keyed by immutable observations and dangerous for streams that carry feature edits."}
        }
      ]
    }
  ]
}
</script>

**Deploy readers that understand both versions first, translate every event into one internal representation at the edge, then cut producers over and wait for the per-version counter to reach zero — the old branch cannot be deleted at the deploy, only after the topic's full retention has passed.**

This guide sits under [Schema Evolution & Versioning for Spatial Events](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/), within [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/). Where [Adding a Field to a Live Spatial Event Schema](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/adding-a-field-to-a-live-spatial-event-schema/) covers the compatible case, this one covers the change that genuinely breaks: a renamed geometry member, a coordinate order flip, a CRS that is no longer implicit.

## When to use this pattern

- The change is not backward compatible — a field removed or renamed, a type changed, coordinates reordered, or a unit redefined.
- The stream has consumers you do not deploy, so there is no moment when everything switches at once.
- Events already in the broker were written under the old contract and will still be read after the cutover.

If the change is purely additive, this is more machinery than the problem needs.

## Why an atomic cutover does not exist

The broker holds events written under the old contract. Even if every producer and consumer restarted in the same instant, the backlog does not. A consumer starting at its committed offset reads old events for as long as the lag lasts; a consumer resetting to earliest reads them for as long as the topic retains them.

<figure class="fig">
<svg viewBox="0 0 760 214" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A topic timeline showing old-version events surviving in the log long after the producer cutover">
<title>The cutover is a point; the overlap is a window</title>
<desc>A topic's log is drawn as a timeline. Producers switch to version two at a single instant, so every event written after that point carries the new contract. Everything written before it does not, and remains in the log until retention expires it — seven days later in this example. A consumer sitting at the head sees only new events within seconds of the cutover, which is why the deploy looks complete. A lagging consumer keeps reading version one events for as long as its lag lasts, and a consumer that resets its offset to the earliest available position reads version one events on day six. The old reader branch therefore has to survive the whole retention window rather than the deploy, and deleting it when the dashboard shows one hundred percent version two is the mistake this figure exists to prevent.</desc>
<rect x="0" y="0" width="760" height="214" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one topic, 7-day retention · producers cut over at the dashed line</text>
<rect x="30" y="34" width="230" height="30" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="42" y="54" font-size="9" fill="var(--fig-ink)">v1 events — still in the log</text>
<line x1="264" y1="28" x2="264" y2="72" stroke="var(--fig-line)" stroke-width="1.6" stroke-dasharray="4 3"/>
<text x="270" y="24" font-size="8.5" fill="var(--fig-ink-soft)">producer cutover</text>
<rect x="268" y="34" width="462" height="30" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="280" y="54" font-size="9" fill="var(--fig-ink)">v2 events</text>
<circle cx="700" cy="88" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="530" y="92" font-size="8.5" fill="var(--fig-mint-edge)">head consumer — sees only v2 within seconds</text>
<circle cx="330" cy="110" r="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="342" y="114" font-size="8.5" fill="var(--fig-gold-edge)">lagging consumer — still reading v1 while its lag lasts</text>
<circle cx="40" cy="132" r="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="52" y="136" font-size="8.5" fill="var(--fig-rose-edge)">offset reset to earliest — reads v1 events on day six, from a reader you deleted on day one</text>
<rect x="14" y="150" width="732" height="52" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="26" y="169" font-size="9.5" font-weight="600" fill="var(--fig-ink)">The old reader branch survives retention, not the deploy</text>
<text x="26" y="186" font-size="9" fill="var(--fig-ink-soft)">A dashboard reading 100% v2 means producers have cut over. It says nothing about what is still sitting in the log, and</text>
<text x="26" y="198" font-size="9" fill="var(--fig-ink-soft)">an offset reset is a routine operational action, not an exotic one.</text>
</svg>
<figcaption><b>Figure 1.</b> The deploy that removes the old reader is safe seven days after the last v1 event was written — not seven days after the cutover deploy, and certainly not when the version dashboard first turns green.</figcaption>
</figure>

## Complete runnable implementation

The shape that works is a translator at the edge and one internal representation behind it. Business logic must never see a version number; the moment it does, every future migration touches every handler.

```python
from dataclasses import dataclass
from datetime import datetime

from prometheus_client import Counter
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform as shapely_transform

SEEN = Counter("spatial_event_schema_version_total", "Events by version", ("version",))

# v1 emitted local grid coordinates with an implicit CRS; v2 is explicit and
# always EPSG:4326. That is the breaking part: a v1 payload read as v2 is
# silently wrong rather than invalid.
_V1_TO_WGS84 = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True)


@dataclass(slots=True, frozen=True)
class FeatureEvent:
    """The one representation the rest of the system knows about."""
    feature_id: str
    occurred_at: datetime
    geometry: dict          # GeoJSON, always EPSG:4326
    source_version: int     # kept for metrics only — never branched on


class UnknownSchemaVersion(Exception):
    """An event whose version this build has never heard of."""


def _from_v1(body: dict) -> FeatureEvent:
    geom = shape(body["geom"])                      # renamed to "geometry" in v2
    geom = shapely_transform(_V1_TO_WGS84.transform, geom)
    return FeatureEvent(
        feature_id=str(body["fid"]),                # renamed to "feature_id"
        occurred_at=datetime.fromisoformat(body["ts"]),
        geometry=mapping(geom),
        source_version=1,
    )


def _from_v2(body: dict) -> FeatureEvent:
    if body.get("crs") != "EPSG:4326":
        raise ValueError(f"v2 requires EPSG:4326, got {body.get('crs')!r}")
    return FeatureEvent(
        feature_id=body["feature_id"],
        occurred_at=datetime.fromisoformat(body["occurred_at"]),
        geometry=body["geometry"],
        source_version=2,
    )


_READERS = {1: _from_v1, 2: _from_v2}


def translate(headers: dict[str, str], body: dict) -> FeatureEvent:
    """Read the version from the header, fall back to the payload copy.

    An unknown version must raise rather than default. Defaulting to the
    newest reader means a v3 event produced by a service deployed ahead of
    this one is parsed as v2, and the failure is a wrong geometry rather
    than an error.
    """
    version = int(headers.get("schema-version") or body.get("schema_version", 0))
    SEEN.labels(version=str(version)).inc()

    reader = _READERS.get(version)
    if reader is None:
        raise UnknownSchemaVersion(f"no reader for schema version {version}")
    return reader(body)
```

The `UnknownSchemaVersion` path is the one people remove because it never fires in testing. It fires the first time a service is deployed ahead of its consumers, which during a migration is exactly the situation you are in.

<figure class="fig">
<svg viewBox="0 0 760 196" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Two consumer designs: version branching spread through business logic versus a translator at the edge">
<title>Where the version branch lives decides the cost of the next migration</title>
<desc>Two consumer designs are compared. In the first, every handler receives the raw payload and checks the version itself, so the geometry handler, the routing rule, the deduplication key and the metrics emitter each carry their own branch. Four places to update for this migration, four places to find and delete afterwards, and any one of them missed produces a handler quietly reading the wrong field. In the second, a single translator at the edge converts both versions into one internal record and everything behind it is version-blind. One place to add a reader, one place to delete it, and a new version cannot reach business logic without someone having written a reader for it. The internal record keeps the source version as a field for metrics, but nothing branches on it — the moment a handler does, the design has collapsed back into the first.</desc>
<rect x="0" y="0" width="760" height="196" fill="var(--fig-bg)"/>
<defs><marker id="mg-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">branch everywhere — four places to change, four to delete</text>
<rect x="14" y="28" width="86" height="30" rx="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.2"/>
<text x="26" y="47" font-size="8.5" fill="var(--fig-ink)">raw payload</text>
<line x1="104" y1="43" x2="126" y2="43" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#mg-a)"/>
<rect x="130" y="24" width="140" height="18" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="138" y="37" font-size="8" fill="var(--fig-ink)">geometry handler · if v1:</text>
<rect x="130" y="46" width="140" height="18" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="138" y="59" font-size="8" fill="var(--fig-ink)">routing rule · if v1:</text>
<rect x="280" y="24" width="140" height="18" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="288" y="37" font-size="8" fill="var(--fig-ink)">dedup key · if v1:</text>
<rect x="280" y="46" width="140" height="18" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="288" y="59" font-size="8" fill="var(--fig-ink)">metrics · if v1:</text>
<text x="432" y="41" font-size="8.5" fill="var(--fig-rose-edge)">one missed branch reads the wrong field and raises nothing</text>
<line x1="14" y1="80" x2="746" y2="80" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="100" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">translate at the edge — one place, and it is checkable</text>
<rect x="14" y="110" width="86" height="30" rx="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.2"/>
<text x="26" y="129" font-size="8.5" fill="var(--fig-ink)">raw payload</text>
<line x1="104" y1="125" x2="126" y2="125" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#mg-a)"/>
<rect x="130" y="106" width="150" height="38" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="142" y="122" font-size="8.5" font-weight="600" fill="var(--fig-ink)">translate(headers, body)</text>
<text x="142" y="136" font-size="8" fill="var(--fig-ink-soft)">unknown version → raise</text>
<line x1="284" y1="125" x2="306" y2="125" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#mg-a)"/>
<rect x="310" y="106" width="150" height="38" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.4"/>
<text x="322" y="122" font-size="8.5" font-weight="600" fill="var(--fig-ink)">FeatureEvent</text>
<text x="322" y="136" font-size="8" fill="var(--fig-ink-soft)">one shape, always EPSG:4326</text>
<line x1="464" y1="125" x2="486" y2="125" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#mg-a)"/>
<rect x="490" y="106" width="256" height="38" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="502" y="122" font-size="8.5" fill="var(--fig-ink)">every handler behind here is version-blind</text>
<text x="502" y="136" font-size="8" fill="var(--fig-ink-soft)">a new version cannot reach them without a reader being written</text>
<text x="14" y="168" font-size="9" fill="var(--fig-ink-soft)">The internal record keeps source_version for metrics only. The moment a handler branches on it, the design has collapsed</text>
<text x="14" y="181" font-size="9" fill="var(--fig-ink-soft)">back into the top half — which is how a two-version migration becomes a permanent four-branch consumer.</text>
</svg>
<figcaption><b>Figure 2.</b> Keeping the branch in one function is what makes the cleanup deploy a deletion of a known set of lines rather than an audit.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `schema-version` header | `str` | Must be present on every produced event; readable without deserialising | — |
| `schema_version` body field | `int` | The copy that survives archival and transport changes | — |
| `_READERS` | `dict[int, Callable]` | One entry per version still reachable in the log or an archive | `{1, 2}` |
| `always_xy` | `bool` | Must be `True` on every `Transformer`, or the axis order flips silently | `True` |
| Overlap duration | `timedelta` | ≥ topic retention, measured from the last v1 event produced | 7 days |
| `UnknownSchemaVersion` | exception | Must raise, never default to the newest reader | — |

</div>

## Gotchas and spatial edge cases

1. **A coordinate-order change is not detectable by validation.** If v1 emitted `[lat, lon]` and v2 emits `[lon, lat]` per RFC 7946, a v1 payload read by the v2 reader produces a point in a different hemisphere that is a perfectly valid geometry. The version header is the only thing standing between you and a fleet of features relocated to the Indian Ocean, which is why an unknown version must raise rather than guess.

2. **The reprojection in `_from_v1` is not free and not exact.** Transforming every historical event on read adds latency proportional to vertex count and introduces the sub-millimetre differences described in [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/). If a content hash is computed downstream from the translated geometry, the same logical event hashes differently depending on which reader produced it — round to a fixed precision after translating, not before.

3. **Dual-writing to two topics splits ordering.** Publishing v1 to the old topic and v2 to the new one gives a clean break, but two events for the same feature now live on different topics with no defined order between them. A consumer reading both can apply an old edit after a new one, and the conflict machinery in [Conflict Resolution Strategies](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/conflict-resolution-strategies/) becomes load-bearing where it previously was not.

4. **The per-version counter reaching zero is necessary, not sufficient.** It says no v1 event has been *read* recently. It does not say none remains in the log, and an offset reset will find them. Wait out the retention window, and check any dead-letter archive separately — replaying a v1 event from a six-month-old archive is exactly when the deleted reader is missed.

5. **Compaction preserves old versions indefinitely.** On a compacted topic, the last event for a feature that stopped changing before the cutover is retained forever. There is no retention window to wait out; the v1 reader is permanent unless the topic is rewritten.

<figure class="fig">
<svg viewBox="0 0 760 178" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Deploy order for a breaking schema migration, with the two orders that fail">
<title>Readers first, always</title>
<desc>Three deploy orders are compared for a breaking schema change. Producers first means new events reach consumers that have no reader for them, so every consumer fails immediately and loudly — an outage, but an obvious one. Simultaneous deploy means the failure window is only as long as the rollout skew, which sounds acceptable until you notice that a rollout is not instantaneous and the events produced during it are unreadable by whichever half deployed last, producing a burst of dead-lettered events that must be replayed. Readers first means consumers understand both versions while producers still emit only the old one, so there is no window in which an unreadable event exists; the producer cutover then becomes an ordinary deploy with no coordination requirement at all. The asymmetry is worth stating plainly: a reader that understands a version nobody produces costs nothing, while a producer emitting a version nobody reads is an outage.</desc>
<rect x="0" y="0" width="760" height="178" fill="var(--fig-bg)"/>
<rect x="14" y="16" width="732" height="40" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="34" font-size="9.5" font-weight="600" fill="var(--fig-ink)">producers first — an outage, at least an obvious one</text>
<text x="26" y="49" font-size="9" fill="var(--fig-ink-soft)">v2 events reach consumers with no v2 reader · every consumer fails at once</text>
<rect x="14" y="64" width="732" height="40" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="26" y="82" font-size="9.5" font-weight="600" fill="var(--fig-ink)">simultaneous — a burst of dead letters, sized by rollout skew</text>
<text x="26" y="97" font-size="9" fill="var(--fig-ink-soft)">a rollout is not instantaneous; events produced during it are unreadable by whichever half deployed last</text>
<rect x="14" y="112" width="732" height="40" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="26" y="130" font-size="9.5" font-weight="600" fill="var(--fig-ink)">readers first — no window in which an unreadable event exists</text>
<text x="26" y="145" font-size="9" fill="var(--fig-ink-soft)">consumers understand both while producers still emit v1 · the cutover then needs no coordination</text>
<text x="14" y="170" font-size="9" fill="var(--fig-ink-soft)">A reader for a version nobody produces costs nothing. A producer emitting a version nobody reads is an outage.</text>
</svg>
<figcaption><b>Figure 3.</b> The asymmetry is the whole argument: one direction is free, the other is an incident, and they take the same amount of work to schedule.</figcaption>
</figure>

## Verification

```python
import pytest
from shapely.geometry import shape


V1 = {"fid": 4471, "ts": "2026-08-08T09:14:00+00:00",
      "geom": {"type": "Point", "coordinates": [389876.5, 5819432.1]}}
V2 = {"feature_id": "4471", "occurred_at": "2026-08-08T09:14:00+00:00",
      "crs": "EPSG:4326", "geometry": {"type": "Point", "coordinates": [13.4049, 52.5200]}}


def test_both_versions_land_in_the_same_place():
    """The property the migration promises: same event, same geometry."""
    a = translate({"schema-version": "1"}, V1)
    b = translate({"schema-version": "2"}, V2)
    assert a.feature_id == b.feature_id
    assert shape(a.geometry).distance(shape(b.geometry)) < 1e-4   # ~11 m


def test_unknown_version_raises_rather_than_guessing():
    """A v3 event must not be parsed by the v2 reader."""
    with pytest.raises(UnknownSchemaVersion):
        translate({"schema-version": "3"}, V2)


def test_v2_without_explicit_crs_is_rejected():
    """The implicit CRS is exactly what v2 exists to remove."""
    with pytest.raises(ValueError):
        translate({"schema-version": "2"}, {**V2, "crs": None})
```

The first test is the one that catches an axis-order mistake in the transformer, because a flipped `always_xy` moves the translated point thousands of kilometres — well outside the tolerance — while every other test still passes.

## Related

- [Schema Evolution & Versioning for Spatial Events](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/) — the topic this guide belongs to
- [Validating Schema Compatibility in CI](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/validating-schema-compatibility-in-ci/) — catching the breaking change before it reaches a topic at all
- [Adding a Field to a Live Spatial Event Schema](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/adding-a-field-to-a-live-spatial-event-schema/) — the compatible case, and why it still needs care
- [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) — where the reprojection in the v1 reader belongs long-term
