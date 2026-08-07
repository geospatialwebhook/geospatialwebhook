---
title: "Securing Webhook Endpoints with Spatial Token Validation"
description: "Validate spatial tokens on webhook endpoints: embed a signed geohash into an HMAC or JWT, then reject events that fail cryptographic or geographic checks."
slug: "securing-webhook-endpoints-with-spatial-token-validation"
type: "article"
breadcrumb:
  - label: "Core Event Fundamentals & Architecture"
    url: "/core-event-fundamentals-architecture/"
  - label: "Webhook Security Boundaries"
    url: "/core-event-fundamentals-architecture/webhook-security-boundaries/"
  - label: "Securing Webhook Endpoints with Spatial Token Validation"
    url: "/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/"
datePublished: "2024-03-15"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Securing Webhook Endpoints with Spatial Token Validation",
      "description": "Step-by-step guide to validating spatial tokens on webhook endpoints: embed a signed geohash or bounding-box digest into an HMAC or JWT, then reject events that fail cryptographic or geographic checks.",
      "datePublished": "2024-03-15",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Core Event Fundamentals & Architecture", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/" },
        { "@type": "ListItem", "position": 2, "name": "Webhook Security Boundaries", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/" },
        { "@type": "ListItem", "position": 3, "name": "Securing Webhook Endpoints with Spatial Token Validation", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/securing-webhook-endpoints-with-spatial-token-validation/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Securing Webhook Endpoints with Spatial Token Validation",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Decode and parse the spatial token", "text": "Extract the hex signature, spatial claim (geohash or bounding-box digest), and Unix timestamp from the base64url-encoded X-Spatial-Token header." },
        { "@type": "HowToStep", "position": 2, "name": "Check the TTL window", "text": "Reject the request immediately if the absolute difference between the current time and the token timestamp exceeds your allowed window, preventing replay attacks." },
        { "@type": "HowToStep", "position": 3, "name": "Verify the HMAC signature", "text": "Recompute HMAC-SHA256 over raw payload bytes plus the coordinate string, then compare with constant-time digest comparison to prevent timing side-channel attacks." },
        { "@type": "HowToStep", "position": 4, "name": "Assert spatial containment", "text": "Use a prepared Shapely polygon to confirm the payload coordinates fall within the authorized operational zone." },
        { "@type": "HowToStep", "position": 5, "name": "Route failures to a dead-letter queue", "text": "On any validation failure, enqueue the raw payload for forensic analysis rather than silently returning 403." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What coordinate precision should I sign into the spatial token?",
          "acceptedAnswer": { "@type": "Answer", "text": "Sign the coordinates at the precision your device actually reports — typically 6 decimal places for consumer GPS (WGS 84 / EPSG:4326). Do not round before signing, but buffer your authorized polygon by the expected device error radius (5–50 m) to absorb legitimate variance." }
        },
        {
          "@type": "Question",
          "name": "Can I use a JWT instead of a raw HMAC token?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes. Embed the geohash and bounding-box hash in custom JWT claims (e.g. 'geo_hash' and 'bbox_digest'), sign with HS256 or RS256, and validate them after standard JWT signature and expiry checks. The containment check logic stays the same." }
        },
        {
          "@type": "Question",
          "name": "How do I rotate the HMAC secret without downtime?",
          "acceptedAnswer": { "@type": "Answer", "text": "Version your token format (e.g. 'v2:base64...') and accept both the old and the new secret during a transition window. Once all edge devices have received the new secret, remove the fallback." }
        }
      ]
    }
  ]
}
</script>

**Embed a signed spatial claim — a geohash or bounding-box digest — into every webhook token, then validate the cryptographic signature *and* geographic containment before accepting the event.** This how-to sits under [Webhook Security Boundaries](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/), part of [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/).

## When to use this pattern

Spatial token validation adds meaningful overhead; deploy it only when location is a primary trust boundary, not just contextual metadata:

- Your business logic must **reject events originating outside a physical service area** — ride-hailing dispatch zones, drone delivery corridors, or jurisdiction-specific compliance regions.
- You ingest telemetry from **untrusted edge devices** (IoT sensors, fleet trackers, mobile clients) where GPS spoofing or relay attacks are economically viable — an attacker can replay a legitimate coordinate pair from a different physical location.
- Regulatory frameworks require **geographic attestation** for routing or storing data, for example, requiring that health or financial records are processed only in a specific country's infrastructure.

For general-purpose event ingestion where location is metadata, standard HMAC/JWT validation with IP allowlists and rate limiting is sufficient. Reserve spatial attestation for systems where "where did this event originate?" is a security question, not just an analytics one.

## Validation flow

The diagram below shows the fail-fast sequence. Each gate is ordered to minimize compute: cheapest checks (TTL, decode) run first; the most expensive check (spatial containment) runs last.

<figure class="fig">
<svg viewBox="0 0 760 268" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Funnel of five validation gates showing per-gate compute cost and how much traffic each removes, justifying cheapest-first ordering">
<title>Why the containment check runs last</title>
<desc>Ten thousand incoming requests pass through five gates in cost order. Decode costs about 0.8 microseconds and drops 1,200 malformed tokens. The TTL check costs about 0.2 microseconds and drops 2,600 expired ones. HMAC verification costs about 3.1 microseconds and drops 5,900 forgeries. Point construction costs about 12 microseconds and drops 40. Prepared-geometry containment costs about 85 microseconds and drops 190, leaving 70 accepted. Because the three cheap gates remove 97 percent of traffic first, the expensive containment test runs on only 300 requests: about 25 milliseconds of work per ten thousand. Running containment first would cost 850 milliseconds for the same result, a 34-fold increase, and would hand an attacker a cheap way to burn CPU.</desc>
<rect x="0" y="0" width="760" height="268" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10.5" font-weight="600" fill="var(--fig-ink)">10,000 requests in — gates ordered cheapest first</text>
<rect x="14" y="28" width="600" height="30" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="26" y="47" font-size="9.5" font-weight="600" fill="var(--fig-ink)">1 · decode base64url — 0.8 µs</text>
<text x="470" y="47" font-size="9" fill="var(--fig-ink-soft)">−1,200 malformed</text>
<text x="622" y="47" font-size="9" fill="var(--fig-ink-soft)">8,800 left</text>
<rect x="14" y="64" width="528" height="30" rx="4" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.2"/>
<text x="26" y="83" font-size="9.5" font-weight="600" fill="var(--fig-ink)">2 · TTL window — 0.2 µs</text>
<text x="398" y="83" font-size="9" fill="var(--fig-ink-soft)">−2,600 expired</text>
<text x="550" y="83" font-size="9" fill="var(--fig-ink-soft)">6,200 left</text>
<rect x="14" y="100" width="372" height="30" rx="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="26" y="119" font-size="9.5" font-weight="600" fill="var(--fig-ink)">3 · HMAC compare — 3.1 µs</text>
<text x="242" y="119" font-size="9" fill="var(--fig-ink-soft)">−5,900 forged</text>
<text x="394" y="119" font-size="9" fill="var(--fig-ink-soft)">300 left</text>
<rect x="14" y="136" width="342" height="30" rx="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.2"/>
<text x="26" y="155" font-size="9.5" font-weight="600" fill="var(--fig-ink)">4 · build Point — 12 µs</text>
<text x="222" y="155" font-size="9" fill="var(--fig-ink-soft)">−40 bad coords</text>
<text x="364" y="155" font-size="9" fill="var(--fig-ink-soft)">260 left</text>
<rect x="14" y="172" width="300" height="30" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="191" font-size="9.5" font-weight="600" fill="var(--fig-ink)">5 · prepared containment — 85 µs</text>
<text x="322" y="191" font-size="9" fill="var(--fig-ink-soft)">−190 outside the zone</text>
<rect x="14" y="208" width="120" height="26" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="74" y="225" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">70 accepted</text>
<rect x="392" y="208" width="354" height="26" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.2"/>
<text x="404" y="225" font-size="9.5" fill="var(--fig-ink)">containment runs 300× — about 25 ms per 10k requests</text>
<rect x="14" y="240" width="732" height="24" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.2"/>
<text x="26" y="257" font-size="9.5" fill="var(--fig-ink)">Reverse the order and containment runs 10,000× — 850 ms per 10k, a 34× bill, and an attacker can raise it for free with junk tokens.</text>
</svg>
<figcaption><b>Figure 1.</b> Gate ordering is a denial-of-service control as much as an optimisation: the expensive spatial test must sit behind the cheap authenticity tests, so unauthenticated traffic can never reach it.</figcaption>
</figure>

<figure class="fig">
<svg viewBox="0 16 757 290" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Spatial token validation sequence diagram">
  <title>Spatial token validation sequence</title>
  <desc>A flowchart showing five sequential validation gates arranged left-to-right then wrapping to a second row: decode token, TTL check, HMAC verify, spatial containment check, and finally accept or route to dead-letter queue. Failure at any gate sends the event to the dead-letter queue shown at the bottom.</desc>
  <rect x="0" y="16" width="757" height="290" fill="var(--fig-bg)"/>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
    <marker id="arr-dash" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Row 1: Incoming → Decode → TTL → HMAC -->
  <!-- Incoming POST -->
  <rect x="8" y="30" width="120" height="48" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="68" y="52" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">Incoming</text>
  <text x="68" y="68" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">POST</text>
  <!-- Arrow 1 -->
  <line x1="128" y1="54" x2="153" y2="54" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- 1. Decode -->
  <rect x="155" y="30" width="120" height="48" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="215" y="52" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">1. Decode</text>
  <text x="215" y="68" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">&amp; parse token</text>
  <!-- Arrow 2 -->
  <line x1="275" y1="54" x2="300" y2="54" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- 2. TTL check -->
  <rect x="302" y="30" width="130" height="48" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="367" y="52" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">2. TTL check</text>
  <text x="367" y="68" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif">|now − ts| ≤ window</text>
  <!-- Arrow 3 -->
  <line x1="432" y1="54" x2="457" y2="54" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- 3. HMAC verify -->
  <rect x="459" y="30" width="130" height="48" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="524" y="52" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">3. HMAC verify</text>
  <text x="524" y="68" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif">constant-time compare</text>
  <!-- Arrow 4: HMAC → Spatial (down then across) -->
  <line x1="524" y1="78" x2="524" y2="104" stroke="currentColor" stroke-width="1.5"/>
  <line x1="524" y1="104" x2="659" y2="104" stroke="currentColor" stroke-width="1.5"/>
  <line x1="659" y1="104" x2="659" y2="143" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Row 2: Spatial → Accept -->
  <!-- 4. Spatial containment -->
  <rect x="594" y="145" width="150" height="48" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="669" y="167" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">4. Spatial</text>
  <text x="669" y="183" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif">containment check</text>
  <!-- Arrow pass: Spatial → Accept (left) -->
  <line x1="594" y1="169" x2="440" y2="169" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="516" y="162" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif">inside zone ✓</text>
  <!-- 5. Accept -->
  <rect x="310" y="145" width="128" height="48" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="374" y="167" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">5. Accept event</text>
  <text x="374" y="183" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif">200 OK → processor</text>
  <!-- DLQ box at bottom -->
  <rect x="155" y="248" width="430" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6,3"/>
  <text x="370" y="266" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">Dead-letter queue (DLQ)</text>
  <text x="370" y="282" text-anchor="middle" font-size="10" fill="currentColor" font-family="sans-serif">forensic analysis · SIEM ingestion · 403 response</text>
  <!-- Failure paths to DLQ -->
  <!-- Decode fail -->
  <line x1="215" y1="78" x2="215" y2="240" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#arr-dash)" opacity="0.7"/>
  <text x="220" y="160" font-size="9" fill="currentColor" font-family="sans-serif" opacity="0.8">bad format</text>
  <!-- TTL fail -->
  <line x1="367" y1="78" x2="367" y2="240" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#arr-dash)" opacity="0.7"/>
  <text x="372" y="135" font-size="9" fill="currentColor" font-family="sans-serif" opacity="0.8">expired</text>
  <!-- HMAC fail -->
  <line x1="524" y1="104" x2="524" y2="248" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#arr-dash)" opacity="0.7"/>
  <text x="529" y="200" font-size="9" fill="currentColor" font-family="sans-serif" opacity="0.8">bad sig</text>
  <!-- Spatial fail: down from spatial box -->
  <line x1="669" y1="193" x2="669" y2="240" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3"/>
  <line x1="669" y1="240" x2="585" y2="248" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#arr-dash)" opacity="0.7"/>
  <text x="669" y="218" text-anchor="middle" font-size="9" fill="currentColor" font-family="sans-serif" opacity="0.8">outside zone</text>
</svg>
<figcaption><b>Figure 2.</b> Spatial token validation sequence</figcaption>
</figure>

## Complete runnable implementation

The FastAPI endpoint below is self-contained: paste it into a project that has `fastapi`, `shapely`, and `python-multipart` installed and run it with `uvicorn app:app`. Every spatial-specific choice is annotated inline.

If your devices report coordinates in a projected CRS such as EPSG:3857, reproject them to WGS 84 (EPSG:4326) before computing the HMAC — the approach for this is covered in [CRS Normalization Strategies](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/).

```python
import base64
import hashlib
import hmac
import json
import time
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Request, status
from shapely.geometry import Point, Polygon
from shapely.prepared import prep

app = FastAPI()

# --- Configuration -----------------------------------------------------------
# Use a 256-bit (32-byte) secret loaded from an environment variable in prod.
WEBHOOK_SECRET: bytes = b"change-me-to-a-32-byte-env-secret"
# TTL window: 5 minutes. Include ±15 s skew allowance for NTP drift.
ALLOWED_TTL_SECONDS: int = 315
# Authorized operational zone in WGS 84 (EPSG:4326): (longitude, latitude).
# prep() builds a spatial index for repeated containment queries — do this
# once at import time, not per request.
_RAW_ZONE = Polygon([
    (-122.5, 37.70), (-122.30, 37.70),
    (-122.30, 37.90), (-122.50, 37.90),
    (-122.5, 37.70),  # closed exterior ring
])
# Buffer radius in degrees (≈ 50 m at mid-latitudes) to absorb GPS variance.
GPS_TOLERANCE_DEG: float = 0.0005
# Build prepared geometry once, including the GPS tolerance buffer.
# PreparedGeometry does not expose .buffer() directly, so buffer the raw
# polygon first, then wrap with prep() for fast repeated containment tests.
AUTHORIZED_ZONE = prep(_RAW_ZONE.buffer(GPS_TOLERANCE_DEG))


def verify_spatial_token(
    token: str,
    payload_bytes: bytes,
    lon: float,
    lat: float,
) -> bool:
    """
    Returns True only when ALL three conditions pass:
      1. The token is within the TTL window.
      2. The HMAC-SHA256 over (payload_bytes + "<lon>:<lat>") matches.
      3. The coordinate point falls inside the authorized zone (with buffer).
    """
    try:
        # base64url padding: Python requires multiples of 4.
        padding = "=" * (-len(token) % 4)
        decoded = base64.urlsafe_b64decode(token + padding).decode("utf-8")
        sig_hex, _spatial_claim, ts_str = decoded.split(":", maxsplit=2)
        timestamp = int(ts_str)
    except Exception:
        return False

    # Gate 1 — TTL (replay protection). Evaluate before HMAC to avoid
    # unnecessary crypto work on clearly stale tokens.
    if abs(time.time() - timestamp) > ALLOWED_TTL_SECONDS:
        return False

    # Gate 2 — HMAC-SHA256. Sign over payload bytes AND coordinate string so
    # that swapping coordinates invalidates the token even with a valid payload.
    coord_bytes = f"{lon:.6f}:{lat:.6f}".encode()
    expected_sig = hmac.new(
        WEBHOOK_SECRET,
        payload_bytes + coord_bytes,
        hashlib.sha256,
    ).hexdigest()
    # constant-time comparison prevents timing side-channel attacks.
    if not hmac.compare_digest(sig_hex, expected_sig):
        return False

    # Gate 3 — spatial containment. AUTHORIZED_ZONE already includes the GPS
    # tolerance buffer (built at module load time above).
    point = Point(lon, lat)
    if not AUTHORIZED_ZONE.contains(point):
        return False

    return True


def _enqueue_dlq(payload_bytes: bytes, reason: str) -> None:
    """
    In production: push to a Kafka topic, SQS dead-letter queue, or Redis
    stream for forensic analysis. Here we log for illustration.

    For sensor-data routing, see:
    /core-event-fundamentals-architecture/sensor-data-routing-patterns/
    """
    import logging
    logging.warning(
        "DLQ: spatial validation failed — %s — %d bytes", reason, len(payload_bytes)
    )


@app.post("/webhook/spatial", status_code=200)
async def handle_spatial_webhook(
    request: Request,
    x_spatial_token: Optional[str] = Header(default=None),
) -> dict:
    if not x_spatial_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing X-Spatial-Token header",
        )

    payload_bytes = await request.body()

    try:
        data = json.loads(payload_bytes)
        # Coordinates must be WGS 84 (EPSG:4326): lon first, then lat.
        lon = float(data["lon"])
        lat = float(data["lat"])
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid payload or missing coordinates: {exc}",
        )

    if not verify_spatial_token(x_spatial_token, payload_bytes, lon, lat):
        # Do NOT reveal which gate failed — treat all failures identically
        # to prevent oracle attacks. Route to DLQ for SIEM analysis.
        _enqueue_dlq(payload_bytes, reason="token_validation_failed")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    # Hand off to your event processor, feature-change trigger pipeline,
    # or sensor-data router here.
    return {"status": "accepted"}
```

Rejected payloads routed to `_enqueue_dlq` follow the same [sensor data routing patterns](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/) used for accepted events — this turns security rejections into auditable forensic records rather than silent drops. Before handing accepted events downstream, generate a deterministic idempotency key using the approach described in [Event Key Generation for Spatial Data](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/).

## Parameter reference

<div style="overflow-x:auto;">

| Parameter | Type | Spatial constraint | Default |
|---|---|---|---|
| `WEBHOOK_SECRET` | `bytes` | Min 32 bytes; load from env var | — (must be set) |
| `ALLOWED_TTL_SECONDS` | `int` | Include ±15 s NTP skew; max 900 s recommended | `315` |
| `_RAW_ZONE` | `shapely.geometry.Polygon` | Must be a valid, closed exterior ring in EPSG:4326 | Bay Area demo polygon |
| `GPS_TOLERANCE_DEG` | `float` | ~0.0001° ≈ 10 m; ~0.0005° ≈ 50 m at equatorial latitudes | `0.0005` |
| `AUTHORIZED_ZONE` | `shapely.prepared.PreparedGeometry` | Built from `_RAW_ZONE.buffer(GPS_TOLERANCE_DEG)` at import time | buffered Bay Area polygon |
| `lon` / `lat` | `float` | WGS 84 (EPSG:4326); lon ∈ [−180, 180], lat ∈ [−90, 90] | from payload |
| `sig_hex` | `str` | 64-char lowercase hex (HMAC-SHA256 output) | from token |
| `_spatial_claim` | `str` | Geohash or bounding-box digest (informational; not re-verified here) | from token |
| `ts_str` | `str` | Unix epoch as string; must be parseable as `int` | from token |

</div>

## Gotchas and spatial edge cases

1. **Coordinate order mismatch (EPSG:4326).** GeoJSON specifies coordinates as `[longitude, latitude]`, but many mapping libraries and some device SDKs emit `[latitude, longitude]`. Sign and verify with a consistent order, and document it in your API contract. A coordinate-swapped token produces a valid HMAC but fails the containment check in confusing ways.

2. **Coordinate precision drift.** Consumer GPS (u-blox, SiRF) reports 6–7 decimal places but has hardware accuracy of ±3–15 m. Cellular and Wi-Fi triangulation degrades to ±50–200 m. Use `GPS_TOLERANCE_DEG` to buffer your zone rather than requiring exact point matching. If your devices report in a projected CRS (e.g., EPSG:3857), handling mixed-CRS payloads before signing is covered in [handling mixed-CRS payloads in Python event handlers](https://www.geospatialwebhook.com/spatial-payload-routing-parsing/crs-normalization-strategies/handling-mixed-crs-payloads-in-python-event-handlers/).

3. **Polygon exterior ring orientation.** Shapely accepts both clockwise and counter-clockwise rings for `Polygon()`, but ensure your ring is closed (first and last points identical). An unclosed ring creates a `TopologicalError` at `prep()` time, which surfaces only when the first request arrives — not at startup.

4. **Prepared geometry is not thread-safe for mutation.** Call `prep()` once at module load and treat the result as read-only. If you need to reload zones (e.g., from a database), build the new `PreparedGeometry` object in a separate variable and swap the reference atomically.

5. **Buffering must happen before `prep()`.** `PreparedGeometry` does not expose `.buffer()` directly. Call `.buffer()` on the underlying `Polygon` first, then wrap with `prep()`: `prep(raw_polygon.buffer(GPS_TOLERANCE_DEG))`. The implementation above makes this explicit by defining `_RAW_ZONE` separately from `AUTHORIZED_ZONE`.

6. **Token format versioning.** When you rotate your HMAC secret, you need a transition window where both the old and new secrets are valid. Prefix the token with a version string (e.g., `v2:base64url(...)`) and maintain a dict of `{version: secret}`. This prevents downtime during key rotation and lets you audit which devices are still sending v1 tokens.

7. **Replay from a different spatial context.** An attacker can capture a valid token emitted from within the authorized zone and replay it from outside. The TTL window limits the replay window, but for high-security contexts consider binding the token to a per-request nonce (a UUID the server issues and the client echoes back). This composes directly with [using Redis to cache spatial webhook signatures](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/) for nonce deduplication within the TTL window.

<figure class="fig">
<svg viewBox="0 0 760 258" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A captured spatial token replayed from outside the zone, and the three bindings that stop it">
<title>What a spatial token proves, and what it does not</title>
<desc>A legitimate device inside the dispatch zone emits a token binding its coordinates and a timestamp under an HMAC. An attacker captures that token on the wire and replays it verbatim from four hundred kilometres away. Because the token attests to the coordinates written into it rather than to where the request came from, the signature still verifies and the containment check still passes — the payload says the device is inside the zone. Only three additional bindings close the gap: a short time-to-live, which bounds the replay to the window's width; a server-issued nonce echoed back by the client, which makes each token single-use; and channel binding to the device's mutual-TLS certificate, which ties the token to the connection that carried it.</desc>
<rect x="0" y="0" width="760" height="258" fill="var(--fig-bg)"/>
<defs>
<marker id="tk-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
<path d="M0,0 L8,3 L0,6 Z" fill="var(--fig-line)"/>
</marker>
</defs>
<ellipse cx="104" cy="82" rx="90" ry="52" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.5"/>
<text x="104" y="46" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-mint-edge)">authorised zone</text>
<circle cx="104" cy="86" r="5" fill="var(--fig-mint-edge)"/>
<text x="104" y="106" text-anchor="middle" font-size="9" fill="var(--fig-ink)">device · 52.52, 13.40</text>
<line x1="196" y1="86" x2="252" y2="86" stroke="var(--fig-line)" stroke-width="1.4" marker-end="url(#tk-arr)"/>
<rect x="256" y="60" width="180" height="52" rx="6" fill="var(--fig-earth)" stroke="var(--fig-earth-edge)" stroke-width="1.3"/>
<text x="346" y="80" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">token = HMAC(lat, lon, ts)</text>
<text x="346" y="96" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">attests to the numbers inside it</text>
<circle cx="346" cy="140" r="5" fill="var(--fig-rose-edge)"/>
<text x="346" y="160" text-anchor="middle" font-size="9" fill="var(--fig-rose-edge)" font-weight="600">captured on the wire</text>
<line x1="346" y1="114" x2="346" y2="132" stroke="var(--fig-rose-edge)" stroke-width="1.3" stroke-dasharray="3,2" marker-end="url(#tk-arr)"/>
<line x1="380" y1="140" x2="452" y2="140" stroke="var(--fig-rose-edge)" stroke-width="1.4" stroke-dasharray="4,3" marker-end="url(#tk-arr)"/>
<rect x="456" y="118" width="180" height="44" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="546" y="136" text-anchor="middle" font-size="9.5" font-weight="600" fill="var(--fig-ink)">replayed from 400 km away</text>
<text x="546" y="152" text-anchor="middle" font-size="8.5" fill="var(--fig-ink-soft)">signature valid · containment passes</text>
<text x="648" y="142" font-size="9" fill="var(--fig-rose-edge)" font-weight="600">✗ accepted</text>
<text x="14" y="188" font-size="10.5" font-weight="600" fill="var(--fig-ink)">Three bindings that close the gap — the token alone cannot:</text>
<rect x="14" y="196" width="238" height="48" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="26" y="214" font-size="9.5" font-weight="600" fill="var(--fig-ink)">short TTL</text>
<text x="26" y="229" font-size="9" fill="var(--fig-ink-soft)">bounds how long the capture</text>
<text x="26" y="240" font-size="9" fill="var(--fig-ink-soft)">stays useful — never to zero</text>
<rect x="260" y="196" width="238" height="48" rx="6" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.2"/>
<text x="272" y="214" font-size="9.5" font-weight="600" fill="var(--fig-ink)">server-issued nonce</text>
<text x="272" y="229" font-size="9" fill="var(--fig-ink-soft)">makes the token single-use,</text>
<text x="272" y="240" font-size="9" fill="var(--fig-ink-soft)">so the second use is caught</text>
<rect x="506" y="196" width="240" height="48" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="518" y="214" font-size="9.5" font-weight="600" fill="var(--fig-ink)">channel binding (mTLS)</text>
<text x="518" y="229" font-size="9" fill="var(--fig-ink-soft)">ties the token to the connection</text>
<text x="518" y="240" font-size="9" fill="var(--fig-ink-soft)">that carried it — the strongest</text>
</svg>
<figcaption><b>Figure 3.</b> A spatial token attests to the coordinates written into it, not to where the request originated. That distinction is the whole attack surface — the coordinates are asserted by the very device you do not trust.</figcaption>
</figure>

## Minimal verification snippet

Run this with `pytest` after installing `fastapi`, `httpx`, `shapely`, and `pytest-asyncio`:

```python
import base64
import hashlib
import hmac
import json
import time

from fastapi.testclient import TestClient

# Import the app defined in the implementation section above.
from app import app, WEBHOOK_SECRET

client = TestClient(app)


def _make_token(lon: float, lat: float, payload_bytes: bytes, offset: int = 0) -> str:
    """Build a valid spatial token for the given coordinates and payload."""
    ts = int(time.time()) + offset
    coord_bytes = f"{lon:.6f}:{lat:.6f}".encode()
    sig = hmac.new(WEBHOOK_SECRET, payload_bytes + coord_bytes, hashlib.sha256).hexdigest()
    # _spatial_claim field: a placeholder geohash (informational only)
    raw = f"{sig}:9q8y:{ts}"
    return base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode()


def _payload(lon: float = -122.4, lat: float = 37.8) -> dict:
    return {"lon": lon, "lat": lat, "sensor_id": "device-001"}


def test_valid_event_accepted():
    data = _payload()
    body = json.dumps(data).encode()
    token = _make_token(data["lon"], data["lat"], body)
    resp = client.post(
        "/webhook/spatial",
        content=body,
        headers={"X-Spatial-Token": token, "Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


def test_event_outside_zone_rejected():
    # Coordinates clearly outside the Bay Area demo zone
    data = _payload(lon=2.35, lat=48.86)  # Paris
    body = json.dumps(data).encode()
    token = _make_token(data["lon"], data["lat"], body)
    resp = client.post(
        "/webhook/spatial",
        content=body,
        headers={"X-Spatial-Token": token, "Content-Type": "application/json"},
    )
    assert resp.status_code == 403


def test_expired_token_rejected():
    data = _payload()
    body = json.dumps(data).encode()
    # Timestamp 10 minutes in the past — outside the TTL window
    token = _make_token(data["lon"], data["lat"], body, offset=-600)
    resp = client.post(
        "/webhook/spatial",
        content=body,
        headers={"X-Spatial-Token": token, "Content-Type": "application/json"},
    )
    assert resp.status_code == 403


def test_tampered_payload_rejected():
    data = _payload()
    body = json.dumps(data).encode()
    token = _make_token(data["lon"], data["lat"], body)
    # Modify the payload after signing — HMAC must fail
    tampered = json.dumps({**data, "sensor_id": "attacker"}).encode()
    resp = client.post(
        "/webhook/spatial",
        content=tampered,
        headers={"X-Spatial-Token": token, "Content-Type": "application/json"},
    )
    assert resp.status_code == 403


def test_missing_token_returns_400():
    data = _payload()
    body = json.dumps(data).encode()
    resp = client.post(
        "/webhook/spatial",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400
```

---

## Related

- [Webhook Security Boundaries](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/) — parent overview covering the full trust model for geospatial event ingress
- [Using Redis to Cache Spatial Webhook Signatures](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/cache-backed-idempotency-checks/using-redis-to-cache-spatial-webhook-signatures/) — combine spatial token validation with Redis-backed nonce caching to prevent replay within the TTL window
- [Sensor Data Routing Patterns](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/sensor-data-routing-patterns/) — route validated events to downstream consumers based on geographic partitioning
- [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/) — the broader architectural context for secure, location-aware event pipelines
