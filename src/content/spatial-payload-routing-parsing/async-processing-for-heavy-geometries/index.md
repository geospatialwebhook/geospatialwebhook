---
title: "Async Processing for Heavy Geometries"
description: "Decouple CPU-bound spatial operations from I/O-bound webhook ingestion in Python: async dispatch, ProcessPoolExecutor, memory-safe parsing, Pydantic validation, and failure recovery."
slug: "async-processing-for-heavy-geometries"
type: "guide"
breadcrumb: "Spatial Payload Routing & Parsing › Async Processing for Heavy Geometries"
datePublished: "2025-11-12"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Async Processing for Heavy Geometries",
      "description": "Decouple CPU-bound spatial operations from I/O-bound webhook ingestion in Python: async dispatch, ProcessPoolExecutor, memory-safe parsing, Pydantic validation, and failure recovery.",
      "datePublished": "2025-11-12",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/" },
        { "@type": "ListItem", "position": 2, "name": "Spatial Payload Routing & Parsing", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/" },
        { "@type": "ListItem", "position": 3, "name": "Async Processing for Heavy Geometries", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Async Processing for Heavy Geometries",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Async ingestion and immediate acknowledgment" },
        { "@type": "HowToStep", "position": 2, "name": "Task dispatch to a process pool" },
        { "@type": "HowToStep", "position": 3, "name": "Topology validation and CRS normalization" },
        { "@type": "HowToStep", "position": 4, "name": "Coordinate transformation and serialization" },
        { "@type": "HowToStep", "position": 5, "name": "Result persistence and event-driven callbacks" }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "When should I use ProcessPoolExecutor instead of ThreadPoolExecutor for geometry work?",
          "acceptedAnswer": { "@type": "Answer", "text": "Use ProcessPoolExecutor whenever geometry operations are CPU-bound — topology repair with make_valid, coordinate projection loops, or spatial joins over thousands of features. These operations are blocked by Python's GIL and need true OS-level parallelism. ThreadPoolExecutor is suitable only for I/O-bound steps like writing results to PostGIS or publishing to Redis." }
        },
        {
          "@type": "Question",
          "name": "How do I prevent memory spikes when deserializing large GeoJSON payloads?",
          "acceptedAnswer": { "@type": "Answer", "text": "Use ijson for iterative streaming deserialization — it emits geometry objects one at a time without loading the full document into RAM. Pair this with chunked dispatch: split feature collections into coordinate-bounded batches before sending to the worker pool." }
        },
        {
          "@type": "Question",
          "name": "How do I handle mixed CRS payloads in an async pipeline?",
          "acceptedAnswer": { "@type": "Answer", "text": "Detect the source CRS from the payload's crs property or a vendor-specific header, then normalize to EPSG:4326 (WGS 84) inside the worker function before any topology checks. Refusing to dispatch until CRS is resolved prevents silent coordinate corruption in downstream spatial indexes." }
        },
        {
          "@type": "Question",
          "name": "What is a safe timeout for a geometry worker process?",
          "acceptedAnswer": { "@type": "Answer", "text": "Set a per-task timeout via asyncio.wait_for wrapping run_in_executor. A ceiling of 30 seconds works for most polygon simplification and validation workloads; complex union/intersection operations over dense point clouds may need up to 120 seconds. Route timed-out tasks to a dead-letter queue rather than retrying synchronously." }
        }
      ]
    }
  ]
}
</script>

**Use async dispatch to a `ProcessPoolExecutor` to acknowledge a spatial webhook in milliseconds while heavy geometry parsing, validation, and projection happen off the event loop in a separate OS process.**

This implementation guide is part of [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/), the section covering how GeoJSON and binary geometry payloads are ingested, classified, validated, and forwarded to spatial consumers.

---

## Prerequisites

Before building an asynchronous geometry pipeline, confirm your environment meets these baseline requirements:

- [ ] **Python 3.10+** — required for `asyncio.to_thread`, structural pattern matching, and stable `ExceptionGroup` handling.
- [ ] **Shapely 2.0+** — built on GEOS 3.10+, which provides thread-safe geometry objects and the `make_valid` function for topology repair.
- [ ] **pyproj 3.4+** — for CRS detection and coordinate transformation via the PROJ 9 bindings.
- [ ] **FastAPI 0.100+ or aiohttp 3.9+** — non-blocking HTTP framework for the ingestion endpoint.
- [ ] **Pydantic v2** — for schema-validated payload parsing before dispatch.
- [ ] **ijson 3.2+** — for streaming JSON deserialization of large feature collections without loading the full document into RAM.
- [ ] **Redis 7+ or RabbitMQ 3.12+** — optional but recommended for durable task queuing and backpressure management between the HTTP layer and the worker pool.

---

## Architecture Overview

The pipeline separates concerns into four layers. The webhook endpoint only performs lightweight I/O; all CPU work happens downstream in isolated processes.

<figure class="fig">
<svg viewBox="6 0 708 324" role="img" aria-label="Four-layer async geometry pipeline: HTTP ingestion, queue, worker pool, and persistence" xmlns="http://www.w3.org/2000/svg">
  <title>Async Geometry Pipeline Architecture</title>
  <desc>Four-layer pipeline showing data flow from webhook HTTP ingestion through a message queue, into a ProcessPoolExecutor worker pool for spatial validation and projection, then to a PostGIS database and event callback.</desc>
  <rect x="6" y="0" width="708" height="324" fill="var(--fig-bg)"/>
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Layer boxes -->
  <rect x="20" y="30" width="140" height="280" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"/>
  <rect x="190" y="30" width="140" height="280" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"/>
  <rect x="360" y="30" width="175" height="280" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"/>
  <rect x="555" y="30" width="145" height="280" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"/>
  <!-- Layer headings -->
  <text x="90" y="22" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" opacity="0.7">1 · Ingestion</text>
  <text x="260" y="22" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" opacity="0.7">2 · Queue</text>
  <text x="447" y="22" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" opacity="0.7">3 · Worker Pool</text>
  <text x="627" y="22" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" opacity="0.7">4 · Persistence</text>
  <!-- Ingestion layer items -->
  <rect x="35" y="60" width="110" height="40" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="90" y="76" text-anchor="middle" font-size="10" fill="currentColor">POST /webhook</text>
  <text x="90" y="90" text-anchor="middle" font-size="10" fill="currentColor">/spatial</text>
  <rect x="35" y="118" width="110" height="38" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="90" y="133" text-anchor="middle" font-size="10" fill="currentColor">Header validate</text>
  <text x="90" y="147" text-anchor="middle" font-size="10" fill="currentColor">HMAC · size guard</text>
  <rect x="35" y="174" width="110" height="36" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="90" y="189" text-anchor="middle" font-size="10" fill="currentColor">202 Accepted</text>
  <text x="90" y="203" text-anchor="middle" font-size="10" fill="currentColor">&lt;100 ms</text>
  <!-- Queue layer items -->
  <rect x="205" y="60" width="110" height="40" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="260" y="76" text-anchor="middle" font-size="10" fill="currentColor">Redis Stream</text>
  <text x="260" y="90" text-anchor="middle" font-size="10" fill="currentColor">or RabbitMQ</text>
  <rect x="205" y="118" width="110" height="38" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="260" y="133" text-anchor="middle" font-size="10" fill="currentColor">Async consumer</text>
  <text x="260" y="147" text-anchor="middle" font-size="10" fill="currentColor">pulls raw bytes</text>
  <rect x="205" y="174" width="110" height="36" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="260" y="189" text-anchor="middle" font-size="10" fill="currentColor">Dead-letter queue</text>
  <text x="260" y="203" text-anchor="middle" font-size="10" fill="currentColor">on max retries</text>
  <!-- Worker layer items -->
  <rect x="375" y="60" width="145" height="40" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="447" y="76" text-anchor="middle" font-size="10" fill="currentColor">ProcessPoolExecutor</text>
  <text x="447" y="90" text-anchor="middle" font-size="10" fill="currentColor">max_workers = CPU count</text>
  <rect x="375" y="118" width="145" height="38" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="447" y="133" text-anchor="middle" font-size="10" fill="currentColor">Shapely topology repair</text>
  <text x="447" y="147" text-anchor="middle" font-size="10" fill="currentColor">+ pyproj CRS transform</text>
  <rect x="375" y="174" width="145" height="36" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="447" y="189" text-anchor="middle" font-size="10" fill="currentColor">Pydantic schema</text>
  <text x="447" y="203" text-anchor="middle" font-size="10" fill="currentColor">validation</text>
  <rect x="375" y="228" width="145" height="36" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="447" y="243" text-anchor="middle" font-size="10" fill="currentColor">ijson streaming</text>
  <text x="447" y="257" text-anchor="middle" font-size="10" fill="currentColor">for large payloads</text>
  <!-- Persistence layer items -->
  <rect x="570" y="60" width="115" height="40" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="627" y="76" text-anchor="middle" font-size="10" fill="currentColor">PostGIS / MongoDB</text>
  <text x="627" y="90" text-anchor="middle" font-size="10" fill="currentColor">spatial index write</text>
  <rect x="570" y="118" width="115" height="38" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="627" y="133" text-anchor="middle" font-size="10" fill="currentColor">Completion event</text>
  <text x="627" y="147" text-anchor="middle" font-size="10" fill="currentColor">to consumers</text>
  <rect x="570" y="174" width="115" height="36" rx="5" fill="currentColor" opacity="0.08"/>
  <text x="627" y="189" text-anchor="middle" font-size="10" fill="currentColor">Status callback</text>
  <text x="627" y="203" text-anchor="middle" font-size="10" fill="currentColor">to client</text>
  <!-- Connecting arrows -->
  <line x1="160" y1="155" x2="189" y2="155" stroke="currentColor" stroke-width="1.4" marker-end="url(#arrow)" opacity="0.55"/>
  <line x1="330" y1="155" x2="359" y2="155" stroke="currentColor" stroke-width="1.4" marker-end="url(#arrow)" opacity="0.55"/>
  <line x1="535" y1="155" x2="554" y2="155" stroke="currentColor" stroke-width="1.4" marker-end="url(#arrow)" opacity="0.55"/>
</svg>
<figcaption><b>Figure 1.</b> Async Geometry Pipeline Architecture</figcaption>
</figure>

**Layer 1 — Ingestion:** The FastAPI endpoint receives raw bytes, validates the HMAC signature and `Content-Length`, publishes the payload to the queue, and responds `202 Accepted` in under 100 ms.

<figure class="fig">
<svg viewBox="0 0 760 228" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="What a 202 Accepted response promises and what it does not, with the completion path that closes the gap">
<title>202 Accepted moves the promise, it does not remove it</title>
<desc>Returning 202 in under a hundred milliseconds tells the sender the payload is durably queued and will not be lost, which is what stops its retry timer and prevents a retry storm. It does not tell the sender that the geometry was valid, that it was written, or that any tile was rebuilt — all of which happen later and can still fail. Three things close that gap. The signature and content-length must be verified before the 202, because rejecting a forged or oversized payload afterwards is impossible once you have promised to process it. The queue write must be durable before the 202, or the promise is a lie the moment a worker restarts. And a completion path — a status callback, a completion event, or a queryable job id returned in the response — has to exist, because otherwise a payload that fails validation in the worker disappears with the sender still believing it succeeded.</desc>
<rect x="0" y="0" width="760" height="228" fill="var(--fig-bg)"/>
<rect x="14" y="30" width="352" height="86" rx="7" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="50" font-size="10" font-weight="600" fill="var(--fig-ink)">What the 202 does promise</text>
<text x="26" y="70" font-size="9" fill="var(--fig-ink-soft)">the payload is durably queued and will not be lost</text>
<text x="26" y="86" font-size="9" fill="var(--fig-mint-edge)">which is what stops the sender's retry timer</text>
<text x="26" y="106" font-size="8.5" fill="var(--fig-ink-soft)">and therefore what prevents a retry storm at the ingress</text>
<rect x="386" y="30" width="360" height="86" rx="7" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="398" y="50" font-size="10" font-weight="600" fill="var(--fig-ink)">What it does not promise</text>
<text x="398" y="70" font-size="9" fill="var(--fig-ink-soft)">that the geometry is valid · that it was written</text>
<text x="398" y="86" font-size="9" fill="var(--fig-ink-soft)">that any tile was rebuilt</text>
<text x="398" y="106" font-size="8.5" fill="var(--fig-rose-edge)">all of which happen later and can still fail</text>
<rect x="14" y="130" width="238" height="42" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="26" y="147" font-size="9" font-weight="600" fill="var(--fig-ink)">verify before the 202</text>
<text x="26" y="163" font-size="8.5" fill="var(--fig-ink-soft)">signature and Content-Length — you cannot</text>
<text x="26" y="172" font-size="8.5" fill="var(--fig-ink-soft)">reject after promising to process</text>
<rect x="260" y="130" width="238" height="42" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="272" y="147" font-size="9" font-weight="600" fill="var(--fig-ink)">durable before the 202</text>
<text x="272" y="163" font-size="8.5" fill="var(--fig-ink-soft)">an in-memory queue makes the promise</text>
<text x="272" y="172" font-size="8.5" fill="var(--fig-ink-soft)">a lie the moment a worker restarts</text>
<rect x="506" y="130" width="240" height="42" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="518" y="147" font-size="9" font-weight="600" fill="var(--fig-ink)">a completion path</text>
<text x="518" y="163" font-size="8.5" fill="var(--fig-ink-soft)">callback, completion event, or a job id</text>
<text x="518" y="172" font-size="8.5" fill="var(--fig-ink-soft)">the sender can query</text>
<rect x="14" y="186" width="732" height="34" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="203" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Without the third, a payload that fails validation in the worker disappears while the sender believes it succeeded.</text>
<text x="26" y="215" font-size="9" fill="var(--fig-ink-soft)">That is the trade 202 makes: you buy ingress latency by taking on the obligation to report the outcome some other way.</text>
</svg>
<figcaption><b>Figure 2.</b> Async acceptance converts a synchronous failure the sender would have seen into one only you can see. The completion path is not optional polish — it is the other half of what <code>202</code> commits you to.</figcaption>
</figure>

**Layer 2 — Queue:** An async consumer reads from Redis Streams or RabbitMQ. This buffer absorbs traffic spikes and decouples ingestion throughput from worker capacity. Tasks that exceed the retry ceiling move to a dead-letter queue for inspection.

**Layer 3 — Worker Pool:** A `ProcessPoolExecutor` runs topology repair (`make_valid`), CRS normalization to EPSG:4326 (WGS 84), Pydantic schema validation, and coordinate transformation in separate OS processes, bypassing the GIL entirely.

<figure class="fig">
<svg viewBox="0 0 760 234" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A CPU-bound geometry repair blocking the event loop, compared with the same work in a process pool">
<title>Why a thread pool does not help here and a process pool does</title>
<desc>A 900-millisecond make_valid call arriving alongside ordinary point traffic. Run directly in the coroutine it holds the event loop for the full 900 milliseconds, so every other request — including health checks — waits. Moved to a thread pool it still holds the GIL, because shapely's repair is CPU-bound Python and C that does not release it for the whole call, so the event loop is starved almost as badly and the only thing gained is a more confusing stack trace. Moved to a ProcessPoolExecutor the work runs in a separate interpreter with its own GIL, the event loop stays responsive throughout, and acceptance latency is unaffected. The cost is that arguments and results cross a process boundary by pickling, which is why the worker is given raw bytes and returns a compact summary rather than being handed a live shapely object.</desc>
<rect x="0" y="0" width="760" height="234" fill="var(--fig-bg)"/>
<text x="14" y="20" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">in the coroutine</text>
<rect x="150" y="28" width="470" height="22" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="160" y="43" font-size="8.5" fill="var(--fig-ink)">make_valid — 900 ms, event loop held</text>
<text x="628" y="43" font-size="8.5" fill="var(--fig-rose-edge)">everything waits</text>
<text x="14" y="72" font-size="9.5" font-weight="600" fill="var(--fig-gold-edge)">thread pool</text>
<rect x="150" y="80" width="450" height="22" rx="3" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="160" y="95" font-size="8.5" fill="var(--fig-ink)">make_valid — still holds the GIL for the whole call</text>
<text x="608" y="95" font-size="8.5" fill="var(--fig-gold-edge)">loop still starved</text>
<text x="14" y="124" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">process pool</text>
<rect x="150" y="132" width="24" height="22" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="182" y="147" font-size="8.5" fill="var(--fig-ink-soft)">pickle in</text>
<rect x="240" y="132" width="24" height="22" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="272" y="147" font-size="8.5" fill="var(--fig-ink-soft)">pickle out</text>
<rect x="150" y="160" width="470" height="18" rx="3" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.1"/>
<text x="160" y="173" font-size="8" fill="var(--fig-ink-soft)">make_valid runs in a separate interpreter, with its own GIL</text>
<text x="628" y="147" font-size="8.5" fill="var(--fig-mint-edge)">loop stays responsive</text>
<rect x="14" y="192" width="366" height="38" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="26" y="209" font-size="9.5" font-weight="600" fill="var(--fig-ink)">Threads help I/O, not this</text>
<text x="26" y="224" font-size="9" fill="var(--fig-ink-soft)">GEOS repair is CPU-bound and holds the GIL throughout.</text>
<rect x="394" y="192" width="352" height="38" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="406" y="209" font-size="9.5" font-weight="600" fill="var(--fig-ink)">What the process boundary costs</text>
<text x="406" y="224" font-size="9" fill="var(--fig-ink-soft)">Pass raw bytes and return a summary — never a live shapely object.</text>
</svg>
<figcaption><b>Figure 3.</b> The distinction that matters is whether the work releases the GIL. Geometry repair does not, so a thread pool moves the blocking without removing it — the process boundary is what actually buys responsiveness.</figcaption>
</figure>

**Layer 4 — Persistence:** Validated geometries are written to a spatially indexed store. A completion event notifies downstream consumers and can trigger a status callback to the originating client.

---

## Step-by-Step Implementation

### Step 1 — Non-Blocking Ingestion and Immediate Acknowledgment

The endpoint streams raw bytes without deserializing them. Validation is limited to the HTTP layer: check the `Content-Type`, enforce a `Content-Length` ceiling, and verify the HMAC-SHA256 signature. For details on constructing the signature check, see [Securing Webhook Endpoints with Spatial Token Validation](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/).

```python
import asyncio
import hashlib
import hmac
import logging
import os
from concurrent.futures import ProcessPoolExecutor

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks

app = FastAPI()
logger = logging.getLogger(__name__)

WEBHOOK_SECRET = os.environ["WEBHOOK_SECRET"].encode()
MAX_PAYLOAD_BYTES = 100 * 1024 * 1024  # 100 MB ceiling

# Pre-allocate the pool at startup to avoid cold-start latency per request.
WORKER_POOL = ProcessPoolExecutor(max_workers=os.cpu_count() or 4)


def _verify_hmac(body: bytes, signature_header: str | None) -> None:
    """Raise HTTP 401 if the HMAC-SHA256 signature does not match."""
    if not signature_header:
        raise HTTPException(status_code=401, detail="Missing X-Signature header")
    expected = "sha256=" + hmac.new(WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature_header):
        raise HTTPException(status_code=401, detail="Invalid signature")


@app.post("/webhook/spatial")
async def receive_spatial_payload(
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict:
    content_length = int(request.headers.get("content-length", 0))
    if content_length > MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Payload exceeds 100 MB limit")

    raw_bytes = await request.body()
    _verify_hmac(raw_bytes, request.headers.get("x-signature"))

    # Offload heavy geometry work; respond immediately.
    background_tasks.add_task(_dispatch_to_pool, raw_bytes)
    return {"status": "queued"}
```

### Step 2 — Dispatch to the Process Pool

`loop.run_in_executor` submits the CPU-bound worker to the pre-allocated `ProcessPoolExecutor`. The `await` suspends only this coroutine — the event loop remains free to handle other incoming requests.

```python
async def _dispatch_to_pool(payload: bytes) -> None:
    """Submit geometry processing to a separate OS process."""
    loop = asyncio.get_running_loop()
    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(WORKER_POOL, _process_geometry, payload),
            timeout=30.0,  # seconds; adjust for expected geometry complexity
        )
        logger.info("Worker finished: status=%s", result.get("status"))
    except TimeoutError:
        logger.error("Worker timed out — routing to dead-letter queue")
        await _send_to_dlq(payload)
    except Exception as exc:
        logger.exception("Worker raised unexpected exception: %s", exc)
        await _send_to_dlq(payload)
```

### Step 3 — Topology Validation and CRS Normalization

Each worker function is a plain top-level function (required by `pickle` serialization between processes). It validates the GeoJSON structure against [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946), repairs invalid topologies, and normalizes coordinates to EPSG:4326 (WGS 84) using pyproj. This mirrors the [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) pattern for enforcing a canonical projection before any downstream operation.

```python
import json
from typing import Any

from pyproj import CRS, Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform as shapely_transform
from shapely.validation import make_valid


def _reproject(geom, source_epsg: int):
    """Reproject a whole Shapely geometry to EPSG:4326 (WGS 84)."""
    transformer = Transformer.from_crs(
        CRS.from_epsg(source_epsg),
        CRS.from_epsg(4326),
        always_xy=True,  # GeoJSON is lon/lat, so force x=lon, y=lat ordering
    )
    # shapely.ops.transform walks every coordinate ring for us, so MultiPolygons
    # and GeometryCollections are reprojected in full — not just the bounds.
    return shapely_transform(transformer.transform, geom)


def _process_geometry(payload: bytes) -> dict[str, Any]:
    """CPU-bound worker: validate, repair, and normalize a GeoJSON feature."""
    try:
        data = json.loads(payload)
        if data.get("type") != "Feature" or "geometry" not in data:
            return {"status": "error", "message": "Payload is not a GeoJSON Feature"}

        geom = shape(data["geometry"])

        # Topology repair — make_valid returns a valid geometry without data loss.
        if not geom.is_valid:
            geom = make_valid(geom)

        # Detect a non-WGS84 source CRS from an optional vendor property and
        # reproject before persistence so every downstream index is EPSG:4326.
        source_epsg = data.get("properties", {}).get("source_epsg", 4326)
        if source_epsg != 4326:
            geom = _reproject(geom, source_epsg)

        return {
            "status": "success",
            "result": {
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {
                    **data.get("properties", {}),
                    "crs": "EPSG:4326",
                    "bbox": list(geom.bounds),
                    "is_valid": geom.is_valid,
                },
            },
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "message": str(exc)}
```

### Step 4 — Pydantic Schema Validation

Before the worker passes results to the persistence layer, validate the output schema with Pydantic v2. This catches malformed geometry objects that passed Shapely's topology check but violate the application-level contract — for example, `MultiPolygon` features that should have been split, or missing required property fields. This pairs naturally with [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) for a defense-in-depth validation strategy.

```python
from pydantic import BaseModel, Field, model_validator


class SpatialFeatureOut(BaseModel):
    type: str = Field(pattern="^Feature$")
    geometry: dict
    properties: dict

    @model_validator(mode="after")
    def check_geometry_type(self) -> "SpatialFeatureOut":
        allowed = {"Point", "LineString", "Polygon", "MultiPoint",
                   "MultiLineString", "MultiPolygon", "GeometryCollection"}
        if self.geometry.get("type") not in allowed:
            raise ValueError(f"Unsupported geometry type: {self.geometry.get('type')}")
        return self


def validate_output(result: dict) -> SpatialFeatureOut:
    """Raise ValidationError if the processed feature does not meet schema."""
    return SpatialFeatureOut.model_validate(result["result"])
```

### Step 5 — Streaming Deserialization for Large Feature Collections

For payloads exceeding 10 MB, replace `json.loads` with `ijson` to avoid heap spikes. The iterator emits one feature at a time, letting the worker dispatch each feature to a separate sub-task rather than holding the entire collection in memory.

```python
import io
import ijson


def _iter_features(payload: bytes):
    """Yield individual GeoJSON features without loading the full collection."""
    f = io.BytesIO(payload)
    parser = ijson.items(f, "features.item")
    for feature in parser:
        yield feature


def _process_feature_collection(payload: bytes) -> list[dict]:
    results = []
    for feature in _iter_features(payload):
        feature_bytes = json.dumps(feature).encode()
        results.append(_process_geometry(feature_bytes))
    return results
```

---

## Spatial Validation and Error Handling

Shapely's `is_valid` flag catches self-intersections, unclosed rings, and duplicate vertices — but it does not validate coordinate range or ring orientation under [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946). Add explicit guards:

```python
from shapely.geometry import shape
from shapely.validation import explain_validity


def full_validation_report(raw_geometry: dict) -> dict:
    """Return a structured validity report for a GeoJSON geometry object."""
    geom = shape(raw_geometry)
    coords = list(geom.geoms) if hasattr(geom, "geoms") else [geom]

    min_x, min_y, max_x, max_y = geom.bounds
    bbox_valid = (
        -180 <= min_x <= max_x <= 180  # longitude range, west <= east
        and -90 <= min_y <= max_y <= 90  # latitude range, south <= north
    )

    report = {
        "is_valid": geom.is_valid,
        "explanation": explain_validity(geom) if not geom.is_valid else None,
        "bbox_valid": bbox_valid,
        "geometry_type": geom.geom_type,
        "coordinate_count": sum(
            len(list(g.exterior.coords)) if hasattr(g, "exterior") else 0
            for g in coords
        ),
    }
    return report
```

Route features that fail `bbox_valid` directly to the dead-letter queue — they indicate corrupt coordinate data that topology repair cannot fix. Log the `explanation` field for every invalid geometry to enable rapid root-cause analysis without replaying the entire payload. This complements the [at-least-once delivery pattern](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/implementing-at-least-once-delivery-for-gis-webhooks/) where retries must not reprocess already-persisted features.

---

## Retry, Backoff, and Delivery Guarantees

Spatial workloads fail transiently (GEOS internal errors, database timeouts) and permanently (corrupt coordinate rings). Distinguish between these cases in the retry policy:

```python
import random
import asyncio


async def retry_with_backoff(
    payload: bytes,
    max_attempts: int = 4,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
) -> dict | None:
    """
    Retry geometry processing with exponential backoff and jitter.
    Returns None and routes to DLQ after max_attempts.
    """
    for attempt in range(1, max_attempts + 1):
        result = await _dispatch_to_pool(payload)
        if result and result.get("status") == "success":
            return result

        if attempt == max_attempts:
            logger.error(
                "Max retries reached after %d attempts — sending to DLQ", attempt
            )
            await _send_to_dlq(payload)
            return None

        delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
        jitter = random.uniform(0, delay * 0.2)
        logger.warning(
            "Attempt %d failed, retrying in %.2f s", attempt, delay + jitter
        )
        await asyncio.sleep(delay + jitter)

    return None
```

**At-least-once vs exactly-once:** The async pipeline above is at-least-once by default — a worker crash after processing but before acknowledgment will cause a re-delivery. To upgrade to effectively-once semantics, assign each payload a deterministic idempotency key (based on a hash of the raw bytes or a vendor-supplied event ID) and store it in Redis before writing to PostGIS. The [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) and [Cache-Backed Idempotency Checks](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/) pages cover this in detail.

---

## Verification

Run this integration test against a local FastAPI instance to confirm the end-to-end pipeline behaves correctly:

```python
import json
import time
import httpx
import pytest

SAMPLE_FEATURE = {
    "type": "Feature",
    "geometry": {
        "type": "Polygon",
        "coordinates": [[
            [-122.4194, 37.7749],
            [-122.4094, 37.7749],
            [-122.4094, 37.7849],
            [-122.4194, 37.7849],
            [-122.4194, 37.7749],
        ]]
    },
    "properties": {"source_epsg": 4326, "name": "test-polygon"}
}


@pytest.mark.asyncio
async def test_webhook_returns_202_immediately():
    payload = json.dumps(SAMPLE_FEATURE).encode()
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        t0 = time.monotonic()
        resp = await client.post(
            "/webhook/spatial",
            content=payload,
            headers={
                "content-type": "application/json",
                "x-signature": _compute_test_hmac(payload),
            },
        )
        elapsed = time.monotonic() - t0

    assert resp.status_code == 202
    assert resp.json()["status"] == "queued"
    # Endpoint must acknowledge before any geometry processing begins.
    assert elapsed < 0.5, f"Acknowledgment too slow: {elapsed:.3f} s"


def _compute_test_hmac(body: bytes) -> str:
    import hashlib, hmac, os
    secret = os.environ.get("WEBHOOK_SECRET", "test-secret").encode()
    digest = hmac.new(secret, body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"
```

Check the application logs after sending a test payload to confirm the worker completed successfully:

```
INFO     Worker finished: status=success
```

If you see `Worker timed out`, reduce `max_workers` or lower the `Content-Length` ceiling — a flooded process pool starves individual workers of CPU time.

---

## Troubleshooting

<div style="overflow-x:auto">

| Symptom | Likely spatial cause | Fix |
|---|---|---|
| Endpoint latency spikes above 500 ms | Synchronous JSON parsing blocking the event loop | Replace `json.loads` in the handler with `await request.body()` only; defer all parsing to the worker |
| Worker returns `TopologicalError` | Self-intersecting polygon rings in source data | Call `make_valid(geom)` before any spatial operation; log `explain_validity(geom)` to identify the ring |
| CRS mismatch after transformation | Source payload uses EPSG:3857 (Web Mercator) but worker assumes EPSG:4326 | Read the `source_epsg` property or a `X-Source-CRS` vendor header; reject payloads without explicit CRS declaration |
| `PicklingError` in ProcessPoolExecutor | Lambda or closure passed as worker function | Worker function must be a module-level `def`; closures cannot be serialized across process boundaries |
| Memory grows unbounded under load | Full feature collection loaded into RAM per request | Switch to `ijson` streaming deserialization; enforce the `MAX_PAYLOAD_BYTES` ceiling in the handler |
| Dead-letter queue fills faster than expected | Retry policy not distinguishing transient from permanent errors | Inspect the `message` field in failed results; route `ValidationError` outcomes directly to DLQ without retry |
| Worker pool exhausted under burst traffic | `max_workers` set too low for concurrent payload volume | Scale `max_workers` to `os.cpu_count()` and add a semaphore to cap concurrent in-flight dispatch calls |

</div>

---

## FAQ

<details class="faq">
<summary><strong>When should I use ProcessPoolExecutor instead of ThreadPoolExecutor for geometry work?</strong></summary>
<div class="faq__body">

Use `ProcessPoolExecutor` whenever geometry operations are CPU-bound — topology repair with `make_valid`, coordinate projection loops, or spatial joins over thousands of features. These operations are blocked by Python's GIL and need true OS-level parallelism. `ThreadPoolExecutor` is suitable only for I/O-bound steps like writing results to PostGIS or publishing to Redis Streams.

</div>
</details>

<details class="faq">
<summary><strong>How do I prevent memory spikes when deserializing large GeoJSON payloads?</strong></summary>
<div class="faq__body">

Use `ijson` for iterative streaming deserialization — it emits geometry objects one at a time without loading the full document into RAM. Pair this with chunked dispatch: split feature collections into coordinate-bounded batches before sending to the worker pool. For the [GeoJSON-to-Protobuf mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/) path, binary serialization also shrinks wire payload size by 60–80% before it reaches the ingestion endpoint.

</div>
</details>

<details class="faq">
<summary><strong>How do I handle mixed CRS payloads in an async pipeline?</strong></summary>
<div class="faq__body">

Detect the source CRS from the payload's `crs` property or a `X-Source-CRS` vendor header, then normalize to EPSG:4326 (WGS 84) inside the worker function before any topology checks. Refusing to dispatch until CRS is resolved prevents silent coordinate corruption in downstream spatial indexes. The full normalization workflow is covered in [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/).

</div>
</details>

<details class="faq">
<summary><strong>What is a safe timeout for a geometry worker process?</strong></summary>
<div class="faq__body">

Set a per-task timeout via `asyncio.wait_for` wrapping `run_in_executor`. A ceiling of 30 seconds works for most polygon simplification and validation workloads; complex union/intersection operations over dense point clouds may need up to 120 seconds. Route timed-out tasks to a dead-letter queue rather than retrying synchronously — a timeout usually signals a data pathology, not a transient failure.

</div>
</details>

---

## Related

- [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/) — parent section covering the full ingestion and routing architecture
- [Optimizing Async Geometry Parsing with asyncio](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/optimizing-async-geometry-parsing-with-asyncio/) — deep dive into asyncio integration patterns for this pipeline
- [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) — enforcing a canonical projection across mixed-CRS spatial event streams
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — defense-in-depth topology and schema checks before spatial indexing
- [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/) — deriving deterministic idempotency keys from GeoJSON feature hashes to prevent duplicate writes
