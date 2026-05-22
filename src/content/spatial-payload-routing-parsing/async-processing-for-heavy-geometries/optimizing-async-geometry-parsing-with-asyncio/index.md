# Optimizing async geometry parsing with asyncio

Optimizing async geometry parsing with asyncio requires decoupling CPU-intensive coordinate validation from the event loop using `loop.run_in_executor()`. Python’s Global Interpreter Lock (GIL) prevents true parallelism in the main thread, so heavy GeoJSON, WKB, or WKT payloads must be offloaded to a `ProcessPoolExecutor`. This hybrid architecture keeps webhook ingestion, routing, and database writes strictly asynchronous while isolating spatial computations. The result is high concurrency for I/O-bound delivery without event loop starvation during topology checks.

## Why `asyncio` Alone Blocks on Heavy Geometries

`asyncio` is an I/O multiplexing framework, not a parallel execution engine. When a webhook handler receives a spatial payload containing thousands of vertices, nested multipolygons, or complex feature collections, parsing becomes fundamentally CPU-bound. Libraries like `shapely`, `pyproj`, or `geojson` invoke C extensions or perform heavy linear algebra to validate ring orientation, detect self-intersections, and compute bounding boxes. If executed directly on the event loop, these operations block the thread, causing webhook acknowledgments to timeout, connection pools to exhaust, and downstream routing queues to back up.

The correct architectural approach treats geometry parsing as a synchronous worker task bridged into the async context. This is the core principle behind [Async Processing for Heavy Geometries](/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/), where payload acceptance remains non-blocking while validation runs in isolated processes. By isolating CPU work, you preserve the event loop’s ability to handle thousands of concurrent HTTP connections, WebSocket streams, or message broker subscriptions without sacrificing spatial accuracy.

## Executor-Backed Architecture for Spatial Workloads

In an event-driven webhook pipeline, the optimal flow separates ingestion from computation:

1. **Acknowledge immediately**: Return `HTTP 202 Accepted` to the sender.
2. **Queue raw payload**: Push the unmodified JSON to an async-compatible queue (e.g., `asyncio.Queue`, Redis Streams, or RabbitMQ).
3. **Dispatch to executor**: Pull payloads from the queue and submit them to a process pool.
4. **Route validated output**: Once parsing completes, route the normalized geometry to spatial databases, tile generators, or downstream microservices.

This separation ensures that [Spatial Payload Routing & Parsing](/spatial-payload-routing-parsing/) remains responsive under burst traffic. The event loop never waits on GEOS calculations; it only awaits the future returned by `run_in_executor()`. For authoritative guidance on bridging sync and async contexts, consult the official [Python asyncio event loop documentation](https://docs.python.org/3/library/asyncio-eventloop.html#asyncio.loop.run_in_executor).

## Production-Ready Implementation

The following pattern safely bridges async webhook handlers with synchronous geometry validation. It uses `ProcessPoolExecutor` to bypass the GIL, validates topology, and returns structured results without blocking the main thread.

```python
import asyncio
import logging
from concurrent.futures import ProcessPoolExecutor
from typing import Dict, Any

from shapely.geometry import shape
from shapely.validation import make_valid
from shapely.errors import ShapelyError

# 1. CPU-bound worker (runs in isolated process)
def validate_geometry(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        geom = shape(payload["geometry"])
        if not geom.is_valid:
            geom = make_valid(geom)
        return {
            "id": payload.get("id"),
            "geometry": geom.__geo_interface__,
            "valid": True,
            "bbox": geom.bounds
        }
    except (ShapelyError, KeyError, TypeError) as e:
        return {"id": payload.get("id"), "error": str(e), "valid": False}

# 2. Async consumer loop
async def process_geometry_queue(
    queue: asyncio.Queue,
    executor: ProcessPoolExecutor,
    batch_size: int = 50,
    timeout: float = 10.0
) -> None:
    loop = asyncio.get_running_loop()
    
    while True:
        payload = await queue.get()
        try:
            # Offload to process pool; event loop remains unblocked
            result = await asyncio.wait_for(
                loop.run_in_executor(executor, validate_geometry, payload),
                timeout=timeout
            )
            # TODO: Route `result` to PostGIS, S3, or downstream service
            logging.info(f"Processed geometry {result.get('id')}")
        except asyncio.TimeoutError:
            logging.warning(f"Timeout validating geometry {payload.get('id')}")
        except Exception as e:
            logging.error(f"Queue processing failed: {e}")
        finally:
            queue.task_done()
```

Key implementation details:
- **GIL bypass**: `ProcessPoolExecutor` spawns separate Python interpreters, allowing true parallelism for GEOS-backed operations. See [Shapely's official manual](https://shapely.readthedocs.io/en/stable/manual.html) for geometry construction best practices.
- **Timeout enforcement**: `asyncio.wait_for()` prevents slow or malformed payloads from starving the consumer loop.
- **Serialization safety**: GeoJSON dictionaries are natively JSON-serializable, making them safe to pass across process boundaries. Avoid passing unpicklable objects like database connections or file handles.

## Tuning Executors for Spatial Throughput

Process pools introduce memory and context-switch overhead. Optimize throughput by aligning pool size with your deployment constraints:

- **CPU-bound sizing**: Set `max_workers` to `os.cpu_count()` or slightly lower. Oversubscribing processes increases memory pressure and degrades GEOS performance.
- **Payload chunking**: For FeatureCollections with >10,000 geometries, split payloads before queuing. Process pools perform best on uniform, bounded tasks.
- **Backpressure handling**: Monitor `queue.qsize()`. If the queue consistently hits capacity, scale consumers horizontally or implement circuit breakers to reject payloads gracefully.
- **Memory limits**: GEOS operations can temporarily allocate 3–5× the raw payload size. Use container memory limits and `ulimit` to prevent OOM kills during topology repairs.

## Common Pitfalls & Mitigations

| Pitfall | Symptom | Mitigation |
|---------|---------|------------|
| **Blocking the loop** | Webhook latency spikes under load | Never call `shapely` or `pyproj` directly in `async def` handlers |
| **Unpicklable errors** | `TypeError: cannot pickle '...' object` | Keep worker functions stateless; pass only dicts/strings |
| **Executor leak** | Memory grows indefinitely | Use `executor.shutdown(wait=True)` on app shutdown or SIGTERM |
| **Silent topology failures** | Invalid geometries reach PostGIS | Wrap workers in `try/except ShapelyError`; log and quarantine bad payloads |
| **Queue starvation** | Workers idle while queue backs up | Use `asyncio.gather()` to run multiple consumers concurrently |

## When to Use `ThreadPoolExecutor` Instead

`ThreadPoolExecutor` is appropriate only when your geometry pipeline relies on I/O-bound steps: fetching remote WFS tiles, querying external elevation APIs, or writing to network-attached storage. For coordinate math, ring validation, or projection transforms, threads share the GIL and will serialize execution. Stick to process pools for CPU-heavy spatial workloads.

## Summary

Optimizing async geometry parsing with asyncio hinges on strict separation of concerns: keep the event loop lightweight, queue raw payloads immediately, and delegate topology validation to isolated worker processes. By combining `asyncio.Queue`, `ProcessPoolExecutor`, and explicit timeout boundaries, you achieve webhook-scale concurrency without sacrificing spatial accuracy or risking event loop starvation.