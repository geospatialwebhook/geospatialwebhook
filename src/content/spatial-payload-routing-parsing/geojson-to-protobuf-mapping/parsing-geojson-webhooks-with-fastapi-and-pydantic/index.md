---
title: "Parsing GeoJSON Webhooks with FastAPI and Pydantic"
description: "Enforce RFC 7946-compliant spatial schemas at the HTTP layer with Pydantic v2 models, rejecting malformed GeoJSON webhook payloads before they reach event-driven pipeline logic."
slug: "parsing-geojson-webhooks-with-fastapi-and-pydantic"
type: "article"
breadcrumb:
  - label: "Spatial Payload Routing & Parsing"
    url: "/spatial-payload-routing-parsing/"
  - label: "GeoJSON to Protobuf Mapping"
    url: "/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/"
  - label: "Parsing GeoJSON Webhooks with FastAPI and Pydantic"
    url: "/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/parsing-geojson-webhooks-with-fastapi-and-pydantic/"
datePublished: "2024-03-15"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Parsing GeoJSON Webhooks with FastAPI and Pydantic",
      "description": "Enforce RFC 7946-compliant spatial schemas at the HTTP layer with Pydantic v2 models, rejecting malformed GeoJSON webhook payloads before they reach event-driven pipeline logic.",
      "datePublished": "2024-03-15",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Spatial Payload Routing & Parsing", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/" },
        { "@type": "ListItem", "position": 2, "name": "GeoJSON to Protobuf Mapping", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/" },
        { "@type": "ListItem", "position": 3, "name": "Parsing GeoJSON Webhooks with FastAPI and Pydantic", "item": "https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/parsing-geojson-webhooks-with-fastapi-and-pydantic/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Parsing GeoJSON Webhooks with FastAPI and Pydantic",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Model the GeoJSON object graph", "text": "Define discriminated Pydantic v2 models for Geometry, Feature, and FeatureCollection with extra=\"forbid\" so unexpected fields are rejected at parse time." },
        { "@type": "HowToStep", "position": 2, "name": "Validate coordinate bounds and ring structure", "text": "Use model_validator(mode=\"after\") to assert WGS 84 / EPSG:4326 longitude and latitude ranges and that polygon rings are closed." },
        { "@type": "HowToStep", "position": 3, "name": "Verify the HMAC signature over raw bytes", "text": "Compute HMAC-SHA256 over the unparsed request body and compare with constant-time comparison before deserializing JSON." },
        { "@type": "HowToStep", "position": 4, "name": "Deserialize with model_validate_json", "text": "Parse the raw body directly into the typed model, returning 422 with structured errors when the payload violates RFC 7946." },
        { "@type": "HowToStep", "position": 5, "name": "Acknowledge fast and route downstream", "text": "Return 202 Accepted and hand the validated payload to an async processor, queue, or protobuf serializer." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why parse the raw body instead of using a FastAPI body parameter?",
          "acceptedAnswer": { "@type": "Answer", "text": "HMAC signatures are computed over the exact bytes the sender transmitted. If FastAPI deserializes the body into a model first, key ordering and whitespace can change and the recomputed signature will not match. Read request.body() once, verify the signature against those bytes, then call model_validate_json on the same bytes." }
        },
        {
          "@type": "Question",
          "name": "Does Pydantic validate that polygon rings are closed?",
          "acceptedAnswer": { "@type": "Answer", "text": "Not by default. Pydantic validates JSON structure and types but knows nothing about spatial topology. You must add a model_validator that checks the first and last positions of each linear ring are equal, or hand the coordinates to Shapely for a full validity check." }
        },
        {
          "@type": "Question",
          "name": "How do I reject coordinates outside the valid WGS 84 range?",
          "acceptedAnswer": { "@type": "Answer", "text": "Add an after-validator that walks the coordinate arrays and asserts -180 <= longitude <= 180 and -90 <= latitude <= 90. RFC 7946 mandates EPSG:4326 with longitude first, so a Point at [200, 10] is invalid and should return 422." }
        }
      ]
    }
  ]
}
</script>

**Define RFC 7946-compliant Pydantic v2 models with `extra="forbid"`, verify the HMAC signature over the raw request body, then call `model_validate_json` so FastAPI rejects malformed GeoJSON with a structured `422` before any spatial logic runs.** This how-to sits under [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/), part of [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/).

## When to use this pattern

Schema enforcement at the HTTP edge is worth the extra model code when malformed geometry would otherwise propagate silently:

- You **ingest GeoJSON from third parties or untrusted clients** — partner integrations, mobile clients, or IoT gateways — where a single missing `type` discriminator or a swapped longitude/latitude pair can corrupt a spatial index downstream.
- You need **deterministic, machine-readable rejection**: a `422` with field-level error paths beats a `500` traceback when a sender debugs why their payload bounced, and it keeps malformed coordinates out of [Geometry Validation Pipelines](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geometry-validation-pipelines/) further along.
- Your endpoint feeds a **binary serializer or async fan-out** — for example, converting validated features as covered in [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/) — where the consumer assumes the input is already structurally sound.

If you are only logging payloads or your producer is fully trusted and inside your own trust boundary, a permissive `dict[str, Any]` parse may be enough. Reserve strict modeling for ingress points where "is this even valid GeoJSON?" is a question you cannot afford to answer downstream.

## Validation flow

The diagram below shows the fail-fast order. Cheap checks run first (signature over raw bytes, then structural parse); the spatial bound and ring checks run inside the model only once the JSON is well-formed. Any failure short-circuits to a typed HTTP error before the payload reaches your processor.

<svg viewBox="0 0 760 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GeoJSON webhook validation flow diagram" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>GeoJSON webhook validation flow</title>
  <desc>A flowchart showing four sequential gates: read raw body and verify HMAC, parse JSON into Pydantic models, validate coordinate bounds and ring closure, then accept and route downstream. Signature failures return 401, structural failures return 422, and accepted payloads return 202 to an async processor.</desc>
  <defs>
    <marker id="gj-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
    <marker id="gj-arr-dash" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Row 1 -->
  <rect x="8" y="28" width="120" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="68" y="50" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">Incoming</text>
  <text x="68" y="66" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">POST</text>
  <line x1="128" y1="53" x2="153" y2="53" stroke="currentColor" stroke-width="1.5" marker-end="url(#gj-arr)"/>
  <rect x="155" y="28" width="140" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="225" y="50" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">1. Verify HMAC</text>
  <text x="225" y="66" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif">over raw bytes</text>
  <line x1="295" y1="53" x2="320" y2="53" stroke="currentColor" stroke-width="1.5" marker-end="url(#gj-arr)"/>
  <rect x="322" y="28" width="140" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="392" y="50" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">2. Parse JSON</text>
  <text x="392" y="66" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif">into Pydantic models</text>
  <line x1="462" y1="53" x2="487" y2="53" stroke="currentColor" stroke-width="1.5" marker-end="url(#gj-arr)"/>
  <rect x="489" y="28" width="150" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="564" y="48" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">3. Spatial checks</text>
  <text x="564" y="64" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif">bounds · ring closure</text>
  <!-- pass path down to accept -->
  <line x1="564" y1="78" x2="564" y2="104" stroke="currentColor" stroke-width="1.5"/>
  <line x1="564" y1="104" x2="225" y2="104" stroke="currentColor" stroke-width="1.5"/>
  <line x1="225" y1="104" x2="225" y2="143" stroke="currentColor" stroke-width="1.5" marker-end="url(#gj-arr)"/>
  <text x="400" y="98" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif">valid GeoJSON ✓</text>
  <!-- Row 2: accept -->
  <rect x="150" y="145" width="150" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="225" y="167" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">4. Accept event</text>
  <text x="225" y="183" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif">202 → async processor</text>
  <!-- Reject box -->
  <rect x="360" y="225" width="290" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6,3"/>
  <text x="505" y="247" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">Reject before processing</text>
  <text x="505" y="263" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif">401 bad signature · 422 invalid GeoJSON</text>
  <!-- failure paths -->
  <line x1="225" y1="78" x2="225" y2="100" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3"/>
  <line x1="395" y1="218" x2="395" y2="225" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#gj-arr-dash)" opacity="0.7"/>
  <line x1="392" y1="78" x2="392" y2="218" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.7"/>
  <text x="398" y="150" font-size="9" fill="currentColor" font-family="sans-serif" opacity="0.8">malformed</text>
  <line x1="564" y1="78" x2="564" y2="200" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.7"/>
  <line x1="564" y1="200" x2="450" y2="200" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.7"/>
  <line x1="450" y1="200" x2="450" y2="225" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#gj-arr-dash)" opacity="0.7"/>
  <text x="569" y="150" font-size="9" fill="currentColor" font-family="sans-serif" opacity="0.8">out of bounds</text>
</svg>

## Complete runnable code block

The handler below is self-contained. It models the GeoJSON object graph with discriminated unions, enforces WGS 84 / EPSG:4326 coordinate bounds and closed polygon rings inside the model, verifies an HMAC-SHA256 signature over the raw bytes, and returns `202` with a fast hand-off to an async processor. Because the spec mandates EPSG:4326 with longitude before latitude, the bound checks assume that order.

```python
import hashlib
import hmac
from typing import Annotated, Any, Literal, Union

from fastapi import FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

app = FastAPI(title="GeoJSON Webhook Ingestor")
WEBHOOK_SECRET = b"load-from-secrets-manager-not-source-control"

# --- Coordinate helpers (RFC 7946 mandates EPSG:4326, longitude first) ---
def _check_position(pos: list[float]) -> None:
    # A position is [lon, lat] or [lon, lat, elevation]; only the first two are bounded.
    if len(pos) < 2:
        raise ValueError("position must have at least longitude and latitude")
    lon, lat = pos[0], pos[1]
    if not (-180.0 <= lon <= 180.0):
        raise ValueError(f"longitude {lon} outside [-180, 180]")
    if not (-90.0 <= lat <= 90.0):
        raise ValueError(f"latitude {lat} outside [-90, 90]")

def _walk_positions(coords: Any) -> None:
    # Recurse into the nested coordinate array until we hit [lon, lat, ...] positions.
    if coords and isinstance(coords[0], (int, float)):
        _check_position(coords)
    else:
        for child in coords:
            _walk_positions(child)

# --- Pydantic v2 GeoJSON models ---
class Point(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["Point"]
    coordinates: list[float]

class Polygon(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["Polygon"]
    # Polygon = array of linear rings; each ring is an array of positions.
    coordinates: list[list[list[float]]]

    @model_validator(mode="after")
    def rings_must_close(self) -> "Polygon":
        for ring in self.coordinates:
            if len(ring) < 4:
                raise ValueError("a linear ring needs at least 4 positions")
            if ring[0] != ring[-1]:
                raise ValueError("polygon ring is not closed (first != last position)")
        return self

# Discriminated union keeps error messages precise per geometry type.
Geometry = Annotated[Union[Point, Polygon], Field(discriminator="type")]

class Feature(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["Feature"]
    geometry: Geometry
    properties: dict[str, Any] | None = None
    id: str | int | None = None

    @model_validator(mode="after")
    def coordinates_in_bounds(self) -> "Feature":
        _walk_positions(self.geometry.coordinates)
        return self

class FeatureCollection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["FeatureCollection"]
    features: list[Feature] = Field(min_length=1)

class WebhookPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_type: str
    data: Feature | FeatureCollection

# --- Security ---
def verify_signature(raw: bytes, signature: str) -> bool:
    expected = hmac.new(WEBHOOK_SECRET, raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

# --- Route ---
@app.post("/webhooks/geojson", status_code=status.HTTP_202_ACCEPTED)
async def ingest(
    request: Request,
    x_webhook_signature: str = Header(..., alias="X-Webhook-Signature"),
):
    # 1. Read raw bytes ONCE; the signature is computed over these exact bytes.
    raw = await request.body()
    if not verify_signature(raw, x_webhook_signature):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid signature")

    # 2. Parse the same bytes into the typed model; structured 422 on any violation.
    try:
        payload = WebhookPayload.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, exc.errors())

    # 3. Acknowledge fast; offload heavy spatial work to a queue or executor.
    await route_downstream(payload)
    return {"status": "accepted", "event_type": payload.event_type}

async def route_downstream(payload: WebhookPayload) -> None:
    # Hand off to PostGIS, a broker, or a protobuf serializer here.
    ...
```

## Parameter / option reference table

The settings below are the ones that change correctness, not just style. Spatial constraints assume RFC 7946 (EPSG:4326, longitude first).

| Option | Type | Spatial constraint / effect | Default |
| --- | --- | --- | --- |
| `ConfigDict(extra="forbid")` | bool flag | Rejects unknown keys (e.g. a typo'd `geometery`) instead of silently dropping them | `extra="ignore"` |
| `Field(discriminator="type")` | union discriminator | Routes each geometry to the right model so errors name the actual type, not "none matched" | none |
| `Field(min_length=1)` on `features` | int | A `FeatureCollection` with zero features is structurally legal in RFC 7946 but usually a producer bug | unbounded |
| `model_validate_json(raw)` | classmethod | Parses bytes directly; skips a `json.loads` round-trip and preserves byte-exact signature input | n/a |
| `hmac.compare_digest` | function | Constant-time comparison; prevents timing side-channels that leak the secret | use `==` (unsafe) |
| lon bound | float range | `-180.0 <= lon <= 180.0`; values outside indicate swapped lat/lon or a non-EPSG:4326 source | none |
| lat bound | float range | `-90.0 <= lat <= 90.0`; a value of `200` is a classic swapped-axis symptom | none |
| ring closure | list check | First and last position of each linear ring must be equal | not enforced |

## Gotchas and spatial edge cases

1. **Swapped longitude and latitude.** The single most common bug. RFC 7946 mandates `[longitude, latitude]`, but many producers (and most people) say "lat, lon". A `Point` at `[40.7, -74.0]` will pass naive parsing yet place New York in the Indian Ocean. The bound checks above catch only egregious swaps (lat > 90); for plausible mid-latitude values you need a sanity check against an expected region.
2. **Coordinate precision loss before signing.** If you round coordinates before computing or verifying the HMAC, the recomputed digest will not match. Sign the raw bytes exactly as received and round only after validation, never before.
3. **Ring orientation is not validity.** RFC 7946 prefers right-hand-rule winding (exterior counter-clockwise, holes clockwise) but most parsers accept either. Pydantic checks closure, not winding. If a downstream consumer assumes a winding order, normalize it explicitly with Shapely's `orient()` after parsing.
4. **`extra="ignore"` hides typos.** Without `extra="forbid"`, a payload sending `geometery` (misspelled) parses with `geometry=None` and no error. Forbidding extras turns that into a loud `422`.
5. **Unbounded coordinate arrays are a denial-of-service surface.** A single `Polygon` with millions of vertices will exhaust memory during parse. Cap request body size at the gateway and consider a vertex-count guard before handing the geometry to [Async Processing for Heavy Geometries](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/).
6. **CRS assumptions on merge.** This handler assumes EPSG:4326. If any producer emits EPSG:3857 or a local grid, the bound checks will reject legitimate data or — worse — pass garbage. Normalize upstream per [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/) before this endpoint, or carry an explicit CRS field and transform inside the validator.

## Minimal verification snippet

Run the following with `pytest`. It signs a valid payload, asserts a `202`, then mutates the body and asserts the typed rejections — no live server required, thanks to FastAPI's `TestClient`.

```python
import hashlib
import hmac
import json

from fastapi.testclient import TestClient

from app import WEBHOOK_SECRET, app  # import from the module above

client = TestClient(app)

def _sign(body: bytes) -> dict[str, str]:
    sig = hmac.new(WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()
    return {"X-Webhook-Signature": sig}

VALID = {
    "event_type": "feature.created",
    "data": {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [-74.006, 40.7128]},
        "properties": {"name": "NYC"},
    },
}

def test_valid_payload_accepted():
    body = json.dumps(VALID).encode()
    resp = client.post("/webhooks/geojson", content=body, headers=_sign(body))
    assert resp.status_code == 202
    assert resp.json()["event_type"] == "feature.created"

def test_out_of_bounds_latitude_rejected():
    bad = json.loads(json.dumps(VALID))
    bad["data"]["geometry"]["coordinates"] = [-74.006, 200.0]  # lat > 90
    body = json.dumps(bad).encode()
    resp = client.post("/webhooks/geojson", content=body, headers=_sign(body))
    assert resp.status_code == 422

def test_bad_signature_rejected():
    body = json.dumps(VALID).encode()
    resp = client.post(
        "/webhooks/geojson", content=body,
        headers={"X-Webhook-Signature": "deadbeef"},
    )
    assert resp.status_code == 401
```

A passing run confirms three guarantees at once: well-formed GeoJSON is accepted, an out-of-range coordinate is rejected with `422` before any processing, and a forged signature never reaches the parser.

## Related

- [GeoJSON to Protobuf Mapping](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/) — turn the validated features from this handler into compact binary messages for high-throughput routing.
- [Optimizing Async Geometry Parsing with asyncio](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/async-processing-for-heavy-geometries/optimizing-async-geometry-parsing-with-asyncio/) — offload heavy validated geometries to a process pool so ingestion stays non-blocking.
- [Spatial Payload Routing & Parsing](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/) — the broader architecture this ingress layer feeds into.
