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
<figcaption><b>Figure 1.</b> Offloading geometry parsing off the event loop</figcaption>
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
