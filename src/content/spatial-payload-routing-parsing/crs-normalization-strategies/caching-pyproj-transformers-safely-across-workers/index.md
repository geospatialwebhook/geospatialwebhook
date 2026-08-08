---
title: "Caching pyproj Transformers Safely Across Workers"
description: "Building a Transformer per event costs milliseconds and dominates a reprojection path. Cache them per process, never share one across a fork, and keep the cache key complete enough that two different transformations cannot collide."
slug: "caching-pyproj-transformers-safely-across-workers"
type: "article"
breadcrumb: "Spatial Payload Routing & Parsing > CRS Normalization Strategies > Caching pyproj Transformers Safely Across Workers"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Caching pyproj Transformers Safely Across Workers",
      "description": "A pyproj Transformer is expensive to build and cheap to use, so a reprojection path that constructs one per event spends most of its time in setup. This guide caches them per process, explains why a cached transformer must never cross a fork, and shows what has to be in the cache key.",
      "url": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/caching-pyproj-transformers-safely-across-workers/",
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
        {"@type": "ListItem", "position": 3, "name": "CRS Normalization Strategies", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/"},
        {"@type": "ListItem", "position": 4, "name": "Caching pyproj Transformers Safely Across Workers", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/caching-pyproj-transformers-safely-across-workers/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Cache pyproj transformers across workers safely",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Cache per process, keyed on everything that changes the transformation"},
        {"@type": "HowToStep", "position": 2, "name": "Build the cache after the fork, never before it"},
        {"@type": "HowToStep", "position": 3, "name": "Bound the cache so an attacker-supplied CRS cannot grow it without limit"},
        {"@type": "HowToStep", "position": 4, "name": "Warm the transformers a worker will need before it takes traffic"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why is building a Transformer expensive?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because construction searches the PROJ database for a transformation pipeline between the two coordinate reference systems, ranks the candidates by accuracy and availability, and may consult grid files on disk. That is milliseconds of work involving I/O, against a transform call that is microseconds. On a stream reprojecting every event, construction is therefore not overhead around the work — it is the work, by an order of magnitude or more."}
        },
        {
          "@type": "Question",
          "name": "Can a cached Transformer be shared across processes?",
          "acceptedAnswer": {"@type": "Answer", "text": "No. It wraps native PROJ state including file handles and internal contexts, and that state does not survive a fork: a child inheriting a transformer built in the parent may crash, may return wrong coordinates, or may work in testing and fail under concurrency. Build the cache lazily inside each worker after the fork, which happens naturally if the cache is populated on first use rather than at import time."}
        },
        {
          "@type": "Question",
          "name": "What has to be in the cache key?",
          "acceptedAnswer": {"@type": "Answer", "text": "The source CRS, the target CRS, the always_xy flag, and any area of interest or accuracy constraint passed to the constructor. Omitting always_xy is the common mistake: two transformers between the same pair of systems with different axis-order handling produce coordinates that differ by a swap, so a cache keyed only on the CRS pair will hand back a transformer that silently flips latitude and longitude."}
        }
      ]
    }
  ]
}
</script>

**Cache transformers per process on a key covering the CRS pair, `always_xy` and any area of interest, populate the cache lazily so it is built after the fork rather than inherited through it, and bound its size — a transformer wraps native PROJ state that does not survive a fork, and a key missing `always_xy` hands back one that swaps latitude and longitude.**

This guide sits under [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/), within [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/). It is the performance and safety detail behind the normalisation that topic describes.

## When to use this pattern

- Every event is reprojected, so construction cost is paid per event rather than per deploy.
- The service runs multiple workers, which is where the fork hazard appears.
- Source CRS values come from payloads rather than from configuration, which is where the unbounded-growth hazard appears.

## Construction dominates, and the ratio is not close

<figure class="fig">
<svg viewBox="0 0 760 210" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Time spent constructing transformers versus transforming coordinates, uncached and cached">
<title>Almost all of the time is setup</title>
<desc>Ten thousand events are reprojected from a local grid to EPSG:4326, each carrying a geometry of about forty vertices. Without caching, each event constructs a Transformer — a PROJ database search, a ranking of candidate pipelines by accuracy, and possibly a grid file read — costing on the order of two milliseconds, and then performs the transformation itself in tens of microseconds. Construction is therefore over ninety-five per cent of the elapsed time, and the profile is dominated by database lookups rather than by anything geometric. With a per-process cache, construction happens once per distinct CRS pair for the lifetime of the worker, so ten thousand events pay it once and the remaining time is the transformation itself. The improvement is not a tuning gain of a few per cent but an order of magnitude, and it changes what the reprojection stage is: from an I/O-bound lookup service into a CPU-bound numeric one.</desc>
<rect x="0" y="0" width="760" height="210" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">10 000 events · ~40 vertices each · local grid → EPSG:4326</text>
<text x="14" y="44" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">no cache</text>
<rect x="130" y="32" width="580" height="24" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="142" y="48" font-size="8.5" fill="var(--fig-ink)">Transformer construction — PROJ database search, pipeline ranking, grid file reads</text>
<rect x="710" y="32" width="24" height="24" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="130" y="72" font-size="8.5" fill="var(--fig-rose-edge)">≈ 2 ms per event constructing · tens of microseconds transforming · over 95% is setup</text>
<text x="14" y="108" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">per-process cache</text>
<rect x="130" y="96" width="8" height="24" rx="2" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<rect x="140" y="96" width="24" height="24" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="176" y="112" font-size="8.5" fill="var(--fig-mint-edge)">one construction per distinct CRS pair, for the life of the worker</text>
<rect x="14" y="140" width="732" height="60" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.4"/>
<text x="26" y="160" font-size="9.5" font-weight="600" fill="var(--fig-ink)">This is not a few per cent — it changes what the stage is</text>
<text x="26" y="178" font-size="9" fill="var(--fig-ink-soft)">Uncached, reprojection is an I/O-bound lookup service whose latency depends on disk and on how many candidate pipelines</text>
<text x="26" y="191" font-size="9" fill="var(--fig-ink-soft)">PROJ has to rank. Cached, it is a CPU-bound numeric one whose latency depends on vertex count, which is what you can plan against.</text>
</svg>
<figcaption><b>Figure 1.</b> Uncached, the reprojection stage's latency depends on the PROJ database rather than on the geometry — which is why it does not scale with anything you can measure at ingest.</figcaption>
</figure>

## Complete runnable implementation

```python
import os
import threading
from dataclasses import dataclass

from pyproj import CRS, Transformer
from pyproj.enums import TransformDirection

# Bound the cache. Source CRS values arriving in payloads are attacker- or
# accident-supplied, and an unbounded dict keyed on them is a memory leak
# with a network interface.
MAX_TRANSFORMERS = 64


@dataclass(frozen=True, slots=True)
class TransformKey:
    """Everything that changes the resulting transformation.

    always_xy MUST be here. Two transformers between the same pair with
    different axis handling produce coordinates that differ by a swap, so a
    key without it hands back one that silently flips lat and lon.
    """
    source: str
    target: str
    always_xy: bool
    area_of_interest: tuple[float, float, float, float] | None = None


class TransformerCache:
    """Per-process cache. Never shared across a fork.

    A Transformer wraps native PROJ state including file handles and an
    internal context. A child process inheriting one may crash, may return
    wrong coordinates, or may pass every test and fail under concurrency.
    """

    def __init__(self, max_size: int = MAX_TRANSFORMERS) -> None:
        self._max_size = max_size
        self._lock = threading.Lock()
        self._cache: dict[TransformKey, Transformer] = {}
        self._owner_pid = os.getpid()

    def get(self, key: TransformKey) -> Transformer:
        # The guard that turns a silent corruption into an exception. It costs
        # one getpid() per call, which is nothing next to a transform.
        if os.getpid() != self._owner_pid:
            raise RuntimeError(
                "transformer cache inherited across a fork — build it lazily "
                "inside the worker instead of at import time"
            )

        with self._lock:
            cached = self._cache.get(key)
            if cached is not None:
                return cached

            if len(self._cache) >= self._max_size:
                # Simple bound rather than an eviction policy: a service that
                # legitimately needs more than 64 CRS pairs should say so in
                # configuration rather than discover it at runtime.
                raise RuntimeError(
                    f"transformer cache full ({self._max_size}); "
                    f"unexpected CRS pair {key.source} -> {key.target}"
                )

            transformer = Transformer.from_crs(
                CRS.from_user_input(key.source),
                CRS.from_user_input(key.target),
                always_xy=key.always_xy,
                area_of_interest=_aoi(key.area_of_interest),
            )
            self._cache[key] = transformer
            return transformer

    def warm(self, keys: list[TransformKey]) -> None:
        """Build the transformers this worker will need, before it takes traffic.

        Otherwise the first event of each CRS pair pays construction cost, and
        after a deploy every worker pays it at once — a latency spike that
        looks like a cold cache somewhere else entirely.
        """
        for key in keys:
            self.get(key)


def _aoi(bounds):
    if bounds is None:
        return None
    from pyproj.aoi import AreaOfInterest
    west, south, east, north = bounds
    return AreaOfInterest(west, south, east, north)


# One cache per process, populated on first use — which is after any fork.
_CACHE: TransformerCache | None = None


def transformer_for(source: str, target: str = "EPSG:4326",
                    always_xy: bool = True) -> Transformer:
    global _CACHE
    if _CACHE is None or _CACHE._owner_pid != os.getpid():
        _CACHE = TransformerCache()
    return _CACHE.get(TransformKey(source, target, always_xy))
```

<figure class="fig">
<svg viewBox="0 0 760 228" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A cache built at import time being inherited by forked workers, versus one built lazily after the fork">
<title>Where the cache is built decides whether it is safe</title>
<desc>Two start-up sequences are compared for a service running four forked workers. In the first, the transformer cache is populated at import time in the parent process, before the fork. Each of the four children inherits the parent's transformers, which wrap native PROJ contexts and open file handles that were never designed to be duplicated. The consequences are not deterministic: a child may segfault immediately, may produce coordinates that are subtly wrong, or may behave perfectly until two workers use the same inherited context concurrently. The last of those is the dangerous one, because it survives testing. In the second sequence the parent imports the module but builds nothing, the fork happens, and each child populates its own cache on first use. Every worker owns native state it created, nothing is shared, and the cost is that each worker pays construction once per CRS pair — which is what the warm-up call exists to move out of the first request. The process-id guard turns the first pattern from a silent corruption into an exception on the first call.</desc>
<rect x="0" y="0" width="760" height="228" fill="var(--fig-bg)"/>
<defs><marker id="pj-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">built at import time, then forked</text>
<rect x="30" y="28" width="130" height="34" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="40" y="44" font-size="8.5" font-weight="600" fill="var(--fig-ink)">parent builds cache</text>
<text x="40" y="56" font-size="8" fill="var(--fig-ink-soft)">native PROJ contexts</text>
<line x1="164" y1="45" x2="196" y2="45" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#pj-a)"/>
<text x="166" y="38" font-size="8" fill="var(--fig-ink-soft)">fork</text>
<rect x="200" y="24" width="82" height="18" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="208" y="37" font-size="7.5" fill="var(--fig-ink)">worker 1</text>
<rect x="200" y="46" width="82" height="18" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="208" y="59" font-size="7.5" fill="var(--fig-ink)">worker 2</text>
<rect x="290" y="24" width="82" height="18" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="298" y="37" font-size="7.5" fill="var(--fig-ink)">worker 3</text>
<rect x="290" y="46" width="82" height="18" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="298" y="59" font-size="7.5" fill="var(--fig-ink)">worker 4</text>
<text x="390" y="34" font-size="8.5" fill="var(--fig-rose-edge)">inherited file handles and contexts, duplicated four ways</text>
<text x="390" y="48" font-size="8.5" fill="var(--fig-rose-edge)">may segfault · may return wrong coordinates ·</text>
<text x="390" y="60" font-size="8.5" fill="var(--fig-rose-edge)">may work until two workers use one context at once</text>
<text x="390" y="78" font-size="8.5" fill="var(--fig-ink-soft)">the third is the dangerous one: it survives testing</text>
<line x1="14" y1="94" x2="746" y2="94" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="116" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">built lazily, after the fork</text>
<rect x="30" y="126" width="130" height="34" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="40" y="142" font-size="8.5" font-weight="600" fill="var(--fig-ink)">parent imports only</text>
<text x="40" y="154" font-size="8" fill="var(--fig-ink-soft)">builds nothing</text>
<line x1="164" y1="143" x2="196" y2="143" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#pj-a)"/>
<rect x="200" y="122" width="82" height="18" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="208" y="135" font-size="7.5" fill="var(--fig-ink)">own cache</text>
<rect x="200" y="144" width="82" height="18" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="208" y="157" font-size="7.5" fill="var(--fig-ink)">own cache</text>
<rect x="290" y="122" width="82" height="18" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="298" y="135" font-size="7.5" fill="var(--fig-ink)">own cache</text>
<rect x="290" y="144" width="82" height="18" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="298" y="157" font-size="7.5" fill="var(--fig-ink)">own cache</text>
<text x="390" y="136" font-size="8.5" fill="var(--fig-mint-edge)">every worker owns state it created · nothing shared</text>
<text x="390" y="152" font-size="8.5" fill="var(--fig-ink-soft)">cost: each pays construction once per CRS pair — which is what warm() moves out of the first request</text>
<rect x="14" y="180" width="732" height="34" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="26" y="199" font-size="9" fill="var(--fig-ink-soft)">The process-id guard costs one getpid() per call and turns the top pattern from a silent corruption into an exception on the</text>
<text x="26" y="210" font-size="9" fill="var(--fig-ink-soft)">first call — which is the difference between a bug found in a smoke test and one found in a coordinate audit.</text>
</svg>
<figcaption><b>Figure 2.</b> The failure that survives testing is the one to design against: an inherited context that works fine until two workers touch it at the same moment.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `always_xy` | `bool` | Must be in the key; omitting it returns a transformer that swaps axes | `True` |
| `area_of_interest` | tuple | Changes which pipeline PROJ selects, so it changes results — key on it | `None` |
| `MAX_TRANSFORMERS` | `int` | Bounds a dict keyed on payload-supplied CRS values | `64` |
| `_owner_pid` | `int` | Fork guard; compared on every `get` | — |
| `warm()` | call | Before the worker takes traffic, not on the first request | — |
| Cache scope | — | Per process. Never a module-level dict populated at import | — |

</div>

## Gotchas and spatial edge cases

1. **`always_xy` missing from the key is a silent axis swap.** EPSG:4326 declares latitude first; most GeoJSON tooling assumes longitude first. Two transformers differing only in that flag return coordinates in opposite orders, and a cache keyed on the CRS pair alone will hand out whichever was built first. The symptom is features in the wrong hemisphere, appearing only for the CRS pairs where both variants are used.

2. **A payload-supplied source CRS is an unbounded key space.** `CRS.from_user_input` accepts WKT, so a malformed or hostile payload can produce an unlimited number of distinct keys, each costing a database search and a cache slot. Validate the source against an allowlist before it reaches the cache, and treat the "cache full" error as a signal that something upstream changed.

3. **The area of interest changes the answer, not just the speed.** PROJ selects among candidate transformation pipelines partly by which covers the area, and different pipelines differ by metres in some regions. Two transformers between the same pair with different areas of interest are genuinely different transformations, which is why the key includes it.

4. **Cached transformers keep grid files open.** A worker holding many transformers holds many file descriptors, which interacts badly with a low descriptor limit in a container. Bounding the cache bounds this too, which is a second reason for the limit.

5. **Warming must use the same key the request path builds.** A warm-up that constructs with `always_xy=True` while the request path defaults to `False` populates the cache with entries nothing will hit, and the first request still pays construction — with the added confusion that the cache appears full.

6. **Reprojection is not free of precision cost even when cached.** Every transform introduces sub-millimetre differences, so a content hash computed after reprojection differs from one computed before. Round to a fixed precision after transforming, as [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) requires.

## Verification

```python
import multiprocessing as mp
import pytest


def test_axis_order_is_part_of_the_key():
    """The silent-swap case."""
    a = transformer_for("EPSG:4326", "EPSG:25833", always_xy=True)
    b = transformer_for("EPSG:4326", "EPSG:25833", always_xy=False)
    assert a is not b
    x1, y1 = a.transform(13.4049, 52.5200)      # lon, lat
    x2, y2 = b.transform(52.5200, 13.4049)      # lat, lon
    assert abs(x1 - x2) < 1e-6 and abs(y1 - y2) < 1e-6


def test_repeated_lookups_reuse_one_transformer():
    first = transformer_for("EPSG:25833")
    for _ in range(1000):
        assert transformer_for("EPSG:25833") is first


def test_cache_is_bounded():
    cache = TransformerCache(max_size=2)
    cache.get(TransformKey("EPSG:25832", "EPSG:4326", True))
    cache.get(TransformKey("EPSG:25833", "EPSG:4326", True))
    with pytest.raises(RuntimeError, match="cache full"):
        cache.get(TransformKey("EPSG:25834", "EPSG:4326", True))


def _child(cache, queue):
    try:
        cache.get(TransformKey("EPSG:25833", "EPSG:4326", True))
        queue.put("no guard")
    except RuntimeError as exc:
        queue.put(str(exc))


def test_inherited_cache_raises_rather_than_corrupting():
    """An exception on the first call beats a coordinate audit six months later."""
    cache = TransformerCache()
    cache.get(TransformKey("EPSG:25833", "EPSG:4326", True))

    queue = mp.Queue()
    child = mp.get_context("fork").Process(target=_child, args=(cache, queue))
    child.start()
    child.join()
    assert "across a fork" in queue.get()
```

The first test is the one worth keeping in front of a reviewer: it demonstrates that the two cached transformers are genuinely different by showing that they need their arguments in opposite orders to produce the same point.

## Related

- [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) — the topic this guide belongs to
- [Handling Mixed-CRS Payloads in Python Event Handlers](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/) — where the source CRS comes from, and why it must be validated
- [Optimizing Async Geometry Parsing with asyncio](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/optimizing-async-geometry-parsing-with-asyncio/) — the process pool this cache lives inside
- [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — why rounding after reprojection is not optional
