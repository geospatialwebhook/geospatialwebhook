---
title: "Dead-Letter Queues for Spatial Payloads"
description: "Design a dead-letter queue for geospatial events: capture raw payload, failed stage, geometry-validity error, idempotency key, and offload pointer for safe replay."
slug: "dead-letter-queues-spatial"
type: "guide"
breadcrumb: "Queue Management, Retries & Delivery Guarantees > Dead-Letter Queues for Spatial Payloads"
datePublished: "2025-02-10"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Dead-Letter Queues for Spatial Payloads",
      "description": "How to design a dead-letter queue for geospatial webhook events that captures the raw payload, the failed pipeline stage, the specific geometry-validity error, the idempotency key, and an offload pointer for oversized geometries — enabling safe replay under exactly-once semantics.",
      "url": "https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/",
      "datePublished": "2025-02-10",
      "dateModified": "2026-07-13",
      "author": {"@type": "Organization", "name": "geospatialwebhook.com"},
      "publisher": {"@type": "Organization", "name": "geospatialwebhook.com"}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.geospatialwebhook.com/"},
        {"@type": "ListItem", "position": 2, "name": "Queue Management, Retries & Delivery Guarantees", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/"},
        {"@type": "ListItem", "position": 3, "name": "Dead-Letter Queues for Spatial Payloads", "item": "https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Design a dead-letter queue for geospatial webhook events",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Classify the failure as invalid geometry, transient broker error, or schema violation"},
        {"@type": "HowToStep", "position": 2, "name": "Build a dead-letter envelope capturing payload, failed stage, geometry error, and idempotency key"},
        {"@type": "HowToStep", "position": 3, "name": "Offload oversized geometries to object storage and store only a pointer"},
        {"@type": "HowToStep", "position": 4, "name": "Route the failed event to the dead-letter backend after retries are exhausted"},
        {"@type": "HowToStep", "position": 5, "name": "Replay from the dead-letter store while preserving exactly-once semantics via the idempotency key"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What should a spatial dead-letter record capture beyond a normal DLQ entry?",
          "acceptedAnswer": {"@type": "Answer", "text": "Beyond the raw payload and error message that any dead-letter record holds, a spatial record must capture the pipeline stage that failed (parse, CRS transform, topology validation, or spatial join), the precise geometry-validity error including the offending vertex or ring, the CRS with its EPSG code when a mismatch caused the failure, the assigned idempotency key so replay stays exactly-once, and a size or offload pointer when the geometry is too large to store inline."}
        },
        {
          "@type": "Question",
          "name": "How do I stop a dead-letter queue from replaying the same event twice?",
          "acceptedAnswer": {"@type": "Answer", "text": "Carry the idempotency key assigned at ingestion into the dead-letter envelope and reuse it verbatim on replay. The consumer performs its normal atomic claim on that key before doing any spatial work, so a replayed event that was in fact already processed short-circuits harmlessly. Never regenerate the key at replay time, because a re-serialised payload can hash differently and defeat the guarantee."}
        },
        {
          "@type": "Question",
          "name": "Should invalid geometries and transient broker errors go to the same dead-letter queue?",
          "acceptedAnswer": {"@type": "Answer", "text": "Route them to separate destinations. Transient broker errors are worth retrying with exponential backoff and usually recover on their own, so they should only reach the dead-letter store after the retry budget is exhausted. Invalid geometry and schema violations are deterministic and will never succeed on replay without human or upstream correction, so they belong in a poison queue that triggers an alert rather than an automatic retry loop."}
        },
        {
          "@type": "Question",
          "name": "How do I dead-letter a 40 MB MultiPolygon without bloating the queue?",
          "acceptedAnswer": {"@type": "Answer", "text": "Offload the raw geometry to object storage such as S3 or a large-object column, and store only a pointer (bucket, key, byte size, and content hash) inside the dead-letter envelope. The broker message stays small and fast to scan, while the full payload remains recoverable for replay. Record the content hash so you can verify the offloaded blob was not truncated or corrupted before you re-inject it."}
        }
      ]
    }
  ]
}
</script>

**A spatial dead-letter queue is a durable holding area for geospatial events that failed processing, and it earns its place only when each record captures enough context — raw payload, failed stage, exact geometry error, CRS with EPSG code, idempotency key, and an offload pointer for oversized geometries — to make a later replay safe and exactly-once.**

This topic is part of [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/), the discipline of moving geospatial webhook events through a broker without losing them, duplicating their side effects, or letting one poison payload stall an entire partition.

---

## Prerequisites

Before wiring up a dead-letter path, confirm your stack meets the following baseline. Check off each item as you verify it:

- [ ] **Python 3.11+** — required for `StrEnum`, `Self`, and the exception-group ergonomics used in the routing code
- [ ] **`pydantic` 2.x** — the dead-letter envelope is a strict Pydantic model with typed enums
- [ ] **`shapely` 2.0+** — `explain_validity` produces the human-readable topology error stored in the record
- [ ] **`pyproj` 3.6+** — needed to detect and report CRS mismatches by EPSG code
- [ ] **A broker with a DLQ primitive** — Kafka + a `*.DLT` topic, RabbitMQ with a dead-letter exchange, or Redis Streams with a parked-message list
- [ ] **Durable object storage** — S3, MinIO, or a `bytea` / large-object column for offloading geometries above the broker message-size limit
- [ ] **An existing idempotency key per event** — assigned at ingestion so replay can reuse it verbatim

---

## Architecture Overview

A dead-letter queue is not a second inbox. It is a branch off the consumer that captures *why* an event could not be processed, in enough spatial detail that a human or an automated replay job can act on it later. The consumer attempts processing, and only when a failure is classified as terminal (or the retry budget is spent) does the event cross into the dead-letter branch with a fully populated envelope.

<figure class="fig">
<svg viewBox="0 16 753 302" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Consumer pipeline with a dead-letter branch capturing failed geospatial events">
  <title>Spatial dead-letter branch off the consumer</title>
  <desc>A broker delivers events to a consumer that runs parse, CRS transform, and topology validation stages. Transient failures loop back through retry with backoff; terminal failures branch down into a dead-letter envelope which writes to a durable store and offloads oversized geometry to object storage. A replay worker reads the store and re-injects events using the preserved idempotency key.</desc>
  <rect x="0" y="16" width="753" height="302" fill="var(--fig-bg)"/>
  <defs>
    <marker id="dlq-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Broker -->
  <rect x="12" y="40" width="110" height="50" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="67" y="62" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Broker</text>
  <text x="67" y="77" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">Kafka / Redis</text>
  <line x1="122" y1="65" x2="152" y2="65" stroke="currentColor" stroke-width="1.5" marker-end="url(#dlq-arr)" opacity="0.55"/>
  <!-- Consumer -->
  <rect x="154" y="30" width="180" height="72" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="244" y="52" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Consumer</text>
  <text x="244" y="68" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">parse → CRS → topology</text>
  <text x="244" y="82" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">→ spatial join</text>
  <!-- success out -->
  <line x1="334" y1="52" x2="420" y2="52" stroke="currentColor" stroke-width="1.5" marker-end="url(#dlq-arr)" opacity="0.55"/>
  <text x="377" y="44" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">ack</text>
  <rect x="422" y="30" width="120" height="44" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="482" y="49" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Processed</text>
  <text x="482" y="63" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">DB · tiles</text>
  <!-- transient retry loop -->
  <path d="M244 104 q -36 36 -70 0" fill="none" stroke="currentColor" stroke-width="1.2" marker-end="url(#dlq-arr)" opacity="0.4" stroke-dasharray="4,3"/>
  <text x="118" y="120" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">transient → retry + backoff</text>
  <!-- terminal branch down -->
  <line x1="244" y1="102" x2="244" y2="150" stroke="currentColor" stroke-width="1.5" marker-end="url(#dlq-arr)" opacity="0.55"/>
  <text x="256" y="132" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">terminal / budget spent</text>
  <!-- envelope builder -->
  <rect x="154" y="152" width="180" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="244" y="174" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">DL envelope</text>
  <text x="244" y="190" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">stage · error · CRS</text>
  <text x="244" y="203" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">idempotency key</text>
  <!-- offload -->
  <line x1="334" y1="182" x2="420" y2="182" stroke="currentColor" stroke-width="1.5" marker-end="url(#dlq-arr)" opacity="0.55"/>
  <text x="377" y="174" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.65">large geom</text>
  <rect x="422" y="158" width="120" height="48" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="482" y="178" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Object store</text>
  <text x="482" y="192" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">S3 blob + hash</text>
  <!-- envelope to store -->
  <line x1="244" y1="212" x2="244" y2="252" stroke="currentColor" stroke-width="1.5" marker-end="url(#dlq-arr)" opacity="0.55"/>
  <rect x="154" y="254" width="180" height="50" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="244" y="276" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Dead-letter store</text>
  <text x="244" y="291" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">DLT topic / PostGIS table</text>
  <!-- replay worker -->
  <rect x="560" y="254" width="180" height="50" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="650" y="276" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" font-weight="600">Replay worker</text>
  <text x="650" y="291" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">reuse idempotency key</text>
  <line x1="334" y1="279" x2="558" y2="279" stroke="currentColor" stroke-width="1.5" marker-end="url(#dlq-arr)" opacity="0.55"/>
  <!-- replay back to broker -->
  <line x1="650" y1="254" x2="650" y2="65" stroke="currentColor" stroke-width="1.2" marker-end="url(#dlq-arr)" opacity="0.4" stroke-dasharray="4,3"/>
  <line x1="650" y1="65" x2="124" y2="65" stroke="currentColor" stroke-width="1.2" marker-end="url(#dlq-arr)" opacity="0.4" stroke-dasharray="4,3"/>
  <text x="655" y="160" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.6">re-inject</text>
</svg>
<figcaption><b>Figure 1.</b> Spatial dead-letter branch off the consumer</figcaption>
</figure>

**Layer breakdown:**

1. **Consumer with classified failure** — each processing stage (parse, CRS transform, topology validation, spatial join) can fail. The consumer maps the raised exception to a failure class before deciding where the event goes.
2. **Retry branch (transient only)** — broker timeouts, connection resets, and downstream `503`s loop back through [Exponential Backoff & Jitter for Spatial Webhooks](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/). The dead-letter path is the *destination* those retries fall into once the budget is exhausted, not a substitute for them.
3. **Envelope construction and offload** — terminal failures are wrapped in a dead-letter envelope that records the failed stage, the exact geometry error, the CRS with EPSG code, and the preserved idempotency key. Oversized geometries are written to object storage and replaced by a pointer.
4. **Durable dead-letter store** — a Kafka `*.DLT` topic, a PostGIS table, or a Redis parked list holds the envelope until a replay worker or a human operator acts on it, reusing the idempotency key to keep the whole cycle exactly-once.

---

## Step-by-Step Implementation

### Step 1 — Classify the Failure

The single most important design decision in a dead-letter path is deciding what *not* to dead-letter automatically. Three failure classes behave completely differently on replay: a transient broker error will likely succeed on retry, an invalid geometry will never succeed until the data is corrected, and a schema violation is a contract breach that needs an upstream fix. Collapsing them into one queue produces either an infinite poison loop or a graveyard of retryable events nobody replays.

```python
from __future__ import annotations
from enum import StrEnum


class FailureClass(StrEnum):
    """How a failed spatial event should be treated downstream."""
    TRANSIENT = "transient"        # broker/network/downstream 5xx — retry, then DLQ
    INVALID_GEOMETRY = "invalid_geometry"  # deterministic — never auto-retry
    SCHEMA_VIOLATION = "schema_violation"  # contract breach — never auto-retry
    CRS_MISMATCH = "crs_mismatch"  # deterministic — needs reprojection or upstream fix
    UNKNOWN = "unknown"            # unclassified — DLQ and alert a human


class PipelineStage(StrEnum):
    PARSE = "parse"
    CRS_TRANSFORM = "crs_transform"
    TOPOLOGY_VALIDATION = "topology_validation"
    SPATIAL_JOIN = "spatial_join"
    PERSIST = "persist"


# Domain exceptions raised by each stage
class TransientBrokerError(Exception): ...
class GeometryValidityError(Exception): ...
class SchemaViolationError(Exception): ...
class CRSMismatchError(Exception):
    def __init__(self, message: str, epsg: int | None) -> None:
        super().__init__(message)
        self.epsg = epsg


def classify(exc: Exception) -> FailureClass:
    """Map a raised exception to a failure class. Order matters: check the
    deterministic, non-retryable classes before the catch-all."""
    match exc:
        case TransientBrokerError():
            return FailureClass.TRANSIENT
        case GeometryValidityError():
            return FailureClass.INVALID_GEOMETRY
        case CRSMismatchError():
            return FailureClass.CRS_MISMATCH
        case SchemaViolationError():
            return FailureClass.SCHEMA_VIOLATION
        case _:
            return FailureClass.UNKNOWN
```

Only `TRANSIENT` and `UNKNOWN` are candidates for automatic replay. The deterministic classes are parked for human or upstream correction. The upstream discipline that produces the `GeometryValidityError` in the first place is covered in [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/); the dead-letter record simply preserves what that pipeline reported.

---

### Step 2 — Define the Dead-Letter Envelope

The envelope is the contract between the failing consumer and the eventual replay. A normal DLQ record carries the payload and an error string; a spatial one carries the geometry-validity detail, the failed stage, the CRS with its EPSG code, the idempotency key, and — crucially — a `GeometryRef` that is either the inline geometry or a pointer to an offloaded blob.

```python
from datetime import datetime, timezone
from typing import Any, Self
from pydantic import BaseModel, Field, model_validator


class GeometryRef(BaseModel):
    """Either the geometry is inline, or it lives in object storage and we
    keep only a pointer. Exactly one of the two must be populated."""
    inline: dict[str, Any] | None = None          # GeoJSON per RFC 7946
    offload_uri: str | None = None                # e.g. s3://dlq-geom/2026/…
    byte_size: int = 0
    content_sha256: str | None = None             # integrity check for replay

    @model_validator(mode="after")
    def exactly_one_source(self) -> Self:
        if bool(self.inline) == bool(self.offload_uri):
            raise ValueError("set exactly one of inline / offload_uri")
        return self


class GeometryError(BaseModel):
    """The specific validity problem that failed the geometry."""
    reason: str                        # from shapely explain_validity()
    location: list[float] | None = None  # offending vertex [lon, lat]
    epsg: int | None = None            # populated on a CRS mismatch


class DeadLetterEnvelope(BaseModel):
    """Everything a replay job needs to act safely on a failed spatial event."""
    schema_version: str = "dlq.v1"
    event_id: str
    idempotency_key: str               # preserved verbatim from ingestion
    failure_class: FailureClass
    failed_stage: PipelineStage
    error_message: str
    geometry_error: GeometryError | None = None
    source_crs: str = "EPSG:4326"      # always carry the EPSG code
    geometry: GeometryRef
    raw_payload: dict[str, Any]        # untouched original, minus offloaded geom
    attempts: int = Field(ge=1)        # how many times it was tried before DLQ
    first_seen_at: datetime
    dead_lettered_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
```

Keeping `raw_payload` untouched (aside from swapping the geometry for a pointer) matters: replay must reconstruct the *exact* bytes the consumer originally saw, or the idempotency key derived from it will no longer match.

---

### Step 3 — Offload Oversized Geometries

A single continent-scale `MultiPolygon` or a densely sampled sensor track can exceed Kafka's default 1 MB message limit and will be rejected outright — meaning your dead-letter write itself fails, and the event is lost. Offload anything above a threshold to object storage and store only the pointer.

```python
import hashlib
import json

OFFLOAD_THRESHOLD_BYTES = 256 * 1024  # keep DLQ messages small and scannable


def build_geometry_ref(geometry: dict, object_store, key_prefix: str) -> GeometryRef:
    """Inline small geometries; offload large ones to object storage and
    return a pointer with a content hash for later integrity verification."""
    encoded = json.dumps(geometry, sort_keys=True).encode("utf-8")
    size = len(encoded)
    digest = hashlib.sha256(encoded).hexdigest()

    if size <= OFFLOAD_THRESHOLD_BYTES:
        return GeometryRef(inline=geometry, byte_size=size, content_sha256=digest)

    # Large geometry: write the blob, keep only a pointer in the envelope
    object_key = f"{key_prefix}/{digest}.geojson"
    object_store.put_object(Key=object_key, Body=encoded)  # e.g. boto3 client
    return GeometryRef(
        offload_uri=f"s3://dlq-geom/{object_key}",
        byte_size=size,
        content_sha256=digest,
    )
```

Using the content hash as the object key deduplicates identical failing geometries automatically and gives replay a way to detect a truncated or corrupted blob before it is re-injected.

---

### Step 4 — Route a Failed Event to the Dead-Letter Store

This is the function the consumer calls when a stage raises. It classifies the error, extracts the geometry-specific detail, builds the envelope, and publishes it to the correct destination — a retryable dead-letter for transient failures, a poison store for deterministic ones.

```python
import logging
from shapely.geometry import shape
from shapely.validation import explain_validity

logger = logging.getLogger(__name__)


def _extract_geometry_error(
    exc: Exception, raw_geometry: dict | None
) -> GeometryError | None:
    """Pull a precise, human-readable validity error out of the exception."""
    if isinstance(exc, CRSMismatchError):
        return GeometryError(reason=str(exc), epsg=exc.epsg)
    if isinstance(exc, GeometryValidityError) and raw_geometry is not None:
        geom = shape(raw_geometry)
        # explain_validity() returns e.g. "Self-intersection[12.5 41.9]"
        reason = explain_validity(geom)
        return GeometryError(reason=reason)
    return None


def route_to_dead_letter(
    *,
    raw_payload: dict,
    idempotency_key: str,
    failed_stage: PipelineStage,
    exc: Exception,
    attempts: int,
    first_seen_at: datetime,
    object_store,
    dlq_publisher,
) -> DeadLetterEnvelope:
    """Wrap a failed spatial event with full context and publish it."""
    failure_class = classify(exc)
    raw_geometry = raw_payload.get("geometry")

    geom_ref = build_geometry_ref(
        raw_geometry or {"type": "GeometryCollection", "geometries": []},
        object_store,
        key_prefix="2026/dlq",
    )

    # The raw payload we persist must not double-store a large offloaded geom
    persisted_payload = dict(raw_payload)
    if geom_ref.offload_uri is not None:
        persisted_payload["geometry"] = {"$ref": geom_ref.offload_uri}

    envelope = DeadLetterEnvelope(
        event_id=raw_payload.get("event_id", "unknown"),
        idempotency_key=idempotency_key,
        failure_class=failure_class,
        failed_stage=failed_stage,
        error_message=str(exc),
        geometry_error=_extract_geometry_error(exc, raw_geometry),
        source_crs=raw_payload.get("crs", "EPSG:4326"),
        geometry=geom_ref,
        raw_payload=persisted_payload,
        attempts=attempts,
        first_seen_at=first_seen_at,
    )

    # Deterministic failures never auto-retry; they go to a poison store + alert
    destination = (
        "spatial.events.retry.dlt"
        if failure_class in {FailureClass.TRANSIENT, FailureClass.UNKNOWN}
        else "spatial.events.poison.dlt"
    )
    dlq_publisher.publish(destination, envelope.model_dump_json())
    logger.warning(
        "dead-lettered event %s at stage=%s class=%s -> %s",
        envelope.event_id, failed_stage, failure_class, destination,
    )
    return envelope
```

Because the idempotency key is assigned at ingestion and carried through unchanged, the dead-letter record inherits the exactly-once guarantee described in [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — replay does not have to reinvent it.

---

## Spatial Validation and Error Handling

<figure class="fig">
<svg viewBox="0 0 760 218" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Routing transient failures and deterministic failures to different dead-letter destinations">
<title>Two failure classes, two destinations</title>
<desc>A failure classifier splits dead-lettered events by whether a retry could ever succeed. A broker timeout, a connection reset or a 503 is transient: it is retried on the backoff ladder and only reaches the retry dead-letter store once the budget is spent, where an automated replay job re-injects it when the downstream recovers, and the alert threshold is a rate. A self-intersecting polygon, a missing CRS or a schema violation is deterministic: it will fail identically on every attempt, so retrying it only burns budget and delays discovery. It goes straight to a poison store that never auto-replays and alerts on the first record, because the fix is upstream. Sending both to one queue means either replaying poison forever or never auto-replaying anything.</desc>
<rect x="0" y="0" width="760" height="218" fill="var(--fig-bg)"/>
<defs><marker id="rt-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<polygon points="90,64 172,100 90,136 8,100" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.5"/>
<text x="90" y="96" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">could a retry</text>
<text x="90" y="110" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">ever succeed?</text>
<line x1="174" y1="86" x2="212" y2="60" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#rt-a)"/>
<text x="180" y="52" font-size="8.5" fill="var(--fig-mint-edge)" font-weight="600">yes</text>
<line x1="174" y1="114" x2="212" y2="142" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#rt-a)"/>
<text x="180" y="156" font-size="8.5" fill="var(--fig-rose-edge)" font-weight="600">no</text>
<rect x="216" y="26" width="238" height="62" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="228" y="44" font-size="9.5" font-weight="600" fill="var(--fig-ink)">transient — broker timeout, 503, reset</text>
<text x="228" y="59" font-size="8.5" fill="var(--fig-ink-soft)">backoff ladder first; dead-lettered only</text>
<text x="228" y="71" font-size="8.5" fill="var(--fig-ink-soft)">once the retry budget is spent</text>
<text x="228" y="83" font-size="8.5" fill="var(--fig-mint-edge)">alert on rate, not on the first record</text>
<line x1="456" y1="57" x2="490" y2="57" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#rt-a)"/>
<rect x="494" y="26" width="252" height="62" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="506" y="44" font-size="9.5" font-weight="600" fill="var(--fig-ink)">retry store — auto-replay</text>
<text x="506" y="59" font-size="8.5" fill="var(--fig-ink-soft)">a job re-injects when the downstream recovers,</text>
<text x="506" y="71" font-size="8.5" fill="var(--fig-ink-soft)">reusing the original idempotency key verbatim</text>
<text x="506" y="83" font-size="8.5" fill="var(--fig-ink-soft)">so a re-injection that already ran short-circuits</text>
<rect x="216" y="112" width="238" height="62" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="228" y="130" font-size="9.5" font-weight="600" fill="var(--fig-ink)">deterministic — bad geometry, no CRS</text>
<text x="228" y="145" font-size="8.5" fill="var(--fig-ink-soft)">fails identically on attempt 1 and attempt 50;</text>
<text x="228" y="157" font-size="8.5" fill="var(--fig-ink-soft)">retrying burns budget and delays discovery</text>
<text x="228" y="169" font-size="8.5" fill="var(--fig-rose-edge)">alert on the first record — the fix is upstream</text>
<line x1="456" y1="143" x2="490" y2="143" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#rt-a)"/>
<rect x="494" y="112" width="252" height="62" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="506" y="130" font-size="9.5" font-weight="600" fill="var(--fig-ink)">poison store — never auto-replays</text>
<text x="506" y="145" font-size="8.5" fill="var(--fig-ink-soft)">re-injection only after the producer is fixed,</text>
<text x="506" y="157" font-size="8.5" fill="var(--fig-ink-soft)">or after the payload is corrected by hand</text>
<text x="506" y="169" font-size="8.5" fill="var(--fig-ink-soft)">holds the shapely error that names the vertex</text>
<rect x="8" y="188" width="738" height="26" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="20" y="205" font-size="9.5" fill="var(--fig-ink)">One shared queue forces a single policy on both: either it auto-replays poison forever, or it never auto-replays the outage that would have healed itself.</text>
</svg>
<figcaption><b>Figure 2.</b> The split is by whether a retry could ever succeed, not by severity. That single question decides retention, alert threshold and whether automatic replay is safe — which is why the two classes cannot share a destination.</figcaption>
</figure>

The envelope is only as trustworthy as the error detail it records. Two failure modes deserve explicit handling: a geometry that is *structurally* valid JSON but topologically broken, and a payload whose declared CRS does not match what the consumer expected.

```python
from pyproj import CRS


def validate_before_dead_letter(raw_geometry: dict, declared_crs: str,
                                expected_epsg: int = 4326) -> None:
    """Raise the precise, classifiable exception the DLQ envelope expects.
    Call this inside the consumer's topology/CRS stages."""
    # --- CRS check: a mismatch must surface the EPSG code, not a vague string
    try:
        crs = CRS.from_user_input(declared_crs)
    except Exception as exc:
        raise CRSMismatchError(f"unparseable CRS {declared_crs!r}: {exc}", epsg=None)
    if crs.to_epsg() != expected_epsg:
        raise CRSMismatchError(
            f"payload CRS is EPSG:{crs.to_epsg()} but pipeline expects "
            f"EPSG:{expected_epsg} (WGS84)",
            epsg=crs.to_epsg(),
        )

    # --- Topology check: NaN coords and self-intersections both fail here
    geom = shape(raw_geometry)
    if geom.is_empty:
        raise GeometryValidityError("geometry is empty")
    if not geom.is_valid:
        # explain_validity pinpoints e.g. "Self-intersection[12.500 41.900]"
        raise GeometryValidityError(explain_validity(geom))
```

A `crs_mismatch` such as a payload arriving in EPSG:3857 (Web Mercator) when the join layer is EPSG:4326 (WGS84) is deterministic: it will fail identically on every replay until the event is reprojected or the upstream provider is corrected. Recording the EPSG code in `GeometryError.epsg` lets a replay job decide whether it can auto-reproject or must escalate. Coordinates that arrive as `NaN` — common when a sensor drops a fix mid-stream — fail the topology check and are captured with the same precision.

---

## Retry, Backoff, and Delivery Guarantees

A dead-letter queue is the *terminus* of the retry path, not a parallel one. Transient failures should be retried in place with exponential backoff and jitter; the event only crosses into the dead-letter store when the retry budget is spent. Conflating the two — dead-lettering on the first transient blip — floods the store with events that would have succeeded on the second attempt.

```python
import asyncio
import random


async def process_with_retry_then_dead_letter(
    *, raw_payload, idempotency_key, first_seen_at,
    consumer, object_store, dlq_publisher,
    max_attempts: int = 5, base_delay: float = 0.5,
) -> None:
    """Retry transient failures with full jitter; on budget exhaustion or a
    deterministic failure, hand the event to the dead-letter store."""
    for attempt in range(1, max_attempts + 1):
        try:
            await consumer.handle(raw_payload)  # raises a classified exception
            return
        except Exception as exc:
            failure_class = classify(exc)
            deterministic = failure_class not in {
                FailureClass.TRANSIENT, FailureClass.UNKNOWN
            }
            budget_spent = attempt == max_attempts

            if deterministic or budget_spent:
                route_to_dead_letter(
                    raw_payload=raw_payload,
                    idempotency_key=idempotency_key,
                    failed_stage=getattr(exc, "stage", PipelineStage.SPATIAL_JOIN),
                    exc=exc,
                    attempts=attempt,
                    first_seen_at=first_seen_at,
                    object_store=object_store,
                    dlq_publisher=dlq_publisher,
                )
                return

            # Transient with budget remaining: full jitter over [0, base·2^n]
            delay = random.uniform(0, base_delay * (2 ** attempt))
            await asyncio.sleep(delay)
```

**How the guarantee holds:** the consumer performs its atomic idempotency claim *before* any spatial side effect, so a replayed event whose work already completed short-circuits. Because the dead-letter envelope carries the original `idempotency_key`, replay is effectively-once end-to-end. The backoff-and-jitter mechanics that feed this path are detailed in [Exponential Backoff & Jitter for Spatial Webhooks](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/), and the safe-replay procedure itself is covered in [Replaying Dead-Letter Spatial Events Safely](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/replaying-dead-letter-spatial-events-safely/).

---

## Storage Backends

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Dead-letter record split between an inline envelope and an object-store pointer for oversized geometry">
<title>Why the dead-letter record splits from the geometry</title>
<desc>A failed event carrying a 14-megabyte multipolygon cannot be stored inline: a dead-letter table row that large makes triage queries scan gigabytes and pushes the row past most brokers' message limits, so the dead-letter write itself starts failing — the one path that must never fail. Instead the envelope keeps only what triage needs, about 900 bytes: the failed stage, the exact shapely error, the CRS with its EPSG code, the idempotency key, the bounding box and a content hash. The geometry goes to object storage under that hash, and the envelope holds the pointer. An operator scanning failures reads bounding boxes and error strings without ever touching a payload, and replay dereferences the pointer only for the records it actually re-injects. The content hash also makes the offload idempotent, so re-dead-lettering the same event does not duplicate the blob.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<defs><marker id="dq-a" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="var(--fig-line)"/></marker></defs>
<rect x="14" y="34" width="150" height="52" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.4"/>
<text x="89" y="54" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">failed event</text>
<text x="89" y="68" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">14 MB multipolygon</text>
<text x="89" y="80" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">topology repair failed</text>
<line x1="166" y1="60" x2="200" y2="60" stroke="var(--fig-line)" stroke-width="1.3" marker-end="url(#dq-a)"/>
<rect x="204" y="26" width="270" height="68" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="216" y="44" font-size="9.5" font-weight="600" fill="var(--fig-ink)">envelope — 900 bytes, queryable</text>
<text x="216" y="59" font-size="8.5" fill="var(--fig-ink-soft)">stage · shapely error · EPSG:27700 · idem key</text>
<text x="216" y="71" font-size="8.5" fill="var(--fig-ink-soft)">bbox · sha256 · attempt count · first_seen</text>
<text x="216" y="86" font-size="8.5" fill="var(--fig-mint-edge)">triage never deserialises a geometry</text>
<line x1="476" y1="60" x2="510" y2="60" stroke="var(--fig-line)" stroke-width="1.3" stroke-dasharray="4,3" marker-end="url(#dq-a)"/>
<rect x="514" y="26" width="232" height="68" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.4"/>
<text x="526" y="44" font-size="9.5" font-weight="600" fill="var(--fig-ink)">object store — s3://dlq/&lt;sha256&gt;</text>
<text x="526" y="59" font-size="8.5" fill="var(--fig-ink-soft)">the 14 MB body, written once</text>
<text x="526" y="71" font-size="8.5" fill="var(--fig-ink-soft)">keyed by content hash ⇒ offload is idempotent</text>
<text x="526" y="86" font-size="8.5" fill="var(--fig-ink-soft)">dereferenced only on replay</text>
<rect x="14" y="112" width="732" height="46" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.3"/>
<text x="26" y="130" font-size="10" font-weight="600" fill="var(--fig-ink)">Storing it inline breaks the one path that must not fail</text>
<text x="26" y="143" font-size="9" fill="var(--fig-ink-soft)">A 14 MB row exceeds most brokers' message limit, so the dead-letter write is itself rejected and the event is lost outright.</text>
<text x="26" y="154" font-size="9" fill="var(--fig-ink-soft)">A triage query over one day of such rows also scans gigabytes to answer "what failed near this bbox?".</text>
<rect x="14" y="170" width="732" height="46" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.3"/>
<text x="26" y="188" font-size="10" font-weight="600" fill="var(--fig-ink)">Retention has to be set on both halves</text>
<text x="26" y="201" font-size="9" fill="var(--fig-ink-soft)">Expire the blob before the envelope and replay finds a dangling pointer; expire the envelope first and the blob leaks forever.</text>
<text x="26" y="212" font-size="9" fill="var(--fig-ink-soft)">Tie both lifecycles to the same retention policy.</text>
</svg>
<figcaption><b>Figure 3.</b> Splitting the record is what keeps the dead-letter write cheap enough never to fail and the triage query cheap enough to run. Note that retention must be configured on both halves or replay breaks in one direction and storage leaks in the other.</figcaption>
</figure>

The dead-letter store choice trades queryability against operational simplicity.

<div style="overflow-x:auto;">

| Backend | Strength | Weakness | Best for |
|---------|----------|----------|----------|
| Kafka `*.DLT` topic | Same infra as the main stream; ordered; replay is a re-produce | Poor ad-hoc querying; retention windows can drop old failures | High-throughput pipelines already on Kafka |
| PostGIS table | Query by geometry, EPSG code, or failure class; inspect the broken shape directly | Another system to operate; write throughput lower than a broker | Analyst-driven triage of invalid geometries |
| Redis Streams parked list | Sub-millisecond writes; easy TTL | Not durable enough as a system of record without AOF | Short-lived transient failures awaiting fast replay |
| Object storage + index | Cheap for very large geometries; effectively unbounded retention | No native querying without a separate index | Archival of oversized offloaded payloads |

</div>

A PostGIS table is the most operator-friendly choice because you can `SELECT` failed events by `failure_class`, filter by `source_crs`, or even map the invalid geometry to see the self-intersection. That end-to-end pattern — a PostGIS dead-letter table drained by a Celery replay task — is walked through in [Building a Spatial DLQ with PostGIS and Celery](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/building-a-spatial-dlq-with-postgis-and-celery/).

---

## Verification

Confirm the envelope captures the right context and that offload round-trips cleanly. Run with `pytest -v`.

```python
import json
from datetime import datetime, timezone


class _FakeStore:
    """In-memory stand-in for an S3 client."""
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
    def put_object(self, Key: str, Body: bytes) -> None:
        self.objects[Key] = Body


class _FakePublisher:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []
    def publish(self, destination: str, body: str) -> None:
        self.sent.append((destination, body))


BAD_GEOM = {  # bowtie polygon: self-intersecting
    "type": "Polygon",
    "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]],
}
PAYLOAD = {"event_id": "evt-9", "crs": "EPSG:4326", "geometry": BAD_GEOM}


def test_invalid_geometry_routes_to_poison_and_records_reason():
    pub, store = _FakePublisher(), _FakeStore()
    route_to_dead_letter(
        raw_payload=PAYLOAD,
        idempotency_key="idem:v1:abc",
        failed_stage=PipelineStage.TOPOLOGY_VALIDATION,
        exc=GeometryValidityError("Self-intersection[0.5 0.5]"),
        attempts=1,
        first_seen_at=datetime.now(timezone.utc),
        object_store=store,
        dlq_publisher=pub,
    )
    destination, body = pub.sent[0]
    env = json.loads(body)
    # Deterministic failure must NOT land in the retryable topic
    assert destination == "spatial.events.poison.dlt"
    assert env["failure_class"] == "invalid_geometry"
    assert env["failed_stage"] == "topology_validation"
    assert "Self-intersection" in env["geometry_error"]["reason"]
    # The idempotency key survives verbatim for safe replay
    assert env["idempotency_key"] == "idem:v1:abc"


def test_large_geometry_is_offloaded_not_inlined():
    pub, store = _FakePublisher(), _FakeStore()
    big = {"type": "MultiPoint",
           "coordinates": [[i * 1e-6, i * 1e-6] for i in range(60_000)]}
    ref = build_geometry_ref(big, store, key_prefix="test")
    assert ref.offload_uri is not None and ref.inline is None
    assert len(store.objects) == 1  # blob written exactly once
    # content hash lets replay verify integrity before re-injecting
    assert ref.content_sha256 is not None


def test_crs_mismatch_captures_epsg_code():
    err = GeometryError(reason="EPSG:3857 not EPSG:4326", epsg=3857)
    assert err.epsg == 3857
```

The first test is the load-bearing one: it proves a deterministic geometry failure is diverted away from the auto-retry topic and that the idempotency key is preserved for a later exactly-once replay.

---

## Troubleshooting

<div style="overflow-x:auto;">

| Symptom | Likely spatial cause | Fix |
|---------|----------------------|-----|
| Poison loop: same event dead-lettered thousands of times | Invalid geometry routed to a retryable topic and auto-replayed | Classify `GeometryValidityError` as deterministic; send it to the poison store, not the retry DLT |
| Dead-letter write itself fails with a message-size error | Oversized `MultiPolygon` exceeds the broker's 1 MB limit | Offload geometries above the threshold to object storage; store only the pointer + hash |
| Replay reprocesses events that already succeeded | Idempotency key regenerated at replay from a re-serialised payload | Reuse the stored `idempotency_key` verbatim; never re-derive it during replay |
| Envelope error says "invalid geometry" but no location | `explain_validity` result discarded in favour of `str(exc)` | Store the full `explain_validity` string in `geometry_error.reason` |
| CRS failures can't be auto-fixed on replay | Mismatch recorded as a generic string without the EPSG code | Populate `GeometryError.epsg` from `CRS.to_epsg()` so replay can decide to reproject |
| Offloaded blob is truncated on replay | No integrity check between write and read | Compare `content_sha256` before re-injecting; discard and alert on mismatch |
| Transient failures flood the dead-letter store | Dead-lettering on the first attempt instead of after the retry budget | Only route to DLQ once `attempts == max_attempts` for transient classes |

</div>

---

## FAQ

<details class="faq">
<summary><strong>What should a spatial dead-letter record capture beyond a normal DLQ entry?</strong></summary>

Beyond the raw payload and error message that any dead-letter record holds, a spatial record must capture the pipeline stage that failed (parse, CRS transform, topology validation, or spatial join), the precise geometry-validity error including the offending vertex or ring, the CRS with its EPSG code when a mismatch caused the failure, the assigned idempotency key so replay stays exactly-once, and a size or offload pointer when the geometry is too large to store inline.

</details>

<details class="faq">
<summary><strong>How do I stop a dead-letter queue from replaying the same event twice?</strong></summary>

Carry the idempotency key assigned at ingestion into the dead-letter envelope and reuse it verbatim on replay. The consumer performs its normal atomic claim on that key before doing any spatial work, so a replayed event that was in fact already processed short-circuits harmlessly. Never regenerate the key at replay time, because a re-serialised payload can hash differently and defeat the guarantee.

</details>

<details class="faq">
<summary><strong>Should invalid geometries and transient broker errors go to the same dead-letter queue?</strong></summary>

Route them to separate destinations. Transient broker errors are worth retrying with exponential backoff and usually recover on their own, so they should only reach the dead-letter store after the retry budget is exhausted. Invalid geometry and schema violations are deterministic and will never succeed on replay without human or upstream correction, so they belong in a poison queue that triggers an alert rather than an automatic retry loop.

</details>

<details class="faq">
<summary><strong>How do I dead-letter a 40 MB MultiPolygon without bloating the queue?</strong></summary>

Offload the raw geometry to object storage such as S3 or a large-object column, and store only a pointer (bucket, key, byte size, and content hash) inside the dead-letter envelope. The broker message stays small and fast to scan, while the full payload remains recoverable for replay. Record the content hash so you can verify the offloaded blob was not truncated or corrupted before you re-inject it.

</details>

---

## Related

- [Queue Management, Retries & Delivery Guarantees](https://www.geospatialwebhook.com/queue-management-retry-delivery/) — the parent section covering brokers, retries, ordering, and delivery guarantees for spatial event streams
- [Exponential Backoff & Jitter for Spatial Webhooks](https://www.geospatialwebhook.com/queue-management-retry-delivery/exponential-backoff-jitter/) — the retry mechanics whose exhaustion feeds the dead-letter path
- [Replaying Dead-Letter Spatial Events Safely](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/replaying-dead-letter-spatial-events-safely/) — the step-by-step procedure for draining the store while preserving exactly-once semantics
- [Building a Spatial DLQ with PostGIS and Celery](https://www.geospatialwebhook.com/queue-management-retry-delivery/dead-letter-queues-spatial/building-a-spatial-dlq-with-postgis-and-celery/) — a concrete PostGIS-backed dead-letter table drained by a Celery replay task
- [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) — where the geometry-validity errors captured in the envelope originate
