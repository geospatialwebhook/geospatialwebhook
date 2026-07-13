<p align="center">
  <a href="https://www.geospatialwebhook.com">
    <img src="https://www.geospatialwebhook.com/og-image.png" alt="Geospatial Webhook — build event-driven spatial systems in Python" width="100%">
  </a>
</p>

<h1 align="center">Geospatial Webhook</h1>

<p align="center">
  <strong>The practical playbook for building event-driven geospatial systems in Python.</strong><br>
  Real-time feature changes, tile updates, and sensor payloads — routed, deduplicated,
  retried, and observed without losing data or double-writing features.
</p>

<p align="center">
  <a href="https://www.geospatialwebhook.com"><b>🌐 Read it live → www.geospatialwebhook.com</b></a>
</p>

---

## What this is

[**geospatialwebhook.com**](https://www.geospatialwebhook.com) is a deep, production-focused
reference for engineers who move spatial data through webhooks and event streams. Most
event-driven material assumes tidy JSON payloads; spatial data is messier — coordinate
reference systems drift, geometries are topologically equivalent but byte-different, GPS
jitter breaks naive hashing, and a single million-vertex multipolygon can stall an event
loop. This site covers the patterns that hold up under real production load, every one of
them backed by runnable Python.

It is written for **platform engineers, GIS backend developers, real-time spatial app
builders, and SaaS founders** who need pipelines that don't lose data, don't double-write
features, and stay observable at scale.

## What it covers

The material is organised into five areas, each starting with architecture, then concrete
Python implementations, then the operational hardening that separates a prototype from a
platform:

- **[Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/)** — pub/sub with geographic partitioning, event sourcing for spatial state, sensor routing, tile-update pipelines, webhook security boundaries, and spatial partitioning strategies (H3 / S2 / Quadkey).
- **[Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/)** — deterministic key generation, cache-backed checks, tolerance-based spatial overlap detection, and conflict resolution for repeated events.
- **[Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/)** — CRS normalization (with EPSG codes), geometry validation, GeoJSON ⇄ Protobuf mapping, and async parsing of heavy geometries.
- **[Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/)** — exponential backoff with jitter, dead-letter queues that preserve geometry context, broker selection and partitioning, and delivery/ordering semantics.
- **[Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/)** — geo-specific Prometheus metrics, consumer-lag and partition-skew detection, structured logging, and OpenTelemetry tracing across async geometry handlers.

Highlights include head-to-head comparisons engineers actually search for —
[H3 vs S2 vs Quadkey](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/h3-vs-s2-vs-quadkey-for-spatial-partitioning/),
[Redis Streams vs Kafka](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/redis-streams-vs-kafka-for-geospatial-webhooks/),
and [Protocol Buffers vs GeoJSON](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/protocol-buffers-vs-geojson-for-high-frequency-spatial-events/) —
plus webhook security depth on HMAC-SHA256 signing, IP allowlisting, and replay-attack prevention.

## How it's built

- **[Eleventy (11ty)](https://www.11ty.dev/)** static site generator — content authored in Markdown with Nunjucks templates.
- Hand-authored, theme-adaptive inline **SVG** diagrams; syntax-highlighted Python via Prism.
- Structured data (`Article`, `BreadcrumbList`, `HowTo`, `FAQPage`) on every page.
- Deployed to **[Cloudflare Pages](https://pages.cloudflare.com/)**.

```bash
npm install      # install dependencies
npm run build    # build the static site into _site/
npm run serve    # local dev server with live reload
npm run deploy    # build + deploy to Cloudflare Pages
```

## Commits

All commits to this repository are made by the **`geospatialwebhook`** account only.
Commits carry no co-author trailer and no other identities — a single, consistent author
for the whole history.

## License

© 2026 Geospatial Webhook. All rights reserved.
