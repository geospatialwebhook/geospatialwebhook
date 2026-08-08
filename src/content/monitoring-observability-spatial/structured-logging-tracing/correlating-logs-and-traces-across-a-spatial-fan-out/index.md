---
title: "Correlating Logs and Traces Across a Spatial Fan-Out"
description: "One feature edit becomes four hundred tile rebuilds, and a trace per tile is unusable. Carry the originating trace as a link rather than a parent, and put the cell and zoom on every span so a query can find them all."
slug: "correlating-logs-and-traces-across-a-spatial-fan-out"
type: "article"
breadcrumb: "Monitoring & Observability for Spatial Pipelines > Structured Logging & Tracing for Spatial Handlers > Correlating Logs and Traces Across a Spatial Fan-Out"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Correlating Logs and Traces Across a Spatial Fan-Out",
      "description": "A single feature edit fans out into hundreds of tile rebuilds, and making each one a child span produces a trace nothing can render. This guide uses span links instead of parentage, puts the spatial dimensions on every span, and keeps sampling coherent across the fan-out.",
      "url": "https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/correlating-logs-and-traces-across-a-spatial-fan-out/",
      "datePublished": "2026-08-08",
      "dateModified": "2026-08-08",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Monitoring & Observability for Spatial Pipelines", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/"},
        {"@type": "ListItem", "position": 3, "name": "Structured Logging & Tracing for Spatial Handlers", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/"},
        {"@type": "ListItem", "position": 4, "name": "Correlating Logs and Traces Across a Spatial Fan-Out", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/correlating-logs-and-traces-across-a-spatial-fan-out/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Correlate logs and traces across a spatial fan-out",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Give each fan-out branch its own trace, linked rather than parented"},
        {"@type": "HowToStep", "position": 2, "name": "Put the cell, zoom and feature id on every span as attributes"},
        {"@type": "HowToStep", "position": 3, "name": "Carry the same identifiers into every log line as structured fields"},
        {"@type": "HowToStep", "position": 4, "name": "Make sampling coherent, so a sampled edit keeps its whole fan-out"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why not make every tile rebuild a child span of the edit?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because a single edit can invalidate hundreds or thousands of tiles, and a trace with that many spans is one no backend will render and no engineer can read. It also distorts every duration in the trace, since the parent span cannot end until the last child does, so a trace that should describe a two-second edit describes a four-hour rebuild queue instead. Span links express the same relationship without forcing everything into one tree."}
        },
        {
          "@type": "Question",
          "name": "What is a span link and how does it differ from a parent?",
          "acceptedAnswer": {"@type": "Answer", "text": "A link records a causal relationship between spans in different traces without making one the child of the other. The rebuild starts its own trace with its own root, and carries a link back to the edit that caused it. Each trace stays small and independently renderable, and a query can still walk from an edit to every rebuild it triggered — or from a slow rebuild back to the edit responsible — which is the question anyone actually asks."}
        },
        {
          "@type": "Question",
          "name": "How do you keep sampling from breaking the correlation?",
          "acceptedAnswer": {"@type": "Answer", "text": "Derive the sampling decision from the originating trace identifier rather than making it independently in each branch. With independent decisions at a one per cent rate, an edit whose trace was sampled has almost none of its rebuilds sampled too, so the correlation exists in principle and never in practice. Hashing the originating trace id and comparing against the rate means every branch of a sampled edit is sampled, and none of an unsampled one is."}
        }
      ]
    }
  ]
}
</script>

**Give each fan-out branch its own trace with a link back to the originating edit rather than making it a child span, put the cell, zoom and feature id on every span, and derive the sampling decision from the originating trace id — independent sampling at one per cent means a sampled edit has almost none of its rebuilds sampled.**

This guide sits under [Structured Logging & Tracing for Spatial Handlers](https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/), within [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/). It is what makes the shard named by an alert in [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/) investigable.

## When to use this pattern

- One input event produces many downstream units of work — tiles, index updates, notifications per subscriber.
- Traces are already in place and are either unusably large or unusably disconnected.
- Investigating "why was this tile stale" currently means grepping logs by timestamp.

## A tree is the wrong shape for a fan-out

<figure class="fig">
<svg viewBox="0 0 760 236" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="One edit parented over four hundred rebuild spans, versus separate linked traces">
<title>Four hundred children, or four hundred linked traces</title>
<desc>A single boundary edit invalidates four hundred tiles. Modelled as parentage, the edit's span becomes the root of a tree with four hundred children, some of which have children of their own for the render and upload steps — well over a thousand spans in one trace. No tracing backend renders that usefully, and the root span cannot end until the last child does, so a trace that should describe a two-second edit reports a duration of four hours, which is the length of the rebuild queue rather than of anything the edit did. Every percentile computed over edit spans is then a percentile of queue depth. Modelled as links, the edit is one small trace of half a dozen spans that ends when the edit is published, and each rebuild is its own small trace carrying a link back to it. Both traces render instantly, the edit's duration is the edit's duration, and a query can still walk in either direction — from the edit to all four hundred rebuilds, or from one slow rebuild back to the edit that caused it. The relationship is preserved without forcing it into a shape that the tooling and the arithmetic both reject.</desc>
<rect x="0" y="0" width="760" height="236" fill="var(--fig-bg)"/>
<defs><marker id="tr-a" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto"><path d="M0,0 L6,2.5 L0,5 Z" fill="var(--fig-line)"/></marker></defs>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">parentage — one trace, 1 000+ spans</text>
<rect x="30" y="28" width="110" height="22" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="40" y="43" font-size="8" fill="var(--fig-ink)">edit (root)</text>
<line x1="86" y1="52" x2="86" y2="62" stroke="var(--fig-line)" stroke-width="1.1"/>
<line x1="60" y1="62" x2="330" y2="62" stroke="var(--fig-line)" stroke-width="1.1"/>
<line x1="60" y1="62" x2="60" y2="72" stroke="var(--fig-line)" stroke-width="1.1" marker-end="url(#tr-a)"/>
<line x1="120" y1="62" x2="120" y2="72" stroke="var(--fig-line)" stroke-width="1.1" marker-end="url(#tr-a)"/>
<line x1="180" y1="62" x2="180" y2="72" stroke="var(--fig-line)" stroke-width="1.1" marker-end="url(#tr-a)"/>
<line x1="240" y1="62" x2="240" y2="72" stroke="var(--fig-line)" stroke-width="1.1" marker-end="url(#tr-a)"/>
<line x1="300" y1="62" x2="300" y2="72" stroke="var(--fig-line)" stroke-width="1.1" marker-end="url(#tr-a)"/>
<rect x="40" y="74" width="40" height="16" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="100" y="74" width="40" height="16" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="160" y="74" width="40" height="16" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="220" y="74" width="40" height="16" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<rect x="280" y="74" width="40" height="16" rx="3" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1"/>
<text x="330" y="86" font-size="8.5" fill="var(--fig-rose-edge)">…× 400, each with render and upload children</text>
<text x="30" y="110" font-size="8.5" fill="var(--fig-rose-edge)">the root cannot end until the last child does, so a 2-second edit reports a 4-hour duration</text>
<text x="30" y="124" font-size="8.5" fill="var(--fig-rose-edge)">— every percentile over edit spans becomes a percentile of queue depth</text>
<line x1="14" y1="140" x2="746" y2="140" stroke="var(--fig-line-soft)" stroke-width="1"/>
<text x="14" y="160" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">links — many small traces</text>
<rect x="30" y="170" width="110" height="22" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="40" y="185" font-size="8" fill="var(--fig-ink)">edit · 6 spans</text>
<path d="M144,181 L184,181" fill="none" stroke="var(--fig-mint-edge)" stroke-width="1.3" stroke-dasharray="3 2" marker-end="url(#tr-a)"/>
<rect x="190" y="170" width="96" height="22" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="198" y="185" font-size="7.5" fill="var(--fig-ink)">rebuild z14</text>
<rect x="294" y="170" width="96" height="22" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="302" y="185" font-size="7.5" fill="var(--fig-ink)">rebuild z15</text>
<rect x="398" y="170" width="96" height="22" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="406" y="185" font-size="7.5" fill="var(--fig-ink)">rebuild z16</text>
<text x="506" y="185" font-size="8.5" fill="var(--fig-ink-soft)">…each its own trace, each carrying a link back</text>
<text x="30" y="212" font-size="8.5" fill="var(--fig-mint-edge)">both render instantly · the edit's duration is the edit's duration · queries still walk in either direction</text>
<text x="30" y="226" font-size="8.5" fill="var(--fig-ink-soft)">from the edit to all 400 rebuilds, or from one slow rebuild back to its cause</text>
</svg>
<figcaption><b>Figure 1.</b> The duration distortion is the part that outlives the rendering problem: parented, every edit-latency percentile silently measures the rebuild queue.</figcaption>
</figure>

## Complete runnable implementation

```python
import hashlib
import json
import logging

from opentelemetry import trace
from opentelemetry.trace import Link, SpanContext, TraceFlags

tracer = trace.get_tracer("tile-pipeline")
log = logging.getLogger("tile-pipeline")

SAMPLE_RATE = 0.01


def coherent_sample(origin_trace_id: int, rate: float = SAMPLE_RATE) -> bool:
    """Sample the whole fan-out or none of it.

    Deciding independently per branch at 1% means a sampled edit has almost
    none of its rebuilds sampled, so the correlation exists in principle and
    never in practice. Deriving from the origin makes it all-or-nothing.
    """
    digest = hashlib.blake2b(str(origin_trace_id).encode(), digest_size=8).digest()
    return int.from_bytes(digest, "big") / 2**64 < rate


def spatial_attributes(feature_id: str, cell: str, zoom: int | None = None) -> dict:
    """The dimensions every query in an investigation filters on.

    Without these a trace can be found only by time, which for a fan-out of
    four hundred concurrent rebuilds narrows nothing.
    """
    attrs = {
        "geo.feature_id": feature_id,
        "geo.cell": cell,
        "geo.cell_resolution": 8,
        "geo.crs": "EPSG:4326",
    }
    if zoom is not None:
        attrs["tile.zoom"] = zoom
    return attrs


def handle_edit(event: dict, enqueue) -> None:
    """The originating trace. Small, and it ends when the edit is published."""
    with tracer.start_as_current_span(
        "feature.edit",
        attributes=spatial_attributes(event["feature_id"], event["routing_key"]),
    ) as span:
        ctx = span.get_span_context()
        tiles = tiles_to_invalidate(event)

        span.set_attribute("fanout.tile_count", len(tiles))
        _log("edit received", event["feature_id"], event["routing_key"],
             trace_id=f"{ctx.trace_id:032x}", fanout=len(tiles))

        for tile in tiles:
            # Propagate the ORIGIN context, not the current span as a parent.
            enqueue({
                "tile": tile,
                "feature_id": event["feature_id"],
                "origin_trace_id": f"{ctx.trace_id:032x}",
                "origin_span_id": f"{ctx.span_id:016x}",
            })


def handle_rebuild(job: dict) -> None:
    """A new root trace, linked back to the edit that caused it."""
    origin = SpanContext(
        trace_id=int(job["origin_trace_id"], 16),
        span_id=int(job["origin_span_id"], 16),
        is_remote=True,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
    )

    with tracer.start_as_current_span(
        "tile.rebuild",
        links=[Link(origin, {"link.type": "caused_by"})],
        attributes=spatial_attributes(job["feature_id"], job["tile"].cell,
                                      zoom=job["tile"].z),
    ) as span:
        ctx = span.get_span_context()
        _log("rebuild started", job["feature_id"], job["tile"].cell,
             trace_id=f"{ctx.trace_id:032x}",
             origin_trace_id=job["origin_trace_id"], zoom=job["tile"].z)
        render(job["tile"])


def _log(message: str, feature_id: str, cell: str, **fields) -> None:
    """One structured line. The same field names as the span attributes.

    Different names in logs and traces means every investigation is two
    vocabularies, and the join has to be done by a human.
    """
    log.info(json.dumps({
        "message": message,
        "geo.feature_id": feature_id,
        "geo.cell": cell,
        **fields,
    }))
```

<figure class="fig">
<svg viewBox="0 0 760 218" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Independent per-branch sampling losing the correlation, versus a decision derived from the origin trace id">
<title>Independent sampling destroys exactly what the links were for</title>
<desc>An edit fans out into four hundred tile rebuilds, with tracing sampled at one per cent. If each branch decides independently, the edit has a one in a hundred chance of being sampled and each rebuild has its own one in a hundred chance, so an edit that is sampled has on average four of its four hundred rebuilds sampled — and the four are a different four every time. Following a sampled edit to its rebuilds therefore almost always leads to a nearly empty result, and following a sampled slow rebuild back to its edit finds the edit unsampled ninety-nine times out of a hundred. The correlation was built and then made unusable by the sampler. Deriving the decision from a hash of the originating trace identifier makes it all-or-nothing: one edit in a hundred is sampled along with every one of its four hundred rebuilds, and the other ninety-nine are sampled nowhere. The total volume is identical — one per cent of spans either way — but what is retained is a complete picture of one per cent of edits instead of a scattering of fragments from all of them.</desc>
<rect x="0" y="0" width="760" height="218" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">one edit → 400 rebuilds · sampling at 1%</text>
<rect x="14" y="30" width="366" height="140" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">independent decision per branch</text>
<circle cx="40" cy="72" r="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="54" y="76" font-size="8.5" fill="var(--fig-ink-soft)">edit sampled</text>
<circle cx="150" cy="72" r="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="164" cy="72" r="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="178" cy="72" r="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<circle cx="192" cy="72" r="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="210" y="76" font-size="8.5" fill="var(--fig-rose-edge)">4 of 400 rebuilds</text>
<text x="26" y="102" font-size="8.5" fill="var(--fig-rose-edge)">following a sampled edit leads to a nearly empty result</text>
<text x="26" y="120" font-size="8.5" fill="var(--fig-rose-edge)">following a slow rebuild back finds its edit unsampled</text>
<text x="26" y="132" font-size="8.5" fill="var(--fig-rose-edge)">99 times out of 100</text>
<text x="26" y="156" font-size="8.5" fill="var(--fig-ink-soft)">the correlation was built, then made unusable by the sampler</text>
<rect x="392" y="30" width="354" height="140" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="404" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">decision derived from the origin trace id</text>
<circle cx="418" cy="72" r="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.4"/>
<text x="432" y="76" font-size="8.5" fill="var(--fig-ink-soft)">edit sampled →</text>
<rect x="520" y="66" width="210" height="12" rx="3" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="560" y="76" font-size="7.5" fill="var(--fig-ink)">all 400 rebuilds sampled</text>
<text x="404" y="102" font-size="8.5" fill="var(--fig-mint-edge)">one edit in a hundred, complete</text>
<text x="404" y="120" font-size="8.5" fill="var(--fig-ink-soft)">the other ninety-nine sampled nowhere</text>
<text x="404" y="144" font-size="8.5" fill="var(--fig-ink-soft)">identical total volume — 1% of spans either way</text>
<text x="404" y="158" font-size="8.5" fill="var(--fig-mint-edge)">what changes is whether any single picture is complete</text>
<text x="14" y="196" font-size="9" fill="var(--fig-ink-soft)">A complete picture of one per cent of edits beats a scattering of fragments from all of them, and costs exactly the same storage.</text>
<text x="14" y="210" font-size="9" fill="var(--fig-ink-soft)">The decision is a hash comparison, so no coordination between services is needed.</text>
</svg>
<figcaption><b>Figure 2.</b> Both schemes retain one per cent of spans. Only one of them retains anything you can follow from end to end.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `origin_trace_id` | `str` | Propagated in the job payload, not in the parent context | — |
| `Link` | span link | `caused_by`; keeps each trace independently renderable | — |
| `geo.cell` | `str` | H3 cell at a stated resolution; the primary investigation filter | res 8 |
| `tile.zoom` | `int` | Present on rebuild spans only | — |
| `SAMPLE_RATE` | `float` | Applied to origins, not branches | `0.01` |
| Log field names | — | Identical to span attribute names, or every query is two vocabularies | — |

</div>

## Gotchas and spatial edge cases

1. **Cell as a span attribute is fine; cell as a metric label is not.** Attributes are stored per span and queried after the fact, so high cardinality costs storage; metric labels create a time series each, and a resolution-8 cell space would create millions. The two look similar and have completely different cost models.

2. **Log field names must match the span attribute names exactly.** `geo.cell` in one and `h3_index` in the other means every investigation involves translating between two vocabularies, and the automated join most backends offer will not find anything.

3. **The originating trace id has to be in the job payload.** Relying on context propagation across a broker means it survives only if every producer, broker client and consumer preserves headers — and the first component that does not silently breaks the chain. An explicit field in the message body survives transports and archives.

4. **A rebuild that fans out again needs the same treatment.** If a tile rebuild triggers downstream cache invalidations, those link to the rebuild rather than back to the edit, so the chain is walkable one hop at a time. Flattening every level to link to the original edit loses the intermediate structure that explains where the time went.

5. **Sampled-out branches still need logs.** Coherent sampling means ninety-nine per cent of rebuilds produce no trace at all, so structured logs carrying the cell and feature id remain the only record for those. Log at a lower volume rather than not at all, and keep the same fields.

6. **The fan-out count belongs on the edit span.** `fanout.tile_count` turns "this edit was expensive" into a queryable fact, and it is the single most useful attribute when investigating why a rebuild queue grew — usually one edit to a very large feature, which [Scoping Tile Invalidation to the Zoom Levels That Changed](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/scoping-tile-invalidation-to-the-zoom-levels-that-changed/) exists to reduce.

<figure class="fig">
<svg viewBox="0 0 760 190" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The same spatial dimension used as a span attribute and as a metric label, with very different costs">
<title>Attribute or label — the same field, two cost models</title>
<desc>An H3 cell identifier at resolution 8 is attached to telemetry in two places. As a span attribute it is one key-value pair stored alongside each span, queried after the fact, and costs storage proportional to the number of sampled spans — which at one per cent sampling is a small and predictable amount, and gives an investigation the ability to filter directly to one cell. As a metric label it creates a distinct time series per cell value, and a fleet spanning a hundred thousand active resolution-8 cells therefore creates a hundred thousand series per metric, each with its own retention and its own memory in the scrape target. Adding the zoom level as a second label multiplies that again. The two look identical in code — the same string on the same event — and their costs differ by orders of magnitude, which is why the cell belongs on spans and a coarse region code belongs on metrics.</desc>
<rect x="0" y="0" width="760" height="190" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">the same H3 cell string, attached in two places</text>
<rect x="14" y="30" width="366" height="118" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.7"/>
<text x="26" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">span attribute — geo.cell</text>
<text x="26" y="72" font-size="8.5" fill="var(--fig-ink-soft)">one key-value pair per sampled span</text>
<text x="26" y="88" font-size="8.5" fill="var(--fig-ink-soft)">queried after the fact, not indexed in advance</text>
<text x="26" y="110" font-size="8.5" fill="var(--fig-mint-edge)">cost scales with sampled spans — at 1%, small and predictable</text>
<text x="26" y="132" font-size="8.5" fill="var(--fig-ink)">lets an investigation filter straight to one cell</text>
<rect x="392" y="30" width="354" height="118" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.7"/>
<text x="404" y="50" font-size="9.5" font-weight="600" fill="var(--fig-ink)">metric label — cell="..."</text>
<text x="404" y="72" font-size="8.5" fill="var(--fig-ink-soft)">one time series per distinct value</text>
<text x="404" y="88" font-size="8.5" fill="var(--fig-rose-edge)">100 000 active res-8 cells → 100 000 series per metric</text>
<text x="404" y="110" font-size="8.5" fill="var(--fig-rose-edge)">add zoom as a second label and multiply again</text>
<text x="404" y="132" font-size="8.5" fill="var(--fig-ink-soft)">use a coarse region code here instead</text>
<text x="14" y="176" font-size="9" fill="var(--fig-ink-soft)">Identical in code — the same string on the same event — and the costs differ by orders of magnitude.</text>
</svg>
<figcaption><b>Figure 3.</b> The mistake is easy because the two look the same at the call site. The cell belongs on spans; metrics get a coarse region code.</figcaption>
</figure>

## Verification

```python
import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


@pytest.fixture
def spans():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    yield exporter
    exporter.clear()


def test_rebuild_is_a_root_with_a_link_not_a_child(spans):
    jobs = []
    handle_edit(_edit(feature_id="4471"), enqueue=jobs.append)
    handle_rebuild(jobs[0])

    edit, rebuild = spans.get_finished_spans()
    assert rebuild.parent is None, "rebuild must not be parented to the edit"
    assert rebuild.links[0].context.trace_id == edit.context.trace_id


def test_every_span_carries_the_spatial_dimensions(spans):
    jobs = []
    handle_edit(_edit(feature_id="4471"), enqueue=jobs.append)
    handle_rebuild(jobs[0])

    for span in spans.get_finished_spans():
        assert "geo.feature_id" in span.attributes
        assert "geo.cell" in span.attributes


def test_sampling_is_all_or_nothing_per_edit():
    """Independent decisions would give ~4 of 400; this must give 0 or 400."""
    sampled_origins = [t for t in range(10_000) if coherent_sample(t)]
    for origin in sampled_origins[:20]:
        assert all(coherent_sample(origin) for _ in range(400))
    assert 50 < len(sampled_origins) < 150      # ~1% of 10 000


def test_origin_id_travels_in_the_payload_not_the_context(spans):
    """It must survive a broker that drops headers."""
    jobs = []
    handle_edit(_edit(feature_id="4471"), enqueue=jobs.append)
    assert "origin_trace_id" in jobs[0] and "origin_span_id" in jobs[0]
```

The first test is the one that fails if someone replaces the link with a parent while "tidying up the tracing" — a change that looks like a simplification, produces a more familiar-looking trace tree, and silently turns every edit-latency measurement into a measurement of the rebuild queue.

## Related

- [Structured Logging & Tracing for Spatial Handlers](https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/) — the topic this guide belongs to
- [Adding OpenTelemetry Spans to Async Geometry Handlers](https://www.geospatialwebhook.com/monitoring-observability-spatial/structured-logging-tracing/adding-opentelemetry-spans-to-async-geometry-handlers/) — instrumenting the handler that these spans wrap
- [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/) — the alert that names the shard these traces then explain
- [Scoping Tile Invalidation to the Zoom Levels That Changed](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/scoping-tile-invalidation-to-the-zoom-levels-that-changed/) — reducing the fan-out count these traces make visible
