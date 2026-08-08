---
title: "Adding a Field to a Live Spatial Event Schema"
description: "Add a field to a running geospatial event stream without breaking deduplication: hash over an explicit field list, distinguish absent from zero, and roll readers out first."
slug: "adding-a-field-to-a-live-spatial-event-schema"
type: "article"
breadcrumb: "Core Event Fundamentals & Architecture > Schema Evolution & Versioning for Spatial Events > Adding a Field to a Live Spatial Event Schema"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Adding a Field to a Live Spatial Event Schema",
      "description": "Adding an optional field to a geospatial event schema is structurally safe and operationally dangerous: it silently changes any idempotency key derived from the whole payload. This guide covers hashing over an explicit field list, encoding absence rather than defaulting it, and the rollout order that keeps both halves of the stream readable.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/adding-a-field-to-a-live-spatial-event-schema/",
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
        {"@type": "ListItem", "position": 4, "name": "Adding a Field to a Live Spatial Event Schema", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/adding-a-field-to-a-live-spatial-event-schema/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Add a field to a live spatial event schema",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Move the idempotency hash onto an explicit field list before adding anything"},
        {"@type": "HowToStep", "position": 2, "name": "Decide what the field's absence means, and encode it rather than defaulting it"},
        {"@type": "HowToStep", "position": 3, "name": "Deploy readers, then writers, and watch the per-version counter drain"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does adding an optional field break deduplication?",
          "acceptedAnswer": {"@type": "Answer", "text": "Only if the idempotency key is derived from the whole payload. A canonical serialisation of the full event includes the new field, so the same logical event hashes differently before and after the producer starts sending it. The deduplication store holds the old hashes, the new events produce new ones, nothing matches, and every redelivery across the rollout window is treated as novel and written again. Hashing over an explicit list of identity fields makes the addition invisible to the key."}
        },
        {
          "@type": "Question",
          "name": "Should a new numeric field default to zero for old events?",
          "acceptedAnswer": {"@type": "Answer", "text": "Almost never. Zero is a measurement; absence is the lack of one, and collapsing the second into the first invents data. A confidence of 0.0 asserts the reading is certainly wrong, while a missing confidence says nobody measured it — a consumer filtering on confidence below 0.2 will discard every historical event if you default to zero. Use NaN, None, or a separate presence flag so the difference survives."}
        },
        {
          "@type": "Question",
          "name": "Do I need a new schema version just to add a field?",
          "acceptedAnswer": {"@type": "Answer", "text": "Yes, even though the change is structurally compatible. The version is what lets a consumer know which contract it received, so it can tell a genuinely absent value from one the producer simply had not started sending yet. Without it, an old event and a new event that happens to omit an optional field are indistinguishable, and any logic that treats absence as meaningful has no way to interpret it."}
        }
      ]
    }
  ]
}
</script>

**Add the field to the idempotency hash's exclusion list before you add it to the schema — otherwise the same logical event hashes differently on either side of the rollout, deduplication stops matching, and every redelivery during the changeover is written twice.**

This guide sits under [Schema Evolution & Versioning for Spatial Events](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/), within [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/). It assumes the deterministic key scheme described in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/).

## When to use this pattern

- You are adding an optional field — a confidence score, a source identifier, a sensor model — to a stream that is already in production and already deduplicated.
- Your idempotency or content hash is currently computed over the serialised payload rather than over a named subset of it.
- Consumers exist that you do not control, so the change has to be safe for readers that will never be updated.

If the stream has no deduplication and no content hashing, adding an optional field really is trivial, and this guide is about the case where it is not.

## Why the hash is the problem, not the field

The field itself is harmless. Old consumers ignore it, new consumers read it, and every payload validates on both sides. What breaks is anything downstream that treated the payload's bytes as the event's identity.

<figure class="fig">
<svg viewBox="0 0 760 216" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The same logical event hashed before and after a field is added, under whole-payload hashing and explicit-field hashing">
<title>Where an added field does and does not reach</title>
<desc>One logical event for feature 4471 is delivered before and after producers begin sending a confidence field. Hashing a canonical serialisation of the whole payload includes the new field, so the two deliveries produce different digests and the deduplication store, holding the earlier one, does not recognise the later one; the event is written a second time and every redelivery during the rollout window does the same. Hashing over an explicit identity list — feature id, normalised geometry, occurred-at — excludes the new field by construction, so both deliveries produce the same digest and the second is correctly recognised as a duplicate. The distinction is not about which fields are important but about which fields constitute identity: confidence describes the observation, it does not say which observation this is.</desc>
<rect x="0" y="0" width="760" height="216" fill="var(--fig-bg)"/>
<defs><marker id="af-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-rose-edge)">hash(canonical(whole payload))</text>
<rect x="14" y="30" width="230" height="42" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="26" y="47" font-size="8.5" font-family="monospace" fill="var(--fig-ink-soft)">{feature_id, geometry, occurred_at}</text>
<text x="26" y="63" font-size="8.5" fill="var(--fig-ink-soft)">before → 9f2c1a…</text>
<line x1="248" y1="51" x2="276" y2="51" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#af-a)"/>
<rect x="280" y="30" width="252" height="42" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="292" y="47" font-size="8.5" font-family="monospace" fill="var(--fig-ink-soft)">{feature_id, geometry, occurred_at, confidence}</text>
<text x="292" y="63" font-size="8.5" fill="var(--fig-rose-edge)">after → 41ba6d… — no match</text>
<rect x="546" y="30" width="200" height="42" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="558" y="47" font-size="8.5" font-weight="600" fill="var(--fig-ink)">written twice</text>
<text x="558" y="63" font-size="8" fill="var(--fig-ink-soft)">for every redelivery in the window</text>
<line x1="14" y1="88" x2="746" y2="88" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="108" font-size="10.5" font-weight="600" fill="var(--fig-mint-edge)">hash over an explicit identity list</text>
<rect x="14" y="118" width="230" height="42" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="26" y="135" font-size="8.5" font-family="monospace" fill="var(--fig-ink-soft)">IDENTITY = (feature_id, geometry,</text>
<text x="26" y="150" font-size="8.5" font-family="monospace" fill="var(--fig-ink-soft)">            occurred_at)</text>
<line x1="248" y1="139" x2="276" y2="139" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#af-a)"/>
<rect x="280" y="118" width="252" height="42" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="292" y="135" font-size="8.5" fill="var(--fig-ink)">confidence is not in the list, so it</text>
<text x="292" y="150" font-size="8.5" fill="var(--fig-mint-edge)">cannot move the digest — 9f2c1a… both times</text>
<rect x="546" y="118" width="200" height="42" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="558" y="135" font-size="8.5" font-weight="600" fill="var(--fig-ink)">recognised as a duplicate</text>
<text x="558" y="151" font-size="8" fill="var(--fig-ink-soft)">written once, correctly</text>
<rect x="14" y="176" width="732" height="32" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="26" y="193" font-size="9.5" font-weight="600" fill="var(--fig-ink)">The question is not which fields matter — it is which fields constitute identity.</text>
<text x="26" y="205" font-size="9" fill="var(--fig-ink-soft)">Confidence describes the observation. It does not say which observation this is, so it has no business in the key.</text>
</svg>
<figcaption><b>Figure 1.</b> Moving to an explicit identity list is the change that has to land first — it makes this addition safe and every future one safe as well.</figcaption>
</figure>

## Complete runnable implementation

```python
import hashlib
import json
import math
from typing import Any

from shapely.geometry import mapping, shape
from shapely.ops import transform


# The identity of a spatial event: which feature, what shape, when observed.
# Anything describing the observation rather than naming it stays out.
IDENTITY_FIELDS = ("feature_id", "geometry", "occurred_at")

PRECISION = 6  # decimal places; part of the schema, see the parent topic


def _round_geometry(geometry: dict[str, Any]) -> dict[str, Any]:
    """Round coordinates so float noise cannot move the digest."""
    geom = shape(geometry)
    rounded = transform(
        lambda *coords: tuple(round(c, PRECISION) for c in coords), geom
    )
    return mapping(rounded)


def identity_key(event: dict[str, Any]) -> str:
    """Derive the idempotency key from named fields only.

    Adding, removing or reordering any field outside IDENTITY_FIELDS cannot
    change this value — which is exactly the property that makes a schema
    addition safe to deploy against a live deduplication store.
    """
    identity = {}
    for name in IDENTITY_FIELDS:
        value = event[name]
        identity[name] = _round_geometry(value) if name == "geometry" else value

    canonical = json.dumps(
        identity, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )
    return hashlib.sha256(canonical.encode()).hexdigest()[:32]


def confidence_of(event: dict[str, Any]) -> float:
    """Read the new field, preserving the difference between absent and zero.

    An event produced before the field existed did not measure confidence.
    Returning 0.0 would assert the reading is certainly wrong, which is a
    different — and false — statement.
    """
    if "confidence" not in event:
        return math.nan
    return float(event["confidence"])
```

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `IDENTITY_FIELDS` | `tuple[str, ...]` | Must name identity, not description; changing it is itself a breaking change | `("feature_id", "geometry", "occurred_at")` |
| `PRECISION` | `int` | Decimal places in EPSG:4326; 6 ≈ 11 cm. Changing it moves every key | `6` |
| `sort_keys` | `bool` | Must be `True`, or key insertion order leaks into the digest | `True` |
| `separators` | `tuple[str, str]` | Must be `(",", ":")` so whitespace cannot vary | — |
| `ensure_ascii` | `bool` | `True` keeps non-ASCII place names encoded identically across producers | `True` |

</div>

## Gotchas and spatial edge cases

1. **Changing `IDENTITY_FIELDS` is a breaking change, not a refactor.** Every key in the deduplication store was computed under the old list. Adding or removing an identity field invalidates all of them at once, so it needs the same overlap treatment as any other schema version bump — and, unlike a payload field addition, it cannot be made invisible.

2. **The geometry must be normalised before it enters the key.** If the added field's rollout coincides with a producer that emits different ring winding or a different CRS, you will see the deduplication failure and blame the new field. Normalise projection, winding and precision inside `identity_key` so the key depends on the shape rather than on its encoding.

3. **`NaN` does not compare equal to itself.** Using `math.nan` to mean "not measured" is correct for storage and wrong for equality tests: `nan == nan` is `False`, so a naive comparison treats two unmeasured events as different. Test with `math.isnan()`, or carry a separate `confidence_measured: bool` if the value flows into comparison logic.

4. **A field added inside `geometry` is not optional at all.** GeoJSON geometry objects have a fixed member set; adding a vendor field inside one produces a payload many strict parsers reject, and it will be included by any geometry-aware hashing. Extra fields belong in the envelope, alongside the routing keys.

5. **Backfilling the new field changes historical keys.** If you run a job to populate `confidence` on stored events, and anything recomputes keys from stored records, those records now hash differently from the live stream. Backfill the value but never recompute the key — the key was assigned at ingest and is part of the event's identity, as [Replaying Dead-Letter Spatial Events Safely](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/replaying-dead-letter-spatial-events-safely/) describes.

<figure class="fig">
<svg viewBox="0 0 760 206" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Deployment order for a field addition, with the identity-list change landing before either producers or the field itself">
<title>Three deploys, and only the first one is optional to notice</title>
<desc>The change lands in three deploys. First the identity list is introduced on its own, with no schema change at all: the key function stops hashing the whole payload and starts hashing named fields, and because no field has been added yet the digests it produces are identical to the ones already in the deduplication store, so the deploy is a no-op on the wire and can be verified against live traffic before anything depends on it. Second, consumers gain the new field and the version that carries it, while producers still emit the old version. Third, producers begin emitting the field. Only after the identity list is in place is the third deploy safe, which is why it has to be separated out rather than bundled — bundling means the deduplication break and the field addition ship together, and the first is diagnosed as the second.</desc>
<rect x="0" y="0" width="760" height="206" fill="var(--fig-bg)"/>
<defs><marker id="ar-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="34" width="228" height="66" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="26" y="53" font-size="9.5" font-weight="600" fill="var(--fig-ink)">1 · identity list only</text>
<text x="26" y="70" font-size="8.5" fill="var(--fig-ink-soft)">no schema change · no new field</text>
<text x="26" y="83" font-size="8.5" fill="var(--fig-mint-edge)">digests are identical to those already</text>
<text x="26" y="94" font-size="8.5" fill="var(--fig-mint-edge)">in the store — a verifiable no-op</text>
<line x1="246" y1="67" x2="274" y2="67" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#ar-a)"/>
<rect x="278" y="34" width="228" height="66" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="290" y="53" font-size="9.5" font-weight="600" fill="var(--fig-ink)">2 · readers gain the field</text>
<text x="290" y="70" font-size="8.5" fill="var(--fig-ink-soft)">consumers understand the new version</text>
<text x="290" y="83" font-size="8.5" fill="var(--fig-ink-soft)">producers still emit the old one</text>
<text x="290" y="94" font-size="8.5" fill="var(--fig-gold-edge)">still nothing on the wire</text>
<line x1="510" y1="67" x2="538" y2="67" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#ar-a)"/>
<rect x="542" y="34" width="204" height="66" rx="6" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.4"/>
<text x="554" y="53" font-size="9.5" font-weight="600" fill="var(--fig-ink)">3 · writers emit it</text>
<text x="554" y="70" font-size="8.5" fill="var(--fig-ink-soft)">safe only because step 1 landed</text>
<text x="554" y="83" font-size="8.5" fill="var(--fig-ink-soft)">the key cannot see the new field,</text>
<text x="554" y="94" font-size="8.5" fill="var(--fig-ink-soft)">so dedup keeps matching throughout</text>
<rect x="14" y="118" width="732" height="76" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="26" y="136" font-size="10" font-weight="600" fill="var(--fig-ink)">What bundling steps 1 and 3 costs you</text>
<text x="26" y="154" font-size="9" fill="var(--fig-ink-soft)">The deduplication break and the field addition ship in the same release, so the symptom — duplicate writes appearing across the fleet —</text>
<text x="26" y="167" font-size="9" fill="var(--fig-ink-soft)">is attributed to the field, which is the one part of the change that was never the problem.</text>
<text x="26" y="186" font-size="9" fill="var(--fig-rose-edge)">Separating them makes step 1 independently verifiable against live traffic, which is the only point in the sequence where that is possible.</text>
</svg>
<figcaption><b>Figure 2.</b> Landing the identity list as its own deploy is what makes it verifiable: with no schema change alongside it, any digest that moves is a bug in the key function rather than an expected consequence of the field.</figcaption>
</figure>

<figure class="fig">
<svg viewBox="0 0 760 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Absent, zero and unmeasured represented distinctly, and what a downstream filter does with each">
<title>Absent is not zero, and a filter can tell</title>
<desc>A downstream consumer filters out readings whose confidence is below 0.2. If events produced before the field existed are defaulted to 0.0, every one of them fails that filter and the historical record disappears from the consumer's view — silently, because a filter that excludes data raises nothing. If they carry NaN instead, the comparison is false in both directions, so the consumer must handle them explicitly and the choice becomes visible in code review. If they carry a separate measured flag, the consumer can branch on whether a measurement exists before comparing values at all. Only the first option loses information, and it loses it in the direction that is hardest to notice.</desc>
<rect x="0" y="0" width="760" height="200" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="10" font-weight="600" fill="var(--fig-ink)">Downstream filter: keep readings where confidence &gt;= 0.2</text>
<rect x="14" y="30" width="238" height="82" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="48" font-size="9.5" font-weight="600" fill="var(--fig-ink)">default 0.0</text>
<text x="26" y="66" font-size="8.5" fill="var(--fig-ink-soft)">0.0 &gt;= 0.2 is False</text>
<text x="26" y="80" font-size="8.5" fill="var(--fig-rose-edge)">every pre-rollout event is filtered out</text>
<text x="26" y="94" font-size="8.5" fill="var(--fig-ink-soft)">and a filter that excludes data raises</text>
<text x="26" y="105" font-size="8.5" fill="var(--fig-ink-soft)">nothing at all</text>
<rect x="260" y="30" width="238" height="82" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="272" y="48" font-size="9.5" font-weight="600" fill="var(--fig-ink)">NaN</text>
<text x="272" y="66" font-size="8.5" fill="var(--fig-ink-soft)">nan &gt;= 0.2 is False, and so is nan &lt; 0.2</text>
<text x="272" y="80" font-size="8.5" fill="var(--fig-gold-edge)">the consumer must handle it explicitly</text>
<text x="272" y="94" font-size="8.5" fill="var(--fig-ink-soft)">so the decision surfaces in review</text>
<text x="272" y="105" font-size="8.5" fill="var(--fig-ink-soft)">rather than in a dashboard, later</text>
<rect x="506" y="30" width="240" height="82" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="518" y="48" font-size="9.5" font-weight="600" fill="var(--fig-ink)">separate measured flag</text>
<text x="518" y="66" font-size="8.5" fill="var(--fig-ink-soft)">branch on existence before comparing</text>
<text x="518" y="80" font-size="8.5" fill="var(--fig-mint-edge)">no value can be mistaken for a measurement</text>
<text x="518" y="94" font-size="8.5" fill="var(--fig-ink-soft)">costs one boolean per event, and makes</text>
<text x="518" y="105" font-size="8.5" fill="var(--fig-ink-soft)">the ambiguity impossible to express</text>
<rect x="14" y="126" width="732" height="60" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="144" font-size="10" font-weight="600" fill="var(--fig-ink)">Only the first loses information, and it loses it in the direction hardest to notice</text>
<text x="26" y="162" font-size="9" fill="var(--fig-ink-soft)">Nothing errors, no count drops to zero, and the events are still in the store. They have simply stopped reaching one consumer, which is the</text>
<text x="26" y="175" font-size="9" fill="var(--fig-ink-soft)">kind of failure that is normally found months later by someone asking why a historical chart starts on the day of a deploy.</text>
</svg>
<figcaption><b>Figure 3.</b> The default value you pick for old events is an assertion about them. Zero asserts a measurement that was never taken; only the third option makes that assertion impossible to write by accident.</figcaption>
</figure>

## Verification

```python
import math

import pytest


def test_added_field_does_not_move_the_key():
    """The property the whole change depends on."""
    before = {"feature_id": 4471, "occurred_at": "2026-08-08T09:14:00Z",
              "geometry": {"type": "Point", "coordinates": [13.4049547, 52.5200087]}}
    after = before | {"confidence": 0.87}

    assert identity_key(before) == identity_key(after)


def test_absent_confidence_is_not_zero():
    """A pre-rollout event must not claim a measurement it never had."""
    assert math.isnan(confidence_of({"feature_id": 1}))
    assert confidence_of({"feature_id": 1, "confidence": 0.0}) == 0.0


def test_identity_field_change_is_detected():
    """The gate's negative case: the key must be sensitive to identity.

    A key that ignored everything would satisfy the first test perfectly, so
    this asserts the digest still moves when the geometry genuinely changes.
    """
    a = {"feature_id": 4471, "occurred_at": "2026-08-08T09:14:00Z",
         "geometry": {"type": "Point", "coordinates": [13.4049547, 52.5200087]}}
    b = a | {"geometry": {"type": "Point", "coordinates": [13.5, 52.5200087]}}
    assert identity_key(a) != identity_key(b)
```

The third test is the one that earns its place. Without it, a key function that hashed a constant would pass the first two and destroy deduplication entirely.

## FAQ

<details class="faq">
<summary><strong>Why does adding an optional field break deduplication?</strong></summary>

Only if the idempotency key is derived from the whole payload. A canonical serialisation of the full event includes the new field, so the same logical event hashes differently before and after the producer starts sending it. The deduplication store holds the old hashes, the new events produce new ones, nothing matches, and every redelivery across the rollout window is treated as novel and written again. Hashing over an explicit list of identity fields makes the addition invisible to the key.

</details>

<details class="faq">
<summary><strong>Should a new numeric field default to zero for old events?</strong></summary>

Almost never. Zero is a measurement; absence is the lack of one, and collapsing the second into the first invents data. A confidence of 0.0 asserts the reading is certainly wrong, while a missing confidence says nobody measured it — a consumer filtering on confidence below 0.2 will discard every historical event if you default to zero. Use `NaN`, `None`, or a separate presence flag so the difference survives.

</details>

<details class="faq">
<summary><strong>Do I need a new schema version just to add a field?</strong></summary>

Yes, even though the change is structurally compatible. The version is what lets a consumer know which contract it received, so it can tell a genuinely absent value from one the producer simply had not started sending yet. Without it, an old event and a new event that happens to omit an optional field are indistinguishable, and any logic that treats absence as meaningful has no way to interpret it.

</details>

## Related

- [Schema Evolution & Versioning for Spatial Events](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/) — the parent topic, including why spatial schemas break silently more often than structural ones
- [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — the canonicalisation pipeline the identity key depends on
- [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/) — the section, and the four-layer envelope the new field belongs in
