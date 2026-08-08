---
title: "Streaming & Chunking Large Geometry Payloads"
description: "When a multipolygon will not fit in a broker message or a request body, the choice is chunk it, reference it, or stream it. Each has a different failure mode, and only one of them keeps the event atomic."
slug: "streaming-large-geometries"
type: "topic"
breadcrumb: "Spatial Payload Routing & Parsing > Streaming & Chunking Large Geometry Payloads"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Streaming & Chunking Large Geometry Payloads",
      "description": "A national land-cover multipolygon does not fit in a one-megabyte broker message, and buffering it whole exhausts a consumer's memory. This topic compares chunking, the claim-check pattern and incremental parsing, and shows which failure mode each one buys.",
      "url": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/",
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
        {"@type": "ListItem", "position": 3, "name": "Streaming & Chunking Large Geometry Payloads", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Move a geometry that does not fit in one message",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Measure the real size distribution before choosing a strategy"},
        {"@type": "HowToStep", "position": 2, "name": "Prefer a claim check, so the event stays atomic"},
        {"@type": "HowToStep", "position": 3, "name": "Chunk only when the parts are independently useful"},
        {"@type": "HowToStep", "position": 4, "name": "Parse incrementally so the consumer never holds the whole document"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should I raise the broker's message size limit instead?",
          "acceptedAnswer": {"@type": "Answer", "text": "Rarely, and never as the only change. Raising max.message.bytes moves the limit but not the cost: the broker now buffers larger records, replication traffic rises in proportion, and the consumer still has to hold the whole geometry in memory to parse it. A limit raised to accommodate the largest geometry seen so far will be met again by a larger one, because geometry size follows the underlying geography and has no natural ceiling."}
        },
        {
          "@type": "Question",
          "name": "What is the claim-check pattern for spatial events?",
          "acceptedAnswer": {"@type": "Answer", "text": "The event carries a reference to the geometry rather than the geometry itself. The producer writes the payload to object storage under a content-addressed key, publishes a small envelope containing that key, its digest and a bounding box, and the consumer fetches the body only if it decides the event is relevant. The message stays small and constant in size, routing and filtering still work because the envelope carries the spatial metadata, and the event remains atomic — there is exactly one message per event."}
        },
        {
          "@type": "Question",
          "name": "When is chunking a geometry across messages the right choice?",
          "acceptedAnswer": {"@type": "Answer", "text": "Only when the parts are independently useful — a multipolygon of separate administrative units, a feature collection of distinct features, a tile set. Splitting a single connected polygon into coordinate ranges is almost always wrong, because no chunk is a valid geometry on its own, the consumer must reassemble every part before it can do anything, and a lost part turns into a partial write that no individual message can detect."}
        },
        {
          "@type": "Question",
          "name": "Does incremental parsing remove the need for a claim check?",
          "acceptedAnswer": {"@type": "Answer", "text": "No — they solve different limits. Incremental parsing with a library such as ijson keeps the consumer's memory bounded while reading a large document, but the document still had to arrive, so it does not help with a broker's per-message size limit. A claim check fixes the transport limit and incremental parsing fixes the memory limit, and a pipeline handling gigabyte-scale geometry normally needs both."}
        },
        {
          "@type": "Question",
          "name": "How large is too large for an inline geometry?",
          "acceptedAnswer": {"@type": "Answer", "text": "A useful working threshold is a few hundred kilobytes, well under any broker limit, chosen so the ninety-ninth percentile of the measured distribution sits inside it. The number matters less than the fact that the pipeline decides per event rather than per stream: an envelope that inlines small geometries and references large ones handles both without the small ones paying for an object-storage round trip."}
        }
      ]
    }
  ]
}
</script>

**A geometry that will not fit in one message can be chunked, referenced or streamed, and only referencing keeps the event atomic — chunking turns one event into many that can partially fail, while streaming solves the consumer's memory problem and does nothing about the broker's size limit.**

This topic sits under [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/), which covers how a spatial payload gets from the wire into a usable geometry. It assumes the geometry has already been normalised as described in [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/), and it is the transport half of the problem whose compute half is [Async Processing for Geometry-Heavy Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) — that page keeps a heavy geometry off the event loop; this one gets it there at all.

---

## Prerequisites

- [ ] **Python 3.11+** with `asyncio` — the streaming paths below are all async
- [ ] **`ijson` 3.2+** — event-driven JSON parsing without materialising the document
- [ ] **S3-compatible object storage** — any store with content-addressed keys and presigned URLs
- [ ] **`shapely` 2.x** — `STRtree` and the vectorised predicates used when reassembling
- [ ] **A measured size distribution for the stream** — percentiles, not the mean
- [ ] **A broker whose limit you know** — Kafka `max.message.bytes`, SQS 256 KB, Redis Streams practical ceiling

---

## Measure the distribution before choosing anything

Geometry size is not normally distributed and its mean is useless. A stream of parcel boundaries is kilobytes at the median and hundreds of megabytes at the maximum, because one record is a national coastline and the rest are back gardens.

```python
import statistics
from pathlib import Path


def size_profile(samples: list[bytes]) -> dict[str, int]:
    """The five numbers that decide the strategy.

    The mean is deliberately absent: with a distribution this skewed it sits
    below the 90th percentile and describes nothing that will actually break.
    """
    sizes = sorted(len(s) for s in samples)
    q = statistics.quantiles(sizes, n=100, method="inclusive")
    return {
        "p50": int(q[49]), "p90": int(q[89]), "p99": int(q[98]),
        "p999": int(q[-1]), "max": sizes[-1],
    }
```

The decision falls out of two of those numbers. If p99 fits comfortably inside the broker limit, inline the geometry and handle the tail by reference. If p50 is already close to the limit, the stream needs a different transport entirely.

---

## Three strategies, three different failure modes

<figure class="fig">
<svg viewBox="0 0 760 254" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Chunking, claim check and streaming compared on atomicity, ordering, storage and the failure each introduces">
<title>What each strategy costs when something goes wrong</title>
<desc>Three ways to move an oversized geometry are compared. Chunking splits the geometry across many messages: it needs no extra infrastructure, but the event stops being atomic because a lost or reordered part leaves the consumer holding an incomplete geometry it cannot validate, and reassembly requires buffering every part anyway so the memory saving is illusory. The claim check publishes a small envelope referencing a body in object storage: the message size becomes constant regardless of geometry, the event stays atomic because there is exactly one message, routing still works because the envelope carries the bounding box, and the costs are an extra store to operate and a retention policy that must outlive the broker's own. Streaming with incremental parsing keeps consumer memory bounded and is the only option that scales to documents larger than memory, but it does nothing at all about the broker's per-message limit, so it is a complement to the other two rather than an alternative. The right default is a claim check with an inline fast path for small geometries, and incremental parsing on top when the referenced body is itself very large.</desc>
<rect x="0" y="0" width="760" height="254" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">three strategies for a geometry that will not fit</text>
<rect x="14" y="28" width="238" height="176" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="26" y="48" font-size="10" font-weight="600" fill="var(--fig-ink)">chunk across messages</text>
<text x="26" y="68" font-size="8.5" fill="var(--fig-ink-soft)">+ no new infrastructure</text>
<text x="26" y="82" font-size="8.5" fill="var(--fig-ink-soft)">+ works on any broker as-is</text>
<text x="26" y="102" font-size="8.5" fill="var(--fig-gold-edge)">− the event stops being atomic</text>
<text x="26" y="116" font-size="8.5" fill="var(--fig-gold-edge)">− a lost part is an invalid geometry</text>
<text x="26" y="130" font-size="8.5" fill="var(--fig-gold-edge)">− reassembly buffers every part, so</text>
<text x="26" y="144" font-size="8.5" fill="var(--fig-gold-edge)">  the memory saving is illusory</text>
<text x="26" y="166" font-size="8.5" fill="var(--fig-ink-soft)">right only when the parts are</text>
<text x="26" y="180" font-size="8.5" fill="var(--fig-ink-soft)">independently useful</text>
<rect x="262" y="28" width="238" height="176" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="274" y="48" font-size="10" font-weight="600" fill="var(--fig-ink)">claim check</text>
<text x="274" y="68" font-size="8.5" fill="var(--fig-mint-edge)">+ message size constant, whatever</text>
<text x="274" y="82" font-size="8.5" fill="var(--fig-mint-edge)">  the geometry</text>
<text x="274" y="96" font-size="8.5" fill="var(--fig-mint-edge)">+ one message, so still atomic</text>
<text x="274" y="110" font-size="8.5" fill="var(--fig-mint-edge)">+ routing works — bbox in envelope</text>
<text x="274" y="130" font-size="8.5" fill="var(--fig-ink-soft)">− an object store to operate</text>
<text x="274" y="144" font-size="8.5" fill="var(--fig-ink-soft)">− retention must outlive the broker's</text>
<text x="274" y="158" font-size="8.5" fill="var(--fig-ink-soft)">− one extra round trip per fetch</text>
<text x="274" y="180" font-size="8.5" fill="var(--fig-ink)">the default for oversized events</text>
<rect x="510" y="28" width="236" height="176" rx="6" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.5"/>
<text x="522" y="48" font-size="10" font-weight="600" fill="var(--fig-ink)">stream and parse incrementally</text>
<text x="522" y="68" font-size="8.5" fill="var(--fig-ink-soft)">+ consumer memory stays bounded</text>
<text x="522" y="82" font-size="8.5" fill="var(--fig-ink-soft)">+ the only option above RAM size</text>
<text x="522" y="102" font-size="8.5" fill="var(--fig-peach-edge)">− does nothing about the broker's</text>
<text x="522" y="116" font-size="8.5" fill="var(--fig-peach-edge)">  per-message limit</text>
<text x="522" y="130" font-size="8.5" fill="var(--fig-peach-edge)">− no random access into the body</text>
<text x="522" y="152" font-size="8.5" fill="var(--fig-ink-soft)">a complement to the other two,</text>
<text x="522" y="166" font-size="8.5" fill="var(--fig-ink-soft)">not an alternative to them</text>
<rect x="14" y="212" width="732" height="32" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="232" font-size="9.5" fill="var(--fig-ink-soft)">Default: a claim check with an inline fast path for small geometries, plus incremental parsing when the referenced body is itself large.</text>
</svg>
<figcaption><b>Figure 1.</b> Chunking looks cheapest because it needs no new infrastructure. It is the only one of the three that can leave a consumer holding a geometry that is silently incomplete.</figcaption>
</figure>

---

## Architecture: an envelope that decides per event

The envelope is the design. It carries enough spatial metadata to route and filter without the body, and it names where the body is when the body is not inline.

**Layer 1 — measure at the producer.** Serialise the geometry, take its length, and compare against an inline threshold set well below the broker limit.

**Layer 2 — branch.** Under threshold, the geometry goes in the envelope. Over it, the geometry goes to object storage under a content-addressed key and the envelope carries the key.

**Layer 3 — always carry the bounding box and vertex count.** These make the envelope routable and let a consumer estimate cost before fetching anything, which is what [Backpressure & Flow Control for Spatial Consumers](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/) charges against its budget.

**Layer 4 — resolve lazily at the consumer.** Fetch the body only after deciding the event is relevant. A consumer filtering on a geofence discards most events without ever paying for their geometry.

<figure class="fig">
<svg viewBox="0 0 760 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Producer branching on measured size into an inline envelope or a claim-check envelope, and a consumer resolving lazily">
<title>One envelope, two paths, resolved only when relevant</title>
<desc>At the producer, the serialised geometry is measured. Below the inline threshold of two hundred and fifty six kilobytes it is embedded directly in the envelope and published as one self-contained message. Above it, the body is written to object storage under a key derived from its own SHA-256 digest, which makes the write idempotent — a retry of the same geometry produces the same key and overwrites itself harmlessly — and the envelope carries the key, the digest and the byte length instead. Both paths produce an envelope of the same shape carrying the feature identifier, the bounding box, the vertex count and the CRS, so every downstream router, filter and metric works identically regardless of which path was taken. At the consumer, the envelope is examined first: an event whose bounding box does not intersect the consumer's area of interest is acknowledged and dropped without any fetch at all, which is where most of the saving comes from in a geographically sharded fleet. Only a relevant referenced event triggers the object-storage read, and the digest is verified after the read so a truncated or replaced body fails loudly rather than parsing into a plausible smaller geometry.</desc>
<rect x="0" y="0" width="760" height="250" fill="var(--fig-bg)"/>
<defs><marker id="sg-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="40" width="118" height="52" rx="5" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.4"/>
<text x="26" y="60" font-size="9" font-weight="600" fill="var(--fig-ink)">producer</text>
<text x="26" y="76" font-size="8.5" fill="var(--fig-ink-soft)">serialise, measure</text>
<line x1="136" y1="66" x2="164" y2="66" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#sg-a)"/>
<path d="M168,66 L206,44 L244,66 L206,88 Z" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="180" y="69" font-size="8" fill="var(--fig-ink)">&lt; 256 KB?</text>
<line x1="206" y1="42" x2="206" y2="26" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="206" y1="26" x2="288" y2="26" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sg-a)"/>
<text x="212" y="22" font-size="8" fill="var(--fig-mint-edge)">yes — inline</text>
<line x1="206" y1="90" x2="206" y2="116" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="206" y1="116" x2="288" y2="116" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sg-a)"/>
<text x="212" y="112" font-size="8" fill="var(--fig-peach-edge)">no — store the body</text>
<rect x="292" y="10" width="188" height="34" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="304" y="31" font-size="8.5" fill="var(--fig-ink)">envelope + geometry, one message</text>
<rect x="292" y="100" width="188" height="34" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.4"/>
<text x="304" y="115" font-size="8.5" fill="var(--fig-ink)">object store · key = sha256(body)</text>
<text x="304" y="128" font-size="8" fill="var(--fig-ink-soft)">content-addressed, so retries are idempotent</text>
<rect x="292" y="146" width="188" height="34" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="304" y="167" font-size="8.5" fill="var(--fig-ink)">envelope + key + digest + length</text>
<line x1="386" y1="136" x2="386" y2="144" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sg-a)"/>
<text x="492" y="86" font-size="8.5" font-weight="600" fill="var(--fig-ink-soft)">both carry</text>
<text x="492" y="99" font-size="8" fill="var(--fig-ink-soft)">feature id · bbox · vertex</text>
<text x="492" y="111" font-size="8" fill="var(--fig-ink-soft)">count · CRS (EPSG:4326)</text>
<line x1="484" y1="27" x2="584" y2="27" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sg-a)"/>
<line x1="484" y1="163" x2="584" y2="163" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#sg-a)"/>
<rect x="588" y="10" width="158" height="60" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="600" y="30" font-size="9" font-weight="600" fill="var(--fig-ink)">consumer: bbox first</text>
<text x="600" y="46" font-size="8" fill="var(--fig-ink-soft)">no intersection with the area</text>
<text x="600" y="58" font-size="8" fill="var(--fig-ink-soft)">of interest → ack and drop</text>
<rect x="588" y="140" width="158" height="60" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="600" y="160" font-size="9" font-weight="600" fill="var(--fig-ink)">relevant → fetch body</text>
<text x="600" y="176" font-size="8" fill="var(--fig-ink-soft)">verify the digest after reading,</text>
<text x="600" y="188" font-size="8" fill="var(--fig-ink-soft)">so a truncated body fails loudly</text>
<rect x="14" y="212" width="732" height="30" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="26" y="231" font-size="9" fill="var(--fig-ink-soft)">Most of the saving is the drop, not the transport: a geographically sharded consumer discards the majority of events without fetching a byte.</text>
</svg>
<figcaption><b>Figure 2.</b> Keeping the bounding box in the envelope is what makes lazy resolution possible. Without it the consumer must fetch every body just to find out the event was irrelevant.</figcaption>
</figure>

---

## Step-by-step implementation

### Step 1 — Publish an envelope that branches on size

```python
import hashlib
import json
from dataclasses import dataclass, asdict

from shapely.geometry import shape

INLINE_LIMIT = 256 * 1024      # well under any broker limit, by design


@dataclass(slots=True)
class SpatialEnvelope:
    feature_id: str
    occurred_at: str
    crs: str                    # always explicit — "EPSG:4326"
    bbox: tuple[float, float, float, float]
    vertex_count: int
    geometry: dict | None = None       # inline path
    body_key: str | None = None        # claim-check path
    body_sha256: str | None = None
    body_bytes: int | None = None


async def publish(geometry: dict, feature_id: str, occurred_at: str,
                  store, broker) -> None:
    geom = shape(geometry)
    body = json.dumps(geometry, separators=(",", ":")).encode()

    env = SpatialEnvelope(
        feature_id=feature_id,
        occurred_at=occurred_at,
        crs="EPSG:4326",
        bbox=geom.bounds,
        vertex_count=count_vertices(geom),
    )

    if len(body) < INLINE_LIMIT:
        env.geometry = geometry
    else:
        digest = hashlib.sha256(body).hexdigest()
        # Content-addressed: a retry writes the same bytes to the same key,
        # so the store write is idempotent and needs no coordination.
        env.body_key = f"geom/{digest[:2]}/{digest}.json"
        env.body_sha256 = digest
        env.body_bytes = len(body)
        await store.put(env.body_key, body)

    await broker.send(json.dumps(asdict(env)).encode())
```

Writing the body **before** publishing the envelope is not optional. Reversed, a consumer can receive a reference to an object that does not exist yet and fail on a race that only appears under load.

### Step 2 — Resolve lazily, and verify what comes back

```python
class BodyMismatch(Exception):
    """The stored body is not the one the envelope described."""


async def resolve(env: SpatialEnvelope, store) -> dict:
    if env.geometry is not None:
        return env.geometry

    body = await store.get(env.body_key)

    # Verify, always. A truncated read parses into a smaller but perfectly
    # valid geometry, which is the worst possible failure: silent, plausible,
    # and it propagates into every downstream calculation.
    if len(body) != env.body_bytes:
        raise BodyMismatch(f"{env.body_key}: {len(body)} != {env.body_bytes}")
    if hashlib.sha256(body).hexdigest() != env.body_sha256:
        raise BodyMismatch(f"{env.body_key}: digest mismatch")

    return json.loads(body)
```

A truncated JSON document usually fails to parse, but a truncated *feature collection* frequently does not — it ends after a complete feature, and the reader gets a valid collection with fewer features than it should have. Nothing errors, and a coverage calculation quietly reports a smaller area.

### Step 3 — Parse incrementally when the body is large

A hundred-megabyte feature collection loaded with `json.loads` costs roughly six hundred megabytes of Python objects. `ijson` yields one feature at a time and holds only that feature.

```python
import ijson


async def stream_features(store, key: str):
    """Yield features one at a time, holding one feature's worth of memory.

    ijson drives the parse from the byte stream, so the peak footprint is
    the largest single feature rather than the whole document.
    """
    async with store.open(key) as raw:
        async for feature in ijson.items_async(raw, "features.item"):
            yield feature


async def total_area(store, key: str) -> float:
    total = 0.0
    async for feature in stream_features(store, key):
        total += shape(feature["geometry"]).area
    return total
```

The limit of the technique is that a *single* geometry larger than memory is still larger than memory: `ijson` can stream a collection of features, but the moment one feature is handed to `shape()` it is materialised whole. For genuinely enormous single geometries the answer is to simplify at the producer or to tile the feature, not to parse harder.

### Step 4 — Chunk only when the parts stand alone

<figure class="fig">
<svg viewBox="0 0 760 224" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A multipolygon split into independently valid parts versus a single polygon split into coordinate ranges">
<title>A valid split and an invalid one</title>
<desc>On the left, a multipolygon of three separate administrative units is split into three messages, each carrying one complete polygon. Every part is a valid geometry on its own, a consumer can process the parts as they arrive, and a lost part is a missing unit rather than a corrupt shape — the loss is detectable by comparing the part count in the envelope against the parts received. On the right, one connected polygon is split into three ranges of its coordinate array. No part is a valid geometry: the first ends mid-ring, the second is a line fragment belonging to nothing, and the third cannot close. The consumer must buffer all three before it can validate anything, which removes the memory saving that motivated the split, and a lost part produces either a hang waiting for a message that will never arrive or, worse, a ring closed over the gap into a polygon that is valid, smaller, and wrong. The test is simple: if a part is not independently useful, the geometry should be referenced rather than chunked.</desc>
<rect x="0" y="0" width="760" height="224" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-mint-edge)">valid split — three separate units</text>
<rect x="14" y="28" width="360" height="132" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<path d="M40,60 L92,50 L104,92 L52,102 Z" fill="var(--fig-bg)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<path d="M130,56 L186,62 L178,104 L124,96 Z" fill="var(--fig-bg)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<path d="M214,58 L268,52 L280,98 L222,104 Z" fill="var(--fig-bg)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="30" y="126" font-size="8.5" fill="var(--fig-ink)">each part is a valid polygon on its own</text>
<text x="30" y="140" font-size="8.5" fill="var(--fig-ink-soft)">a lost part is a missing unit — detectable by comparing</text>
<text x="30" y="152" font-size="8.5" fill="var(--fig-ink-soft)">the declared part count against the parts received</text>
<text x="392" y="18" font-size="10" font-weight="600" fill="var(--fig-rose-edge)">invalid split — one polygon, sliced by coordinate range</text>
<rect x="392" y="28" width="354" height="132" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<path d="M420,96 L446,58 L492,50 L520,66" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<path d="M540,64 L578,54 L604,72" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.8" stroke-dasharray="3 3"/>
<path d="M624,74 L660,96 L636,104" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="408" y="126" font-size="8.5" fill="var(--fig-ink)">no part is a geometry: one ends mid-ring, one is a</text>
<text x="408" y="138" font-size="8.5" fill="var(--fig-ink)">fragment belonging to nothing, one cannot close</text>
<text x="408" y="152" font-size="8.5" fill="var(--fig-rose-edge)">and a lost part can close over the gap — valid, smaller, wrong</text>
<rect x="14" y="170" width="732" height="42" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="188" font-size="9.5" font-weight="600" fill="var(--fig-ink)">The test: is a part independently useful?</text>
<text x="26" y="204" font-size="9" fill="var(--fig-ink-soft)">If not, reference the geometry rather than chunking it — the buffering the consumer must do anyway removes the only benefit.</text>
</svg>
<figcaption><b>Figure 3.</b> The right-hand failure is the one to fear: a lost part does not always produce an error, it can produce a smaller polygon that passes every validity check.</figcaption>
</figure>

When the parts genuinely stand alone, the envelope needs a group identifier, a part index and a declared total, so a consumer can detect a missing part rather than waiting for it forever. The reassembly then belongs behind the same idempotency key the rest of the pipeline uses, as [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) describes.

---

## Spatial validation and error handling

**Compute the bounding box before serialising, not after fetching.** The whole point of the envelope is that a consumer can decide without the body. A bounding box derived at resolve time is derived too late.

**Reject an envelope whose declared vertex count is absent.** It is the cost estimate that backpressure charges against, and an event with no estimate is an event of unknown cost, which is the thing the budget exists to prevent.

**Verify geometry validity after reassembly, never per chunk.** A chunk of a multipolygon can be valid while the assembled whole has overlapping parts. Run the repair described in [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) on the assembled geometry only.

**Give object bodies a longer retention than the broker.** If the topic retains seven days and the bucket expires objects after three, a replay on day four resolves references to objects that no longer exist — and the failure appears only during an incident, which is when replay is being used.

---

## Retry, backoff and delivery guarantees

The claim check changes what a retry costs. The envelope is small, so redelivering it is nearly free; the body is content-addressed, so re-storing it is idempotent. A producer that crashes between the store write and the publish leaves an orphaned object and no event, which is a garbage-collection problem rather than a correctness one — sweep objects with no referencing event after a period longer than the broker's retention.

The reverse order is a correctness problem, which is why the ordering in Step 1 matters. Publish-then-store means a consumer can resolve a reference before the body exists, producing a `NoSuchKey` that looks exactly like the object having been deleted, and retrying it burns the retry budget on a race that will resolve on its own.

Chunked events have the harder guarantee. At-least-once delivery means a part can arrive twice, so reassembly must be idempotent per part index; ordering is not guaranteed, so the reassembler cannot assume part *n* precedes part *n+1*; and a part can be lost entirely, so the buffer needs a timeout that fails the group rather than waiting. That is three failure modes the claim check simply does not have, and it is the strongest argument for preferring it.

---

## Verification

```python
import json
import pytest
from shapely.geometry import Polygon, MultiPolygon, mapping


@pytest.mark.asyncio
async def test_small_geometry_stays_inline(store, broker):
    """A back garden must not pay for an object-storage round trip."""
    small = mapping(Polygon([(0, 0), (0, 1), (1, 1), (1, 0)]))
    await publish(small, "f-1", "2026-08-08T10:00:00Z", store, broker)

    env = json.loads(broker.sent[-1])
    assert env["geometry"] is not None
    assert env["body_key"] is None
    assert store.writes == 0


@pytest.mark.asyncio
async def test_large_geometry_is_referenced_and_verifiable(store, broker):
    """The envelope must stay small and the digest must round-trip."""
    huge = mapping(MultiPolygon([
        Polygon([(i, j), (i, j + 0.9), (i + 0.9, j + 0.9), (i + 0.9, j)])
        for i in range(120) for j in range(120)
    ]))
    await publish(huge, "f-2", "2026-08-08T10:00:00Z", store, broker)

    env = json.loads(broker.sent[-1])
    assert env["geometry"] is None
    assert len(broker.sent[-1]) < 2048          # envelope, not payload
    assert await resolve(SpatialEnvelope(**env), store) == huge


@pytest.mark.asyncio
async def test_truncated_body_is_rejected(store, broker):
    """The failure this check exists for: a valid, smaller, wrong geometry."""
    huge = mapping(MultiPolygon([
        Polygon([(i, 0), (i, 1), (i + 0.9, 1), (i + 0.9, 0)]) for i in range(9000)
    ]))
    await publish(huge, "f-3", "2026-08-08T10:00:00Z", store, broker)
    env = SpatialEnvelope(**json.loads(broker.sent[-1]))

    store.truncate(env.body_key, keep=env.body_bytes // 2)
    with pytest.raises(BodyMismatch):
        await resolve(env, store)
```

The third test is the one worth keeping. Without the digest check it passes for the wrong reason on some inputs and fails silently on others, because whether a truncated GeoJSON document parses depends on where the cut fell.

---

## Troubleshooting

<div class="table-scroll">

| Symptom | Likely spatial cause | Fix |
|---|---|---|
| `RecordTooLargeException` on a handful of events a day | A rare outsized geometry above the broker limit | Add the claim-check branch; do not raise the limit |
| Consumer OOMs on one partition only | A region whose features are genuinely huge | Parse incrementally, and charge vertex count against a budget |
| `NoSuchKey` immediately after deploy | Envelope published before the body was stored | Store first, publish second |
| `NoSuchKey` only during replay | Object retention shorter than broker retention | Extend bucket lifecycle beyond topic retention |
| Areas come out slightly too small | Truncated body parsed as a valid shorter collection | Verify length and digest after every fetch |
| A chunked group never completes | A part lost, and the reassembler waits forever | Declare the total part count; fail the group on timeout |
| Object store fills with unreferenced bodies | Producer crashes between store and publish | Sweep unreferenced keys older than broker retention |
| Routing degrades after switching to references | Bounding box moved into the body | Keep bbox, vertex count and CRS in the envelope always |

</div>

---

## FAQ

<details class="faq">
<summary><strong>Should I raise the broker's message size limit instead?</strong></summary>

Rarely, and never as the only change. Raising `max.message.bytes` moves the limit but not the cost — the broker buffers larger records, replication traffic rises in proportion, and the consumer still holds the whole geometry to parse it. A limit raised to fit the largest geometry seen so far will be met again, because geometry size follows geography and has no natural ceiling.

</details>

<details class="faq">
<summary><strong>What is the claim-check pattern for spatial events?</strong></summary>

The event carries a reference instead of the geometry. The producer writes the body to object storage under a content-addressed key and publishes a small envelope with that key, its digest and a bounding box; the consumer fetches the body only if it decides the event is relevant. Message size becomes constant, routing still works from the envelope, and there is still exactly one message per event.

</details>

<details class="faq">
<summary><strong>When is chunking across messages the right choice?</strong></summary>

Only when the parts are independently useful — separate administrative units, distinct features, a tile set. Splitting one connected polygon into coordinate ranges is almost always wrong: no chunk is a valid geometry, the consumer must buffer everything anyway, and a lost part can close the ring over the gap into a polygon that is valid, smaller and wrong.

</details>

<details class="faq">
<summary><strong>Does incremental parsing remove the need for a claim check?</strong></summary>

No — they solve different limits. Incremental parsing keeps consumer memory bounded while reading a large document, but the document still had to arrive, so it does nothing about a per-message size limit. A pipeline handling gigabyte-scale geometry usually needs both.

</details>

<details class="faq">
<summary><strong>How large is too large for an inline geometry?</strong></summary>

A few hundred kilobytes is a good working threshold, chosen so the 99th percentile of the measured distribution sits inside it. The exact number matters less than deciding per event rather than per stream, so small geometries never pay for an object-storage round trip.

</details>

---

## Related

- [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/) — the section this topic belongs to
- [Async Processing for Geometry-Heavy Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) — the compute half of the same problem, once the geometry has arrived
- [Protocol Buffers vs GeoJSON for High-Frequency Spatial Events](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/protocol-buffers-vs-geojson-for-high-frequency-spatial-events/) — how much of the size problem a denser encoding removes
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — what to run on a geometry once it has been reassembled
- [Backpressure & Flow Control for Spatial Consumers](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/) — where the envelope's vertex count is charged against a work budget
