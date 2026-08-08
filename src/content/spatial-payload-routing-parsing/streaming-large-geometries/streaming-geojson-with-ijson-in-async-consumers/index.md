---
title: "Streaming GeoJSON with ijson in Async Consumers"
description: "Parse a hundred-megabyte FeatureCollection one feature at a time so peak memory is the largest feature, not the whole document — and keep the blocking parser off the event loop while you do it."
slug: "streaming-geojson-with-ijson-in-async-consumers"
type: "article"
breadcrumb: "Spatial Payload Routing & Parsing > Streaming & Chunking Large Geometry Payloads > Streaming GeoJSON with ijson in Async Consumers"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Streaming GeoJSON with ijson in Async Consumers",
      "description": "Loading a large FeatureCollection with json.loads costs several times the document size in Python objects. This guide streams it with ijson so peak memory is one feature, keeps the parser off the event loop, and covers the truncation failure that incremental parsing makes easier to miss.",
      "url": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/streaming-geojson-with-ijson-in-async-consumers/",
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
        {"@type": "ListItem", "position": 4, "name": "Streaming GeoJSON with ijson in Async Consumers", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/streaming-geojson-with-ijson-in-async-consumers/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Stream a large GeoJSON document in an async consumer",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Parse with ijson against the byte stream rather than loading the document"},
        {"@type": "HowToStep", "position": 2, "name": "Yield one feature at a time and never accumulate them"},
        {"@type": "HowToStep", "position": 3, "name": "Keep the blocking parser off the event loop"},
        {"@type": "HowToStep", "position": 4, "name": "Verify completeness explicitly, because a truncated document streams cleanly"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How much memory does json.loads actually cost for GeoJSON?",
          "acceptedAnswer": {"@type": "Answer", "text": "Several times the document size, because coordinate arrays become Python lists of float objects. A pair of coordinates that occupies about twenty bytes of JSON text becomes a list object plus two float objects, which is well over a hundred bytes of heap. For coordinate-dense geometry a hundred-megabyte document routinely lands around six hundred megabytes resident, which is why a consumer sized against document bytes is sized against the wrong number."}
        },
        {
          "@type": "Question",
          "name": "Does ijson block the event loop?",
          "acceptedAnswer": {"@type": "Answer", "text": "The C-backed parsing work is synchronous, and even the async interface performs that work on the calling thread between awaits. On a coordinate-dense document that is enough CPU to stall an event loop for hundreds of milliseconds at a time, which shows up as heartbeat failures and consumer group rebalances rather than as slow parsing. Run the parse in a thread or a process, exactly as any other geometry-heavy work would be."}
        },
        {
          "@type": "Question",
          "name": "Why does a truncated document still stream successfully?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because incremental parsing yields each complete feature as it is encountered and only discovers the truncation when it reaches the end. If the cut fell after a complete feature, every feature yielded was valid and the consumer has already processed them; the parser raises at the end, after the work is done and possibly committed. Streaming therefore needs an explicit completeness check — a declared feature count, or a digest verified before parsing begins."}
        }
      ]
    }
  ]
}
</script>

**Drive the parse from the byte stream with `ijson` so peak memory is the largest single feature rather than the whole document, run it off the event loop because the parsing work is synchronous CPU, and check completeness explicitly — a truncated document streams every feature it does have before raising.**

This guide sits under [Streaming & Chunking Large Geometry Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/), within [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/). It solves the consumer's memory limit; the broker's size limit is solved by [The Claim-Check Pattern for Oversized Spatial Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/the-claim-check-pattern-for-oversized-spatial-payloads/), and a pipeline handling large geometry usually needs both.

## When to use this pattern

- Documents are large enough that resident memory is a constraint — tens of megabytes upward for coordinate-dense data.
- The work per feature is independent, so features can be processed and released rather than collected.
- The consumer is async, which makes the blocking-parse problem real rather than theoretical.

## Where the memory goes

<figure class="fig">
<svg viewBox="0 0 760 216" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Resident memory profile of json.loads against ijson streaming for the same document">
<title>The whole document, or one feature</title>
<desc>Resident memory is traced through the processing of a hundred-megabyte FeatureCollection. With json.loads, memory climbs steadily during the parse to roughly six hundred megabytes and stays there for the whole processing pass, because every feature is alive until the document object is released — a coordinate pair that occupies about twenty bytes of JSON text becomes a list object plus two float objects, well over a hundred bytes of heap, so coordinate-dense data expands several-fold. With ijson the profile is flat at a few megabytes with small spikes, each spike being one feature materialised, processed and released before the next is read. The peak is therefore set by the largest single feature rather than by the document, which matters because the largest feature is a property of the data and the document size is a property of how the data was batched. The limit of the technique is visible in the same shape: a single feature larger than memory is still larger than memory, because the moment it is handed to shape() it is materialised whole.</desc>
<rect x="0" y="0" width="760" height="216" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">resident memory · one 100 MB FeatureCollection</text>
<line x1="60" y1="150" x2="740" y2="150" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="60" y1="30" x2="60" y2="150" stroke="var(--fig-line)" stroke-width="1.2"/>
<text x="20" y="42" font-size="8" fill="var(--fig-ink-soft)">600 MB</text>
<text x="26" y="146" font-size="8" fill="var(--fig-ink-soft)">0</text>
<path d="M60,150 C120,150 180,60 240,44 L680,44 L690,150" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2.2"/>
<text x="300" y="38" font-size="8.5" fill="var(--fig-rose-edge)">json.loads — every feature alive until the document object is released</text>
<path d="M60,144 L110,144 L114,128 L118,144 L180,144 L184,124 L188,144 L260,144 L264,132 L268,144 L340,144 L344,120 L348,144 L430,144 L434,130 L438,144 L520,144 L524,126 L528,144 L610,144 L614,134 L618,144 L690,144" fill="none" stroke="var(--fig-mint-edge)" stroke-width="2"/>
<text x="300" y="164" font-size="8.5" fill="var(--fig-mint-edge)">ijson — one feature materialised, processed, released; peak is the largest feature</text>
<rect x="14" y="176" width="732" height="34" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="26" y="194" font-size="9" fill="var(--fig-ink-soft)">The limit of the technique is visible in the same shape: a single feature larger than memory is still larger than memory, because</text>
<text x="26" y="206" font-size="9" fill="var(--fig-ink-soft)">the moment it reaches shape() it is materialised whole. For those, simplify or tile at the producer — do not parse harder.</text>
</svg>
<figcaption><b>Figure 1.</b> The peak becomes a property of the data rather than of how the data was batched, which is what makes a consumer's memory limit predictable.</figcaption>
</figure>

## Complete runnable implementation

```python
import asyncio
import hashlib
from dataclasses import dataclass

import ijson
from shapely.geometry import shape


class TruncatedDocument(Exception):
    """The stream ended before the document did, or before its declared count."""


@dataclass(slots=True)
class StreamResult:
    features_seen: int
    total_area: float


def _parse_blocking(fileobj, declared_count: int | None, handle) -> StreamResult:
    """Run the parse synchronously; the caller keeps it off the loop.

    ijson's parsing work is CPU on the calling thread, and on coordinate-dense
    data that is enough to stall an event loop for hundreds of milliseconds —
    which surfaces as consumer heartbeat failures, not as slow parsing.
    """
    seen, total = 0, 0.0
    try:
        for feature in ijson.items(fileobj, "features.item"):
            handle(feature)
            total += shape(feature["geometry"]).area
            seen += 1
            # `feature` is released here. Appending it to a list — even to
            # "collect results" — reinstates the whole memory problem.
    except ijson.IncompleteJSONError as exc:
        raise TruncatedDocument(f"stream ended after {seen} features") from exc

    # A cut that landed after a complete feature parses cleanly to that point.
    # Only a declared count catches it.
    if declared_count is not None and seen != declared_count:
        raise TruncatedDocument(f"expected {declared_count} features, saw {seen}")

    return StreamResult(features_seen=seen, total_area=total)


async def stream_features(fileobj, declared_count: int | None = None,
                          handle=lambda f: None) -> StreamResult:
    """Parse off the event loop, so the consumer keeps polling."""
    return await asyncio.to_thread(_parse_blocking, fileobj, declared_count, handle)


async def verify_then_stream(store, key: str, expected_sha256: str,
                             declared_count: int) -> StreamResult:
    """Verify the whole body first when correctness matters more than memory.

    Digesting requires reading every byte, but not holding them: read in
    fixed-size blocks, hash them, discard them. Peak memory is the block.
    """
    digest = hashlib.sha256()
    async for block in store.iter_blocks(key, size=1 << 20):
        digest.update(block)
    if digest.hexdigest() != expected_sha256:
        raise TruncatedDocument(f"{key}: digest mismatch before parsing")

    async with store.open(key) as fileobj:
        return await stream_features(fileobj, declared_count)
```

Verifying before parsing costs a second pass over the bytes and removes the entire class of "processed half a document and committed it" failures. Where a second pass is unaffordable, the declared feature count is the cheaper approximation.

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A truncated document streaming 8 400 of 12 000 features successfully before raising">
<title>The features it does have are processed before it fails</title>
<desc>A document declaring twelve thousand features is truncated at seventy per cent, with the cut falling immediately after a complete feature. Incremental parsing yields eight thousand four hundred features, every one of them valid, and the consumer processes each as it arrives — writing to a database, emitting downstream events, updating an area total. Only at the end does the parser reach the truncation and raise. By then the work is done and, in a consumer that commits per feature, committed: the pipeline has recorded a coverage figure that is seventy per cent of the truth with no indication that anything is missing. A whole-document parse fails before any work happens, which is worse for latency and much better for correctness. The fix is not to abandon streaming but to make completeness explicit — a declared feature count checked at the end, or a digest verified over the whole body before parsing begins — so the consumer knows whether the eight thousand four hundred features it processed were all of them.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">document declares 12 000 features · truncated at 70%, after a complete feature</text>
<rect x="30" y="34" width="480" height="26" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="40" y="52" font-size="8.5" fill="var(--fig-ink)">8 400 features — every one valid, every one processed</text>
<rect x="514" y="34" width="206" height="26" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6" stroke-dasharray="4 3"/>
<text x="524" y="52" font-size="8.5" fill="var(--fig-rose-edge)">3 600 features that are not there</text>
<line x1="512" y1="28" x2="512" y2="70" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="440" y="82" font-size="8" fill="var(--fig-rose-edge)">the cut</text>
<rect x="14" y="94" width="366" height="80" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="114" font-size="9.5" font-weight="600" fill="var(--fig-ink)">streaming, without a completeness check</text>
<text x="26" y="134" font-size="8.5" fill="var(--fig-ink-soft)">work is done — and, per-feature commits, committed</text>
<text x="26" y="150" font-size="8.5" fill="var(--fig-rose-edge)">a coverage figure that is 70% of the truth,</text>
<text x="26" y="162" font-size="8.5" fill="var(--fig-rose-edge)">with nothing to indicate anything is missing</text>
<rect x="392" y="94" width="354" height="80" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="404" y="114" font-size="9.5" font-weight="600" fill="var(--fig-ink)">with a declared count or a pre-verified digest</text>
<text x="404" y="134" font-size="8.5" fill="var(--fig-ink-soft)">count checked at the end: 8 400 ≠ 12 000 → raise</text>
<text x="404" y="150" font-size="8.5" fill="var(--fig-ink-soft)">digest verified first: nothing is processed at all</text>
<text x="404" y="166" font-size="8.5" fill="var(--fig-mint-edge)">the second costs a pass over the bytes and is worth it</text>
<rect x="14" y="186" width="732" height="32" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="205" font-size="9" fill="var(--fig-ink-soft)">A whole-document parse fails before any work happens — worse for latency, much better for correctness. Streaming trades that away and has to buy it back.</text>
</svg>
<figcaption><b>Figure 2.</b> Incremental parsing moves the failure from before the work to after it. That is the cost of the memory saving, and it is payable.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| Prefix | `str` | `"features.item"` for a FeatureCollection; `"geometries.item"` for a GeometryCollection | — |
| `declared_count` | `int \| None` | From the envelope; the cheap completeness check | `None` |
| Block size | `int` | For digesting without holding the body | `1 MiB` |
| `asyncio.to_thread` | call | Required — the parse is synchronous CPU on the calling thread | — |
| Backend | `str` | `ijson.backends.yajl2_c` is far faster than the pure-Python one | auto |
| Accumulation | — | None. Appending features reinstates the whole problem | — |

</div>

## Gotchas and spatial edge cases

1. **`ijson.items` returns coordinates as `Decimal` by default in some backends.** `shape()` accepts them, but arithmetic mixing `Decimal` and `float` raises, and the memory advantage shrinks because `Decimal` objects are larger than floats. Use `ijson.items(..., use_float=True)` where the backend supports it, and assert the type in a test rather than discovering it in production.

2. **A single feature can still exhaust memory.** Streaming bounds the document, not the feature: one national coastline handed to `shape()` is materialised whole. For those the answer is at the producer — simplify for transport, or tile the feature — not a different parser.

3. **The blocking parse stalls the event loop, and the symptom is a rebalance.** A consumer that stops polling for four hundred milliseconds misses heartbeats, gets evicted, and its partitions are reassigned; the batch is then redelivered to another consumer which does the same. It presents as a rebalance storm rather than as slow parsing, which sends people to look at broker configuration.

4. **Prefixes are silently wrong rather than erroneous.** A typo in `"features.item"` yields nothing at all — no exception, no warning, just a document with zero features. Assert a non-zero count, or a schema change that renames the array produces a clean, empty, wrong result.

5. **Streaming and the claim check solve different limits.** The document still had to arrive, so streaming does nothing about a broker's per-message ceiling. A pipeline handling gigabyte-scale geometry needs the claim check to move it and `ijson` to read it.

6. **Per-feature commits make truncation unrecoverable.** If the consumer commits its offset as it goes, a truncated document leaves the pipeline believing it processed the whole thing. Commit once at the end of a document, or verify the digest before starting.

<figure class="fig">
<svg viewBox="0 0 760 186" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A blocked event loop missing consumer heartbeats and triggering a rebalance">
<title>A blocking parse presents as a rebalance storm, not as slow parsing</title>
<desc>A consumer parses a large collection synchronously on its event loop. The parse occupies the loop for four hundred milliseconds at a stretch, during which the heartbeat coroutine cannot run: it is scheduled, ready, and never given the loop. The broker sees missed heartbeats, presumes the member dead and rebalances the group, so the partitions move and the batch is redelivered to another member — which parses it the same way and meets the same fate. What appears in the incident channel is a rebalance storm, which sends the investigation to the broker configuration, to session timeouts, and to the network, none of which are the cause. Running the same parse in a thread leaves the loop free to service the heartbeat between awaits, so the member stays in the group and the only visible effect is that the parse takes as long as it takes. The symptom and the cause are in completely different subsystems, which is why the thread offload is worth a comment rather than being left as an idiom.</desc>
<rect x="0" y="0" width="760" height="186" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">parse on the event loop</text>
<rect x="30" y="28" width="380" height="22" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="40" y="44" font-size="8" fill="var(--fig-ink)">ijson parse — 400 ms, uninterrupted</text>
<circle cx="90" cy="62" r="3.5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<circle cx="150" cy="62" r="3.5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<circle cx="210" cy="62" r="3.5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<circle cx="270" cy="62" r="3.5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="420" y="46" font-size="8.5" fill="var(--fig-rose-edge)">heartbeats scheduled, ready, never given the loop</text>
<text x="30" y="84" font-size="8.5" fill="var(--fig-rose-edge)">broker presumes the member dead → rebalance → batch redelivered → the next member does the same</text>
<text x="30" y="98" font-size="8.5" fill="var(--fig-ink-soft)">the incident channel shows a rebalance storm, and the investigation goes to session timeouts and the network</text>
<line x1="14" y1="114" x2="746" y2="114" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="134" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">parse in a thread</text>
<rect x="30" y="142" width="380" height="22" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="40" y="158" font-size="8" fill="var(--fig-ink)">same parse, off the loop</text>
<circle cx="440" cy="153" r="3.5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<circle cx="470" cy="153" r="3.5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<circle cx="500" cy="153" r="3.5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="520" y="157" font-size="8.5" fill="var(--fig-mint-edge)">heartbeats run · the member stays in the group</text>
<text x="14" y="180" font-size="9" fill="var(--fig-ink-soft)">Symptom and cause sit in different subsystems, which is why the thread offload deserves a comment rather than being left as an idiom.</text>
</svg>
<figcaption><b>Figure 3.</b> Nothing about the symptom points at the parser, so this is a failure that is diagnosed by knowing the mechanism rather than by reading the logs.</figcaption>
</figure>

## Verification

```python
import io
import json
import pytest
from shapely.geometry import Polygon, mapping


def collection(n: int) -> bytes:
    return json.dumps({
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"i": i},
             "geometry": mapping(Polygon([(i, 0), (i, 1), (i + 1, 1), (i + 1, 0)]))}
            for i in range(n)
        ],
    }).encode()


@pytest.mark.asyncio
async def test_streams_every_feature():
    result = await stream_features(io.BytesIO(collection(5000)), declared_count=5000)
    assert result.features_seen == 5000


@pytest.mark.asyncio
async def test_truncation_after_a_complete_feature_is_caught():
    """The failure incremental parsing makes easy to miss."""
    raw = collection(5000)
    cut = raw[: raw.index(b'{"type": "Feature", "properties": {"i": 3500}')]
    with pytest.raises(TruncatedDocument):
        await stream_features(io.BytesIO(cut + b"]}"), declared_count=5000)


@pytest.mark.asyncio
async def test_wrong_prefix_produces_zero_rather_than_an_error():
    """Documented, and asserted, because it is silent."""
    def parse(fileobj):
        return sum(1 for _ in ijson.items(fileobj, "featurez.item"))

    assert parse(io.BytesIO(collection(100))) == 0


@pytest.mark.asyncio
async def test_parse_does_not_block_the_event_loop():
    """A stalled loop shows up as a rebalance, not as slow parsing."""
    ticks = 0

    async def heartbeat():
        nonlocal ticks
        while True:
            ticks += 1
            await asyncio.sleep(0.01)

    beat = asyncio.create_task(heartbeat())
    await stream_features(io.BytesIO(collection(40_000)))
    beat.cancel()
    assert ticks > 5, "the event loop was starved during the parse"
```

The second test constructs the truncation deliberately at a feature boundary, because a cut in the middle of a coordinate array raises on its own and proves nothing — the dangerous cut is the tidy one.

## Related

- [Streaming & Chunking Large Geometry Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/) — the topic this guide belongs to
- [The Claim-Check Pattern for Oversized Spatial Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/the-claim-check-pattern-for-oversized-spatial-payloads/) — moving the body that this guide reads
- [Optimizing Async Geometry Parsing with asyncio](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/optimizing-async-geometry-parsing-with-asyncio/) — the general form of keeping geometry work off the loop
- [Backpressure & Flow Control for Spatial Consumers](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/) — bounding how many of these streams run at once
