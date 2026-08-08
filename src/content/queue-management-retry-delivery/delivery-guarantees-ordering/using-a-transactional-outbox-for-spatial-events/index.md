---
title: "Using a Transactional Outbox for Spatial Events"
description: "Writing the feature and publishing the event in two systems means one of them can fail alone. Write both to PostGIS in one transaction, then relay the outbox — and keep the geometry out of the outbox row."
slug: "using-a-transactional-outbox-for-spatial-events"
type: "article"
breadcrumb: "Queue Management, Retries & Delivery Guarantees > Delivery Guarantees & Ordering > Using a Transactional Outbox for Spatial Events"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Using a Transactional Outbox for Spatial Events",
      "description": "A feature write and an event publish in two systems can succeed and fail independently, producing either a silent update or an event for a change that never happened. This guide writes both to PostGIS in one transaction and relays the outbox, with the geometry kept out of the outbox row.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/using-a-transactional-outbox-for-spatial-events/",
      "datePublished": "2026-08-08",
      "dateModified": "2026-08-08",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Queue Management, Retries & Delivery Guarantees", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/"},
        {"@type": "ListItem", "position": 3, "name": "Delivery Guarantees & Ordering", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/"},
        {"@type": "ListItem", "position": 4, "name": "Using a Transactional Outbox for Spatial Events", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/using-a-transactional-outbox-for-spatial-events/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Implement a transactional outbox for spatial events",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Write the feature and the outbox row in one transaction"},
        {"@type": "HowToStep", "position": 2, "name": "Keep the geometry out of the outbox row and reference it instead"},
        {"@type": "HowToStep", "position": 3, "name": "Relay with SKIP LOCKED so several relays can run without duplicating"},
        {"@type": "HowToStep", "position": 4, "name": "Publish before marking sent, and let the consumer deduplicate"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What goes wrong without an outbox?",
          "acceptedAnswer": {"@type": "Answer", "text": "Two failure modes, and they are opposites. If the feature is written and the publish then fails, the database has a change nobody downstream ever hears about — tiles stay stale and derived indexes drift, with no error anywhere because the write succeeded. If the publish happens first and the transaction then rolls back, consumers act on a change that does not exist: tiles are rebuilt from data that was never committed, and a notification is sent about an edit that did not happen."}
        },
        {
          "@type": "Question",
          "name": "Should the geometry go in the outbox row?",
          "acceptedAnswer": {"@type": "Answer", "text": "Not for large geometry. An outbox row holding a full multipolygon doubles the write volume of every edit, inflates the write-ahead log, and makes the outbox table larger than the feature table it serves. Store the feature id and the version, and have the relay read the geometry from the feature table when it builds the message — accepting that the relay then reads whatever version is current, which is why the version has to be in the row."}
        },
        {
          "@type": "Question",
          "name": "How is the outbox different from logical replication?",
          "acceptedAnswer": {"@type": "Answer", "text": "The outbox is explicit and the replication slot is implicit. An outbox row is written by application code that knows what the change means, so it can carry an event type, a routing key and a schema version; a decoded write-ahead log record carries the row as it changed and nothing about intent. The outbox costs an extra write per edit and catches only changes the application makes, while replication catches every writer including bulk loads and desktop clients."}
        }
      ]
    }
  ]
}
</script>

**Write the feature row and the outbox row in the same PostGIS transaction, keep the geometry out of the outbox and reference it by id and version, then relay with `FOR UPDATE SKIP LOCKED` — publishing before marking sent gives at-least-once delivery, which is the guarantee the consumer's deduplication already assumes.**

This guide sits under [Delivery Guarantees & Ordering](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/), within [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/). It is the explicit alternative to [Capturing PostGIS Changes with Logical Replication](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/capturing-postgis-changes-with-logical-replication/), and the two catch different sets of changes.

## When to use this pattern

- The application is the only writer that matters, so an application-level record catches every change worth publishing.
- Events need intent — an event type, a routing key, a schema version — that a decoded row does not carry.
- Operating a replication slot is undesirable, which for a managed database with restricted permissions it often is.

## Two failure modes, in opposite directions

<figure class="fig">
<svg viewBox="0 0 760 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Write-then-publish losing an event and publish-then-write inventing one, against the outbox which does neither">
<title>Whichever order you pick without an outbox, one of these happens</title>
<desc>Three orderings are traced for a single feature edit. Writing the feature and then publishing means that if the publish fails — a broker timeout, a network partition, a process death — the database holds a change nobody downstream ever hears about. Tiles stay stale, derived indexes drift, and no error is raised anywhere because the write itself succeeded, so the gap is discovered later by someone comparing counts. Publishing and then writing means that if the transaction rolls back, consumers have already acted on a change that does not exist: tiles are rebuilt from uncommitted data and a notification goes out about an edit that never happened. With the outbox, the feature row and the outbox row are written in one transaction, so either both exist or neither does, and a separate relay publishes from the outbox afterwards. A relay crash delays the event; it cannot lose it, because the row is still there. A relay that publishes twice produces a duplicate, which the consumer's deduplication already handles.</desc>
<rect x="0" y="0" width="760" height="240" fill="var(--fig-bg)"/>
<defs><marker id="ob-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">write, then publish — an event can be lost</text>
<rect x="30" y="28" width="98" height="24" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="40" y="44" font-size="8" fill="var(--fig-ink)">COMMIT feature</text>
<line x1="132" y1="40" x2="160" y2="40" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#ob-a)"/>
<rect x="164" y="28" width="98" height="24" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="174" y="44" font-size="8" fill="var(--fig-ink)">publish fails</text>
<text x="276" y="38" font-size="8.5" fill="var(--fig-rose-edge)">the database holds a change nobody hears about · tiles stale, indexes drift</text>
<text x="276" y="51" font-size="8.5" fill="var(--fig-rose-edge)">no error anywhere — the write succeeded</text>
<line x1="14" y1="66" x2="746" y2="66" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="86" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">publish, then write — an event can be invented</text>
<rect x="30" y="96" width="98" height="24" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="40" y="112" font-size="8" fill="var(--fig-ink)">publish</text>
<line x1="132" y1="108" x2="160" y2="108" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#ob-a)"/>
<rect x="164" y="96" width="98" height="24" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="174" y="112" font-size="8" fill="var(--fig-ink)">ROLLBACK</text>
<text x="276" y="106" font-size="8.5" fill="var(--fig-rose-edge)">consumers act on a change that does not exist · tiles rebuilt from uncommitted data</text>
<text x="276" y="119" font-size="8.5" fill="var(--fig-rose-edge)">a notification about an edit that never happened</text>
<line x1="14" y1="134" x2="746" y2="134" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="154" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">outbox — neither is possible</text>
<rect x="30" y="164" width="188" height="24" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="40" y="180" font-size="8" fill="var(--fig-ink)">COMMIT feature + outbox row</text>
<line x1="222" y1="176" x2="250" y2="176" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#ob-a)"/>
<rect x="254" y="164" width="120" height="24" rx="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="264" y="180" font-size="8" fill="var(--fig-ink)">relay publishes later</text>
<text x="388" y="174" font-size="8.5" fill="var(--fig-mint-edge)">both exist or neither does · a relay crash delays the event, it cannot lose it</text>
<text x="388" y="187" font-size="8.5" fill="var(--fig-ink-soft)">a relay that publishes twice produces a duplicate, which dedup already handles</text>
<rect x="14" y="200" width="732" height="30" rx="5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="26" y="219" font-size="9" fill="var(--fig-ink-soft)">The outbox does not remove the failure — it moves it from "lost or invented" to "late or duplicated", and the pipeline already has an answer for both.</text>
</svg>
<figcaption><b>Figure 1.</b> The trade is not correctness for cost. It is exchanging two failures nothing downstream can handle for two the pipeline is already built to absorb.</figcaption>
</figure>

## Complete runnable implementation

```sql
CREATE TABLE feature_outbox (
    id            bigserial PRIMARY KEY,
    feature_id    bigint      NOT NULL,
    feature_version int       NOT NULL,   -- what the relay must publish
    event_type    text        NOT NULL,   -- intent: created | moved | retired
    routing_key   text        NOT NULL,   -- H3 cell, computed at write time
    schema_version int        NOT NULL DEFAULT 2,
    created_at    timestamptz NOT NULL DEFAULT now(),
    published_at  timestamptz
    -- Deliberately NO geometry column: an outbox row carrying a full
    -- multipolygon doubles the write volume of every edit and makes this
    -- table larger than the one it serves.
);

-- The relay only ever scans unpublished rows, so index for exactly that.
CREATE INDEX feature_outbox_unpublished
    ON feature_outbox (id) WHERE published_at IS NULL;
```

```python
import json
from datetime import datetime, UTC

import h3
from prometheus_client import Counter, Gauge

RELAYED = Counter("outbox_rows_relayed_total", "Rows published", ("event_type",))
BACKLOG = Gauge("outbox_unpublished_rows", "Unpublished outbox rows")

BATCH_SIZE = 200


async def edit_feature(conn, feature_id: int, geometry: dict,
                       event_type: str) -> None:
    """Write the feature and its outbox row in ONE transaction.

    Either both are durable or neither is. That is the whole pattern; every
    other detail here is about cost.
    """
    async with conn.transaction():
        version = await conn.fetchval(
            """
            UPDATE features
               SET geom = ST_GeomFromGeoJSON($2),
                   version = version + 1,
                   updated_at = now()
             WHERE id = $1
            RETURNING version
            """,
            feature_id, json.dumps(geometry),
        )

        centroid = await conn.fetchrow(
            "SELECT ST_Y(ST_Centroid(geom)) AS lat, ST_X(ST_Centroid(geom)) AS lon "
            "FROM features WHERE id = $1",
            feature_id,
        )
        routing_key = h3.latlng_to_cell(centroid["lat"], centroid["lon"], 8)

        await conn.execute(
            """
            INSERT INTO feature_outbox
                (feature_id, feature_version, event_type, routing_key)
            VALUES ($1, $2, $3, $4)
            """,
            feature_id, version, event_type, routing_key,
        )


async def relay(conn, publish) -> int:
    """Publish unsent rows. Safe to run in several processes at once."""
    async with conn.transaction():
        rows = await conn.fetch(
            """
            SELECT o.id, o.feature_id, o.feature_version, o.event_type,
                   o.routing_key, o.schema_version,
                   ST_AsGeoJSON(f.geom) AS geometry, f.version AS current_version
              FROM feature_outbox o
              JOIN features f ON f.id = o.feature_id
             WHERE o.published_at IS NULL
             ORDER BY o.id
             LIMIT $1
               FOR UPDATE OF o SKIP LOCKED
            """,
            BATCH_SIZE,
        )

        for row in rows:
            # The relay reads whatever version is CURRENT, which may be newer
            # than the row's. Carrying both lets a consumer tell that it is
            # seeing a later state than the event described.
            await publish({
                "schema_version": row["schema_version"],
                "action": row["event_type"],
                "feature_id": str(row["feature_id"]),
                "event_version": row["feature_version"],
                "geometry_version": row["current_version"],
                "routing_key": row["routing_key"],
                "crs": "EPSG:4326",
                "geometry": json.loads(row["geometry"]),
                "occurred_at": datetime.now(UTC).isoformat(),
            })
            RELAYED.labels(event_type=row["event_type"]).inc()

        # Marked sent AFTER publishing. A crash between the two republishes
        # on the next pass — at-least-once, which the consumer already expects.
        if rows:
            await conn.execute(
                "UPDATE feature_outbox SET published_at = now() WHERE id = ANY($1)",
                [r["id"] for r in rows],
            )
    return len(rows)
```

<figure class="fig">
<svg viewBox="0 0 760 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Several relay processes claiming disjoint batches with SKIP LOCKED, and what happens without it">
<title>SKIP LOCKED is what lets the relay scale</title>
<desc>Three relay processes poll the same outbox table. Without FOR UPDATE SKIP LOCKED, all three select the same oldest rows: either they block on each other, serialising the relay to the throughput of one process while consuming three connections, or — if they read without locking — all three publish the same events, tripling the duplicate rate the consumer has to absorb. With SKIP LOCKED each transaction claims rows the others have not locked and skips over the rest, so the three processes take disjoint batches and throughput scales with the number of relays. Ordering is preserved only within a batch, not across them, which means two edits to the same feature can be published out of order if they land in different batches taken by different relays. That is why the routing key is computed at write time and why the event carries its version: ordering per feature has to be reconstructed by the consumer rather than assumed from the relay.</desc>
<rect x="0" y="0" width="760" height="220" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">without SKIP LOCKED</text>
<rect x="30" y="28" width="86" height="20" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="38" y="42" font-size="7.5" fill="var(--fig-ink)">relay 1</text>
<rect x="30" y="52" width="86" height="20" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="38" y="66" font-size="7.5" fill="var(--fig-ink)">relay 2</text>
<rect x="30" y="76" width="86" height="20" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="38" y="90" font-size="7.5" fill="var(--fig-ink)">relay 3</text>
<rect x="140" y="28" width="130" height="68" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="150" y="58" font-size="8" fill="var(--fig-ink)">the same oldest rows</text>
<text x="286" y="46" font-size="8.5" fill="var(--fig-rose-edge)">blocked on each other — one relay's throughput, three connections</text>
<text x="286" y="66" font-size="8.5" fill="var(--fig-rose-edge)">or, reading unlocked, all three publish the same events</text>
<text x="286" y="86" font-size="8.5" fill="var(--fig-ink-soft)">tripling the duplicate rate the consumer must absorb</text>
<line x1="14" y1="110" x2="746" y2="110" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="130" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">with FOR UPDATE ... SKIP LOCKED</text>
<rect x="30" y="140" width="86" height="20" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="38" y="154" font-size="7.5" fill="var(--fig-ink)">relay 1</text>
<rect x="140" y="140" width="86" height="20" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="150" y="154" font-size="7.5" fill="var(--fig-ink)">rows 1–200</text>
<rect x="30" y="164" width="86" height="20" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="38" y="178" font-size="7.5" fill="var(--fig-ink)">relay 2</text>
<rect x="140" y="164" width="86" height="20" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="150" y="178" font-size="7.5" fill="var(--fig-ink)">rows 201–400</text>
<rect x="30" y="188" width="86" height="20" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="38" y="202" font-size="7.5" fill="var(--fig-ink)">relay 3</text>
<rect x="140" y="188" width="86" height="20" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="150" y="202" font-size="7.5" fill="var(--fig-ink)">rows 401–600</text>
<text x="240" y="154" font-size="8.5" fill="var(--fig-mint-edge)">disjoint batches · throughput scales with relay count</text>
<text x="240" y="178" font-size="8.5" fill="var(--fig-gold-edge)">but ordering holds only WITHIN a batch, not across them</text>
<text x="240" y="198" font-size="8.5" fill="var(--fig-ink-soft)">so two edits to one feature can publish out of order — which is why the event carries its version</text>
</svg>
<figcaption><b>Figure 2.</b> Scaling the relay costs per-feature ordering, so the consumer has to reconstruct it. Pretending otherwise is how a single-relay design quietly becomes load-bearing.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `feature_version` | `int` | The version the event describes; compared against current at relay | — |
| `routing_key` | `text` | H3 cell computed at write time, from the geometry as it then was | — |
| Geometry column | — | Absent by design; relay joins the feature table | — |
| `BATCH_SIZE` | `int` | Ordering holds within a batch only | `200` |
| `SKIP LOCKED` | — | Required for more than one relay; without it they serialise or duplicate | — |
| Partial index | — | On `id WHERE published_at IS NULL` — the only query the relay runs | — |

</div>

## Gotchas and spatial edge cases

1. **The relay publishes the current geometry, not the one at the time of the edit.** Two rapid edits mean the first event carries the second edit's shape. Carrying both `event_version` and `geometry_version` lets a consumer detect it; storing the geometry in the outbox would avoid it entirely, at a write cost most pipelines will not pay.

2. **Computing the routing key at write time is deliberate.** A feature that moves between cells would otherwise be routed by wherever it ended up rather than where the edit happened, so a consumer subscribed to the origin area never learns the feature left. The same reasoning drives the previous-geometry field in [Tile Update Event Pipelines](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/).

3. **Published rows must be deleted, not merely marked.** An outbox retaining every event forever becomes the largest table in the database and slows the partial index scan through sheer bloat. Delete on a schedule once the topic has the events, and keep the deletion window longer than any replay you might run.

4. **A stalled relay is invisible without a backlog metric.** The application keeps working — writes succeed, transactions commit — while nothing reaches consumers. The `outbox_unpublished_rows` gauge and an age-of-oldest-unpublished-row metric are the only signals, and they belong in the freshness objective described in [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/).

5. **The outbox misses every writer that is not the application.** A bulk import, a migration or a desktop GIS client editing the table directly produces no outbox row, and the pipeline silently has no idea those features changed. If that is a real risk, logical replication is the pattern that catches them.

6. **`ST_Centroid` of a multipolygon can fall outside the feature.** For a routing key that is usually acceptable, but for a crescent-shaped or multi-part feature the centroid can land in a cell the feature does not touch. Use `ST_PointOnSurface` where the key must be inside the geometry.

<figure class="fig">
<svg viewBox="0 0 760 186" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A stalled relay leaving the application healthy while nothing reaches consumers">
<title>A stalled relay looks like nothing at all from the application</title>
<desc>The relay process stops — a crash, a bad deploy, a database permission change. From the application's point of view nothing has happened: writes still succeed, transactions still commit, outbox rows are still inserted, and every request returns normally. From the consumers' point of view the stream has stopped entirely, and because no error is raised anywhere in between, the only evidence is the outbox table growing and the age of its oldest unpublished row increasing. Neither of those is visible on an application dashboard, which watches request rates and error rates, both of which are healthy. The two metrics that catch it are the count of unpublished rows and the age of the oldest one, and the second is the more useful because it is unaffected by traffic volume: a backlog of ten thousand rows during a bulk import is normal, while an oldest row from four hours ago never is.</desc>
<rect x="0" y="0" width="760" height="186" fill="var(--fig-bg)"/>
<rect x="14" y="28" width="230" height="94" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="26" y="48" font-size="9.5" font-weight="600" fill="var(--fig-ink)">the application</text>
<text x="26" y="70" font-size="8.5" fill="var(--fig-ink-soft)">writes succeed · transactions commit</text>
<text x="26" y="86" font-size="8.5" fill="var(--fig-ink-soft)">outbox rows inserted · requests 200</text>
<text x="26" y="108" font-size="8.5" fill="var(--fig-mint-edge)">every dashboard is green</text>
<rect x="264" y="28" width="230" height="94" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<text x="276" y="48" font-size="9.5" font-weight="600" fill="var(--fig-ink)">the relay — stopped</text>
<text x="276" y="70" font-size="8.5" fill="var(--fig-ink-soft)">a crash, a bad deploy, a permission change</text>
<text x="276" y="92" font-size="8.5" fill="var(--fig-rose-edge)">no error is raised anywhere in between</text>
<rect x="514" y="28" width="232" height="94" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="526" y="48" font-size="9.5" font-weight="600" fill="var(--fig-ink)">the consumers</text>
<text x="526" y="70" font-size="8.5" fill="var(--fig-rose-edge)">the stream has stopped entirely</text>
<text x="526" y="92" font-size="8.5" fill="var(--fig-ink-soft)">tiles stale, indexes drifting, no signal</text>
<rect x="14" y="134" width="732" height="42" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="26" y="152" font-size="9" fill="var(--fig-ink-soft)">Two metrics catch it: unpublished row count, and the age of the oldest unpublished row. Prefer the second — it is unaffected</text>
<text x="26" y="167" font-size="9" fill="var(--fig-ink-soft)">by volume, so a ten-thousand-row backlog during a bulk import reads as normal while a four-hour-old row never does.</text>
</svg>
<figcaption><b>Figure 3.</b> The outbox converts a lost event into a delayed one, which is only an improvement if somebody is watching the delay.</figcaption>
</figure>

## Verification

```python
import pytest

SQUARE = {"type": "Polygon", "coordinates": [[[13.40, 52.52], [13.40, 52.53],
                                              [13.41, 52.53], [13.41, 52.52],
                                              [13.40, 52.52]]]}


@pytest.mark.asyncio
async def test_rollback_leaves_no_outbox_row(conn):
    """The invented-event failure, asserted."""
    with pytest.raises(RuntimeError):
        async with conn.transaction():
            await edit_feature(conn, 4471, SQUARE, "moved")
            raise RuntimeError("simulated failure after the edit")

    assert await conn.fetchval(
        "SELECT count(*) FROM feature_outbox WHERE feature_id = 4471") == 0


@pytest.mark.asyncio
async def test_relay_crash_republishes_rather_than_losing(conn):
    """Publish-then-mark gives at-least-once, deliberately."""
    await edit_feature(conn, 4471, SQUARE, "moved")

    async def failing_publish(event):
        raise ConnectionError("broker unavailable")

    with pytest.raises(ConnectionError):
        await relay(conn, failing_publish)

    published = []
    assert await relay(conn, published.append) == 1
    assert published[0]["feature_id"] == "4471"


@pytest.mark.asyncio
async def test_two_relays_take_disjoint_batches(conn, conn2):
    """Without SKIP LOCKED this either blocks or double-publishes."""
    for i in range(400):
        await edit_feature(conn, 4471, SQUARE, "moved")

    a, b = [], []
    await asyncio.gather(relay(conn, a.append), relay(conn2, b.append))
    ids_a = {e["event_version"] for e in a}
    ids_b = {e["event_version"] for e in b}
    assert not (ids_a & ids_b)


@pytest.mark.asyncio
async def test_outbox_row_carries_no_geometry(conn):
    """The cost decision, guarded so it does not drift back."""
    columns = await conn.fetch(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'feature_outbox'")
    assert not any("geom" in c["column_name"] for c in columns)
```

The second test is the one that documents the guarantee rather than the implementation: it asserts that a failed publish leads to a republish, which is what makes the consumer's deduplication load-bearing rather than decorative.

## Related

- [Delivery Guarantees & Ordering](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/) — the topic this guide belongs to
- [Capturing PostGIS Changes with Logical Replication](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/capturing-postgis-changes-with-logical-replication/) — the implicit alternative, and the writers it catches that this does not
- [Idempotent Consumers for Out-of-Order Spatial Events](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/idempotent-consumers-for-out-of-order-spatial-events/) — absorbing the duplicates and the reordering this relay produces
- [Partitioning Kafka Topics by H3 Cell](https://www.geospatialwebhook.com/queue-management-retry-delivery/broker-selection-partitioning/partitioning-kafka-topics-by-h3-cell/) — what the routing key computed at write time is for
