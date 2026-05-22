# Securing Webhook Endpoints with Spatial Token Validation

Securing webhook endpoints with spatial token validation requires verifying both the cryptographic integrity of the incoming payload and its geographic provenance. Unlike traditional signature checks, this approach embeds a spatial claim—such as a signed geohash, bounding-box digest, or coordinate-derived nonce—directly into the webhook token. The receiver validates the HMAC or JWT signature first, then confirms the embedded spatial claim matches the payload’s coordinates and falls within authorized operational boundaries. This dual-validation model prevents replay attacks, spoofed location telemetry, and unauthorized event injection from outside your physical footprint, making it essential for IoT telemetry, fleet routing, and location-aware SaaS platforms.

## Architecture & Spatial Attestation

Standard webhook security typically stops at signature verification and IP allowlisting. When building event-driven geospatial systems, you must extend [Webhook Security Boundaries](/core-event-fundamentals-architecture/webhook-security-boundaries/) to treat location as a cryptographic primitive rather than a mutable metadata field. A spatial token contains three mandatory components: a monotonic timestamp, a cryptographic signature computed over the raw payload plus coordinates, and a spatial constraint (e.g., a precomputed geofence ID or bounding-box hash). If any component fails validation, the event is quarantined rather than dropped. This pattern aligns with [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/) by enforcing geographic attestation at the ingress layer, which reduces downstream fraud detection overhead and simplifies compliance auditing.

## Token Structure & Validation Sequence

The recommended token format uses `base64url(signature:geohash:timestamp)`. Validation follows a strict, fail-fast sequence to minimize compute overhead:

1. **Decode & Parse:** Extract the hex signature, spatial claim, and Unix timestamp from the base64url-encoded string.
2. **TTL Check:** Reject if `abs(current_time - timestamp) > allowed_window`. This neutralizes replay attacks.
3. **HMAC Verification:** Recompute the signature over `payload_bytes + f"{lon}:{lat}".encode()` using a shared secret. Use constant-time comparison to prevent timing side-channels.
4. **Spatial Containment:** Verify the payload coordinates fall within the authorized polygon or match the claimed geofence.
5. **Quarantine on Failure:** Route invalid payloads to a dead-letter queue for forensic analysis instead of silently returning `403`.

## Production-Ready Python Implementation

The following FastAPI endpoint validates a spatial webhook token using HMAC-SHA256 and `shapely` for precise boundary checks. The implementation prioritizes constant-time operations, strict type enforcement, and graceful degradation.

```python
import base64
import hashlib
import hmac
import time
import json
from typing import Optional

from fastapi import FastAPI, Request, HTTPException, status
from shapely.geometry import Point, Polygon
from shapely.prepared import prep

app = FastAPI()

# Configuration
WEBHOOK_SECRET = b"your-256-bit-secret-key-here"
ALLOWED_TTL_SECONDS = 300
# Authorized operational zone (longitude, latitude)
AUTHORIZED_ZONE = prep(Polygon([
    (-122.5, 37.7), (-122.3, 37.7),
    (-122.3, 37.9), (-122.5, 37.9)
]))

def verify_spatial_token(token: str, payload_bytes: bytes, lon: float, lat: float) -> bool:
    try:
        # Pad base64 if necessary
        decoded = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        sig_hex, geohash, ts_str = decoded.decode("utf-8").split(":")
        timestamp = int(ts_str)
        
        # 1. Time window check
        if abs(time.time() - timestamp) > ALLOWED_TTL_SECONDS:
            return False
            
        # 2. HMAC verification over payload + coordinates
        expected_sig = hmac.new(
            WEBHOOK_SECRET,
            payload_bytes + f"{lon}:{lat}".encode(),
            hashlib.sha256
        ).hexdigest()
        
        if not hmac.compare_digest(sig_hex, expected_sig):
            return False
            
        # 3. Spatial containment check
        point = Point(lon, lat)
        if not AUTHORIZED_ZONE.contains(point):
            return False
            
        return True
    except Exception:
        return False

@app.post("/webhook/spatial")
async def handle_spatial_webhook(request: Request):
    token = request.headers.get("X-Spatial-Token")
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing X-Spatial-Token header")
        
    payload_bytes = await request.body()
    try:
        data = json.loads(payload_bytes)
        lon = float(data.get("lon"))
        lat = float(data.get("lat"))
    except (json.JSONDecodeError, TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload or missing coordinates")
        
    if not verify_spatial_token(token, payload_bytes, lon, lat):
        # Production: route to DLQ, log for SIEM, return generic 403
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Spatial validation failed")
        
    return {"status": "accepted", "message": "Event processed"}
```

## Operational Hardening & Edge Cases

Spatial token validation introduces unique failure modes that require explicit handling:

* **Coordinate Precision Drift:** GPS modules and cellular triangulation introduce ±5–50m variance. Use geohash precision levels (e.g., 6–8 characters) or buffer your authorized polygon by a tolerance radius rather than exact point matching. Refer to the [Shapely Documentation](https://shapely.readthedocs.io/en/stable/) for robust buffering and topology operations.
* **Clock Skew:** Distributed systems rarely share perfectly synchronized clocks. Allow a ±15s skew window and monitor NTP drift across your fleet.
* **HMAC Standardization:** Always follow [RFC 2104](https://www.rfc-editor.org/info/rfc2104/) for key derivation and digest computation. Rotate secrets quarterly and version your token format (e.g., `v2:base64...`) to support zero-downtime key rotation.
* **Geofence Complexity:** Precompute spatial constraints at deployment time. Running `shapely.prepared` checks on every webhook invocation is efficient, but dynamically loading thousands of polygons will degrade ingress latency. Cache prepared geometries in memory or use a spatial index (e.g., R-tree) for multi-zone routing.

## When to Deploy Spatial Validation

Spatial token validation is not a replacement for standard webhook security; it is a specialized layer for location-dependent trust boundaries. Deploy it when:
- Your business logic rejects events originating outside a physical service area (e.g., ride-hailing dispatch, drone delivery, localized compliance reporting).
- You ingest telemetry from untrusted edge devices where GPS spoofing or relay attacks are economically viable.
- Regulatory frameworks require geographic attestation for data processing or storage routing.

For general-purpose event ingestion, standard HMAC/JWT validation with IP allowlists and rate limiting remains sufficient. Reserve spatial attestation for systems where location is a primary security primitive, not just a metadata tag.