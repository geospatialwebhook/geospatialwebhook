---
title: "Capturing PostGIS Changes with Logical Replication"
description: "Replace fragile PostGIS triggers with a logical replication slot: decode WAL into feature-change events, keep geometry decoding off the replication connection, and never let the slot fall behind unwatched."
slug: "capturing-postgis-changes-with-logical-replication"
type: "article"
breadcrumb: "Core Event Fundamentals & Architecture > Feature Change Triggers > Capturing PostGIS Changes with Logical Replication"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Capturing PostGIS Changes with Logical Replication",
      "description": "A trigger fires inside the writing transaction and makes every feature edit pay for the webhook. A logical replication slot moves that work out of the write path entirely, at the cost of one operational hazard that will fill the disk if nobody watches it.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/capturing-postgis-changes-with-logical-replication/",
      "datePublished": "2026-08-08",
      "dateModified": "2026-08-08",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Core Event Fundamentals & Architecture", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/"},
        {"@type": "ListItem", "position": 3, "name": "Feature Change Triggers", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/"},
        {"@type": "ListItem", "position": 4, "name": "Capturing PostGIS Changes with Logical Replication", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/capturing-postgis-changes-with-logical-replication/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Capture PostGIS feature changes with a logical replication slot",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Set REPLICA IDENTITY so an update carries the old geometry as well as the new"},
        {"@type": "HowToStep", "position": 2, "name": "Create a slot and a publication scoped to the feature tables"},
        {"@type": "HowToStep", "position": 3, "name": "Decode changes off the replication connection, never on it"},
        {"@type": "HowToStep", "position": 4, "name": "Advance the confirmed position only after the event is durable, and alert on slot lag"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why use logical replication instead of a PostGIS trigger?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because a trigger runs inside the writing transaction, so every feature edit pays for the change-capture work and any slowness in it becomes slowness in the application's write path. A trigger that serialises a large multipolygon to GeoJSON can add hundreds of milliseconds to a commit, and one that calls out to a queue can hold a transaction open across a network round trip. Logical replication reads the write-ahead log after the fact, so the writer commits at full speed and the capture cost lands in a separate process."}
        },
        {
          "@type": "Question",
          "name": "What is the danger of a replication slot?",
          "acceptedAnswer": {"@type": "Answer", "text": "An unconsumed slot pins the write-ahead log. PostgreSQL cannot recycle WAL segments that a slot has not confirmed, so a consumer that crashes on a Friday can fill the data volume by Sunday and take the database down — including for writers that have nothing to do with the feature stream. It is the one failure mode that turns a change-capture outage into a database outage, and it is why slot lag needs an alert before the slot is created."}
        },
        {
          "@type": "Question",
          "name": "How do I get the previous geometry on an update?",
          "acceptedAnswer": {"@type": "Answer", "text": "Set REPLICA IDENTITY FULL on the table, or define an index-backed identity that includes the geometry column. By default an update record carries only the primary key of the old row, so a consumer wanting to know what changed spatially — whether the feature moved, grew or was merely re-attributed — has the new geometry and nothing to compare it against. FULL makes the old row available at the cost of larger WAL records."}
        }
      ]
    }
  ]
}
</script>

**Set `REPLICA IDENTITY FULL` before creating the slot, decode the WAL in a process that does nothing else, and alert on slot lag on day one — an unconsumed replication slot pins the write-ahead log, so a crashed consumer fills the data volume and takes down every writer, not just the feature stream.**

This guide sits under [Feature Change Triggers](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/), within [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/). It is the alternative to the in-transaction trigger that topic describes, and it trades a write-path cost for an operational one.

## When to use this pattern

- Feature edits are frequent enough that trigger cost shows up in commit latency, or geometries are large enough that serialising one inside the transaction is measurable.
- Something other than your application writes to the tables — a bulk import, a GIS desktop client, a migration — and a trigger is the only thing that would catch it. This is also the argument *for* triggers over application-level publishing, and logical replication keeps it.
- You can operate a slot, which means you can alert on its lag and have somewhere for the consumer to run.

If feature edits are rare and small, a trigger is simpler and the operational hazard is not worth taking on.

## Where the cost lands

<figure class="fig">
<svg viewBox="0 0 760 224" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A trigger inside the writing transaction compared with WAL decoding after commit">
<title>Inside the transaction, or after it</title>
<desc>Two change-capture designs are traced against one feature edit. With a trigger, the transaction begins, the row is updated, the trigger then serialises the geometry to GeoJSON and enqueues an event, and only then does the commit complete — so the serialisation time, which scales with vertex count, is added directly to the write latency the application sees, and a queue call inside the trigger holds the transaction open across a network round trip. With logical replication the transaction begins, the row is updated, and the commit completes immediately; the change is durable in the write-ahead log, and a separate decoder process reads it afterwards, serialises the geometry and publishes the event on its own time. The application's write latency is unchanged by the size of the geometry. What has been bought is not less work but work moved off the critical path, and what has been sold is a new failure mode: the decoder is now something that can fall behind, and while it is behind the database cannot recycle the log.</desc>
<rect x="0" y="0" width="760" height="224" fill="var(--fig-bg)"/>
<defs><marker id="lr-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">trigger — the writer pays for the geometry</text>
<rect x="14" y="28" width="70" height="26" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="24" y="45" font-size="8" fill="var(--fig-ink)">BEGIN</text>
<rect x="88" y="28" width="86" height="26" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="98" y="45" font-size="8" fill="var(--fig-ink)">UPDATE row</text>
<rect x="178" y="28" width="188" height="26" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="188" y="45" font-size="8" fill="var(--fig-ink)">trigger: ST_AsGeoJSON + enqueue</text>
<rect x="370" y="28" width="70" height="26" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="380" y="45" font-size="8" fill="var(--fig-ink)">COMMIT</text>
<line x1="14" y1="64" x2="440" y2="64" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="446" y="68" font-size="8.5" fill="var(--fig-rose-edge)">write latency the application sees — grows with vertex count</text>
<line x1="14" y1="86" x2="746" y2="86" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="106" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">logical replication — the writer commits and leaves</text>
<rect x="14" y="116" width="70" height="26" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="24" y="133" font-size="8" fill="var(--fig-ink)">BEGIN</text>
<rect x="88" y="116" width="86" height="26" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="98" y="133" font-size="8" fill="var(--fig-ink)">UPDATE row</text>
<rect x="178" y="116" width="70" height="26" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="188" y="133" font-size="8" fill="var(--fig-ink)">COMMIT</text>
<line x1="14" y1="152" x2="248" y2="152" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="254" y="156" font-size="8.5" fill="var(--fig-mint-edge)">write latency — independent of geometry size</text>
<line x1="248" y1="129" x2="290" y2="129" stroke="var(--fig-line)" stroke-width="1.2" marker-end="url(#lr-a)"/>
<rect x="294" y="116" width="452" height="26" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="304" y="133" font-size="8.5" fill="var(--fig-ink)">decoder process: read WAL · serialise geometry · publish — on its own time</text>
<rect x="14" y="172" width="732" height="42" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="26" y="190" font-size="9.5" font-weight="600" fill="var(--fig-ink)">What was bought, and what was sold</text>
<text x="26" y="200" font-size="9" fill="var(--fig-ink-soft)">Not less work — work moved off the critical path. The decoder is now something that can fall behind,</text>
<text x="26" y="212" font-size="9" fill="var(--fig-ink-soft)">and while it is behind the database cannot recycle its log.</text>
</svg>
<figcaption><b>Figure 1.</b> The trade is real in both directions. Commit latency stops depending on geometry size; a new process becomes load-bearing for the database's disk usage.</figcaption>
</figure>

## Complete runnable implementation

Set up the database side first. `REPLICA IDENTITY FULL` is what makes an update carry the old row, which is the only way to tell a geometry change from an attribute change.

```sql
-- Old geometry available on UPDATE. Without this, an update record carries
-- only the primary key of the old row and "did it move?" is unanswerable.
ALTER TABLE features REPLICA IDENTITY FULL;

CREATE PUBLICATION feature_changes FOR TABLE features;

-- pgoutput is built in; wal2json is easier to read but must be installed.
SELECT pg_create_logical_replication_slot('feature_capture', 'wal2json');
```

Then the decoder. It does one thing: read, publish, confirm.

```python
import asyncio
import json
from datetime import datetime, UTC

import psycopg
from psycopg.rows import dict_row
from prometheus_client import Counter, Gauge
from shapely import wkb
from shapely.geometry import mapping

DECODED = Counter("wal_changes_decoded_total", "WAL changes decoded", ("action",))
SLOT_LAG = Gauge("wal_slot_lag_bytes", "Unconsumed WAL held by the slot")

SLOT = "feature_capture"


def _geometry(hex_ewkb: str | None) -> dict | None:
    """PostGIS emits EWKB hex; shapely reads it and drops the SRID prefix."""
    if hex_ewkb is None:
        return None
    return mapping(wkb.loads(bytes.fromhex(hex_ewkb)))


def to_event(change: dict) -> dict:
    """One WAL change -> one feature-change event.

    Both geometries are carried. A consumer needs the old one to tell a
    move from an attribute edit, and to invalidate the tiles the feature
    used to cover as well as the ones it covers now.
    """
    cols = dict(zip(change["columnnames"], change["columnvalues"]))
    old = dict(zip(change.get("oldkeys", {}).get("keynames", []),
                   change.get("oldkeys", {}).get("keyvalues", [])))

    return {
        "schema_version": 2,
        "action": change["kind"],                     # insert | update | delete
        "feature_id": str(cols.get("id") or old.get("id")),
        "occurred_at": datetime.now(UTC).isoformat(),
        "crs": "EPSG:4326",
        "geometry": _geometry(cols.get("geom")),
        "previous_geometry": _geometry(old.get("geom")),
    }


async def run(dsn: str, publish) -> None:
    """Stream the slot, publish each change, confirm only when durable."""
    async with await psycopg.AsyncConnection.connect(
        dsn, autocommit=True, row_factory=dict_row
    ) as conn:
        cur = conn.cursor()
        await cur.execute(
            "SELECT lsn, data FROM pg_logical_slot_get_changes(%s, NULL, NULL)",
            (SLOT,),
        )
        async for row in cur:
            for change in json.loads(row["data"])["change"]:
                event = to_event(change)
                # Publish BEFORE confirming. Confirming first means a crash
                # here loses the change permanently — the WAL is already gone.
                await publish(event)
                DECODED.labels(action=event["action"]).inc()


async def watch_slot_lag(dsn: str) -> None:
    """The alert that has to exist before the slot does."""
    async with await psycopg.AsyncConnection.connect(dsn) as conn:
        while True:
            row = await (await conn.execute(
                """
                SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)
                FROM pg_replication_slots WHERE slot_name = %s
                """,
                (SLOT,),
            )).fetchone()
            SLOT_LAG.set(row[0] or 0)
            await asyncio.sleep(15)
```

Publishing before confirming gives at-least-once delivery: a crash between the two replays the change. The reverse order gives at-most-once and silent loss, because once the slot has confirmed a position the WAL behind it is recyclable and the change is unrecoverable.

<figure class="fig">
<svg viewBox="0 0 760 216" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Write-ahead log growth over a weekend while a replication slot is not consumed">
<title>The failure that takes the database with it</title>
<desc>Write-ahead log usage is plotted across a weekend. Under normal operation the decoder confirms its position continuously and PostgreSQL recycles segments behind it, so usage stays flat at a few gigabytes regardless of write volume. The decoder crashes on Friday evening. From that moment the slot stops confirming, and because PostgreSQL may not recycle any segment a slot has not confirmed, usage climbs at the rate the database generates log — steadily, without any error being raised, because nothing is wrong from the database's point of view. By Sunday the data volume is full, and a full data volume stops every writer, including applications that have nothing to do with the feature stream. The alert that prevents this is a threshold on the byte distance between the current log position and the slot's confirmed position, and it needs to exist before the slot does, because the window between the crash and the outage is measured in hours and nobody is looking at a dashboard for a service that has already stopped emitting metrics.</desc>
<rect x="0" y="0" width="760" height="216" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">WAL volume on disk · decoder crashes Friday 18:00</text>
<line x1="50" y1="150" x2="740" y2="150" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="50" y1="34" x2="50" y2="150" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="50" y1="46" x2="740" y2="46" stroke="var(--fig-rose-edge)" stroke-width="1.2" stroke-dasharray="4 3"/>
<text x="600" y="42" font-size="8.5" fill="var(--fig-rose-edge)">data volume full</text>
<path d="M50,142 L200,142 L230,141 L260,142" fill="none" stroke="var(--fig-mint-edge)" stroke-width="2"/>
<path d="M260,142 L740,48" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2.2"/>
<line x1="260" y1="34" x2="260" y2="150" stroke="var(--fig-line)" stroke-width="1.3" stroke-dasharray="3 3"/>
<text x="266" y="32" font-size="8.5" fill="var(--fig-ink-soft)">decoder crashes · nothing raises</text>
<text x="60" y="134" font-size="8.5" fill="var(--fig-mint-edge)">flat — segments recycled behind the confirmed position</text>
<text x="400" y="118" font-size="8.5" fill="var(--fig-rose-edge)">climbing at the rate the database writes log</text>
<text x="56" y="164" font-size="8" fill="var(--fig-ink-soft)">Fri</text>
<text x="264" y="164" font-size="8" fill="var(--fig-ink-soft)">Fri 18:00</text>
<text x="480" y="164" font-size="8" fill="var(--fig-ink-soft)">Sat</text>
<text x="700" y="164" font-size="8" fill="var(--fig-ink-soft)">Sun</text>
<rect x="14" y="176" width="732" height="34" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="196" font-size="9" fill="var(--fig-ink-soft)">A full data volume stops every writer, including applications with nothing to do with the feature stream. Alert on the byte</text>
<text x="26" y="206" font-size="9" fill="var(--fig-ink-soft)">distance between the current log position and the slot's confirmed one — before the slot is created, not after the first incident.</text>
</svg>
<figcaption><b>Figure 2.</b> Nothing errors while this is happening. The database is behaving exactly as documented, which is why it needs an external alert rather than a log line.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `REPLICA IDENTITY` | table setting | `FULL` to carry the old geometry; without it, moves are undetectable | `DEFAULT` |
| Output plugin | `str` | `wal2json` for readability, `pgoutput` for lower overhead on large geometries | `wal2json` |
| `max_slot_wal_keep_size` | size | Caps the damage: the slot is invalidated rather than the disk filling | `-1` (unlimited) |
| `wal_level` | `str` | Must be `logical`; changing it needs a restart | `replica` |
| Slot lag alert | bytes | Well below free disk; page, do not ticket | — |
| Publication scope | table list | Feature tables only — a whole-database publication decodes everything | — |

</div>

## Gotchas and spatial edge cases

1. **`REPLICA IDENTITY FULL` multiplies WAL volume for geometry tables.** Every update now writes the entire old row into the log, and for a table of large multipolygons that can be tens of kilobytes per edit. Consider an index-backed replica identity covering only the primary key and geometry column, which gets the old geometry without the other columns.

2. **Set `max_slot_wal_keep_size` even with an alert.** It converts the worst case from "the database stops" to "the slot is invalidated and change capture needs a resync". The second is a bad afternoon; the first is an outage for every application on that instance.

3. **A bulk import produces one change record per row.** A shapefile load of two hundred thousand features arrives as two hundred thousand events, all at once, all large. This is where the debouncing in [Debouncing Rapid Feature Edits](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/debouncing-rapid-feature-edits/) and the backpressure in [Backpressure & Flow Control for Spatial Consumers](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/) stop being optional.

4. **PostGIS emits EWKB with an embedded SRID, and `shapely` drops it.** The `mapping()` output has no CRS at all, so the event must state one explicitly. If the table holds mixed SRIDs, read the SRID from the EWKB prefix and normalise as [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) describes rather than assuming the column's declared type.

5. **A `TRUNCATE` is not a stream of deletes.** It arrives as a single truncate message, so a consumer maintaining a derived spatial index will keep every feature unless it handles that message type explicitly. The same applies to `DROP` — the publication simply stops producing.

6. **Slots do not survive a failover to a physical replica** in older PostgreSQL versions. After promotion the slot does not exist and the decoder reconnects to nothing, silently capturing zero changes. Verify slot existence as part of the health check, not just connectivity.

<figure class="fig">
<svg viewBox="0 0 760 196" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A bulk shapefile import producing one WAL change record per row and the burst that reaches the decoder">
<title>A bulk import is two hundred thousand events, all at once</title>
<desc>A shapefile load of two hundred thousand parcels is applied to the features table in a single transaction. Logical replication is faithful and records one change per row, so the decoder receives two hundred thousand change records the moment the transaction commits, each carrying a full geometry and — under REPLICA IDENTITY FULL — the old row as well. The publish rate the decoder needs to sustain for the next several minutes is orders of magnitude above its steady state, the broker sees a spike it was not provisioned for, and every downstream consumer meets a backlog of large payloads at once. Nothing is wrong: this is what faithful change capture does with a bulk write. What it means is that the decoder cannot be sized for the steady state alone, and that the debouncing and backpressure stages downstream stop being optional the day someone loads a dataset.</desc>
<rect x="0" y="0" width="760" height="196" fill="var(--fig-bg)"/>
<defs><marker id="lrb-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one shapefile load · 200 000 parcels · one transaction</text>
<rect x="14" y="30" width="150" height="42" rx="5" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.4"/>
<text x="26" y="48" font-size="9" font-weight="600" fill="var(--fig-ink)">COMMIT</text>
<text x="26" y="64" font-size="8.5" fill="var(--fig-ink-soft)">one write, from the app's view</text>
<line x1="168" y1="51" x2="198" y2="51" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#lrb-a)"/>
<rect x="202" y="30" width="216" height="42" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="214" y="48" font-size="9" font-weight="600" fill="var(--fig-ink)">200 000 WAL change records</text>
<text x="214" y="64" font-size="8.5" fill="var(--fig-ink-soft)">each with a geometry, and its old row</text>
<line x1="422" y1="51" x2="452" y2="51" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#lrb-a)"/>
<rect x="456" y="30" width="290" height="42" rx="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="468" y="48" font-size="9" font-weight="600" fill="var(--fig-ink)">decoder publish rate, for several minutes</text>
<text x="468" y="64" font-size="8.5" fill="var(--fig-rose-edge)">orders of magnitude above steady state</text>
<rect x="14" y="86" width="732" height="18" rx="3" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.1"/>
<text x="24" y="99" font-size="8" fill="var(--fig-ink-soft)">steady state — a few edits a second</text>
<rect x="14" y="108" width="732" height="34" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="24" y="129" font-size="8.5" fill="var(--fig-ink)">the same channel, during the load</text>
<text x="14" y="162" font-size="9" fill="var(--fig-ink-soft)">Nothing is wrong — this is what faithful change capture does with a bulk write. It means the decoder cannot be sized for</text>
<text x="14" y="175" font-size="9" fill="var(--fig-ink-soft)">the steady state, and that debouncing and backpressure downstream stop being optional the day somebody loads a dataset.</text>
<text x="14" y="190" font-size="9" fill="var(--fig-mint-edge)">The slot absorbs it safely; the consumers are what has to be provisioned for it.</text>
</svg>
<figcaption><b>Figure 3.</b> The transaction is one write to the application and two hundred thousand events to everything downstream. That asymmetry is the main operational consequence of capturing at the log rather than in the application.</figcaption>
</figure>

## Verification

```python
import json
import pytest


UPDATE_CHANGE = {
    "kind": "update",
    "columnnames": ["id", "name", "geom"],
    "columnvalues": [4471, "Depot B",
                     "0101000020E610000068B3EA73B5CD2A400E4FAF9465464A40"],
    "oldkeys": {"keynames": ["id", "geom"],
                "keyvalues": [4471,
                              "0101000020E6100000E8D9ACFA5CCD2A40FA7E6ABC74464A40"]},
}


def test_update_carries_both_geometries():
    """Without REPLICA IDENTITY FULL this test fails, which is the point."""
    event = to_event(UPDATE_CHANGE)
    assert event["geometry"] is not None
    assert event["previous_geometry"] is not None
    assert event["geometry"] != event["previous_geometry"]


def test_delete_has_a_feature_id_from_oldkeys():
    """On a delete, every value the consumer needs is in oldkeys."""
    change = {"kind": "delete", "columnnames": [], "columnvalues": [],
              "oldkeys": {"keynames": ["id"], "keyvalues": [4471]}}
    assert to_event(change)["feature_id"] == "4471"
    assert to_event(change)["geometry"] is None


@pytest.mark.integration
async def test_slot_lag_returns_to_zero(dsn, publish):
    """The property the alert is written against."""
    await write_one_feature(dsn)
    await run(dsn, publish)
    assert await slot_lag_bytes(dsn) < 1024
```

The first test is the one that fails loudly if someone resets `REPLICA IDENTITY` while tuning WAL volume — a change that looks like pure storage optimisation and silently removes the pipeline's ability to detect that a feature moved.

## Related

- [Feature Change Triggers](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/) — the topic this guide belongs to, and the trigger-based alternative
- [Debouncing Rapid Feature Edits](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/debouncing-rapid-feature-edits/) — what to do with the burst a bulk import produces
- [How to Design a Geospatial Webhook Architecture in Python](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/feature-change-triggers/how-to-design-a-geospatial-webhook-architecture-in-python/) — where this capture stage sits in the whole pipeline
- [Tile Update Event Pipelines](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/) — the main consumer of the previous-geometry field
