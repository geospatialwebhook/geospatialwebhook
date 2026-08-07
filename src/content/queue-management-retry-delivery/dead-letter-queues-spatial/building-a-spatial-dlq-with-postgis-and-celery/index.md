---
title: "Building a Spatial DLQ with PostGIS and Celery"
description: "Store dead-lettered spatial webhook events in a PostGIS table with nullable geometry and a JSONB payload, driven by Celery task failure hooks — with DDL, code, and tests."
slug: "building-a-spatial-dlq-with-postgis-and-celery"
type: "article"
breadcrumb:
  - label: "Queue Management, Retries & Delivery Guarantees"
    url: "/queue-management-retry-delivery/"
  - label: "Dead-Letter Queues for Spatial Payloads"
    url: "/queue-management-retry-delivery/dead-letter-queues-spatial/"
  - label: "Building a Spatial DLQ with PostGIS and Celery"
    url: "/queue-management-retry-delivery/dead-letter-queues-spatial/building-a-spatial-dlq-with-postgis-and-celery/"
datePublished: "2025-05-01"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Building a Spatial DLQ with PostGIS and Celery",
      "description": "Store dead-lettered spatial webhook events in a PostGIS table with nullable geometry and a JSONB payload, driven by Celery task failure hooks — with DDL, code, and tests.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/building-a-spatial-dlq-with-postgis-and-celery/",
      "datePublished": "2025-05-01",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Queue Management, Retries & Delivery Guarantees", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/" },
        { "@type": "ListItem", "position": 2, "name": "Dead-Letter Queues for Spatial Payloads", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/" },
        { "@type": "ListItem", "position": 3, "name": "Building a Spatial DLQ with PostGIS and Celery", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/building-a-spatial-dlq-with-postgis-and-celery/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Build a Spatial Dead-Letter Queue with PostGIS and Celery",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Create the PostGIS DLQ table", "text": "Define a table with a JSONB raw_payload column, a nullable geometry(Geometry,4326) column, and failure_stage, error, idempotency_key, attempt, and created_at columns, then add a partial GiST index on the geometry." },
        { "@type": "HowToStep", "position": 2, "name": "Wire Celery autoretry and on_failure", "text": "Configure the processing task with autoretry_for and max_retries so transient errors are retried, and override on_failure so the terminal failure writes one DLQ row." },
        { "@type": "HowToStep", "position": 3, "name": "Insert the dead-letter row", "text": "In on_failure, parse the geometry to EPSG:4326 WKT when it exists, otherwise insert NULL geometry, and record the failure_stage, error text, idempotency_key, and attempt count." },
        { "@type": "HowToStep", "position": 4, "name": "Query and triage failures", "text": "Group rows by failure_stage to prioritise triage, then replay or discard entries once the root cause is fixed." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why store dead-lettered spatial events in PostGIS instead of Redis or a broker DLQ?",
          "acceptedAnswer": { "@type": "Answer", "text": "A broker or Redis DLQ keeps the opaque message bytes but gives you no way to query by location or failure stage. Persisting to a PostGIS table with a real geometry column lets you run spatial queries over failures — for example counting dead letters inside a bounding box or clustering them by region — and gives durable, transactional storage that survives a broker flush." }
        },
        {
          "@type": "Question",
          "name": "Should the geometry column be nullable in a spatial DLQ?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes. Many failures happen before a valid geometry exists — malformed GeoJSON, a parse exception, or a CRS the pipeline rejects. If geometry were NOT NULL you could not record those failures at all, which defeats the purpose of a dead-letter queue. Keep geom nullable and use a partial GiST index that skips NULL rows." }
        },
        {
          "@type": "Question",
          "name": "How do I use Celery's on_failure hook to write a DLQ row?",
          "acceptedAnswer": { "@type": "Answer", "text": "Subclass Task (or use the task's bind=True self) and override on_failure(self, exc, task_id, args, kwargs, einfo). Celery calls it once, after autoretry_for has exhausted max_retries, so it runs exactly once per terminally failed message. Insert the DLQ row there rather than inside the task body." }
        },
        {
          "@type": "Question",
          "name": "What EPSG code should the DLQ geometry column use?",
          "acceptedAnswer": { "@type": "Answer", "text": "Store the DLQ geometry in EPSG:4326 (WGS84), the CRS mandated by RFC 7946 for GeoJSON, so every row shares one coordinate system regardless of the source payload's CRS. Reproject on the way in; a mismatched SRID makes bounding-box queries and index lookups silently wrong." }
        }
      ]
    }
  ]
}
</script>

**To build a spatial dead-letter queue, create a PostGIS table with a JSONB `raw_payload` column and a nullable `geometry(Geometry,4326)` column, then have a Celery task with `autoretry_for` write one row from its `on_failure` hook once retries are exhausted — storing the untouched payload, the parsed geometry when it exists, and the `failure_stage` that killed the message.** This keeps every unprocessable spatial event durable, queryable by location, and ready for triage or replay.

This page sits within [Dead-Letter Queues for Spatial Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/), part of the broader [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/) — the reference section for keeping spatial webhook pipelines reliable under failure.

---

## When to use this pattern

Reach for a PostGIS-backed DLQ when:

- You run Celery workers that process GeoJSON or WKT webhooks and need failed messages to survive a broker restart, so an in-memory or broker-native dead-letter mechanism is not durable enough.
- You want to triage failures *by location or by stage* — "how many parse failures landed inside this bounding box last night?" — which requires a real geometry column and structured failure metadata, not opaque message bytes.
- You already operate PostgreSQL with PostGIS as your spatial store, so reusing it for dead letters avoids adding another system.

It is **not** the right tool when your failures are almost entirely transient (network blips, brief downstream outages) — those belong in a retry policy, not a DLQ. Persisting every retryable error to PostGIS just creates table churn and index bloat. Dead-letter only what is *terminally* unprocessable.

---

## Why a spatial DLQ needs its own schema

A generic dead-letter queue stores the raw message and an error string. That is enough to replay a text payload, but it throws away everything that makes a spatial event debuggable. When a geofence-crossing event fails, you want to know *where* it was and *at which stage* it broke — during envelope parsing, geometry validation, CRS normalization, or the downstream write.

Two design decisions carry the schema. First, `raw_payload` is `JSONB`, not `TEXT`: it preserves the exact bytes for replay while still being queryable (`raw_payload->'properties'->>'sensor_id'`). Second, `geom` is **nullable**. Failures cluster into two families — those that occur *after* a geometry was parsed (validation, downstream write) carry a real geometry, and those that occur *before* it existed (malformed GeoJSON, unknown CRS, a parse exception) have nothing to store. A `NOT NULL` column would make the earliest, most common failures impossible to record. The `failure_stage` column captures that distinction explicitly so triage does not depend on guessing from the error text.

The diagram below shows where the DLQ write sits relative to Celery's retry loop.

<figure class="fig">
<svg viewBox="0 45 760 164" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Celery task retry loop feeding a PostGIS dead-letter queue">
  <title>Celery retry loop feeding a PostGIS spatial DLQ</title>
  <desc>A spatial webhook enters a Celery task. On a transient error the task is retried via autoretry_for up to max_retries. When retries are exhausted, the on_failure hook writes one row into a PostGIS dlq table with a nullable geometry column and a failure_stage label.</desc>
  <rect x="0" y="45" width="760" height="164" fill="var(--fig-bg)"/>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L8,3.5 Z" fill="currentColor" opacity="0.55"/>
    </marker>
  </defs>
  <!-- Box 1: Webhook in -->
  <rect x="8" y="110" width="120" height="70" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="68" y="140" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Spatial event</text>
  <text x="68" y="156" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">GeoJSON body</text>
  <line x1="128" y1="145" x2="150" y2="145" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 2: Celery task -->
  <rect x="152" y="110" width="140" height="70" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="222" y="135" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Celery task</text>
  <text x="222" y="151" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">parse → validate</text>
  <text x="222" y="165" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">→ write</text>
  <!-- retry loop -->
  <path d="M222 110 C 222 60, 300 60, 300 110" fill="none" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="300" y="70" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">autoretry_for</text>
  <text x="300" y="84" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.55">≤ max_retries</text>
  <line x1="292" y1="145" x2="330" y2="145" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 3: on_failure -->
  <rect x="332" y="110" width="150" height="70" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="407" y="135" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">on_failure</text>
  <text x="407" y="151" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">retries exhausted</text>
  <text x="407" y="165" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">runs once</text>
  <line x1="482" y1="145" x2="520" y2="145" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Box 4: PostGIS DLQ -->
  <rect x="522" y="95" width="228" height="100" rx="8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="636" y="120" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">PostGIS dlq table</text>
  <text x="636" y="138" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">raw_payload JSONB</text>
  <text x="636" y="153" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">geom (4326, nullable)</text>
  <text x="636" y="168" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">failure_stage · error</text>
  <text x="636" y="183" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.5">GiST index (WHERE geom NOT NULL)</text>
</svg>
<figcaption><b>Figure 1.</b> Celery retry loop feeding a PostGIS spatial DLQ</figcaption>
</figure>

---

## Complete runnable implementation

### 1. The PostGIS DLQ table

The DDL below creates the table and a **partial** GiST index — partial so rows with `NULL` geometry (the pre-parse failures) do not bloat the index. `failure_stage` gets a plain B-tree index because triage almost always filters or groups on it.

```sql
-- Requires PostGIS: CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE spatial_dlq (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    raw_payload     JSONB                     NOT NULL,   -- exact bytes for replay
    geom            geometry(Geometry, 4326),             -- nullable: parse may fail first
    failure_stage   TEXT                      NOT NULL,   -- envelope | parse | validate | crs | downstream
    error           TEXT                      NOT NULL,   -- exception class + message
    idempotency_key TEXT,                                 -- links back to the original event
    attempt         INTEGER                   NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ               NOT NULL DEFAULT now()
);

-- Partial GiST index: only real geometries are indexed, so NULL-geom
-- rows (pre-parse failures) never enter the spatial index.
CREATE INDEX spatial_dlq_geom_gix
    ON spatial_dlq USING GIST (geom)
    WHERE geom IS NOT NULL;

-- Triage almost always filters/groups by stage.
CREATE INDEX spatial_dlq_stage_idx ON spatial_dlq (failure_stage);
```

PostGIS's `geometry(Geometry, 4326)` accepts any geometry type constrained to EPSG:4326 (WGS84), so points, polygons, and collections all share one column without a per-type table.

### 2. The Celery task with `autoretry_for` + `on_failure`

```python
import json
import logging

import psycopg2
from psycopg2.extras import Json
from celery import Celery
from shapely.geometry import shape
from shapely.errors import ShapelyError

log = logging.getLogger(__name__)
app = Celery("spatial", broker="redis://localhost:6379/0")

DSN = "dbname=events user=worker host=localhost"

_INSERT_DLQ = """
    INSERT INTO spatial_dlq
        (raw_payload, geom, failure_stage, error, idempotency_key, attempt)
    VALUES
        (%(raw)s,
         CASE WHEN %(wkt)s IS NULL THEN NULL
              ELSE ST_SetSRID(ST_GeomFromText(%(wkt)s), 4326) END,
         %(stage)s, %(error)s, %(key)s, %(attempt)s)
"""


class TransientError(Exception):
    """Retryable: downstream timeout, connection reset, 5xx, etc."""


def _extract_wkt(payload: dict) -> str | None:
    """
    Return EPSG:4326 WKT for the payload geometry, or None if it cannot
    be parsed. Failures here legitimately produce a NULL-geometry DLQ row.
    """
    try:
        geom = payload.get("geometry")
        if not geom:                      # geometry may be absent or JSON null
            return None
        return shape(geom).wkt            # assumes payload already in EPSG:4326
    except (ShapelyError, ValueError, TypeError):
        return None


def _write_dlq(payload: dict, stage: str, error: str,
               key: str | None, attempt: int) -> None:
    with psycopg2.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute(_INSERT_DLQ, {
            "raw": Json(payload),
            "wkt": _extract_wkt(payload),
            "stage": stage,
            "error": error[:2000],        # cap error text to avoid TOAST churn
            "key": key,
            "attempt": attempt,
        })


class SpatialTask(app.Task):
    # Retry transient errors automatically with capped exponential backoff.
    autoretry_for = (TransientError,)
    retry_backoff = True
    retry_backoff_max = 300
    retry_jitter = True
    max_retries = 5

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """
        Celery calls this exactly once, after autoretry_for exhausts
        max_retries (or on a non-retryable error). Write the DLQ row here,
        never inside the task body, so transient retries don't dead-letter.
        """
        payload = kwargs.get("payload") or (args[0] if args else {})
        stage = getattr(exc, "stage", "unknown")
        _write_dlq(
            payload=payload,
            stage=stage,
            error=f"{type(exc).__name__}: {exc}",
            key=kwargs.get("idempotency_key"),
            attempt=self.request.retries,
        )
        log.warning("dead-lettered task=%s stage=%s", task_id, stage)


@app.task(bind=True, base=SpatialTask)
def process_spatial_event(self, payload: dict, idempotency_key: str | None = None):
    # Stage: parse. A malformed geometry raises before geom exists -> NULL geom row.
    try:
        geom = shape(payload["geometry"])
    except (KeyError, ShapelyError, ValueError, TypeError) as exc:
        exc.stage = "parse"               # non-retryable: bad data won't fix itself
        raise
    # Stage: validate. Invalid topology is terminal, not retryable.
    if not geom.is_valid:
        err = ValueError(f"invalid geometry: {geom.is_valid_reason}")
        err.stage = "validate"
        raise err
    # Stage: downstream. Timeouts are transient -> autoretry_for handles them.
    _persist_feature(payload, geom)       # may raise TransientError(stage="downstream")
```

### 3. Query failures by stage

```sql
-- Triage dashboard: which stages are failing, and where?
SELECT
    failure_stage,
    count(*)                                   AS failures,
    count(geom)                                AS with_geometry,   -- NULLs excluded
    max(created_at)                            AS latest
FROM spatial_dlq
WHERE created_at >= now() - INTERVAL '24 hours'
GROUP BY failure_stage
ORDER BY failures DESC;
```

Because `geom` is nullable, `count(geom)` counts only rows that reached a real geometry — the gap between `count(*)` and `count(geom)` tells you how many events died *before* parsing, which is usually the most urgent signal.

---

## Parameter reference

<div style="overflow-x:auto;">

| Column / arg | Type | Role | Spatial constraint |
|---|---|---|---|
| `raw_payload` | `JSONB` | Exact original bytes, for replay and forensic queries | Keep untouched; do not reproject before storing |
| `geom` | `geometry(Geometry,4326)` | Parsed geometry when one exists | **Nullable**; must be EPSG:4326 (WGS84) — reproject upstream |
| `failure_stage` | `TEXT` | Which pipeline stage killed the message | Use a fixed vocabulary: `envelope`, `parse`, `validate`, `crs`, `downstream` |
| `error` | `TEXT` | Exception class + message | Cap length (e.g. 2000 chars) to avoid TOAST/index churn |
| `idempotency_key` | `TEXT` | Links the dead letter to the original event | Nullable — some failures occur before the key is computed |
| `attempt` | `INTEGER` | Retry count at time of dead-lettering (`self.request.retries`) | — |
| `created_at` | `TIMESTAMPTZ` | Dead-letter timestamp | Default `now()`; index if you purge by age |
| `autoretry_for` | `tuple[Exception]` | Exceptions Celery retries before dead-lettering | Only transient errors; never data-shape errors |
| `max_retries` | `int` | Retries before `on_failure` fires | Balance against provider retry budget |

</div>

---

## Gotchas and spatial edge cases

1. **Storing giant geometries inline bloats the table.** A single high-vertex MultiPolygon can be megabytes. Persisting many of them inline in `geom` and `raw_payload` inflates row size, forces PostgreSQL into TOAST storage, and slows sequential triage scans. For oversized payloads, store the raw body in object storage (S3/GCS) and keep only a reference plus a simplified `ST_Simplify` geometry in the DLQ row.

2. **`NULL` geometry when parsing failed before a geometry existed.** This is the whole reason `geom` is nullable. A malformed GeoJSON string, an unknown CRS, or a `KeyError` on `geometry` all fail *before* Shapely produces anything. The `on_failure` path must insert `NULL` for `geom` in those cases rather than raising a second exception — validate the WKT extraction returns `None` gracefully, as `_extract_wkt` does above.

3. **EPSG assumptions silently corrupt spatial queries.** `_extract_wkt` assumes the payload is already EPSG:4326 (WGS84). If a source sends EPSG:3857 (Web Mercator) coordinates and you insert them as SRID 4326, every bounding-box query and GiST lookup is wrong without erroring. Reproject to EPSG:4326 before storing, or record the source CRS in `raw_payload` and reproject at read time. The [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) covers CRS-aware validation you can run *before* the DLQ write.

4. **GiST index bloat from churn.** A DLQ is high-insert, high-delete: you dead-letter rows, then delete them after replay. GiST indexes fragment under that pattern. The partial index (`WHERE geom IS NOT NULL`) already shrinks it, but also schedule periodic `REINDEX` (or use `pg_repack` online) and run `VACUUM` so dead tuples are reclaimed.

5. **Dead-lettering inside the task body instead of `on_failure`.** If you write the DLQ row in a `try/except` inside the task, a *retryable* error gets dead-lettered on the first attempt — before `autoretry_for` ever runs. Always insert from `on_failure`, which Celery invokes once, after retries are exhausted.

6. **Invalid geometry passed to `ST_GeomFromText`.** If you try to store an invalid-but-parseable geometry (self-intersecting polygon) directly, some PostGIS operations error later. Store it as-is for forensics (it *is* a failure record), but never let the DLQ write itself throw — wrap it, and fall back to `NULL` geom plus the WKT in `raw_payload` if the insert rejects the geometry.

---

## Verification

Insert a failure through the task's `on_failure` path and assert the row landed with the expected stage and a `NULL` geometry for a pre-parse failure. This uses `pytest` against a live PostGIS database (a testcontainer or a disposable schema).

```python
import psycopg2
import pytest
from psycopg2.extras import Json

from your_module import _write_dlq, DSN  # adjust import path


@pytest.fixture
def clean_dlq():
    with psycopg2.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE spatial_dlq RESTART IDENTITY;")
    yield


def test_pre_parse_failure_stores_null_geometry(clean_dlq):
    """A payload with no valid geometry must dead-letter with geom IS NULL."""
    bad_payload = {"type": "Feature", "geometry": "not-a-geometry"}
    _write_dlq(bad_payload, stage="parse",
               error="ShapelyError: malformed", key="evt-1", attempt=3)

    with psycopg2.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT failure_stage, geom IS NULL, attempt, idempotency_key
            FROM spatial_dlq WHERE idempotency_key = %s
        """, ("evt-1",))
        stage, geom_is_null, attempt, key = cur.fetchone()

    assert stage == "parse"
    assert geom_is_null is True        # pre-parse failure -> NULL geometry
    assert attempt == 3
    assert key == "evt-1"


def test_validate_failure_stores_geometry(clean_dlq):
    """A payload that parsed but failed validation keeps a real geometry."""
    payload = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [-73.965355, 40.782865]},
    }
    _write_dlq(payload, stage="validate",
               error="ValueError: invalid topology", key="evt-2", attempt=5)

    with psycopg2.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT ST_SRID(geom), ST_AsText(geom)
            FROM spatial_dlq WHERE idempotency_key = %s
        """, ("evt-2",))
        srid, wkt = cur.fetchone()

    assert srid == 4326                # stored in EPSG:4326 (WGS84)
    assert wkt.startswith("POINT")


def test_failures_group_by_stage(clean_dlq):
    """The triage query buckets failures by stage."""
    for stage in ("parse", "parse", "validate"):
        _write_dlq({"type": "Feature", "geometry": None},
                   stage=stage, error="e", key=None, attempt=0)

    with psycopg2.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT failure_stage, count(*)
            FROM spatial_dlq GROUP BY failure_stage ORDER BY count(*) DESC
        """)
        rows = dict(cur.fetchall())

    assert rows["parse"] == 2
    assert rows["validate"] == 1
```

---

## FAQ

<details class="faq">
<summary><strong>Why store dead-lettered spatial events in PostGIS instead of Redis or a broker DLQ?</strong></summary>

A broker or Redis DLQ keeps the opaque message bytes but gives you no way to query by location or failure stage. Persisting to a PostGIS table with a real geometry column lets you run spatial queries over failures — for example counting dead letters inside a bounding box or clustering them by region — and gives durable, transactional storage that survives a broker flush.

</details>

<details class="faq">
<summary><strong>Should the geometry column be nullable in a spatial DLQ?</strong></summary>

Yes. Many failures happen before a valid geometry exists — malformed GeoJSON, a parse exception, or a CRS the pipeline rejects. If `geom` were `NOT NULL` you could not record those failures at all, which defeats the purpose of a dead-letter queue. Keep `geom` nullable and use a partial GiST index that skips `NULL` rows.

</details>

<details class="faq">
<summary><strong>How do I use Celery's on_failure hook to write a DLQ row?</strong></summary>

Subclass `Task` (or use the task's `bind=True` self) and override `on_failure(self, exc, task_id, args, kwargs, einfo)`. Celery calls it once, after `autoretry_for` has exhausted `max_retries`, so it runs exactly once per terminally failed message. Insert the DLQ row there rather than inside the task body, so transient retries do not dead-letter prematurely.

</details>

<details class="faq">
<summary><strong>What EPSG code should the DLQ geometry column use?</strong></summary>

Store the DLQ geometry in EPSG:4326 (WGS84), the CRS mandated by RFC 7946 for GeoJSON, so every row shares one coordinate system regardless of the source payload's CRS. Reproject on the way in; a mismatched SRID makes bounding-box queries and index lookups silently wrong.

</details>

---

## Related

- [Dead-Letter Queues for Spatial Payloads](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/) — parent: dead-letter design patterns across brokers and stores for spatial events
- [Replaying Dead-Letter Spatial Events Safely](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/replaying-dead-letter-spatial-events-safely/) — draining the rows this table stores back into the pipeline without re-corrupting state
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — catching invalid topology and CRS mismatches before they reach the DLQ
