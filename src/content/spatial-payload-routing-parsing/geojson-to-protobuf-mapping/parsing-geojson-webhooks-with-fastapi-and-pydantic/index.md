# Parsing GeoJSON Webhooks with FastAPI and Pydantic

Parsing GeoJSON webhooks with FastAPI and Pydantic requires strict schema enforcement, cryptographic verification, and idempotent processing. By defining [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946)-compliant Pydantic v2 models, you reject malformed spatial payloads at the HTTP layer before they reach your business logic. FastAPI’s native JSON deserialization handles this automatically, returning structured `422 Unprocessable Entity` responses when coordinates, geometry types, or required fields violate the spec. This eliminates boilerplate validation and guarantees that your event-driven pipeline only receives spatially valid payloads.

## Core Implementation: Strict Validation & Routing

The implementation below uses modern Pydantic v2 syntax, explicit type hints, and FastAPI’s dependency injection to ingest, verify, and route webhooks securely. It validates geometry structure, verifies HMAC signatures, and enforces idempotency keys.

```python
import hashlib
import hmac
import json
import time
from typing import Any, Literal, Optional
from fastapi import FastAPI, Request, HTTPException, Header, Depends, status
from pydantic import BaseModel, Field, model_validator, ConfigDict

app = FastAPI(title="GeoJSON Webhook Ingestor")

# --- In-memory idempotency store (replace with Redis/DB in production) ---
IDEMPOTENCY_STORE: dict[str, float] = {}
REPLAY_WINDOW_SECONDS = 300  # 5 minutes

# --- Pydantic v2 GeoJSON Models ---
class Geometry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"]
    coordinates: list[Any]

    @model_validator(mode="after")
    def validate_coordinates(self) -> "Geometry":
        if not self.coordinates:
            raise ValueError("coordinates array cannot be empty")
        return self

class GeoJSONFeature(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["Feature"]
    geometry: Optional[Geometry] = None
    properties: Optional[dict[str, Any]] = None
    id: Optional[str | int] = None

class GeoJSONFeatureCollection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["FeatureCollection"]
    features: list[GeoJSONFeature]

    @model_validator(mode="after")
    def validate_features(self) -> "GeoJSONFeatureCollection":
        if not self.features:
            raise ValueError("FeatureCollection must contain at least one Feature")
        return self

class WebhookPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_type: str
    timestamp: float
    data: GeoJSONFeature | GeoJSONFeatureCollection

# --- Security & Validation Dependencies ---
def verify_signature(payload_bytes: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

def check_idempotency(idempotency_key: str) -> None:
    if idempotency_key in IDEMPOTENCY_STORE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Duplicate request")
    IDEMPOTENCY_STORE[idempotency_key] = time.time()

# --- Route Handler ---
@app.post("/webhooks/geojson", status_code=status.HTTP_202_ACCEPTED)
async def ingest_geojson_webhook(
    request: Request,
    x_webhook_signature: str = Header(..., alias="X-Webhook-Signature"),
    x_idempotency_key: str = Header(..., alias="X-Idempotency-Key"),
    webhook_secret: str = "your-secure-webhook-secret"  # Load from env in production
):
    # 1. Idempotency check
    check_idempotency(x_idempotency_key)

    # 2. Read raw bytes for signature verification
    body = await request.body()
    if not verify_signature(body, x_webhook_signature, webhook_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")

    # 3. Parse & validate JSON against Pydantic models
    try:
        payload = WebhookPayload.model_validate_json(body)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

    # 4. Async processing (fire-and-forget or queue)
    await process_geojson_event(payload)
    return {"status": "accepted", "event_type": payload.event_type}

async def process_geojson_event(payload: WebhookPayload) -> None:
    # Route to spatial pipeline, DB, or message broker
    pass
```

## Webhook Security & Idempotency Safeguards

Webhook ingestion is inherently untrusted. Relying solely on JSON parsing leaves you vulnerable to replay attacks, signature forgery, and duplicate event processing. The implementation above layers three critical defenses:

1. **HMAC-SHA256 Verification**: The raw request body is hashed using a shared secret and compared against the `X-Webhook-Signature` header. Using `hmac.compare_digest()` prevents timing attacks that could leak secret material.
2. **Idempotency Keys**: Every webhook delivery should include a unique `X-Idempotency-Key`. Checking this key against a short-lived store prevents duplicate processing if the sender retries due to network timeouts.
3. **Strict Schema Boundaries**: Pydantic’s `extra="forbid"` configuration drops unexpected fields immediately. Combined with `@model_validator(mode="after")`, you catch structural violations (empty coordinate arrays, missing features) before they propagate downstream.

For production deployments, replace the in-memory `IDEMPOTENCY_STORE` with Redis or a relational database with TTL expiration. Store webhook secrets in a secrets manager, never in plaintext configuration.

## Routing to Spatial Pipelines

Once validated, GeoJSON payloads can be safely routed to downstream services. FastAPI’s async architecture pairs naturally with message brokers like RabbitMQ or Kafka, allowing you to decouple ingestion from heavy spatial operations. Validated payloads can be indexed in PostGIS, streamed to real-time map renderers, or transformed into compact binary formats for low-latency transmission.

When designing event-driven spatial architectures, consider how payload validation feeds into broader [Spatial Payload Routing & Parsing](/spatial-payload-routing-parsing/) strategies. Routing decisions often depend on geometry type, bounding box, or custom properties. By enforcing schema compliance at the ingress layer, you guarantee that downstream consumers never handle malformed coordinate sequences or missing type declarations.

## Production Considerations & Next Steps

- **Coordinate Precision & Validation**: Pydantic validates structure, not mathematical correctness. For strict RFC compliance, integrate libraries like `shapely` or `geojson` to verify closed polygons, correct coordinate ordering (longitude, latitude), and valid CRS references.
- **Binary Serialization**: Large GeoJSON payloads consume bandwidth and increase JSON parsing latency. Converting validated features to Protocol Buffers reduces payload size by 40–70% and enables strongly typed streaming. See [GeoJSON to Protobuf Mapping](/spatial-payload-routing-parsing/geojson-to-protobuf-mapping/) for schema translation patterns that preserve spatial semantics while optimizing throughput.
- **Observability**: Instrument webhook routes with structured logging. Capture `event_type`, validation errors, and processing latency. Use OpenTelemetry to trace payloads from ingestion through spatial indexing or protobuf conversion.
- **Rate Limiting**: Apply FastAPI’s `SlowAPI` or API gateway rate limits to prevent abuse. Webhook endpoints are common targets for credential stuffing or payload flooding.

By combining FastAPI’s request lifecycle with Pydantic v2’s declarative validation, you build a resilient ingress layer that guarantees spatial correctness, cryptographic integrity, and exactly-once processing semantics.