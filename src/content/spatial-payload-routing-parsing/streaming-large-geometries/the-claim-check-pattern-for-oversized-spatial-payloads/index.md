---
title: "The Claim-Check Pattern for Oversized Spatial Payloads"
description: "Put the geometry in object storage under a content-addressed key and publish a small envelope. Store before you publish, verify the digest after you read, and give the bucket a longer retention than the topic."
slug: "the-claim-check-pattern-for-oversized-spatial-payloads"
type: "article"
breadcrumb: "Spatial Payload Routing & Parsing > Streaming & Chunking Large Geometry Payloads > The Claim-Check Pattern for Oversized Spatial Payloads"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "The Claim-Check Pattern for Oversized Spatial Payloads",
      "description": "A claim check keeps a spatial event atomic and its message size constant, at the cost of an object store and three ordering rules that are easy to get wrong. This guide covers store-before-publish, digest verification after read, and retention that outlives the topic.",
      "url": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/the-claim-check-pattern-for-oversized-spatial-payloads/",
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
        {"@type": "ListItem", "position": 4, "name": "The Claim-Check Pattern for Oversized Spatial Payloads", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/the-claim-check-pattern-for-oversized-spatial-payloads/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Implement a claim check for oversized spatial payloads",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Write the body to object storage under a key derived from its own digest"},
        {"@type": "HowToStep", "position": 2, "name": "Publish an envelope carrying the key, digest, length and bounding box"},
        {"@type": "HowToStep", "position": 3, "name": "Resolve lazily and verify the digest after reading"},
        {"@type": "HowToStep", "position": 4, "name": "Set bucket retention longer than the topic's, and sweep orphans"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why must the body be stored before the envelope is published?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because a consumer can resolve the reference the instant the envelope is visible. Publishing first creates a window in which a fast consumer fetches a key whose object does not exist yet, producing a not-found error indistinguishable from a deleted object. Retrying it burns retry budget on a race that resolves itself, and the window widens under load — exactly when the pipeline is least able to absorb it. Storing first means the reference is always resolvable when it appears."}
        },
        {
          "@type": "Question",
          "name": "Why use a content-addressed key rather than an event id?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because it makes the write idempotent for free. A producer that retries after a timeout writes the same bytes to the same key, so the second write is harmless and needs no coordination or cleanup. An event-id key means a retry writes a second object with the same content under a different name, and the orphan sweep has to distinguish those from genuinely abandoned bodies."}
        },
        {
          "@type": "Question",
          "name": "What has to stay in the envelope rather than the body?",
          "acceptedAnswer": {"@type": "Answer", "text": "Everything routing and filtering needs: the feature identifier, the bounding box, the vertex count and the CRS. Moving the bounding box into the body forces every consumer to fetch every object just to discover the event was irrelevant, which removes the pattern's main saving — in a geographically sharded fleet most consumers discard most events, and they should do so without a storage round trip."}
        }
      ]
    }
  ]
}
</script>

**Write the body to object storage under a key derived from its own SHA-256, publish the envelope only after that write returns, verify the digest after every read, and give the bucket a longer lifecycle than the topic's retention — the ordering is what stops a fast consumer resolving a key that does not exist yet.**

This guide sits under [Streaming & Chunking Large Geometry Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/), within [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/). That topic compares the three strategies; this one is the implementation detail of the recommended default.

## When to use this pattern

- Geometry size has a long upper tail, so a per-message limit is met occasionally rather than constantly.
- Consumers are geographically sharded and discard most events, which is where lazy resolution pays.
- The event must stay atomic — one message, one event — which chunking cannot provide.

## The three ordering rules

<figure class="fig">
<svg viewBox="0 0 760 234" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Publish-then-store racing a fast consumer, compared with store-then-publish">
<title>The window between publish and store</title>
<desc>Two producer orderings are traced against a consumer polling at the head of the topic. In the first, the envelope is published and the body is written afterwards. A consumer polling every fifty milliseconds sees the envelope, resolves the reference, and receives a not-found error because the object write has not completed — a window of perhaps two hundred milliseconds for a large body, widening under load precisely when the pipeline can least absorb it. The error is indistinguishable from an object that was deleted, so the consumer cannot tell whether to retry or dead-letter, and retrying burns budget on a race that resolves itself. In the second, the body is written first and the envelope published only after that write returns. There is no window: any envelope a consumer can see refers to an object that already exists. The cost of the correct order is that a producer crashing between the two leaves an object with no event referencing it, which is a garbage-collection problem — a periodic sweep of unreferenced keys older than the topic's retention — rather than a correctness one.</desc>
<rect x="0" y="0" width="760" height="234" fill="var(--fig-bg)"/>
<defs><marker id="cc-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">publish, then store — a race with every consumer</text>
<rect x="30" y="30" width="96" height="24" rx="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.3"/>
<text x="40" y="46" font-size="8" fill="var(--fig-ink)">publish envelope</text>
<rect x="240" y="30" width="120" height="24" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="250" y="46" font-size="8" fill="var(--fig-ink)">object write completes</text>
<rect x="126" y="34" width="114" height="16" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="132" y="46" font-size="7.5" fill="var(--fig-ink)">the window</text>
<circle cx="170" cy="70" r="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<line x1="170" y1="64" x2="170" y2="56" stroke="var(--fig-rose-edge)" stroke-width="1.3" marker-end="url(#cc-a)"/>
<text x="184" y="74" font-size="8.5" fill="var(--fig-rose-edge)">consumer resolves → NoSuchKey, indistinguishable from a deletion</text>
<text x="184" y="88" font-size="8.5" fill="var(--fig-rose-edge)">so it cannot tell whether to retry or dead-letter, and retrying burns budget on a race</text>
<text x="30" y="106" font-size="8.5" fill="var(--fig-ink-soft)">the window widens with body size and under load — when the pipeline can least absorb it</text>
<line x1="14" y1="120" x2="746" y2="120" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="142" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">store, then publish — no window exists</text>
<rect x="30" y="154" width="120" height="24" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="40" y="170" font-size="8" fill="var(--fig-ink)">object write completes</text>
<line x1="154" y1="166" x2="184" y2="166" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#cc-a)"/>
<rect x="188" y="154" width="96" height="24" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="198" y="170" font-size="8" fill="var(--fig-ink)">publish envelope</text>
<text x="300" y="170" font-size="8.5" fill="var(--fig-mint-edge)">any envelope a consumer can see refers to an object that already exists</text>
<rect x="14" y="190" width="732" height="34" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="26" y="208" font-size="9" fill="var(--fig-ink-soft)">The cost of the correct order: a producer crashing between the two leaves an object nothing references. That is a garbage-collection</text>
<text x="26" y="220" font-size="9" fill="var(--fig-ink-soft)">problem — sweep unreferenced keys older than the topic's retention — rather than a correctness one.</text>
</svg>
<figcaption><b>Figure 1.</b> Both orders have a failure mode. One produces an orphaned object you can sweep on a schedule; the other produces an error consumers cannot classify.</figcaption>
</figure>

## Complete runnable implementation

```python
import hashlib
import json
from dataclasses import asdict, dataclass

from shapely.geometry import shape

INLINE_LIMIT = 256 * 1024


class BodyMismatch(Exception):
    """The stored body is not the one the envelope described."""


@dataclass(slots=True)
class Envelope:
    feature_id: str
    occurred_at: str
    crs: str                                   # always explicit
    bbox: tuple[float, float, float, float]    # stays here — see gotcha 1
    vertex_count: int
    geometry: dict | None = None
    body_key: str | None = None
    body_sha256: str | None = None
    body_bytes: int | None = None


async def publish(geometry: dict, feature_id: str, occurred_at: str,
                  store, broker) -> Envelope:
    geom = shape(geometry)
    body = json.dumps(geometry, separators=(",", ":")).encode()

    env = Envelope(
        feature_id=feature_id, occurred_at=occurred_at, crs="EPSG:4326",
        bbox=geom.bounds, vertex_count=_count_vertices(geom),
    )

    if len(body) < INLINE_LIMIT:
        env.geometry = geometry
    else:
        digest = hashlib.sha256(body).hexdigest()
        # Content-addressed: a retry writes identical bytes to the same key,
        # so the write is idempotent and needs no coordination.
        env.body_key = f"geom/{digest[:2]}/{digest}.json"
        env.body_sha256, env.body_bytes = digest, len(body)
        await store.put(env.body_key, body)     # FIRST

    await broker.send(json.dumps(asdict(env)).encode())   # SECOND
    return env


async def resolve(env: Envelope, store, area_of_interest=None) -> dict | None:
    """Fetch the body only if this event is relevant, then verify it."""
    # Lazy resolution: most of the saving is the events never fetched at all.
    if area_of_interest is not None and not _intersects(env.bbox, area_of_interest):
        return None

    if env.geometry is not None:
        return env.geometry

    body = await store.get(env.body_key)

    # A truncated read of a FeatureCollection frequently parses: it ends
    # after a complete feature and yields a valid, smaller collection. The
    # length and digest checks are the only things that catch it.
    if len(body) != env.body_bytes:
        raise BodyMismatch(f"{env.body_key}: {len(body)} != {env.body_bytes}")
    if hashlib.sha256(body).hexdigest() != env.body_sha256:
        raise BodyMismatch(f"{env.body_key}: digest mismatch")

    return json.loads(body)


async def sweep_orphans(store, broker_retention_seconds: int, referenced) -> int:
    """Delete bodies no event references, once replay can no longer need them.

    Sweeping earlier than the topic's retention deletes objects that a replay
    would still resolve, which converts a harmless orphan into a broken event.
    """
    removed = 0
    async for key, age_seconds in store.list_with_age("geom/"):
        if age_seconds > broker_retention_seconds and key not in referenced:
            await store.delete(key)
            removed += 1
    return removed
```

<figure class="fig">
<svg viewBox="0 0 760 218" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bucket lifecycle shorter than topic retention breaking replay on day four">
<title>Retention has to outlast the topic, not match it</title>
<desc>A topic retains seven days of events. The bucket holding referenced bodies is configured with a three-day lifecycle, which looks generous next to typical object storage costs and is set by someone who has never replayed the topic. For the first three days everything works: every envelope resolves and every body is present. On day four the objects for days one to three have expired while their envelopes are still in the log, so a replay from the beginning of retention resolves references to objects that no longer exist. The failure appears only during a replay, which means only during an incident, which is the moment the pipeline is least able to absorb an additional unknown. Setting the bucket lifecycle beyond the topic's retention — and beyond the age of any dead-letter archive that can be replayed — costs storage and removes the failure entirely. The orphan sweep then handles the other direction, deleting bodies whose events are gone, and it must use the same boundary.</desc>
<rect x="0" y="0" width="760" height="218" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">topic retention 7 days · bucket lifecycle 3 days</text>
<text x="14" y="46" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">envelopes in the log</text>
<rect x="180" y="34" width="560" height="22" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="190" y="49" font-size="8.5" fill="var(--fig-ink)">day 1 ────────────────────────────────────────────── day 7</text>
<text x="14" y="90" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">bodies in the bucket</text>
<rect x="180" y="78" width="240" height="22" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="190" y="93" font-size="8.5" fill="var(--fig-ink)">days 5–7 only</text>
<rect x="424" y="78" width="316" height="22" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6" stroke-dasharray="4 3"/>
<text x="434" y="93" font-size="8.5" fill="var(--fig-rose-edge)">days 1–4 expired — envelopes still present, bodies gone</text>
<rect x="14" y="118" width="732" height="42" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="136" font-size="9.5" font-weight="600" fill="var(--fig-ink)">The failure appears only during a replay</text>
<text x="26" y="153" font-size="9" fill="var(--fig-ink-soft)">…which means only during an incident, which is the moment the pipeline is least able to absorb an additional unknown.</text>
<rect x="14" y="170" width="732" height="38" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="188" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Set the lifecycle beyond topic retention AND beyond any replayable dead-letter archive</text>
<text x="26" y="203" font-size="9" fill="var(--fig-ink-soft)">The orphan sweep uses the same boundary from the other direction: delete bodies whose events are gone, never sooner.</text>
</svg>
<figcaption><b>Figure 2.</b> The bucket lifecycle and the topic retention are two halves of one number. Configuring them in different systems is why they drift apart.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `INLINE_LIMIT` | `int` | Chosen so the 99th percentile of measured sizes stays inline | `262144` |
| `body_key` | `str` | `sha256(body)` — content-addressed, so retries are idempotent | — |
| `body_sha256` | `str` | Verified after every read; a truncated collection still parses | — |
| `bbox` | tuple | Must stay in the envelope, or lazy resolution is impossible | — |
| Bucket lifecycle | days | **>** topic retention and any replayable archive | 14 |
| Orphan sweep age | seconds | Same boundary, from the other direction | retention |

</div>

## Gotchas and spatial edge cases

1. **Moving the bounding box into the body destroys the pattern's main benefit.** Lazy resolution is why a geographically sharded consumer costs almost nothing: it discards most events without a storage round trip. With the bbox in the body, every consumer fetches every object to learn the event was irrelevant, and the claim check becomes strictly worse than inlining.

2. **A truncated body can parse successfully.** A FeatureCollection cut after a complete feature is a valid collection with fewer features, so `json.loads` succeeds and a coverage calculation quietly reports a smaller area. The length check catches it; the digest check catches the case where the length is right and the content is not.

3. **The key must not encode anything mutable.** Putting a date or a tenant name in the key path means two producers with different clocks or different configuration write the same body twice, and the idempotence the content address provides is lost. The digest prefix used for path sharding is fine because it derives from the body.

4. **Presigned URLs expire, and replay is exactly when they have.** If envelopes carry presigned fetch URLs rather than keys, a replay a week later resolves URLs that are no longer valid. Carry the key and let the consumer sign at fetch time.

5. **The store's consistency model matters.** Most object stores are now strongly consistent for new writes, but a read-after-write against a stale replica returns not-found even with correct ordering. Treat a not-found on a freshly published envelope as retryable and a not-found on an old one as terminal, and use the envelope's timestamp to tell them apart.

6. **The digest cannot double as the idempotency key.** Two genuinely different events can carry an identical geometry — the same boundary re-published by two sources — and they hash the same. Event identity comes from [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/); the digest identifies bytes.

## Verification

```python
import json
import pytest
from shapely.geometry import MultiPolygon, Polygon, mapping


def big() -> dict:
    return mapping(MultiPolygon([
        Polygon([(i, j), (i, j + 0.9), (i + 0.9, j + 0.9), (i + 0.9, j)])
        for i in range(120) for j in range(120)
    ]))


@pytest.mark.asyncio
async def test_store_happens_before_publish(store, broker):
    """The ordering rule, asserted against the recorded call sequence."""
    await publish(big(), "f-1", "2026-08-08T10:00:00Z", store, broker)
    assert store.calls[0][0] == "put"
    assert store.calls[0][1] < broker.calls[0][1]      # timestamps


@pytest.mark.asyncio
async def test_envelope_stays_small_and_routable(store, broker):
    env = await publish(big(), "f-2", "2026-08-08T10:00:00Z", store, broker)
    assert len(broker.sent[-1]) < 2048
    assert env.bbox is not None and env.vertex_count > 0


@pytest.mark.asyncio
async def test_irrelevant_event_is_never_fetched(store, broker):
    """Where the saving actually comes from."""
    env = await publish(big(), "f-3", "2026-08-08T10:00:00Z", store, broker)
    before = store.reads
    assert await resolve(env, store, area_of_interest=(200, 200, 210, 210)) is None
    assert store.reads == before


@pytest.mark.asyncio
async def test_truncated_body_is_rejected(store, broker):
    env = await publish(big(), "f-4", "2026-08-08T10:00:00Z", store, broker)
    store.truncate(env.body_key, keep=env.body_bytes // 2)
    with pytest.raises(BodyMismatch):
        await resolve(env, store)


@pytest.mark.asyncio
async def test_retry_writes_the_same_key(store, broker):
    """Content addressing makes the producer retry harmless."""
    a = await publish(big(), "f-5", "2026-08-08T10:00:00Z", store, broker)
    b = await publish(big(), "f-5", "2026-08-08T10:00:00Z", store, broker)
    assert a.body_key == b.body_key
```

The third test is the one that keeps the pattern honest. It fails the moment someone moves the bounding box into the body for tidiness, and that change would otherwise show up only as a slow rise in storage read costs that nobody attributes to a schema edit.

## Related

- [Streaming & Chunking Large Geometry Payloads](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/) — the topic this guide belongs to, and how the three strategies compare
- [Chunking a Multipolygon Across Message Size Limits](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/chunking-a-multipolygon-across-message-size-limits/) — the alternative, and the three failure modes it adds
- [Streaming GeoJSON with ijson in Async Consumers](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/streaming-large-geometries/streaming-geojson-with-ijson-in-async-consumers/) — reading the referenced body without materialising it
- [Replaying Dead-Letter Spatial Events Safely](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/replaying-dead-letter-spatial-events-safely/) — the operation that finds a retention mismatch
