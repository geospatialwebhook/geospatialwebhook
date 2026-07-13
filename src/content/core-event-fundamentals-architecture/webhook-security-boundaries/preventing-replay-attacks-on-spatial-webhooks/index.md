---
title: "Preventing Replay Attacks on Spatial Webhooks"
description: "Stop replayed spatial webhooks from re-triggering geometry mutations: sign a timestamp for freshness, then reject each nonce once via Redis SET NX."
slug: "preventing-replay-attacks-on-spatial-webhooks"
type: "article"
breadcrumb:
  - label: "Core Event Fundamentals & Architecture"
    url: "/core-event-fundamentals-architecture/"
  - label: "Webhook Security Boundaries"
    url: "/core-event-fundamentals-architecture/webhook-security-boundaries/"
  - label: "Preventing Replay Attacks on Spatial Webhooks"
    url: "/core-event-fundamentals-architecture/webhook-security-boundaries/preventing-replay-attacks-on-spatial-webhooks/"
datePublished: "2025-05-01"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Preventing Replay Attacks on Spatial Webhooks",
      "description": "Stop an attacker from re-sending a previously valid, correctly-signed spatial webhook to re-trigger a geometry mutation: enforce a signed-timestamp freshness window and reject each delivery nonce exactly once with Redis SET NX.",
      "url": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/preventing-replay-attacks-on-spatial-webhooks/",
      "datePublished": "2025-05-01",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "geospatialwebhook.com" },
      "publisher": { "@type": "Organization", "name": "geospatialwebhook.com" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Core Event Fundamentals & Architecture", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/" },
        { "@type": "ListItem", "position": 2, "name": "Webhook Security Boundaries", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/" },
        { "@type": "ListItem", "position": 3, "name": "Preventing Replay Attacks on Spatial Webhooks", "item": "https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/preventing-replay-attacks-on-spatial-webhooks/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Preventing Replay Attacks on Spatial Webhooks",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Sign a timestamp into the payload", "text": "Include a Unix timestamp and a unique delivery id inside the bytes covered by the HMAC-SHA256 signature so neither can be altered without invalidating the signature." },
        { "@type": "HowToStep", "position": 2, "name": "Verify the signature and freshness window", "text": "Recompute the HMAC over the signed bytes, compare in constant time, then reject the request if the timestamp is outside a short skew window such as five minutes." },
        { "@type": "HowToStep", "position": 3, "name": "Claim the nonce exactly once", "text": "Call Redis SET NX on a key derived from the delivery id with a TTL matching the freshness window. If the key already exists, the message is a replay and must be rejected." },
        { "@type": "HowToStep", "position": 4, "name": "Only then apply the geometry mutation", "text": "Perform the spatial state change after both the freshness check and the nonce claim succeed, so a replayed valid message can never re-trigger the mutation." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Isn't a freshness window alone enough to stop replays?",
          "acceptedAnswer": { "@type": "Answer", "text": "No. A signed timestamp bounds how long a captured message stays valid, but an attacker can replay it many times inside that window. You still need a per-message nonce, tracked in Redis with SET NX, so the same delivery id is accepted exactly once regardless of how fast it is resent." }
        },
        {
          "@type": "Question",
          "name": "How is replay prevention different from idempotency deduplication?",
          "acceptedAnswer": { "@type": "Answer", "text": "They share Redis mechanics but differ in intent and TTL. Replay prevention is adversarial: a short window (minutes) and reject on a duplicate. Idempotency dedup is benign: it absorbs a provider's own retries over a long window (hours to days) by returning the original result. Do not collapse them into one key with one TTL." }
        },
        {
          "@type": "Question",
          "name": "Should the nonce store fail open or fail closed when Redis is down?",
          "acceptedAnswer": { "@type": "Answer", "text": "For a security boundary that guards geometry mutations, fail closed: reject the webhook if you cannot verify the nonce, because a fail-open path lets an attacker replay freely during an outage. Reserve fail-open behavior for non-adversarial idempotency caches where a rare duplicate is acceptable." }
        },
        {
          "@type": "Question",
          "name": "What should the nonce TTL be relative to the freshness window?",
          "acceptedAnswer": { "@type": "Answer", "text": "Set the nonce TTL at least as long as the freshness window plus your maximum clock skew. If the nonce expires before the timestamp goes stale, a replay can slip through in the gap. Matching the window (for example 300 seconds plus skew) keeps the two defences aligned." }
        }
      ]
    }
  ]
}
</script>

**Stop a replayed spatial webhook from re-triggering a geometry mutation by signing a timestamp into the payload and rejecting anything outside a short freshness window, then claiming a per-message nonce in Redis with `SET NX` so a valid, correctly-signed message is accepted exactly once.** This how-to sits under [Webhook Security Boundaries](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/), part of [Core Event Fundamentals & Architecture](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/).

A replay attack does not need to forge anything. The attacker captures one genuinely valid delivery — correct HMAC, correct coordinates, everything your signature check accepts — and simply sends it again. If that delivery said "move parcel boundary 42 to this new polygon" or "delete the geofence for zone A", replaying it re-applies the mutation. Signature verification, covered in [Signing Spatial Webhook Payloads with HMAC-SHA256](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/signing-spatial-webhook-payloads-with-hmac-sha256/), proves *who* sent the message and that it was not tampered with. It says nothing about *when* or *how many times*.

## When to use this pattern

- Your webhook triggers a **state-changing spatial operation** — writing a new geometry, mutating a feature's bounds, toggling a geofence, or dispatching a physical asset — where re-applying the same event has real consequences.
- You accept webhooks over the public internet from a provider or edge fleet where a network path could **capture and resend** a valid delivery, or where a buggy client retries aggressively.
- You already sign payloads and now need the second half of the defence: **freshness plus single-use**, not just authenticity.

This is *not* the right tool when the operation is naturally read-only or already commutative, or when your only concern is a provider's own well-behaved retries. Benign duplicate suppression is idempotency deduplication, a different problem with a different TTL — see [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/). The rest of this page is deliberate about keeping the two apart.

## Why a freshness window alone is not enough

The instinct is to sign a timestamp and reject stale messages. That is necessary but insufficient. A freshness window bounds the *duration* an attacker can replay — but within that window, nothing stops them resending the same valid message a thousand times. If your window is five minutes, that is five minutes of unlimited re-triggering of a geometry mutation.

So you need two orthogonal defences working together. The signed timestamp bounds *how long* a captured message is dangerous. The per-message nonce bounds *how many times* any single message is accepted — exactly once. Neither substitutes for the other.

<svg viewBox="0 0 760 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Two-gate replay defence: freshness window then single-use nonce claim in Redis" style="width:100%;max-width:760px;height:auto;display:block;margin:1.5rem auto;">
  <title>Replay defence: freshness gate then nonce gate</title>
  <desc>An incoming signed webhook passes through a freshness window check on the signed timestamp, then a Redis SET NX nonce claim. A first delivery passes both gates and applies the geometry mutation. A replayed delivery passes the freshness gate but is rejected at the nonce gate because the key already exists.</desc>
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
    <marker id="arr-dash" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <!-- Incoming -->
  <rect x="10" y="120" width="118" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="69" y="142" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">Signed webhook</text>
  <text x="69" y="158" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">ts + delivery-id</text>
  <line x1="128" y1="146" x2="158" y2="146" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Gate 1 freshness -->
  <rect x="160" y="118" width="150" height="56" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="235" y="140" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">1. Freshness</text>
  <text x="235" y="156" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">|now − ts| ≤ 5 min</text>
  <line x1="310" y1="146" x2="342" y2="146" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/>
  <!-- Gate 2 nonce -->
  <rect x="344" y="118" width="164" height="56" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="426" y="140" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">2. Nonce claim</text>
  <text x="426" y="156" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">Redis SET NX (TTL)</text>
  <!-- Redis store -->
  <rect x="372" y="30" width="108" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.55"/>
  <text x="426" y="50" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">Redis</text>
  <text x="426" y="65" text-anchor="middle" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">seen delivery-ids</text>
  <line x1="426" y1="74" x2="426" y2="116" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.55"/>
  <!-- Accept path -->
  <line x1="508" y1="146" x2="560" y2="146" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/>
  <rect x="562" y="120" width="186" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="655" y="142" text-anchor="middle" font-size="12" fill="currentColor" font-family="system-ui,sans-serif">Apply geometry</text>
  <text x="655" y="158" text-anchor="middle" font-size="10" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.7">mutation (once)</text>
  <!-- Reject stale -->
  <line x1="235" y1="174" x2="235" y2="238" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#arr-dash)" opacity="0.7"/>
  <text x="240" y="210" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">stale → 401</text>
  <!-- Reject replay -->
  <line x1="426" y1="174" x2="426" y2="238" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#arr-dash)" opacity="0.7"/>
  <text x="431" y="210" font-size="9" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.8">key exists → replay, 409</text>
  <rect x="150" y="240" width="360" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="6,3" opacity="0.7"/>
  <text x="330" y="264" text-anchor="middle" font-size="11" fill="currentColor" font-family="system-ui,sans-serif" opacity="0.85">Rejected — no mutation applied</text>
</svg>

## Complete runnable implementation

The module below is self-contained. It verifies an HMAC-SHA256 signature over the exact bytes that include the timestamp and delivery id, enforces a five-minute freshness window, and then claims the nonce with a single atomic `SET NX`. Only if both gates pass does it apply the geometry mutation. Install `redis` (the modern `redis-py`, which bundles async support); the payload is plain JSON following [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946) GeoJSON structure.

```python
import hashlib
import hmac
import json
import time
from typing import Any

import redis  # redis-py >= 4.2 (bundles redis.asyncio)

# --- Configuration -----------------------------------------------------------
WEBHOOK_SECRET: bytes = b"change-me-to-a-32-byte-env-secret"
# Freshness window for the SECURITY replay check: short and adversarial.
FRESHNESS_WINDOW_SECONDS: int = 300          # 5 minutes
# Allowance for NTP drift between sender and receiver clocks.
CLOCK_SKEW_SECONDS: int = 30
# Nonce TTL must cover the whole window a replay could still look "fresh":
# freshness window + skew. Shorter than this leaves a replay gap.
NONCE_TTL_SECONDS: int = FRESHNESS_WINDOW_SECONDS + CLOCK_SKEW_SECONDS
NONCE_PREFIX = "replay:nonce:"

_redis = redis.Redis(host="localhost", port=6379, decode_responses=True)


class ReplayRejected(Exception):
    """Raised when a message is stale, unsigned/invalid, or already seen."""


def _expected_signature(signed_bytes: bytes) -> str:
    return hmac.new(WEBHOOK_SECRET, signed_bytes, hashlib.sha256).hexdigest()


def verify_fresh_and_signed(body: dict[str, Any], signature_hex: str) -> str:
    """
    Verify the HMAC over the signed bytes, then enforce the freshness window.
    The timestamp and delivery id are INSIDE the signed bytes, so an attacker
    cannot slide the timestamp forward without breaking the signature.
    Returns the delivery id (the nonce) on success; raises otherwise.
    """
    ts = int(body["ts"])
    delivery_id = str(body["delivery_id"])

    # Sign over a canonical, sorted serialization so sender and receiver agree
    # on the exact bytes. The ts and delivery_id are part of this payload.
    signed_bytes = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    expected = _expected_signature(signed_bytes)
    if not hmac.compare_digest(signature_hex, expected):
        raise ReplayRejected("bad signature")  # not authentic — reject

    # Freshness gate: reject anything outside the short adversarial window.
    # Allow a little skew on BOTH sides (early clock as well as late).
    age = time.time() - ts
    if age > FRESHNESS_WINDOW_SECONDS + CLOCK_SKEW_SECONDS:
        raise ReplayRejected("stale timestamp")
    if age < -CLOCK_SKEW_SECONDS:
        raise ReplayRejected("timestamp in the future")

    return delivery_id


def claim_nonce(delivery_id: str) -> None:
    """
    Claim the delivery id exactly once. SET NX is atomic: the first caller
    creates the key and gets True; any replay finds it present and gets None.
    We FAIL CLOSED — if Redis is unreachable, we reject rather than risk an
    unbounded replay during the outage (this guards a geometry mutation).
    """
    key = NONCE_PREFIX + delivery_id
    try:
        created = _redis.set(key, "1", nx=True, ex=NONCE_TTL_SECONDS)
    except redis.RedisError as exc:
        raise ReplayRejected(f"nonce store unavailable: {exc}") from exc
    if not created:
        # Key already existed within its TTL -> this is a replay.
        raise ReplayRejected("replayed delivery_id")


def apply_geometry_mutation(body: dict[str, Any]) -> dict[str, Any]:
    """The protected side effect: mutate spatial state. Runs at most once
    per delivery_id because both gates ran first."""
    feature_id = body["feature_id"]
    geometry = body["geometry"]  # GeoJSON geometry, WGS 84 (EPSG:4326)
    # ... persist the new geometry for feature_id here ...
    return {"feature_id": feature_id, "type": geometry["type"], "status": "applied"}


def handle_webhook(body: dict[str, Any], signature_hex: str) -> dict[str, Any]:
    """Full ingress path. Order matters: authenticity, then freshness,
    then single-use nonce, then — and only then — the mutation."""
    delivery_id = verify_fresh_and_signed(body, signature_hex)  # gates 1 + 2a
    claim_nonce(delivery_id)                                     # gate 2b
    return apply_geometry_mutation(body)


def sign_payload(body: dict[str, Any]) -> str:
    """Helper a legitimate sender uses to produce the signature header."""
    signed_bytes = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    return _expected_signature(signed_bytes)
```

The key discipline: the timestamp and `delivery_id` live *inside* the signed bytes. If they were unsigned header fields, an attacker could rewrite the timestamp to look fresh and swap the delivery id to dodge the nonce check while keeping a stolen signature. Signing them binds all three together.

## Replay prevention versus idempotency dedup

These two use nearly identical Redis mechanics — a key, a TTL, a "have I seen this before" check — which is exactly why they get conflated. They are not the same job, and merging them weakens both.

<div style="overflow-x:auto;">

| Aspect | Replay prevention (this page) | Idempotency deduplication |
|---|---|---|
| Threat model | Adversarial — attacker resends a valid capture | Benign — provider retries after a timeout |
| Goal | Reject the duplicate | Absorb it, return the original result |
| Window / TTL | Short (minutes), tied to freshness window | Long (hours to days), tied to retry policy |
| On duplicate | Reject: `409` / `401`, no side effect | Accept: replay the stored response, no re-mutation |
| Failure mode | Fail **closed** (reject if store is down) | Often fail **open** (rare duplicate is tolerable) |
| Key source | Signed per-message nonce / delivery id | Deterministic content or event key |

</div>

If you try to serve both with one long-lived key, you either widen the replay window to hours (a security regression) or reject the provider's legitimate retries (a reliability regression). Run them as two layers: the short adversarial nonce here, and a separate long-window dedup key downstream. The dedup side is covered in [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/), whose deterministic keys and long TTLs are designed for benign retries rather than attacks.

## Parameter reference

<div style="overflow-x:auto;">

| Parameter | Type | Constraint / intent | Default |
|---|---|---|---|
| `WEBHOOK_SECRET` | `bytes` | Min 32 bytes; load from env var, never hard-code | — (must be set) |
| `FRESHNESS_WINDOW_SECONDS` | `int` | Short adversarial window; keep ≤ 900 s | `300` |
| `CLOCK_SKEW_SECONDS` | `int` | NTP drift allowance, applied to both sides | `30` |
| `NONCE_TTL_SECONDS` | `int` | Must be ≥ window + skew, or replays slip the gap | `330` |
| `NONCE_PREFIX` | `str` | Namespaces nonce keys away from dedup/idempotency keys | `"replay:nonce:"` |
| `body["ts"]` | `int` | Unix epoch seconds; signed, not a header | from payload |
| `body["delivery_id"]` | `str` | Globally unique per delivery (UUID/ULID); the nonce | from payload |
| `body["geometry"]` | `dict` | GeoJSON geometry, WGS 84 (EPSG:4326), per RFC 7946 | from payload |
| `signature_hex` | `str` | 64-char lowercase hex, HMAC-SHA256 output | from header |

</div>

## Gotchas and spatial edge cases

1. **Clock skew cuts both ways.** If the sender's clock runs fast, a genuinely fresh message can look like it is from the future; if slow, it looks stale on arrival. Allow `CLOCK_SKEW_SECONDS` on *both* sides of the comparison, as the code does, and keep receivers on NTP. Do not widen the window to paper over unsynchronized clocks — that just lengthens the replay window.

2. **Freshness without a nonce is a false sense of security.** The single most common mistake is shipping only the timestamp check. Inside a five-minute window an attacker replays freely. The nonce is not optional; it is the half that enforces *exactly once*.

3. **Nonce TTL shorter than the freshness window opens a gap.** If the nonce expires at 60 s but a timestamp stays "fresh" for 300 s, a replay sent at 90 s finds no nonce and passes both gates. Always set `NONCE_TTL_SECONDS >= FRESHNESS_WINDOW_SECONDS + CLOCK_SKEW_SECONDS`.

4. **Nonce store outage — fail open or fail closed?** For a boundary guarding geometry mutations, fail **closed**: if Redis is unreachable you cannot prove the message is new, so reject it. A fail-open path turns a Redis outage into an open replay window. This is the opposite default from a benign idempotency cache, where a missed dedup is merely a rare duplicate.

5. **The delivery id must be signed, not a bare header.** If the nonce lives in an unsigned header, an attacker replays the stolen signature while mutating the delivery id to a fresh value and sails past the nonce gate. Put `delivery_id` inside the signed bytes so it cannot move independently of the signature. Signature construction is detailed in [Signing Spatial Webhook Payloads with HMAC-SHA256](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/signing-spatial-webhook-payloads-with-hmac-sha256/).

6. **Do not reuse the idempotency key as the replay nonce.** A deterministic content-hash key is designed to be *identical* across legitimate retries — which is precisely what you want dedup to absorb and precisely what you must not silently absorb in a security context. Keep separate key namespaces and separate TTLs; conflating them is the subtle bug that quietly disables one defence.

## Verification

Run with `pytest` after `pip install redis fakeredis pytest`. The test proves the core property: the same signed message is accepted the first time and rejected the second.

```python
import time
import pytest
import fakeredis

import replay_guard as g  # the module above, saved as replay_guard.py


@pytest.fixture(autouse=True)
def fake_redis(monkeypatch):
    monkeypatch.setattr(g, "_redis", fakeredis.FakeStrictRedis(decode_responses=True))


def _signed_message(delivery_id="del-abc-123", ts=None):
    body = {
        "delivery_id": delivery_id,
        "ts": int(ts if ts is not None else time.time()),
        "feature_id": "parcel-42",
        "geometry": {"type": "Point", "coordinates": [-122.4194, 37.7749]},  # EPSG:4326
    }
    return body, g.sign_payload(body)


def test_first_delivery_applies_mutation():
    body, sig = _signed_message()
    result = g.handle_webhook(body, sig)
    assert result["status"] == "applied"


def test_replay_of_same_message_is_rejected():
    body, sig = _signed_message()
    g.handle_webhook(body, sig)                      # first time: accepted
    with pytest.raises(g.ReplayRejected, match="replayed delivery_id"):
        g.handle_webhook(body, sig)                  # exact replay: rejected


def test_stale_timestamp_rejected():
    body, sig = _signed_message(ts=time.time() - 3600)  # an hour old
    with pytest.raises(g.ReplayRejected, match="stale timestamp"):
        g.handle_webhook(body, sig)


def test_tampered_timestamp_breaks_signature():
    body, sig = _signed_message()
    body["ts"] = int(time.time())  # slide ts after signing -> signature no longer matches
    body["ts"] += 1
    with pytest.raises(g.ReplayRejected, match="bad signature"):
        g.handle_webhook(body, sig)
```

## FAQ

<details class="faq">
<summary><strong>Isn't a freshness window alone enough to stop replays?</strong></summary>

No. A signed timestamp bounds how long a captured message stays valid, but an attacker can replay it many times inside that window. You still need a per-message nonce, tracked in Redis with `SET NX`, so the same delivery id is accepted exactly once regardless of how fast it is resent.

</details>

<details class="faq">
<summary><strong>How is replay prevention different from idempotency deduplication?</strong></summary>

They share Redis mechanics but differ in intent and TTL. Replay prevention is adversarial: a short window (minutes) and reject on a duplicate. Idempotency dedup is benign: it absorbs a provider's own retries over a long window (hours to days) by returning the original result. Do not collapse them into one key with one TTL — see [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) for the dedup side.

</details>

<details class="faq">
<summary><strong>Should the nonce store fail open or fail closed when Redis is down?</strong></summary>

For a security boundary that guards geometry mutations, fail closed: reject the webhook if you cannot verify the nonce, because a fail-open path lets an attacker replay freely during an outage. Reserve fail-open behavior for non-adversarial idempotency caches where a rare duplicate is acceptable.

</details>

<details class="faq">
<summary><strong>What should the nonce TTL be relative to the freshness window?</strong></summary>

Set the nonce TTL at least as long as the freshness window plus your maximum clock skew. If the nonce expires before the timestamp goes stale, a replay can slip through in the gap. Matching the window (for example 300 seconds plus skew) keeps the two defences aligned.

</details>

---

## Related

- [Webhook Security Boundaries](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/) — parent overview of the trust model for geospatial event ingress, of which replay prevention is one gate
- [Signing Spatial Webhook Payloads with HMAC-SHA256](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/webhook-security-boundaries/signing-spatial-webhook-payloads-with-hmac-sha256/) — how to construct the signature whose bytes must include the timestamp and delivery id
- [Idempotency & Spatial Deduplication](https://www.geospatialwebhook.com/idempotency-spatial-deduplication/) — the benign, long-window counterpart to adversarial replay prevention, for absorbing a provider's own retries
