---
title: "Routing Telemetry by Geofence Membership"
description: "Route each ping to the consumers whose geofences contain it, using a prepared STRtree and a stateful entry/exit test — and emit transitions rather than memberships, because a consumer wants the crossing, not the dwell."
slug: "routing-telemetry-by-geofence-membership"
type: "article"
breadcrumb: "Core Event Fundamentals & Architecture > Sensor Data Routing Patterns > Routing Telemetry by Geofence Membership"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Routing Telemetry by Geofence Membership",
      "description": "Testing every ping against every geofence is quadratic and unnecessary. This guide builds a prepared STRtree index, tracks per-asset membership so the router emits entries and exits rather than a membership set on every ping, and handles the boundary jitter that turns one crossing into forty.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/routing-telemetry-by-geofence-membership/",
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
        {"@type": "ListItem", "position": 3, "name": "Sensor Data Routing Patterns", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/"},
        {"@type": "ListItem", "position": 4, "name": "Routing Telemetry by Geofence Membership", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/routing-telemetry-by-geofence-membership/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Route telemetry to consumers by geofence membership",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Build an STRtree over the geofences and prepare each polygon once"},
        {"@type": "HowToStep", "position": 2, "name": "Query the tree for candidates, then run the exact predicate on those only"},
        {"@type": "HowToStep", "position": 3, "name": "Diff against the asset's previous membership and emit transitions"},
        {"@type": "HowToStep", "position": 4, "name": "Apply hysteresis at the boundary so one crossing is not forty events"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why prepare the geometries instead of calling contains directly?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because an unprepared point-in-polygon test rebuilds the polygon's edge structure on every call, and a geofence with ten thousand vertices pays that cost for every ping. Preparing the geometry once builds that structure a single time and reuses it, which turns a linear scan of the ring into an indexed lookup. For a fleet emitting thousands of pings a second against complex administrative boundaries, the difference is the difference between one core and thirty."}
        },
        {
          "@type": "Question",
          "name": "Should the router emit membership or transitions?",
          "acceptedAnswer": {"@type": "Answer", "text": "Transitions. A consumer almost never wants to know that a vehicle is still inside the depot; it wants to know that it arrived and that it left. Emitting the full membership set on every ping puts the burden of diffing on every consumer, multiplies message volume by the ping rate rather than the crossing rate, and makes it impossible for a late-joining consumer to distinguish a genuine entry from the first ping after it subscribed."}
        },
        {
          "@type": "Question",
          "name": "How do I stop a vehicle parked on a boundary from flapping?",
          "acceptedAnswer": {"@type": "Answer", "text": "Use two thresholds instead of one: require the position to be a few metres inside the fence to register an entry, and a few metres outside to register an exit. GPS jitter of five metres against a boundary the vehicle is parked on produces a continuous stream of entry and exit events with a single threshold, and each one is indistinguishable from a real crossing to everything downstream. A buffer wider than the measured jitter removes the flapping without delaying a genuine crossing by more than a ping."}
        }
      ]
    }
  ]
}
</script>

**Query an STRtree for candidate fences, run the exact predicate only on those, and emit entries and exits rather than a membership set — a router that publishes membership on every ping multiplies volume by the ping rate instead of the crossing rate, and makes a vehicle parked on a boundary indistinguishable from one driving through it.**

This guide sits under [Sensor Data Routing Patterns](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/), within [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/). It assumes positions have already been normalised to EPSG:4326 as described in [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/).

## When to use this pattern

- Consumers subscribe to areas rather than to assets — a depot operator wants everything in their yard, not a named list of vehicles.
- The set of geofences is large enough that testing every ping against every fence is measurable, which starts at a few hundred fences.
- What matters downstream is the crossing, not the dwell: arrival notifications, zone-based billing, compliance boundaries.

## Two indexes, and only one of them is exact

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="An STRtree narrowing thousands of geofences to a handful of bounding-box candidates before the exact predicate runs">
<title>Cheap filter, exact refine</title>
<desc>Four thousand geofences are indexed in an STRtree keyed on bounding boxes. A ping arrives and the tree is queried, which examines a logarithmic number of nodes and returns three candidate fences whose bounding boxes contain the point. Only those three run the exact point-in-polygon predicate, and of them one actually contains the point: the other two are bounding-box overlaps, which are common for administrative boundaries because a long diagonal coastline has an enormous rectangle containing mostly sea. Without the tree, all four thousand exact predicates run per ping, and each one on a complex boundary walks thousands of edges. The two-stage structure is the standard filter-and-refine pattern and the reason it matters here is the shape of real geofences — bounding boxes are a terrible approximation of administrative geometry, so the filter stage must be followed by an exact test rather than trusted on its own.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<defs><marker id="gf-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="26" font-size="10" font-weight="600" fill="var(--fig-ink)">one ping against 4 000 geofences: filter on bounding boxes, then refine exactly</text>
<rect x="14" y="46" width="152" height="60" rx="6" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.4"/>
<text x="26" y="66" font-size="9.5" font-weight="600" fill="var(--fig-ink)">one ping</text>
<text x="26" y="84" font-size="8.5" fill="var(--fig-ink-soft)">lat/lon, EPSG:4326</text>
<text x="26" y="98" font-size="8.5" fill="var(--fig-ink-soft)">4 000 fences in the system</text>
<line x1="170" y1="76" x2="204" y2="76" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#gf-a)"/>
<rect x="208" y="46" width="176" height="60" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="220" y="66" font-size="9.5" font-weight="600" fill="var(--fig-ink)">STRtree query</text>
<text x="220" y="84" font-size="8.5" fill="var(--fig-ink-soft)">bounding boxes only</text>
<text x="220" y="98" font-size="8.5" fill="var(--fig-gold-edge)">→ 3 candidates</text>
<line x1="388" y1="76" x2="422" y2="76" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#gf-a)"/>
<rect x="426" y="46" width="176" height="60" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="438" y="66" font-size="9.5" font-weight="600" fill="var(--fig-ink)">prepared contains()</text>
<text x="438" y="84" font-size="8.5" fill="var(--fig-ink-soft)">exact, on 3 polygons</text>
<text x="438" y="98" font-size="8.5" fill="var(--fig-mint-edge)">→ 1 real member</text>
<line x1="606" y1="76" x2="640" y2="76" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#gf-a)"/>
<rect x="644" y="46" width="102" height="60" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.4"/>
<text x="656" y="72" font-size="8.5" fill="var(--fig-ink)">route to that</text>
<text x="656" y="86" font-size="8.5" fill="var(--fig-ink)">fence's consumers</text>
<rect x="14" y="124" width="366" height="88" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="26" y="144" font-size="9.5" font-weight="600" fill="var(--fig-ink)">why the filter alone is not enough</text>
<path d="M40,158 L120,200 L200,166 L250,204" fill="none" stroke="var(--fig-rose-edge)" stroke-width="1.8"/>
<rect x="36" y="154" width="220" height="54" fill="none" stroke="var(--fig-ink-soft)" stroke-width="1" stroke-dasharray="3 2"/>
<text x="268" y="172" font-size="8.5" fill="var(--fig-ink-soft)">a diagonal coastline's</text>
<text x="268" y="186" font-size="8.5" fill="var(--fig-ink-soft)">bounding box is mostly sea</text>
<rect x="392" y="124" width="354" height="88" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="404" y="144" font-size="9.5" font-weight="600" fill="var(--fig-ink)">what each stage costs per ping</text>
<text x="404" y="164" font-size="8.5" fill="var(--fig-ink-soft)">tree query: a logarithmic number of node visits</text>
<text x="404" y="180" font-size="8.5" fill="var(--fig-ink-soft)">exact test: 3 prepared predicates, not 4 000</text>
<text x="404" y="198" font-size="8.5" fill="var(--fig-mint-edge)">unprepared, each of those 3 walks the ring again</text>
</svg>
<figcaption><b>Figure 1.</b> Bounding boxes are a poor approximation of administrative geometry, so the filter stage narrows the work but can never be trusted on its own.</figcaption>
</figure>

## Complete runnable implementation

```python
from dataclasses import dataclass, field

from shapely import STRtree, prepare, contains_xy
from shapely.geometry import shape

# Metres of hysteresis at the boundary. Must exceed measured GPS jitter, or a
# vehicle parked on a fence line produces an unbounded stream of crossings.
ENTER_BUFFER_M = 15.0
EXIT_BUFFER_M = 25.0
_M_PER_DEGREE = 111_320.0     # at the equator; fine for a jitter-scale buffer


@dataclass(slots=True)
class Geofence:
    fence_id: str
    consumers: tuple[str, ...]
    geometry: object          # shapely polygon, EPSG:4326
    enter_zone: object = None # eroded — must be inside THIS to enter
    exit_zone: object = None  # dilated — must leave THIS to exit


class GeofenceRouter:
    def __init__(self, fences: list[Geofence]) -> None:
        for fence in fences:
            fence.enter_zone = fence.geometry.buffer(-ENTER_BUFFER_M / _M_PER_DEGREE)
            fence.exit_zone = fence.geometry.buffer(EXIT_BUFFER_M / _M_PER_DEGREE)
            # Prepare once. Without this, every contains() call rebuilds the
            # edge structure of a boundary that may have 10 000 vertices.
            prepare(fence.enter_zone)
            prepare(fence.exit_zone)

        self._fences = fences
        # Index the DILATED zones: anything that could still be inside must be
        # a candidate, and the exit zone is the largest of the two.
        self._tree = STRtree([f.exit_zone for f in fences])
        self._membership: dict[str, set[str]] = {}

    def route(self, asset_id: str, lon: float, lat: float) -> list[dict]:
        """Return entry/exit transitions for this ping. Usually empty."""
        was_in = self._membership.get(asset_id, set())
        now_in: set[str] = set()

        for idx in self._tree.query(_point(lon, lat)):
            fence = self._fences[idx]
            inside_exit = contains_xy(fence.exit_zone, lon, lat)
            inside_enter = contains_xy(fence.enter_zone, lon, lat)

            # Hysteresis: entering needs the inner zone, staying only needs
            # the outer one. That asymmetry is the whole anti-flap mechanism.
            if fence.fence_id in was_in:
                if inside_exit:
                    now_in.add(fence.fence_id)
            elif inside_enter:
                now_in.add(fence.fence_id)

        self._membership[asset_id] = now_in

        transitions = []
        for fence_id in now_in - was_in:
            transitions.append(self._event(asset_id, fence_id, "enter", lon, lat))
        for fence_id in was_in - now_in:
            transitions.append(self._event(asset_id, fence_id, "exit", lon, lat))
        return transitions

    def _event(self, asset_id: str, fence_id: str, kind: str,
               lon: float, lat: float) -> dict:
        fence = next(f for f in self._fences if f.fence_id == fence_id)
        return {
            "schema_version": 2,
            "action": f"geofence_{kind}",
            "asset_id": asset_id,
            "fence_id": fence_id,
            "consumers": list(fence.consumers),
            "crs": "EPSG:4326",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
        }


def _point(lon: float, lat: float):
    from shapely.geometry import Point
    return Point(lon, lat)
```

The membership dictionary is what turns a stateless predicate into a transition detector, and it is also the thing that makes this router stateful — which has consequences for how it is deployed, covered below.

<figure class="fig">
<svg viewBox="0 0 760 214" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A vehicle parked on a fence boundary flapping under a single threshold and stable under two">
<title>One threshold flaps; two do not</title>
<desc>A vehicle is parked directly on a geofence boundary and reports every ten seconds with about five metres of GPS jitter. With a single threshold — the fence line itself — successive readings fall alternately inside and outside, so the router emits an entry, an exit, an entry and an exit indefinitely, and each of those events is indistinguishable downstream from a real crossing: a billing rule charges for every entry, a notification rule wakes somebody up each time, and an arrival dashboard shows the vehicle arriving forty times an hour. With two thresholds, entry requires the position to be fifteen metres inside the fence and exit requires it to be twenty-five metres outside, so the jittering readings between those lines change nothing at all. A vehicle genuinely driving through crosses both bands within one or two pings, so the cost of the hysteresis is a delay of a single reporting interval, which is negligible against a crossing anyone cares about.</desc>
<rect x="0" y="0" width="760" height="214" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">vehicle parked on the boundary · ±5 m GPS jitter · 10 s reporting</text>
<text x="14" y="40" font-size="9" font-weight="600" fill="var(--fig-rose-edge)">one threshold — the fence line</text>
<line x1="120" y1="72" x2="740" y2="72" stroke="var(--fig-line)" stroke-width="1.6"/>
<text x="30" y="76" font-size="8" fill="var(--fig-ink-soft)">fence line</text>
<circle cx="160" cy="64" r="3.5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="220" cy="80" r="3.5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<circle cx="280" cy="66" r="3.5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="340" cy="79" r="3.5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<circle cx="400" cy="65" r="3.5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="460" cy="81" r="3.5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<circle cx="520" cy="67" r="3.5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="580" cy="78" r="3.5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="150" y="100" font-size="8.5" fill="var(--fig-rose-edge)">enter · exit · enter · exit · enter · exit · enter · exit — 40 "arrivals" an hour, each one billable</text>
<text x="14" y="130" font-size="9" font-weight="600" fill="var(--fig-mint-edge)">two thresholds — enter 15 m inside, exit 25 m outside</text>
<rect x="120" y="150" width="620" height="14" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.1"/>
<text x="30" y="161" font-size="8" fill="var(--fig-ink-soft)">dead band</text>
<circle cx="160" cy="153" r="3.5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<circle cx="240" cy="160" r="3.5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<circle cx="320" cy="154" r="3.5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<circle cx="400" cy="161" r="3.5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<circle cx="480" cy="155" r="3.5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<circle cx="560" cy="159" r="3.5" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="150" y="182" font-size="8.5" fill="var(--fig-mint-edge)">every reading is in the dead band · zero events · state unchanged</text>
<text x="14" y="204" font-size="9" fill="var(--fig-ink-soft)">A vehicle genuinely driving through crosses both bands within a ping or two, so the hysteresis costs one reporting interval.</text>
</svg>
<figcaption><b>Figure 2.</b> The two events on the top line are not noise a consumer can filter — each is byte-identical to a real crossing, so the fix has to be in the router.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `ENTER_BUFFER_M` | `float` | Must exceed measured GPS jitter (typically 5–10 m urban) | `15.0` |
| `EXIT_BUFFER_M` | `float` | Must exceed `ENTER_BUFFER_M`, or the dead band is inverted | `25.0` |
| `prepare()` | call | Once per fence at build time; re-preparing per ping defeats it | — |
| Tree contents | geometry list | The **dilated** zones, since they are the largest candidate set | — |
| `_membership` | `dict[str, set]` | One entry per active asset; must be evicted or it grows forever | — |
| Buffer CRS | — | Degrees here; use a projected CRS where metre accuracy matters | EPSG:4326 |

</div>

## Gotchas and spatial edge cases

1. **Buffering in degrees is only approximately metres, and the error grows with latitude.** A 15 m buffer expressed as degrees is 15 m north–south everywhere, but east–west it is 15 m at the equator and about 7.5 m at 60° north. For a jitter dead band that is acceptable; for a fence whose exact extent is contractual, buffer in a local projected CRS and transform back.

2. **A negative buffer can erase a small fence entirely.** `geometry.buffer(-15/111320)` on a fence twenty metres across returns an empty polygon, and every ping then fails the entry test — the fence silently stops matching anything. Check for emptiness at build time and fall back to the unbuffered geometry with a logged warning.

3. **The membership dictionary makes the router stateful, so it cannot be scaled by adding replicas.** Two instances each see half the pings and each has half the picture, so both emit spurious entries. Partition by asset identifier so every ping for one asset reaches the same instance, exactly as [Spatial Partitioning Strategies](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/) describes for consumers generally.

4. **Membership state has to be evicted.** An asset that stops reporting keeps its entry forever, so a fleet with churn leaks memory in proportion to lifetime asset count. Expire entries after a multiple of the reporting interval, and treat expiry as an exit or not — deliberately, because both choices are defensible and only one of them notifies the depot that the vehicle left.

5. **Overlapping fences are normal and must all fire.** Administrative boundaries nest — a city inside a region inside a country — so one ping legitimately produces three entries. Do not stop at the first match, which is a tempting optimisation that quietly breaks nested subscriptions.

6. **A restart replays the fleet's entire membership as entries.** With empty state, the first ping from every asset inside a fence looks like an arrival. Either persist membership, or mark the first transition after startup with a flag consumers can ignore, as [Idempotent Consumers for Out-of-Order Spatial Events](https://www.geospatialwebhook.com/queue-management-retry-delivery/delivery-guarantees-ordering/idempotent-consumers-for-out-of-order-spatial-events/) discusses.

<figure class="fig">
<svg viewBox="0 0 760 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A stateful geofence router split across two replicas, each seeing half an asset's pings">
<title>Two replicas, two half-pictures, and both emit spurious crossings</title>
<desc>The geofence router holds per-asset membership in memory, which makes it stateful. Deployed as two replicas behind a round-robin distribution, a single vehicle's pings alternate between them: replica one sees pings one, three and five, replica two sees pings two, four and six. Each replica therefore has a membership set built from half the vehicle's history. When the vehicle sits inside a fence, replica one records an entry on its first ping; replica two, having never seen that entry, records its own entry on the next ping — so the depot receives two arrivals for one vehicle. Worse, when the vehicle leaves, whichever replica happens not to see the departing ping keeps the vehicle marked as inside indefinitely. Partitioning by asset identifier instead sends every ping for one vehicle to the same replica, so each asset's membership is complete in exactly one place; the replicas then scale by asset count rather than by ping count, which is the property the stateful design requires.</desc>
<rect x="0" y="0" width="760" height="200" fill="var(--fig-bg)"/>
<defs><marker id="gf3-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">round-robin across replicas — one vehicle, two half-pictures</text>
<text x="30" y="44" font-size="8.5" fill="var(--fig-ink-soft)">veh-1 pings:</text>
<circle cx="112" cy="40" r="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.2"/>
<circle cx="132" cy="40" r="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<circle cx="152" cy="40" r="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.2"/>
<circle cx="172" cy="40" r="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<circle cx="192" cy="40" r="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.2"/>
<circle cx="212" cy="40" r="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<line x1="228" y1="40" x2="256" y2="30" stroke="var(--fig-line)" stroke-width="1.1" marker-end="url(#gf3-a)"/>
<line x1="228" y1="40" x2="256" y2="58" stroke="var(--fig-line)" stroke-width="1.1" marker-end="url(#gf3-a)"/>
<rect x="260" y="18" width="230" height="26" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="270" y="35" font-size="8" fill="var(--fig-ink)">replica 1 · membership from pings 1, 3, 5</text>
<rect x="260" y="48" width="230" height="26" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="270" y="65" font-size="8" fill="var(--fig-ink)">replica 2 · membership from pings 2, 4, 6</text>
<text x="502" y="35" font-size="8.5" fill="var(--fig-rose-edge)">both record an entry → the depot sees two arrivals</text>
<text x="502" y="65" font-size="8.5" fill="var(--fig-rose-edge)">on departure, whichever misses the ping keeps it inside</text>
<line x1="14" y1="92" x2="746" y2="92" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="114" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">partitioned by asset id — one complete picture per vehicle</text>
<rect x="260" y="122" width="230" height="26" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="270" y="139" font-size="8" fill="var(--fig-ink)">replica 1 · every ping for veh-1</text>
<rect x="260" y="152" width="230" height="26" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="270" y="169" font-size="8" fill="var(--fig-ink)">replica 2 · every ping for veh-2</text>
<text x="502" y="139" font-size="8.5" fill="var(--fig-mint-edge)">membership is complete in exactly one place</text>
<text x="502" y="169" font-size="8.5" fill="var(--fig-ink-soft)">replicas scale by asset count, not by ping count</text>
</svg>
<figcaption><b>Figure 3.</b> The router looks stateless from the outside — one ping in, transitions out — which is why it is usually the first service someone scales by adding replicas.</figcaption>
</figure>

## Verification

```python
import pytest
from shapely.geometry import Polygon

YARD = Polygon([(13.400, 52.520), (13.400, 52.524),
                (13.406, 52.524), (13.406, 52.520)])


@pytest.fixture
def router():
    return GeofenceRouter([Geofence("yard-1", ("depot-ops",), YARD)])


def test_entry_then_silence(router):
    """One entry, then nothing while the asset stays inside."""
    assert [e["action"] for e in router.route("veh-1", 13.403, 52.522)] == \
        ["geofence_enter"]
    assert router.route("veh-1", 13.4031, 52.5221) == []


def test_parked_on_the_boundary_emits_nothing(router):
    """The flapping case — jitter across the fence line, inside the band."""
    router.route("veh-2", 13.4030, 52.5220)          # establish: inside
    events = []
    for offset in (0.0000, 0.0001, -0.0001, 0.0001, -0.0001):
        events += router.route("veh-2", 13.4060 + offset, 52.5220)
    assert events == [], f"boundary jitter produced {len(events)} transitions"


def test_nested_fences_all_fire():
    """A city inside a region must produce two entries, not one."""
    region = Polygon([(13.30, 52.45), (13.30, 52.60), (13.55, 52.60), (13.55, 52.45)])
    r = GeofenceRouter([Geofence("yard-1", ("depot",), YARD),
                        Geofence("region-1", ("planning",), region)])
    assert len(r.route("veh-3", 13.403, 52.522)) == 2
```

The middle test only fails when the hysteresis is removed, which is why it is worth writing with explicit coordinates rather than a helper: someone tuning the buffers needs to see the geometry that makes the assertion true.

## Related

- [Sensor Data Routing Patterns](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/) — the topic this guide belongs to
- [Handling Out-of-Order Pings from Intermittent Devices](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/handling-out-of-order-pings-from-intermittent-devices/) — what a late ping does to the membership state above
- [Spatial Partitioning Strategies](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/spatial-partitioning-strategies/) — why this router has to be partitioned by asset rather than by area
- [Time-Windowed Deduplication for Moving Assets](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/temporal-dedup-windows/) — collapsing the ping volume before it reaches the router
