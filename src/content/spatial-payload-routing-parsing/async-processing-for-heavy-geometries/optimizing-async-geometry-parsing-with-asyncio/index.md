---
title: "Optimizing Async Geometry Parsing with asyncio"
description: "Offload CPU-bound spatial parsing to a ProcessPoolExecutor with loop.run_in_executor so webhook ingestion stays non-blocking while Shapely topology checks run in isolated processes."
slug: "optimizing-async-geometry-parsing-with-asyncio"
type: "article"
breadcrumb: "Spatial Payload Routing & Parsing › Async Processing for Heavy Geometries › Optimizing Async Geometry Parsing with asyncio"
datePublished: "2025-11-18"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Optimizing Async Geometry Parsing with asyncio",
      "description": "Offload CPU-bound spatial parsing to a ProcessPoolExecutor with loop.run_in_executor so webhook ingestion stays non-blocking while Shapely topology checks run in isolated processes.",
      "datePublished": "2025-11-18",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/" },
        { "@type": "ListItem", "position": 2, "name": "Spatial Payload Routing & Parsing", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/" },
        { "@type": "ListItem", "position": 3, "name": "Async Processing for Heavy Geometries", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/" },
        { "@type": "ListItem", "position": 4, "name": "Optimizing Async Geometry Parsing with asyncio", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/optimizing-async-geometry-parsing-with-asyncio/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Optimize async geometry parsing with asyncio",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Define a stateless, picklable CPU-bound worker that validates and normalizes the geometry" },
        { "@type": "HowToStep", "position": 2, "name": "Offload the worker to a ProcessPoolExecutor via loop.run_in_executor" },
        { "@type": "HowToStep", "position": 3, "name": "Wrap the future in asyncio.wait_for to enforce a per-task timeout" },
        { "@type": "HowToStep", "position": 4, "name": "Route validated geometry downstream while the event loop stays free" }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does asyncio block when parsing heavy geometries?",
          "acceptedAnswer": { "@type": "Answer", "text": "asyncio is an I/O multiplexing framework, not a parallel execution engine. Shapely and pyproj run GEOS/PROJ C extensions that are CPU-bound. Calling them directly inside a coroutine holds the single event-loop thread, so all other in-flight webhooks stall until parsing finishes. Offload the work to a ProcessPoolExecutor via loop.run_in_executor so the loop only awaits a future." }
        },
        {
          "@type": "Question",
          "name": "Should I use run_in_executor with a thread pool or a process pool?",
          "acceptedAnswer": { "@type": "Answer", "text": "Use a ProcessPoolExecutor for CPU-bound geometry math — coordinate transforms, topology repair, spatial joins — because threads share the GIL and serialize under load. Use a ThreadPoolExecutor (or asyncio.to_thread) only for I/O-bound steps like fetching remote tiles or writing to PostGIS." }
        },
        {
          "@type": "Question",
          "name": "How do I stop a malformed geometry from hanging a worker?",
          "acceptedAnswer": { "@type": "Answer", "text": "Wrap loop.run_in_executor in asyncio.wait_for with an explicit timeout. A timed-out task usually signals a pathological geometry, not a transient fault, so route it to a dead-letter queue instead of retrying. Note the underlying process keeps running after a timeout; cancel it explicitly if you need the worker slot back immediately." }
        }
      ]
    }
  ]
}
</script>

**Wrap each CPU-bound parse in `loop.run_in_executor(ProcessPoolExecutor(), validate_geometry, payload)` and `await` it behind an `asyncio.wait_for` timeout — the event loop keeps accepting webhooks while Shapely validation runs in a separate OS process.**

This page sits under [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/), part of the broader [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/) section that covers how spatial payloads are ingested, validated, and forwarded to consumers.

## When to Use This Pattern

Reach for an executor-backed parse — rather than parsing inline in the coroutine — when:

- **Parsing is CPU-bound, not I/O-bound.** Payloads carry dense `MultiPolygon` rings, thousands of vertices, or full `FeatureCollection` documents, and most of the wall-clock cost is GEOS topology work (`make_valid`, `is_valid`, `unary_union`) rather than network or disk waits.
- **The same process must stay responsive to other webhooks.** A single FastAPI/aiohttp worker handles many concurrent senders and cannot afford to freeze the loop while one large geometry is validated.
- **You need a hard upper bound per geometry.** A timeout must quarantine pathological inputs (degenerate rings, billion-coordinate spikes) without taking down the ingestion endpoint.

If the heavy step is instead a remote call — fetching a WFS tile or an elevation API — prefer `asyncio.to_thread` or a `ThreadPoolExecutor`, since threads release the GIL during I/O and avoid the pickling overhead of a process pool.

## How the Loop Stays Free

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Event loop occupancy while a geometry worker runs, showing what the loop is free to do">
<title>What the loop does while the geometry is being repaired</title>
<desc>One second of event-loop time while a 900-millisecond geometry repair is in flight in a worker process. The loop itself is busy for only about 6 milliseconds of that second: roughly 0.4 milliseconds to pickle the payload out, the same to unpickle the result back, and the remainder spread across accepting new connections, reading request bodies, answering health checks and awaiting broker publishes. For the other 994 milliseconds it is idle and available, which is why acceptance latency stays flat while a heavy payload is processing and why the same process can hold hundreds of concurrent requests. The number that matters is not how long the repair takes but how much of it the loop is obliged to witness — and with a process pool that is only the two serialisation hops at either end.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="10.5" font-weight="600" fill="var(--fig-ink)">One second of event-loop occupancy, with a 900 ms repair in flight</text>
<line x1="60" y1="76" x2="720" y2="76" stroke="var(--fig-line)" stroke-width="1.2"/>
<rect x="60" y="56" width="6" height="20" fill="var(--fig-peach-edge)"/>
<rect x="196" y="60" width="4" height="16" fill="var(--fig-mint-edge)"/>
<rect x="268" y="60" width="4" height="16" fill="var(--fig-mint-edge)"/>
<rect x="352" y="60" width="4" height="16" fill="var(--fig-mint-edge)"/>
<rect x="424" y="60" width="4" height="16" fill="var(--fig-mint-edge)"/>
<rect x="510" y="60" width="4" height="16" fill="var(--fig-mint-edge)"/>
<rect x="588" y="60" width="4" height="16" fill="var(--fig-mint-edge)"/>
<rect x="654" y="56" width="6" height="20" fill="var(--fig-peach-edge)"/>
<text x="60" y="50" font-size="8" fill="var(--fig-peach-edge)">pickle out</text>
<text x="654" y="50" font-size="8" fill="var(--fig-peach-edge)">unpickle in</text>
<text x="196" y="94" font-size="8" fill="var(--fig-ink-soft)">other requests, health checks, broker awaits</text>
<rect x="60" y="106" width="660" height="20" rx="3" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="390" y="120" text-anchor="middle" font-size="8.5" fill="var(--fig-ink)">worker process: make_valid + reproject — 900 ms, on another core</text>
<text x="14" y="120" font-size="8.5" fill="var(--fig-ink-soft)">worker</text>
<text x="14" y="66" font-size="8.5" fill="var(--fig-ink-soft)">loop</text>
<rect x="14" y="146" width="366" height="66" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="26" y="164" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Loop busy: ~6 ms of the second</text>
<text x="26" y="182" font-size="9" fill="var(--fig-ink-soft)">0.4 ms pickling out · 0.4 ms unpickling back ·</text>
<text x="26" y="194" font-size="9" fill="var(--fig-ink-soft)">the rest is ordinary I/O it would have done anyway</text>
<text x="26" y="207" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">994 ms idle and available</text>
<rect x="394" y="146" width="352" height="66" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="406" y="164" font-size="9.5" font-weight="600" fill="var(--fig-ink)">The number that matters</text>
<text x="406" y="182" font-size="9" fill="var(--fig-ink-soft)">Not how long the repair takes, but how much of it the loop is</text>
<text x="406" y="194" font-size="9" fill="var(--fig-ink-soft)">obliged to witness — here, only the two serialisation hops.</text>
<text x="406" y="207" font-size="9" fill="var(--fig-ink-soft)">Which is why one process holds hundreds of live requests.</text>
</svg>
<figcaption><b>Figure 1.</b> Offloading does not make the work cheaper; it makes the loop's share of it constant. The pickle hops at each end are the only part that scales with payload size, which is why the worker should return a summary.</figcaption>
</figure>

The event loop never executes geometry code. It submits the work to a pool of worker processes and immediately returns to servicing sockets; only the originating coroutine suspends on the returned future.

<figure class="fig">
<svg viewBox="6 4 728 280" role="img" aria-label="The asyncio event loop offloads CPU-bound geometry parsing to separate worker processes via run_in_executor and awaits a future" xmlns="http://www.w3.org/2000/svg">
  <title>Offloading geometry parsing off the event loop</title>
  <desc>An async webhook handler calls loop.run_in_executor to submit each payload to a ProcessPoolExecutor. Worker processes run Shapely and pyproj past the GIL boundary, while the single event-loop thread stays free to accept new connections and only awaits a future.</desc>
  <rect x="6" y="4" width="728" height="280" fill="var(--fig-bg)"/>
  <defs>
    <marker id="ag-arrow" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L9,3.5 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Event loop column -->
  <rect x="20" y="40" width="200" height="230" rx="10" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3"/>
  <text x="120" y="30" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor" opacity="0.75">Single event-loop thread</text>
  <rect x="40" y="60" width="160" height="40" rx="6" fill="currentColor" opacity="0.08"/>
  <text x="120" y="78" text-anchor="middle" font-size="10.5" fill="currentColor">accept connections</text>
  <text x="120" y="92" text-anchor="middle" font-size="10.5" fill="currentColor">read raw bytes</text>
  <rect x="40" y="112" width="160" height="40" rx="6" fill="currentColor" opacity="0.08"/>
  <text x="120" y="130" text-anchor="middle" font-size="10.5" fill="currentColor">run_in_executor(...)</text>
  <text x="120" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">returns a future</text>
  <rect x="40" y="164" width="160" height="40" rx="6" fill="currentColor" opacity="0.08"/>
  <text x="120" y="182" text-anchor="middle" font-size="10.5" fill="currentColor">await wait_for(future)</text>
  <text x="120" y="196" text-anchor="middle" font-size="10.5" fill="currentColor">loop serves others</text>
  <rect x="40" y="216" width="160" height="38" rx="6" fill="currentColor" opacity="0.08"/>
  <text x="120" y="233" text-anchor="middle" font-size="10.5" fill="currentColor">route normalized</text>
  <text x="120" y="247" text-anchor="middle" font-size="10.5" fill="currentColor">geometry downstream</text>
  <!-- GIL boundary -->
  <line x1="300" y1="40" x2="300" y2="270" stroke="currentColor" stroke-width="1.2" stroke-dasharray="5 5" opacity="0.45"/>
  <text x="300" y="32" text-anchor="middle" font-size="10" font-weight="600" fill="currentColor" opacity="0.65">process boundary (past the GIL)</text>
  <!-- Worker processes -->
  <text x="560" y="30" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor" opacity="0.75">ProcessPoolExecutor</text>
  <rect x="400" y="55" width="320" height="58" rx="8" fill="currentColor" opacity="0.06" stroke="currentColor" stroke-width="1" stroke-opacity="0.3"/>
  <text x="560" y="78" text-anchor="middle" font-size="10.5" fill="currentColor">Worker 1 — shape() · make_valid()</text>
  <text x="560" y="96" text-anchor="middle" font-size="10.5" fill="currentColor">pyproj transform to EPSG:4326</text>
  <rect x="400" y="123" width="320" height="58" rx="8" fill="currentColor" opacity="0.06" stroke="currentColor" stroke-width="1" stroke-opacity="0.3"/>
  <text x="560" y="146" text-anchor="middle" font-size="10.5" fill="currentColor">Worker 2 — is_valid · bounds · simplify</text>
  <text x="560" y="164" text-anchor="middle" font-size="10.5" fill="currentColor">true OS-level parallelism</text>
  <rect x="400" y="191" width="320" height="58" rx="8" fill="currentColor" opacity="0.06" stroke="currentColor" stroke-width="1" stroke-opacity="0.3"/>
  <text x="560" y="214" text-anchor="middle" font-size="10.5" fill="currentColor">Worker N — one per CPU core</text>
  <text x="560" y="232" text-anchor="middle" font-size="10.5" fill="currentColor">picklable args · picklable result</text>
  <!-- arrows out -->
  <line x1="200" y1="132" x2="398" y2="84" stroke="currentColor" stroke-width="1.4" marker-end="url(#ag-arrow)" opacity="0.55"/>
  <line x1="200" y1="132" x2="398" y2="152" stroke="currentColor" stroke-width="1.4" marker-end="url(#ag-arrow)" opacity="0.55"/>
  <line x1="200" y1="132" x2="398" y2="220" stroke="currentColor" stroke-width="1.4" marker-end="url(#ag-arrow)" opacity="0.55"/>
  <!-- arrow back (result) -->
  <line x1="398" y1="152" x2="221" y2="184" stroke="currentColor" stroke-width="1.4" marker-end="url(#ag-arrow)" opacity="0.4" stroke-dasharray="4 4"/>
</svg>
<figcaption><b>Figure 2.</b> Offloading geometry parsing off the event loop</figcaption>
</figure>

## Complete Runnable Example

The snippet below is self-contained. The worker is a plain module-level function so it can be pickled across the process boundary; the consumer offloads it with `loop.run_in_executor` and enforces a per-task ceiling with `asyncio.wait_for`. The worker normalizes any non-WGS84 input to `EPSG:4326`, mirroring the canonical-projection approach in [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/), and validates topology in line with [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/).

```python
import asyncio
import json
import logging
import os
from concurrent.futures import ProcessPoolExecutor
from typing import Any

from pyproj import CRS, Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform
from shapely.validation import make_valid
from shapely.errors import ShapelyError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("async-geometry")


# ---- 1. CPU-bound worker (runs in a separate OS process) --------------------
# Must be a top-level def: lambdas and closures are not picklable and will
# raise PicklingError when submitted to a ProcessPoolExecutor.
def validate_geometry(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        geom = shape(payload["geometry"])

        # Topology repair before any measurement; make_valid keeps all vertices.
        if not geom.is_valid:
            geom = make_valid(geom)

        # Normalize to EPSG:4326 (WGS 84). RFC 7946 mandates WGS84 when the
        # source CRS is omitted, so default to it. always_xy=True keeps the
        # (lon, lat) axis order PROJ 6+ would otherwise swap.
        source_epsg = int(payload.get("source_epsg", 4326))
        if source_epsg != 4326:
            transformer = Transformer.from_crs(
                CRS.from_epsg(source_epsg),
                CRS.from_epsg(4326),
                always_xy=True,
            )
            geom = shp_transform(transformer.transform, geom)

        return {
            "id": payload.get("id"),
            "valid": True,
            "crs": "EPSG:4326",
            "geometry": mapping(geom),   # JSON-serializable -> safe to pickle back
            "bbox": list(geom.bounds),
        }
    except (ShapelyError, KeyError, TypeError, ValueError) as exc:
        return {"id": payload.get("id"), "valid": False, "error": str(exc)}


# ---- 2. Async consumer: offload each payload, never block the loop ----------
async def process_geometry_queue(
    queue: "asyncio.Queue[dict[str, Any]]",
    executor: ProcessPoolExecutor,
    timeout: float = 30.0,
) -> None:
    loop = asyncio.get_running_loop()
    while True:
        payload = await queue.get()
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(executor, validate_geometry, payload),
                timeout=timeout,
            )
            if result["valid"]:
                logger.info("geometry %s normalized, bbox=%s",
                            result["id"], result["bbox"])
                # route `result` to PostGIS / Redis / a downstream service here
            else:
                logger.warning("geometry %s rejected: %s",
                               result["id"], result["error"])
                # send to dead-letter queue here
        except asyncio.TimeoutError:
            # The worker process is still running; quarantine, do not retry inline.
            logger.error("geometry %s timed out after %.0fs", payload.get("id"), timeout)
        finally:
            queue.task_done()


# ---- 3. Wire it together ----------------------------------------------------
async def main() -> None:
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
    # One worker per core: oversubscribing increases context-switch + memory cost.
    with ProcessPoolExecutor(max_workers=os.cpu_count() or 4) as executor:
        consumers = [
            asyncio.create_task(process_geometry_queue(queue, executor))
            for _ in range(2)  # several consumers feed the same pool
        ]

        # Simulate an ingestion endpoint dropping raw payloads onto the queue.
        sample = {
            "id": "feat-001",
            "source_epsg": 3857,  # Web Mercator -> will be reprojected to 4326
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-13627361.0, 4544760.0],
                    [-13626000.0, 4544760.0],
                    [-13626000.0, 4546000.0],
                    [-13627361.0, 4546000.0],
                    [-13627361.0, 4544760.0],
                ]],
            },
        }
        await queue.put(sample)
        await queue.join()  # wait until all queued geometries are processed

        for c in consumers:
            c.cancel()


if __name__ == "__main__":
    asyncio.run(main())
```

## Parameter Reference

<div style="overflow-x:auto">

| Argument | Type | Spatial constraint / note | Default |
|---|---|---|---|
| `executor` (`max_workers`) | `int` | Set to `os.cpu_count()`; GEOS work is CPU-bound so oversubscribing degrades throughput and inflates RSS | `os.cpu_count()` |
| `loop.run_in_executor(executor, fn, *args)` | callable + picklable args | `fn` must be a module-level `def`; args/return must be picklable (GeoJSON dicts are, Shapely objects are not by default) | required |
| `asyncio.wait_for(..., timeout)` | `float` seconds | 30 s suits validation/simplify; dense union/intersection may need up to 120 s. Timeout cancels the *await*, not the OS process | `None` (no timeout) |
| `source_epsg` | `int` (EPSG code) | Source CRS of incoming coords; reproject to `EPSG:4326` before topology checks to avoid corrupt indexes | `4326` |
| `always_xy` (pyproj) | `bool` | `True` enforces `(lon, lat)` order and prevents the PROJ 6+ axis swap | `True` here |
| `queue` (`maxsize`) | `int` | Bounded queue applies backpressure; `0` is unbounded and risks OOM under burst traffic | `1000` |

</div>

## Gotchas & Spatial Edge Cases

1. **Pickling failures on geometry objects.** A `ProcessPoolExecutor` serializes args and results with `pickle`. Pass and return GeoJSON dicts (call `mapping(geom)` before returning), not raw Shapely objects, database connections, or closures — those raise `PicklingError` or silently fail to round-trip.
2. **Topology repair before measurement.** Compute `bounds`, area, or centroid only after `make_valid`. Self-intersecting rings produce meaningless extents, and an invalid `Polygon` can yield a `GeometryCollection` after repair — assert the output type before persisting.
3. **CRS mismatch on merge.** Reproject to `EPSG:4326` inside the worker *before* validating or unioning. Mixing `EPSG:3857` (Web Mercator) coordinates with WGS84 silently shifts features hundreds of kilometres; resolve the source CRS first, as detailed in [Handling Mixed CRS Payloads in Python Webhooks](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/).
4. **Coordinate ring orientation.** [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946) expects exterior rings counter-clockwise and holes clockwise. `make_valid` does not normalize winding; call `shapely.geometry.polygon.orient(geom, sign=1.0)` if a downstream consumer is winding-sensitive.
5. **Precision loss after transformation.** Reprojection introduces floating-point drift, so a transformed ring's first and last vertex may no longer be bit-identical. Re-close the ring (or re-run `make_valid`) after transforming to avoid spurious "unclosed ring" errors in PostGIS.
6. **Timeout does not kill the process.** `asyncio.wait_for` cancels the *await*, but the worker process keeps grinding on the pathological geometry and holds a pool slot. For a hard kill, give each task its own short-lived pool or use `pebble.ProcessPool`, which cancels the underlying process.
7. **Pool created at import time under spawn.** On macOS and Windows (spawn start method) a module-level `ProcessPoolExecutor()` re-imports the module in each child and can fork-bomb. Create the pool inside `if __name__ == "__main__":` or your app's startup hook, never at module top level.

<figure class="fig">
<svg viewBox="0 0 760 216" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="What crosses a process-pool boundary cleanly and what does not">
<title>Everything crossing the pool boundary must survive pickling</title>
<desc>A ProcessPoolExecutor moves arguments and results between interpreters with pickle, so the boundary imposes a contract the type system does not express. Raw bytes and plain dicts cross cleanly and cheaply. A Shapely geometry does pickle, but it carries the whole coordinate array, so returning one from a worker copies megabytes back across the boundary for a result the caller usually only needs a summary of — call mapping on it, or better, return just the derived facts. A database connection or session cannot be pickled at all and raises immediately, which is at least a loud failure. A closure or lambda also fails to pickle, and a module-level function must be used instead. The pattern that avoids all of this is to send the worker raw bytes and a small config, and have it return a compact result: validity flag, vertex count, bounding box, H3 cell and the normalised geometry as a dict — everything the caller needs and nothing it does not.</desc>
<rect x="0" y="0" width="760" height="216" fill="var(--fig-bg)"/>
<line x1="380" y1="26" x2="380" y2="140" stroke="var(--fig-line)" stroke-width="1.6" stroke-dasharray="6,4"/>
<text x="380" y="20" text-anchor="middle" font-size="9" font-weight="600" fill="var(--fig-ink-soft)">process boundary — everything here is pickled</text>
<rect x="14" y="30" width="340" height="26" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="26" y="47" font-size="8.5" fill="var(--fig-ink)">bytes, plain dicts — cross cleanly and cheaply</text>
<rect x="14" y="60" width="340" height="30" rx="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="26" y="76" font-size="8.5" fill="var(--fig-ink)">a Shapely geometry — pickles, but copies the whole array</text>
<text x="26" y="87" font-size="8" fill="var(--fig-ink-soft)">megabytes back for a result you wanted a summary of</text>
<rect x="14" y="94" width="340" height="26" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="26" y="111" font-size="8.5" fill="var(--fig-ink)">a DB connection or session — raises immediately, loudly</text>
<rect x="14" y="124" width="340" height="26" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="26" y="141" font-size="8.5" fill="var(--fig-ink)">a closure or lambda — use a module-level function</text>
<rect x="406" y="30" width="340" height="52" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="418" y="48" font-size="9.5" font-weight="600" fill="var(--fig-ink)">send: raw bytes + a small config</text>
<text x="418" y="65" font-size="8.5" fill="var(--fig-ink-soft)">the worker parses inside its own interpreter, so nothing</text>
<text x="418" y="76" font-size="8.5" fill="var(--fig-ink-soft)">large or stateful has to travel</text>
<rect x="406" y="90" width="340" height="60" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="418" y="108" font-size="9.5" font-weight="600" fill="var(--fig-ink)">return: a compact result</text>
<text x="418" y="125" font-size="8.5" font-family="monospace" fill="var(--fig-ink-soft)">{valid, vertex_count, bbox, h3_r7,</text>
<text x="418" y="137" font-size="8.5" font-family="monospace" fill="var(--fig-ink-soft)"> geometry: mapping(geom)}</text>
<text x="418" y="147" font-size="8" fill="var(--fig-mint-edge)">everything the caller needs, nothing it does not</text>
<rect x="14" y="164" width="732" height="44" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="182" font-size="10" font-weight="600" fill="var(--fig-ink)">The boundary imposes a contract the type system does not express</text>
<text x="26" y="196" font-size="9" fill="var(--fig-ink-soft)">A signature that type-checks can still fail at runtime, or succeed while copying far more than intended.</text>
<text x="26" y="206" font-size="9" fill="var(--fig-ink-soft)">Design the worker's inputs and outputs deliberately rather than letting them follow from whatever code was extracted.</text>
</svg>
<figcaption><b>Figure 3.</b> Two different failures hide here: the loud one (an unpicklable connection) and the quiet one (a Shapely object that pickles fine and copies megabytes). Design the worker's signature around what must cross, not around what is convenient to pass.</figcaption>
</figure>

## Verify It Works

Drop this into `test_async_geometry.py` and run `pytest -q`. It asserts the worker reprojects Web Mercator to WGS84 and that the offloaded call completes well under its timeout — proving the event loop is never blocked.

```python
import asyncio
import os
from concurrent.futures import ProcessPoolExecutor

import pytest

from async_geometry import validate_geometry  # the module above


def test_worker_reprojects_to_wgs84():
    payload = {
        "id": "t1",
        "source_epsg": 3857,
        "geometry": {
            "type": "Point",
            "coordinates": [-13627361.0, 4544760.0],  # Web Mercator
        },
    }
    out = validate_geometry(payload)
    assert out["valid"] is True
    assert out["crs"] == "EPSG:4326"
    lon, lat = out["geometry"]["coordinates"]
    assert -123.0 < lon < -122.0 and 37.0 < lat < 38.0  # San Francisco area


@pytest.mark.asyncio
async def test_offload_does_not_block_loop():
    loop = asyncio.get_running_loop()
    payload = {"id": "t2", "geometry": {"type": "Point", "coordinates": [0, 0]}}
    with ProcessPoolExecutor(max_workers=os.cpu_count() or 2) as ex:
        result = await asyncio.wait_for(
            loop.run_in_executor(ex, validate_geometry, payload),
            timeout=5.0,
        )
    assert result["valid"] is True
    assert result["bbox"] == [0.0, 0.0, 0.0, 0.0]
```

A passing run confirms the geometry is parsed and reprojected inside a child process and the future resolves before the timeout — exactly the non-blocking behaviour the pattern guarantees.

## Related

- [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/) — the full four-layer ingestion-to-persistence pipeline this offloading pattern plugs into
- [Handling Mixed CRS Payloads in Python Webhooks](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/) — resolving and normalizing source CRS before geometry work
- [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/) — how spatial payloads are ingested, validated, and routed to consumers
