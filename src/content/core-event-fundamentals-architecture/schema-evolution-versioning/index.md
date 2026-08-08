---
title: "Schema Evolution & Versioning for Spatial Events"
description: "Evolve a geospatial event schema without breaking consumers: compatibility rules for geometry fields, readers-before-writers rollout, version negotiation, and CI checks."
slug: "schema-evolution-versioning"
type: "guide"
breadcrumb: "Core Event Fundamentals & Architecture > Schema Evolution & Versioning for Spatial Events"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Schema Evolution & Versioning for Spatial Events",
      "description": "How to change a geospatial event schema in production without breaking consumers: which changes are backward compatible, why geometry fields evolve differently from scalars, the readers-before-writers rollout order, explicit version negotiation, and a CI gate that rejects an incompatible change before it ships.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/",
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
        {"@type": "ListItem", "position": 3, "name": "Schema Evolution & Versioning for Spatial Events", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Evolve a spatial event schema without breaking consumers",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Classify the change as compatible, breaking, or silently breaking"},
        {"@type": "HowToStep", "position": 2, "name": "Stamp every event with a schema version the consumer can branch on"},
        {"@type": "HowToStep", "position": 3, "name": "Roll readers out before writers, and reverse the order for removals"},
        {"@type": "HowToStep", "position": 4, "name": "Handle geometry-field changes separately, since they carry meaning a type check cannot see"},
        {"@type": "HowToStep", "position": 5, "name": "Gate the change in CI by replaying recorded events against the new schema"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Do I need a schema version field if I use Protobuf or Avro?",
          "acceptedAnswer": {"@type": "Answer", "text": "Yes, for a different reason than you need it in JSON. Protobuf and Avro handle structural compatibility for you — an unknown field is preserved, a missing optional field gets its default — but they cannot express semantic changes, which is where spatial schemas actually break. Changing the canonical CRS from EPSG:4326 to EPSG:3857, or changing coordinate rounding from six decimal places to seven, leaves the wire format identical and changes what the numbers mean. An explicit schema version is the only thing that lets a consumer detect that."}
        },
        {
          "@type": "Question",
          "name": "Is adding an optional field always a safe change?",
          "acceptedAnswer": {"@type": "Answer", "text": "Structurally yes, operationally no. Old consumers ignore the field and keep working, so nothing breaks. But if any consumer derives an idempotency key or a content hash from the whole payload, the added field changes that hash, so the same logical event now produces a different key and deduplication stops matching across the rollout boundary. Hash over an explicit field list rather than the whole payload, and adding a field becomes genuinely safe."}
        },
        {
          "@type": "Question",
          "name": "How long should I support an old schema version?",
          "acceptedAnswer": {"@type": "Answer", "text": "At least as long as your longest replay path, which is normally dead-letter retention. A dead-lettered event replayed a week later arrives carrying the schema version it was produced under, so a consumer that dropped support for it will fail on exactly the events that already failed once. Tie the support window to dead-letter retention rather than picking a duration, and instrument a counter per version so you can see when the old one genuinely stops arriving."}
        },
        {
          "@type": "Question",
          "name": "Can I change the coordinate precision policy without a version bump?",
          "acceptedAnswer": {"@type": "Answer", "text": "No — this is the classic silently breaking change. Rounding coordinates to a different number of decimal places produces a valid payload that passes every schema check while changing every derived key: the idempotency hash, the deduplication key, and any content hash used for tile invalidation. Consumers see a stream in which nothing matches anything from before the change, and the symptom is duplicate writes rather than an error. Treat precision as part of the schema and bump the version with it."}
        }
      ]
    }
  ]
}
</script>

**A spatial event schema is safe to change only when you can say which of three categories the change falls into — compatible, breaking, or silently breaking — and geometry fields put changes in that third category far more often than scalar fields do, because a payload can stay structurally valid while the coordinates inside it come to mean something different.**

This topic sits under [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/), the architectural baseline for spatial event systems. Schema changes touch nearly everything downstream: the deterministic keys in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) are computed from the payload's fields, the routing decisions in [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/) read a subset of them, and the canonical projection they assume is set by [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/).

---

## Prerequisites

Confirm your stack meets this baseline before changing a live schema. Check off each item as you verify it:

- [ ] **Python 3.11+** — for `StrEnum` and the `Self` annotations used in the version-dispatch code
- [ ] **`pydantic` 2.x** — each schema version is a separate model class, not a model with optional everything
- [ ] **A schema version already on every event** — if events in flight carry no version, add one before making any other change
- [ ] **A recorded corpus of real events** — a few thousand production payloads per version, used by the CI compatibility gate
- [ ] **Known dead-letter retention** — this sets how long an old version must remain readable
- [ ] **Per-version metric labels** — a counter keyed on `schema_version` so you can watch a version drain

---

## The three kinds of change

Every schema change is one of three things, and the third is the one that causes incidents.

A **compatible** change is one an old consumer survives unchanged: adding an optional field, widening a numeric range, adding a new enum member that old consumers route to a default branch. A **breaking** change is one an old consumer fails on loudly: removing a required field, renaming one, tightening a type. These are unpleasant but manageable, because the failure is immediate and obvious.

A **silently breaking** change is one where every consumer keeps working, every payload validates, and the meaning has changed. Spatial schemas produce these far more readily than ordinary ones, because so much of a geometry's meaning lives outside its structure: the projection the numbers are in, the axis order, the precision they have been rounded to, the winding direction of a polygon's rings. None of that is visible to a type check.

<figure class="fig">
<svg viewBox="0 0 760 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Three categories of schema change with spatial examples, showing which fail loudly and which do not fail at all">
<title>Three kinds of schema change, and how each announces itself</title>
<desc>Schema changes sorted by how they fail. Compatible changes such as adding an optional confidence field or a new enum member are absorbed by old consumers, which keep working; the change announces itself only in the changelog. Breaking changes such as removing a required field or renaming geometry to geom cause an immediate validation error on the first event, so they are caught in staging within seconds. Silently breaking changes such as switching the canonical projection from EPSG:4326 to EPSG:3857, changing coordinate rounding from six to seven decimal places, or reversing polygon ring winding produce payloads that validate perfectly and mean something different, so no error is raised anywhere and the symptom appears days later as features in the wrong place or deduplication that has stopped matching. The third row is the one a schema registry cannot catch, because structural compatibility is exactly what it checks.</desc>
<rect x="0" y="0" width="760" height="250" fill="var(--fig-bg)"/>
<rect x="14" y="30" width="732" height="60" rx="7" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="50" font-size="10.5" font-weight="600" fill="var(--fig-ink)">Compatible — old consumers absorb it</text>
<text x="26" y="68" font-size="9" fill="var(--fig-ink-soft)">a new optional confidence field · a new enum member routed to a default branch · widening a numeric range</text>
<text x="26" y="83" font-size="9" fill="var(--fig-mint-edge)">announces itself in the changelog and nowhere else — which is fine, because nothing changed</text>
<rect x="14" y="98" width="732" height="60" rx="7" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="26" y="118" font-size="10.5" font-weight="600" fill="var(--fig-ink)">Breaking — old consumers fail immediately</text>
<text x="26" y="136" font-size="9" fill="var(--fig-ink-soft)">removing a required field · renaming geometry to geom · tightening a type</text>
<text x="26" y="151" font-size="9" fill="var(--fig-gold-edge)">a validation error on the first event — unpleasant, but you find it in staging within seconds</text>
<rect x="14" y="166" width="732" height="72" rx="7" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="26" y="186" font-size="10.5" font-weight="600" fill="var(--fig-ink)">Silently breaking — everything works and the meaning has changed</text>
<text x="26" y="204" font-size="9" fill="var(--fig-ink-soft)">canonical CRS EPSG:4326 → EPSG:3857 · rounding 6 d.p. → 7 d.p. · ring winding reversed · axis order swapped</text>
<text x="26" y="219" font-size="9" fill="var(--fig-rose-edge)">no error anywhere. The symptom arrives days later as features in the wrong place, or deduplication that</text>
<text x="26" y="231" font-size="9" fill="var(--fig-rose-edge)">stopped matching — and a schema registry cannot catch it, because structure is exactly what it checks.</text>
</svg>
<figcaption><b>Figure 1.</b> The first two rows are handled by any schema registry. The third is not, because every change in it leaves the structure intact — which is why a spatial schema needs a version field even when the wire format already has one.</figcaption>
</figure>

That last row is why a spatial event needs an explicit `schema_version` even under Protobuf or Avro. Those formats solve structural compatibility completely and semantic compatibility not at all.

---

## Architecture: version at the envelope, dispatch at the consumer

The version belongs in the envelope, alongside the routing fields, not inside the geometry object. A consumer reads it before parsing anything else and dispatches to the model for that version; the geometry is only deserialised once the consumer knows which contract it is being offered.

<figure class="fig">
<svg viewBox="0 0 760 254" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Version-dispatched parsing, with each schema version mapped to its own model and a shared internal representation">
<title>Version dispatch: many wire schemas, one internal model</title>
<desc>An event arrives carrying schema_version in its envelope. The consumer reads that field before parsing anything else and selects the matching Pydantic model: version one, version two which added a confidence field, or version three which changed the canonical projection. Each model parses only the payloads it was written for, and each knows how to upgrade its own output into one shared internal representation, so the rest of the consumer is written once against that representation rather than branching on version at every call site. An unknown version does not fall through to a best guess; it is routed to the dead-letter queue with the version recorded, because a consumer that guesses at an unrecognised contract produces exactly the silent corruption the version field exists to prevent. The upgrade functions are also where a semantic change is absorbed — the version-three upgrade reprojects to the canonical CRS, so downstream code never learns that the producer changed.</desc>
<rect x="0" y="0" width="760" height="254" fill="var(--fig-bg)"/>
<defs><marker id="sv-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="96" width="130" height="52" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="79" y="116" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">event envelope</text>
<text x="79" y="132" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">schema_version read</text>
<text x="79" y="143" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">before any parsing</text>
<line x1="146" y1="112" x2="180" y2="60" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sv-a)"/>
<line x1="146" y1="122" x2="180" y2="112" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sv-a)"/>
<line x1="146" y1="132" x2="180" y2="164" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sv-a)"/>
<line x1="146" y1="142" x2="180" y2="216" stroke="var(--fig-line)" stroke-width="1.2" stroke-dasharray="3,2" marker-end="url(#sv-a)"/>
<rect x="184" y="34" width="230" height="46" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="196" y="52" font-size="9" font-weight="600" fill="var(--fig-ink)">SpatialEventV1</text>
<text x="196" y="68" font-size="8.5" fill="var(--fig-ink-soft)">the original contract</text>
<rect x="184" y="88" width="230" height="46" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="196" y="106" font-size="9" font-weight="600" fill="var(--fig-ink)">SpatialEventV2</text>
<text x="196" y="122" font-size="8.5" fill="var(--fig-ink-soft)">adds confidence — structurally compatible</text>
<rect x="184" y="142" width="230" height="46" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="196" y="160" font-size="9" font-weight="600" fill="var(--fig-ink)">SpatialEventV3</text>
<text x="196" y="176" font-size="8.5" fill="var(--fig-ink-soft)">canonical CRS changed — semantic</text>
<rect x="184" y="196" width="230" height="46" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="196" y="214" font-size="9" font-weight="600" fill="var(--fig-ink)">unknown version → dead-letter</text>
<text x="196" y="230" font-size="8.5" fill="var(--fig-ink-soft)">never guess at an unrecognised contract</text>
<line x1="418" y1="57" x2="452" y2="100" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sv-a)"/>
<line x1="418" y1="111" x2="452" y2="112" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sv-a)"/>
<line x1="418" y1="165" x2="452" y2="124" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sv-a)"/>
<rect x="456" y="86" width="150" height="52" rx="6" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.5"/>
<text x="531" y="106" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">upgrade()</text>
<text x="531" y="122" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">where a semantic change</text>
<text x="531" y="133" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">is absorbed, once</text>
<line x1="608" y1="112" x2="642" y2="112" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#sv-a)"/>
<rect x="646" y="86" width="100" height="52" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="696" y="106" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink)">one internal</text>
<text x="696" y="120" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink)">model</text>
<text x="696" y="133" text-anchor="middle" font-size="8" fill="var(--fig-ink-soft)">no version branching</text>
</svg>
<figcaption><b>Figure 2.</b> Version branching lives in exactly one place — the dispatch table and its upgrade functions. Everything downstream is written against the internal model, so a new version adds one class and one upgrade rather than a conditional at every call site.</figcaption>
</figure>

**Layer breakdown:**

1. **Envelope read** — `schema_version` is a flat field in the envelope, so it is readable without deserialising the geometry. This matters because an unknown version must be rejected *before* you spend CPU parsing a payload you cannot interpret.
2. **Model dispatch** — a mapping from version to Pydantic model. Each model is a complete description of one wire contract; none of them use optional-everything to span versions, because a model that accepts all versions cannot tell you which one it received.
3. **Upgrade to internal** — each version knows how to produce the current internal representation. A semantic change, such as a producer switching canonical projection, is absorbed here once rather than being handled at every downstream call site.
4. **Unknown version** — routed to the dead-letter queue with the version recorded in the envelope, exactly as described in [Dead-Letter Queues for Spatial Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/). A consumer that guesses at an unrecognised contract produces the silent corruption the version field exists to prevent.

---

## Step-by-step implementation

### Step 1 — Put the version where it can be read cheaply

The version must be readable without parsing the geometry, which means it lives in the envelope next to the routing fields rather than inside the feature.

```python
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field


class SchemaVersion(StrEnum):
    V1 = "spatial-event/1"
    V2 = "spatial-event/2"
    V3 = "spatial-event/3"


class Envelope(BaseModel):
    """The flat header every version shares. Parsed first, cheaply."""

    schema_version: SchemaVersion
    event_id: str
    occurred_at: str
    partition_key: str
    # The geometry is deliberately left as an opaque blob here: the envelope
    # must parse even when the body belongs to a version we cannot interpret,
    # so that the dead-letter record can carry a real version label.
    body: dict
```

Parsing in two stages — envelope, then body — is what lets an unknown version be dead-lettered with useful context instead of failing as an unparseable blob.

### Step 2 — Model each version separately

The temptation is one model with every field optional. Resist it: such a model accepts all versions and can tell you nothing about which one arrived, so every downstream branch has to re-derive the version from which fields happen to be populated.

```python
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer


class SpatialEventV1(BaseModel):
    schema_version: Literal[SchemaVersion.V1]
    feature_id: int
    geometry: dict          # GeoJSON, EPSG:4326, 6 d.p.


class SpatialEventV2(BaseModel):
    schema_version: Literal[SchemaVersion.V2]
    feature_id: int
    geometry: dict          # unchanged contract
    confidence: float = Field(ge=0.0, le=1.0)


class SpatialEventV3(BaseModel):
    schema_version: Literal[SchemaVersion.V3]
    feature_id: int
    geometry: dict          # EPSG:3857 metres — the semantic change
    confidence: float = Field(ge=0.0, le=1.0)
```

`SpatialEventV3` is the interesting one. Structurally it is identical to V2; a schema registry comparing field names and types would call the change compatible. The difference is entirely in what the numbers mean, which is why it needs a version of its own.

### Step 3 — Give every version an upgrade to one internal model

Downstream code should never branch on version. Each version knows how to become the current internal representation, and that is the only place the difference exists.

```python
_TO_4326 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)


class SpatialEvent(BaseModel):
    """The internal model. Always EPSG:4326, always 6 d.p."""

    feature_id: int
    geometry: dict
    confidence: float


def upgrade_v1(e: SpatialEventV1) -> SpatialEvent:
    # V1 predates confidence; absent is not zero, it is "unknown". Using the
    # midpoint would invent information, so callers get an explicit sentinel.
    return SpatialEvent(feature_id=e.feature_id, geometry=e.geometry,
                        confidence=float("nan"))


def upgrade_v2(e: SpatialEventV2) -> SpatialEvent:
    return SpatialEvent(feature_id=e.feature_id, geometry=e.geometry,
                        confidence=e.confidence)


def upgrade_v3(e: SpatialEventV3) -> SpatialEvent:
    # The whole semantic change, absorbed once.
    from shapely.geometry import mapping

    geom = transform(_TO_4326.transform, shape(e.geometry))
    return SpatialEvent(feature_id=e.feature_id, geometry=mapping(geom),
                        confidence=e.confidence)
```

The `upgrade_v1` case is worth dwelling on. When a field is added, old events do not have it, and the upgrade has to say what its absence means. Defaulting to zero would be wrong here — zero confidence is a real value that says "certainly not", while the absence says "we did not measure". Encoding one as the other is a data-quality bug that no test will catch, because both are valid floats.

### Step 4 — Dispatch, and refuse to guess

```python
import structlog

log = structlog.get_logger()

_MODELS = {
    SchemaVersion.V1: (SpatialEventV1, upgrade_v1),
    SchemaVersion.V2: (SpatialEventV2, upgrade_v2),
    SchemaVersion.V3: (SpatialEventV3, upgrade_v3),
}


class UnknownSchemaVersion(Exception):
    """Raised for a version this consumer was not written against."""


def parse_event(raw: bytes) -> SpatialEvent:
    env = Envelope.model_validate_json(raw)
    entry = _MODELS.get(env.schema_version)
    if entry is None:
        # Deliberately not a best-effort parse. An unrecognised contract that
        # happens to validate against the newest model is the failure mode this
        # whole design exists to prevent.
        log.error("unknown_schema_version", version=env.schema_version,
                  event_id=env.event_id)
        raise UnknownSchemaVersion(env.schema_version)

    model, upgrade = entry
    return upgrade(model.model_validate(env.body | {"schema_version": env.schema_version}))
```

### Step 5 — Roll readers out before writers

The ordering is not a style preference; it follows from which side would meet data it cannot interpret. Deploy consumers that understand the new version first, then producers that emit it. For a removal, reverse it: stop emitting first, drop the reader afterwards.

<figure class="fig">
<svg viewBox="0 0 760 238" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Rollout order for adding and removing a schema version, and the overlap window in which both are live">
<title>The overlap window is the deployment, not a step within it</title>
<desc>Adding version three runs in three stages. First every consumer is deployed with the version-three model and upgrade function, while producers still emit version two; nothing changes on the wire and the new code is exercised only by tests. Second, producers are moved to version three, usually gradually, so the stream carries a mixture and both models are in active use — this overlap window is the deployment itself rather than a step within it, and it must last at least as long as the dead-letter retention period, since a replayed event arrives carrying the version it was produced under. Third, once a per-version counter shows no version-two events arriving for a full retention window, the version-two model can be removed. Removing a version reverses the order: producers stop emitting it first, and readers drop it only after the same drain period. Skipping the wait is what turns a routine deprecation into a batch of dead-lettered replays.</desc>
<rect x="0" y="0" width="760" height="238" fill="var(--fig-bg)"/>
<defs><marker id="ro-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="34" width="220" height="62" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="52" font-size="9.5" font-weight="600" fill="var(--fig-ink)">1 · readers gain V3</text>
<text x="26" y="69" font-size="8.5" fill="var(--fig-ink-soft)">producers still emit V2 — nothing</text>
<text x="26" y="80" font-size="8.5" fill="var(--fig-ink-soft)">changes on the wire</text>
<text x="26" y="92" font-size="8.5" fill="var(--fig-mint-edge)">new code exercised only by tests</text>
<line x1="238" y1="65" x2="266" y2="65" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#ro-a)"/>
<rect x="270" y="34" width="220" height="62" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="282" y="52" font-size="9.5" font-weight="600" fill="var(--fig-ink)">2 · writers move to V3</text>
<text x="282" y="69" font-size="8.5" fill="var(--fig-ink-soft)">the stream carries a mixture and</text>
<text x="282" y="80" font-size="8.5" fill="var(--fig-ink-soft)">both models are in active use</text>
<text x="282" y="92" font-size="8.5" fill="var(--fig-gold-edge)">this overlap IS the deployment</text>
<line x1="494" y1="65" x2="522" y2="65" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#ro-a)"/>
<rect x="526" y="34" width="220" height="62" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="538" y="52" font-size="9.5" font-weight="600" fill="var(--fig-ink)">3 · retire V2</text>
<text x="538" y="69" font-size="8.5" fill="var(--fig-ink-soft)">only once the per-version counter</text>
<text x="538" y="80" font-size="8.5" fill="var(--fig-ink-soft)">has read zero for a full window</text>
<text x="538" y="92" font-size="8.5" fill="var(--fig-mint-edge)">measured, not scheduled</text>
<rect x="14" y="116" width="732" height="52" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="134" font-size="10" font-weight="600" fill="var(--fig-ink)">How long the overlap must last: at least your dead-letter retention</text>
<text x="26" y="149" font-size="9" fill="var(--fig-ink-soft)">A replayed event arrives carrying the version it was produced under, so retiring V2 early fails exactly the events that already failed once —</text>
<text x="26" y="159" font-size="9" fill="var(--fig-ink-soft)">and they fail a second time for a new reason, which makes the original cause much harder to find.</text>
<rect x="14" y="176" width="732" height="48" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="26" y="194" font-size="10" font-weight="600" fill="var(--fig-ink)">Removals run the same three stages backwards</text>
<text x="26" y="205" font-size="9" fill="var(--fig-ink-soft)">Producers stop emitting first; readers drop support after the same drain period.</text>
<text x="26" y="215" font-size="9" fill="var(--fig-ink-soft)">The rule is unchanged — whichever side would meet data it cannot interpret goes last.</text>
</svg>
<figcaption><b>Figure 3.</b> The overlap window is the deployment rather than an awkward interval inside it, and its length is set by your longest replay path — measure the old version draining rather than scheduling its removal.</figcaption>
</figure>

---

## Spatial validation and error handling

Three failure modes are specific to evolving a *spatial* schema.

**A changed canonical projection passes every structural check.** This is the case `SpatialEventV3` models above. The defence is the version field plus a bounds assertion in the upgrade function: if a payload claiming EPSG:4326 carries coordinates outside ±180 and ±90, the producer is not sending what it says it is. That magnitude test is described in more detail under [Webhook Security Boundaries](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/).

**A changed precision policy silently invalidates every derived key.** Rounding coordinates to seven decimal places instead of six leaves a valid payload and changes every idempotency key computed from it, so deduplication stops matching across the boundary and the same feature is written twice. Precision is part of the schema; treat a change to it as a version bump.

**A new geometry type breaks consumers that pattern-match.** Adding `MultiPolygon` to a stream that previously carried only `Polygon` is structurally compatible — the field is still a GeoJSON object — but a consumer with an `if geom["type"] == "Polygon"` branch now silently skips those events. Enumerate accepted geometry types explicitly in the model so the addition fails loudly at validation rather than quietly at the branch.

```python
from typing import Literal

GeometryType = Literal["Point", "LineString", "Polygon", "MultiPolygon"]


def assert_canonical(geometry: dict, version: SchemaVersion) -> None:
    """Catch a producer whose declared version no longer matches its output."""
    if geometry["type"] not in GeometryType.__args__:
        raise ValueError(f"unsupported geometry type {geometry['type']!r}")

    if version in (SchemaVersion.V1, SchemaVersion.V2):
        # These versions promise EPSG:4326. Values past the degree range mean
        # the producer changed projection without changing its version.
        for lon, lat in _iter_coords(geometry):
            if abs(lon) > 180 or abs(lat) > 90:
                raise ValueError(
                    f"{version} promises EPSG:4326 but carries projected metres"
                )
```

---

## Retry, backoff and delivery guarantees

An unknown schema version is a *deterministic* failure: it will fail identically on every redelivery, so it must not enter the retry ladder. Classify it as terminal and route it straight to the poison store described in [Dead-Letter Queues for Spatial Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/), which alerts on the first record rather than on a rate.

The subtlety is that an unknown version is often a *temporary* deterministic failure — it means a producer got ahead of its consumers, and the fix is a deploy rather than a payload correction. That makes those dead-lettered events genuinely replayable once the consumer catches up, unlike an invalid geometry, which will never succeed. Tag the dead-letter record with `reason="unknown_schema_version"` so the replay job can select exactly that class and re-inject it after the rollout completes, reusing the original idempotency key as [Replaying Dead-Letter Spatial Events Safely](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/replaying-dead-letter-spatial-events-safely/) describes.

---

## Verification

The check that actually catches a bad schema change is a replay of recorded events against the new code, run in CI. A unit test written alongside the change tests what the author expected; a corpus of real payloads tests what producers actually send.

```python
import json
import pathlib

import pytest

CORPUS = pathlib.Path("_verify/events")


@pytest.mark.parametrize("path", sorted(CORPUS.glob("*.jsonl")))
def test_recorded_events_still_parse(path):
    """Every recorded production event must still parse and upgrade.

    The corpus is grouped by the version each file was captured under, so a
    version that has been retired fails here loudly rather than in production.
    """
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        event = parse_event(line.encode())
        assert event.geometry["type"] in GeometryType.__args__
        for lon, lat in _iter_coords(event.geometry):
            assert abs(lon) <= 180 and abs(lat) <= 90


def test_unknown_version_is_rejected_not_guessed():
    """The gate's own negative case: an unrecognised version must not parse.

    Without this, a dispatch table that silently falls back to the newest model
    would pass every other test in this file.
    """
    raw = json.dumps({
        "schema_version": "spatial-event/99",
        "event_id": "evt-1", "occurred_at": "2026-08-08T00:00:00Z",
        "partition_key": "8828308281fffff",
        "body": {"feature_id": 1, "geometry": {"type": "Point", "coordinates": [13.4, 52.5]}},
    }).encode()
    with pytest.raises((UnknownSchemaVersion, ValueError)):
        parse_event(raw)
```

The second test is the one worth insisting on. A dispatch table that quietly falls back to the newest model passes every positive test in the file and reintroduces exactly the silent misinterpretation the version field was added to prevent.

---

## Troubleshooting

<div class="table-scroll">

| Symptom | Likely spatial cause | Fix |
|---|---|---|
| Deduplication hit rate drops to near zero after a deploy | Coordinate precision or field set changed, so derived keys no longer match | Hash over an explicit field list, and bump the schema version when precision changes |
| Features render in the wrong place, no errors anywhere | Producer changed canonical CRS without a version bump | Add the magnitude assertion to the upgrade path; treat projection as part of the schema |
| A consumer silently processes fewer events than it receives | A new geometry type was added and a `type ==` branch skips it | Enumerate accepted geometry types in the model so the addition fails at validation |
| Dead-letter queue fills with `unknown_schema_version` right after a release | Producers deployed before consumers | Roll readers first; re-inject the dead-lettered batch once consumers are current |
| Replayed events from last week now fail | An old schema version was retired before the dead-letter retention window elapsed | Restore the retired model, drain, then retire on a measured zero rather than a date |
| `confidence` reads 0.0 for old events that never carried it | An added field was defaulted rather than marked unknown | Distinguish absent from zero in the upgrade function |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Do I need a schema version field if I use Protobuf or Avro?</strong></summary>

Yes, for a different reason than you need it in JSON. Protobuf and Avro handle structural compatibility for you — an unknown field is preserved, a missing optional field gets its default — but they cannot express semantic changes, which is where spatial schemas actually break. Changing the canonical CRS from EPSG:4326 to EPSG:3857, or changing coordinate rounding from six decimal places to seven, leaves the wire format identical and changes what the numbers mean. An explicit schema version is the only thing that lets a consumer detect that.

</details>

<details class="faq">
<summary><strong>Is adding an optional field always a safe change?</strong></summary>

Structurally yes, operationally no. Old consumers ignore the field and keep working, so nothing breaks. But if any consumer derives an idempotency key or a content hash from the whole payload, the added field changes that hash, so the same logical event now produces a different key and deduplication stops matching across the rollout boundary. Hash over an explicit field list rather than the whole payload, and adding a field becomes genuinely safe.

</details>

<details class="faq">
<summary><strong>How long should I support an old schema version?</strong></summary>

At least as long as your longest replay path, which is normally dead-letter retention. A dead-lettered event replayed a week later arrives carrying the schema version it was produced under, so a consumer that dropped support for it will fail on exactly the events that already failed once. Tie the support window to dead-letter retention rather than picking a duration, and instrument a counter per version so you can see when the old one genuinely stops arriving.

</details>

<details class="faq">
<summary><strong>Can I change the coordinate precision policy without a version bump?</strong></summary>

No — this is the classic silently breaking change. Rounding coordinates to a different number of decimal places produces a valid payload that passes every schema check while changing every derived key: the idempotency hash, the deduplication key, and any content hash used for tile invalidation. Consumers see a stream in which nothing matches anything from before the change, and the symptom is duplicate writes rather than an error. Treat precision as part of the schema and bump the version with it.

</details>

---

## Related

- [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/) — the section this topic belongs to, including the four-layer event envelope the version field sits in
- [Best Practices for Spatial Event Payload Schemas](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/best-practices-for-spatial-event-payload-schemas/) — the five isolated domains a schema should keep apart, which is what makes it evolvable
- [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — why a changed field set moves every derived key
- [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) — the canonical projection a schema version pins down
- [Dead-Letter Queues for Spatial Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/) — where an unknown version goes, and why it is replayable
