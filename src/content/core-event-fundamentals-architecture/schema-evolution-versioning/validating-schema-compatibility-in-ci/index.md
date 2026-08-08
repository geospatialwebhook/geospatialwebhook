---
title: "Validating Schema Compatibility in CI"
description: "Make a breaking spatial schema change fail the build instead of the pipeline: check the new schema against every version still in the log, and add the spatial assertions a generic compatibility checker cannot make."
slug: "validating-schema-compatibility-in-ci"
type: "article"
breadcrumb: "Core Event Fundamentals & Architecture > Schema Evolution & Versioning for Spatial Events > Validating Schema Compatibility in CI"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Validating Schema Compatibility in CI",
      "description": "A generic compatibility checker passes changes that are catastrophic for spatial data — a CRS default removed, a coordinate order flipped, a precision reduced. This guide wires a compatibility gate into CI and adds the spatial assertions the generic checker structurally cannot make.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/validating-schema-compatibility-in-ci/",
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
        {"@type": "ListItem", "position": 4, "name": "Validating Schema Compatibility in CI", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/validating-schema-compatibility-in-ci/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Gate spatial schema changes in CI",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Check the candidate schema against every version still reachable, not just the previous one"},
        {"@type": "HowToStep", "position": 2, "name": "Add spatial assertions the structural checker cannot make"},
        {"@type": "HowToStep", "position": 3, "name": "Replay a corpus of real payloads through both readers and compare geometries"},
        {"@type": "HowToStep", "position": 4, "name": "Fail the build, and require an explicit version bump to override"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why is a generic compatibility checker not enough for spatial schemas?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because it reasons about types and field presence, and every dangerous spatial change is type-preserving. Flipping coordinate order keeps an array of two numbers an array of two numbers. Removing a CRS default keeps a string a string. Reducing coordinate precision does not change the schema at all. A structural checker passes all three, and each one silently relocates or reshapes every geometry in the stream."}
        },
        {
          "@type": "Question",
          "name": "Should CI check against the previous version or all of them?",
          "acceptedAnswer": {"@type": "Answer", "text": "All versions still reachable — which means everything in the topic's retention window plus everything in any dead-letter archive that can still be replayed. Transitive compatibility does not follow from pairwise compatibility: v3 can be compatible with v2 and v2 with v1 while v3 is unreadable against a v1 payload, because the two changes compose. Checking only the immediate predecessor is how that gap gets shipped."}
        },
        {
          "@type": "Question",
          "name": "What belongs in the golden corpus?",
          "acceptedAnswer": {"@type": "Answer", "text": "Real payloads captured from production, biased towards the awkward ones: a polygon crossing the antimeridian, a multipolygon with holes, a geometry in a projected CRS, an empty geometry, a feature with a null geometry, and the largest payload the stream has ever carried. Synthetic squares in the first quadrant pass every check and exercise none of the code that actually breaks."}
        }
      ]
    }
  ]
}
</script>

**Run the candidate schema against every version still reachable in the log, then add the assertions a structural checker cannot make — coordinate order, CRS explicitness and precision are all type-preserving, so a generic compatibility gate passes the three changes most likely to relocate every geometry in the stream.**

This guide sits under [Schema Evolution & Versioning for Spatial Events](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/), within [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/). It is the gate that makes [Migrating a Spatial Stream Between Schema Versions](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/migrating-a-spatial-stream-between-schema-versions/) a deliberate act rather than an accident discovered in production.

## When to use this pattern

- More than one service produces to the stream, so no single review catches every schema edit.
- The schema lives in a repository and changes through pull requests, which is where a gate can sit.
- Consumers exist that you do not deploy, so a breaking change cannot be walked back quickly.

## What a structural checker sees, and what it misses

Compatibility checkers reason about types and field presence. That catches a removed required field and a narrowed type, and those are worth catching. The changes that hurt a spatial stream are not those.

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Five schema changes scored by whether a structural compatibility checker catches them and what each does to the data">
<title>The dangerous spatial changes are all type-preserving</title>
<desc>Five schema changes are listed with what a structural compatibility checker reports and what actually happens to the data. Removing a required field is correctly rejected, and widening an integer to a float is correctly accepted; those are the cases generic tooling exists for. The remaining three all pass structurally and all corrupt the stream. Flipping coordinate order from latitude-longitude to longitude-latitude leaves an array of two numbers exactly as it was, and moves every feature to a different hemisphere. Removing an implicit CRS default leaves a string field a string field, and turns every payload that omitted it from well-defined into ambiguous. Reducing stated coordinate precision from six decimal places to four is not a schema change at all — no field, type or constraint moves — and it changes every content hash in the pipeline, so deduplication stops matching across the boundary. A checker that reasons about structure cannot see any of the three, because none of them is structural.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">what the structural checker reports vs what happens to the data</text>
<rect x="14" y="28" width="732" height="34" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="26" y="42" font-size="9" font-weight="600" fill="var(--fig-ink)">required field removed</text>
<text x="26" y="56" font-size="8.5" fill="var(--fig-mint-edge)">correctly REJECTED — this is what generic tooling is for</text>
<rect x="14" y="66" width="732" height="34" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="26" y="80" font-size="9" font-weight="600" fill="var(--fig-ink)">int widened to float</text>
<text x="26" y="94" font-size="8.5" fill="var(--fig-mint-edge)">correctly ACCEPTED — genuinely compatible</text>
<rect x="14" y="104" width="732" height="34" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="118" font-size="9" font-weight="600" fill="var(--fig-ink)">coordinate order flipped — [lat, lon] to [lon, lat]</text>
<text x="26" y="132" font-size="8.5" fill="var(--fig-rose-edge)">PASSES — an array of two numbers is still an array of two numbers · every feature moves hemisphere</text>
<rect x="14" y="142" width="732" height="34" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="156" font-size="9" font-weight="600" fill="var(--fig-ink)">implicit CRS default removed</text>
<text x="26" y="170" font-size="8.5" fill="var(--fig-rose-edge)">PASSES — a string is still a string · every payload that omitted it becomes ambiguous</text>
<rect x="14" y="180" width="732" height="34" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="194" font-size="9" font-weight="600" fill="var(--fig-ink)">coordinate precision reduced from 6 dp to 4 dp</text>
<text x="26" y="208" font-size="8.5" fill="var(--fig-rose-edge)">PASSES — not a schema change at all · every content hash moves, so deduplication stops matching</text>
</svg>
<figcaption><b>Figure 1.</b> Three of the five are invisible to structural checking because none of them is structural. The spatial assertions below exist to cover exactly this row group.</figcaption>
</figure>

## Complete runnable implementation

The gate has two halves: a structural check against every reachable version, and a differential replay of real payloads through the old and new readers.

```python
"""ci/check_schema.py — run in CI; exits non-zero on an unsafe change."""
import json
import sys
from pathlib import Path

from shapely.geometry import shape

SCHEMA_DIR = Path("schemas")
CORPUS = Path("tests/corpus/payloads.jsonl")

# Every version still reachable: topic retention plus any replayable archive.
# NOT just the previous one — pairwise compatibility is not transitive.
REACHABLE = (1, 2)


class Incompatible(Exception):
    pass


def structural_check(old: dict, new: dict, path: str = "") -> list[str]:
    """Required fields may not vanish, and types may not narrow."""
    problems = []
    for name in old.get("required", []):
        if name not in new.get("required", []) and name not in new.get("properties", {}):
            problems.append(f"{path}{name}: required field removed")

    for name, spec in old.get("properties", {}).items():
        target = new.get("properties", {}).get(name)
        if target is None:
            continue
        if spec.get("type") != target.get("type"):
            problems.append(
                f"{path}{name}: type {spec.get('type')} -> {target.get('type')}"
            )
        if spec.get("type") == "object":
            problems += structural_check(spec, target, f"{path}{name}.")
    return problems


def spatial_check(new: dict) -> list[str]:
    """The assertions a structural checker cannot make.

    Each of these is type-preserving, so nothing generic will ever flag it.
    """
    problems = []
    props = new.get("properties", {})

    # 1. CRS must be explicit and required. An implicit default is a decision
    #    made by whichever service happened to write the payload.
    if "crs" not in new.get("required", []):
        problems.append("crs: must be required — an implicit CRS is not a contract")

    # 2. Coordinate order must be stated, and must be lon/lat per RFC 7946.
    order = props.get("geometry", {}).get("x-coordinate-order")
    if order != "lon,lat":
        problems.append(f"geometry: coordinate order must be 'lon,lat', got {order!r}")

    # 3. Precision is part of the contract because content hashes depend on it.
    if "x-coordinate-precision" not in props.get("geometry", {}):
        problems.append("geometry: x-coordinate-precision must be declared")

    return problems


def differential_replay(read_old, read_new) -> list[str]:
    """Feed real payloads to both readers and compare the GEOMETRY.

    A change can be structurally fine and still move every feature; only
    comparing the parsed geometry catches that.
    """
    problems = []
    for line in CORPUS.read_text().splitlines():
        payload = json.loads(line)
        try:
            a, b = read_old(payload), read_new(payload)
        except Exception as exc:                     # noqa: BLE001 - reported, not raised
            problems.append(f"{payload.get('feature_id')}: reader raised {exc!r}")
            continue

        moved = shape(a.geometry).distance(shape(b.geometry))
        if moved > 1e-9:
            problems.append(
                f"{payload.get('feature_id')}: geometry moved {moved:.6f} degrees"
            )
    return problems


def main() -> int:
    new = json.loads((SCHEMA_DIR / "event.v3.json").read_text())
    problems = spatial_check(new)

    for version in REACHABLE:
        old = json.loads((SCHEMA_DIR / f"event.v{version}.json").read_text())
        problems += [f"v{version}: {p}" for p in structural_check(old, new)]

    problems += differential_replay(read_v2, read_v3)

    for problem in problems:
        print(f"INCOMPATIBLE: {problem}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

<figure class="fig">
<svg viewBox="0 0 760 208" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Pairwise compatibility between adjacent versions failing to imply compatibility with the oldest reachable version">
<title>Pairwise compatible, transitively broken</title>
<desc>Three schema versions are checked pairwise. Version two renamed a field and provided a fallback that reads the old name, so it is compatible with version one. Version three removed that fallback, on the reasonable grounds that version two events all carry the new name, so it is compatible with version two. Each pull request passed its check and each check was correct. But a version one payload read by the version three reader finds neither the new name nor the fallback, so it fails — and version one payloads are still in the log for as long as retention lasts, and in the dead-letter archive for longer. The gap is invisible to a checker that compares each candidate only against its immediate predecessor, which is the default configuration of most compatibility tooling. Checking against every reachable version costs one loop and catches the composition.</desc>
<rect x="0" y="0" width="760" height="208" fill="var(--fig-bg)"/>
<defs><marker id="ci-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="30" y="34" width="180" height="52" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="42" y="52" font-size="9.5" font-weight="600" fill="var(--fig-ink)">v1</text>
<text x="42" y="68" font-size="8.5" fill="var(--fig-ink-soft)">field named "geom"</text>
<text x="42" y="80" font-size="8.5" fill="var(--fig-ink-soft)">still in the log and the archive</text>
<line x1="214" y1="60" x2="266" y2="60" stroke="var(--fig-mint-edge)" stroke-width="1.4" marker-end="url(#ci-a)"/>
<text x="216" y="52" font-size="8" fill="var(--fig-mint-edge)">compatible</text>
<rect x="270" y="34" width="180" height="52" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="282" y="52" font-size="9.5" font-weight="600" fill="var(--fig-ink)">v2</text>
<text x="282" y="68" font-size="8.5" fill="var(--fig-ink-soft)">renamed to "geometry",</text>
<text x="282" y="80" font-size="8.5" fill="var(--fig-ink-soft)">reads "geom" as a fallback</text>
<line x1="454" y1="60" x2="506" y2="60" stroke="var(--fig-mint-edge)" stroke-width="1.4" marker-end="url(#ci-a)"/>
<text x="456" y="52" font-size="8" fill="var(--fig-mint-edge)">compatible</text>
<rect x="510" y="34" width="180" height="52" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="522" y="52" font-size="9.5" font-weight="600" fill="var(--fig-ink)">v3</text>
<text x="522" y="68" font-size="8.5" fill="var(--fig-ink-soft)">fallback removed — v2 events</text>
<text x="522" y="80" font-size="8.5" fill="var(--fig-ink-soft)">all carry the new name</text>
<path d="M120,92 C120,140 560,140 590,92" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.8" stroke-dasharray="5 3" marker-end="url(#ci-a)"/>
<text x="270" y="140" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">v1 payload read by v3 — neither name present, and it fails</text>
<rect x="14" y="152" width="732" height="46" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="26" y="170" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Every pull request passed, and every check was correct</text>
<text x="26" y="187" font-size="9" fill="var(--fig-ink-soft)">Pairwise compatibility does not compose. Checking each candidate against every reachable version costs one loop.</text>
</svg>
<figcaption><b>Figure 2.</b> Both individual checks were right. The gap only exists between them, which is why the loop over <code>REACHABLE</code> is not a nicety.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `REACHABLE` | `tuple[int, ...]` | Every version in retention **plus** any replayable archive | `(1, 2)` |
| `x-coordinate-order` | `str` | Must be `"lon,lat"` per RFC 7946; the flip is type-preserving | `"lon,lat"` |
| `x-coordinate-precision` | `int` | Declared, because content hashes depend on it | `6` |
| Move tolerance | `float` | Degrees; `1e-9` is far below any real change and above float noise | `1e-9` |
| `CORPUS` | path | Real captured payloads, biased to awkward geometries | — |
| Exit code | `int` | Non-zero fails the build; overriding requires an explicit version bump | — |

</div>

## Gotchas and spatial edge cases

1. **A synthetic corpus proves nothing.** A square in the first quadrant survives a coordinate flip looking merely translated, survives a precision change with no visible difference, and never exercises hole handling or antimeridian logic. Capture the corpus from production and include the antimeridian polygon, the multipolygon with holes, the empty geometry, the null geometry and the largest payload the stream has carried.

2. **`distance()` on geographic coordinates is in degrees, not metres.** The `1e-9` tolerance above is roughly a tenth of a millimetre at the equator and about half that at 60° north. That asymmetry is fine for a "did it move at all" check and useless as a distance measurement — do not reuse the number as a spatial tolerance elsewhere.

3. **Compare geometries, not serialised payloads.** Two readers can produce byte-different JSON for the same shape — key order, float formatting, an explicit `bbox` member — and a string comparison fails on all of it while missing the case where the bytes match and the interpretation differs.

4. **The corpus has to be regenerated.** A corpus captured two years ago does not contain the payload shapes a producer added last quarter, so the gate is checking the schema against a stream that no longer exists. Refresh it on a schedule and fail the build if it is stale.

5. **Precision is part of the contract even though it is not in the type system.** Reducing declared precision changes every content hash, so deduplication stops matching across the boundary exactly as described in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/). Declaring it as an extension keyword is what makes it reviewable.

## Verification

The gate itself needs a test, because a compatibility checker that has never rejected anything is indistinguishable from one that always passes.

```python
import pytest


BASE = {
    "required": ["feature_id", "crs", "geometry"],
    "properties": {
        "feature_id": {"type": "string"},
        "crs": {"type": "string"},
        "geometry": {"type": "object", "x-coordinate-order": "lon,lat",
                     "x-coordinate-precision": 6},
    },
}


def test_gate_accepts_a_safe_addition():
    """A new optional field must not trip the gate."""
    new = {**BASE, "properties": {**BASE["properties"], "confidence": {"type": "number"}}}
    assert structural_check(BASE, new) == []
    assert spatial_check(new) == []


def test_gate_rejects_a_coordinate_flip():
    """The change no generic checker sees."""
    geom = {**BASE["properties"]["geometry"], "x-coordinate-order": "lat,lon"}
    new = {**BASE, "properties": {**BASE["properties"], "geometry": geom}}
    assert structural_check(BASE, new) == []          # structurally identical
    assert any("coordinate order" in p for p in spatial_check(new))


def test_gate_rejects_an_implicit_crs():
    """Removing crs from required is how an implicit default gets in."""
    new = {**BASE, "required": ["feature_id", "geometry"]}
    assert any("crs" in p for p in spatial_check(new))
```

The middle test is the one to keep in front of a reviewer: `structural_check` returns an empty list on a change that relocates every feature in the stream, and that is not a bug in the structural checker — it is the reason the spatial one exists.

## Related

- [Schema Evolution & Versioning for Spatial Events](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/) — the topic this guide belongs to
- [Migrating a Spatial Stream Between Schema Versions](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/schema-evolution-versioning/migrating-a-spatial-stream-between-schema-versions/) — what to do when the gate correctly says the change is breaking
- [Best Practices for Spatial Event Payload Schemas](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/best-practices-for-spatial-event-payload-schemas/) — the schema conventions these assertions enforce
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — the runtime counterpart to a build-time gate
