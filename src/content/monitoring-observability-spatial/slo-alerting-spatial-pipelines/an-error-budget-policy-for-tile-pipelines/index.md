---
title: "An Error-Budget Policy for Tile Pipelines"
description: "A policy that says the team will discuss it changes nothing. Name the consequence, the owner and the exemptions before the budget is spent — and decide in advance which zoom levels are allowed to fall behind first."
slug: "an-error-budget-policy-for-tile-pipelines"
type: "article"
breadcrumb: "Monitoring & Observability for Spatial Pipelines > SLOs & Alerting for Spatial Webhook Pipelines > An Error-Budget Policy for Tile Pipelines"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "An Error-Budget Policy for Tile Pipelines",
      "description": "An error-budget policy is only useful if it names a consequence, an owner and its exemptions in advance. This guide writes one for a tile pipeline, including the degradation ladder that decides which zoom levels are allowed to fall behind first.",
      "url": "https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/an-error-budget-policy-for-tile-pipelines/",
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
        {"@type": "ListItem", "position": 3, "name": "SLOs & Alerting for Spatial Webhook Pipelines", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/"},
        {"@type": "ListItem", "position": 4, "name": "An Error-Budget Policy for Tile Pipelines", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/an-error-budget-policy-for-tile-pipelines/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Write an error-budget policy for a tile pipeline",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Name a specific consequence, not a commitment to discuss"},
        {"@type": "HowToStep", "position": 2, "name": "Name an owner who can enact it without escalating"},
        {"@type": "HowToStep", "position": 3, "name": "Write the exemptions in advance, or they will be invented under pressure"},
        {"@type": "HowToStep", "position": 4, "name": "Define the degradation ladder: which zoom levels fall behind first"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What makes an error-budget policy useless?",
          "acceptedAnswer": {"@type": "Answer", "text": "Naming a discussion rather than a consequence. A policy saying the team will review priorities when the budget is exhausted describes what would have happened anyway, so it changes no behaviour and provides no reason to protect the budget. A useful policy names something specific that happens automatically — a freeze on non-urgent pipeline changes, a named person who can enact it, and a defined way out."}
        },
        {
          "@type": "Question",
          "name": "Why write the exemptions in advance?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because they will be invented under pressure otherwise, and an exemption invented during an incident is indistinguishable from ignoring the policy. Security fixes, data-loss fixes and the reliability work that would restore the budget are all legitimate exemptions; a feature somebody promised a customer is not, and the time to establish that is before anyone has promised it. A policy with no written exemptions is one that gets suspended the first time it is inconvenient."}
        },
        {
          "@type": "Question",
          "name": "What is a degradation ladder for tiles?",
          "acceptedAnswer": {"@type": "Answer", "text": "A pre-agreed order in which tile freshness is allowed to suffer when the pipeline cannot keep up. Deep zoom levels serve few viewers each and are cheap to rebuild on demand, so they can lag by hours with little visible effect; shallow levels are shared by everyone looking at a region and are expensive to regenerate, so they must stay current. Deciding that order in advance turns an overload into a controlled degradation rather than a race between queued jobs."}
        }
      ]
    }
  ]
}
</script>

**Name a consequence that happens automatically, an owner who can enact it without escalating, and the exemptions — all before the budget is spent, because an exemption invented during an incident is indistinguishable from ignoring the policy.**

This guide sits under [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/), within [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/). It is the step after the slow-burn ticket from [Alert Rules That Survive a Bursty Spatial Stream](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/alert-rules-that-survive-a-bursty-spatial-stream/) has been filed and ignored twice.

## When to use this pattern

- An objective exists and is missed regularly with no consequence, which is the state that makes objectives decorative.
- The tile pipeline competes for capacity with feature work, and the competition is settled by whoever asks most recently.
- Overload currently produces an undirected backlog, so which tiles go stale is decided by queue order rather than by anyone.

## A policy is a decision made early

<figure class="fig">
<svg viewBox="0 0 760 224" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A policy naming a discussion compared with one naming a consequence, an owner and exemptions">
<title>What separates a policy from a sentence</title>
<desc>Two error-budget policies are compared clause by clause. The first says that when the budget is exhausted the team will review priorities and decide on appropriate action. It names no consequence, so nothing happens automatically; no owner, so enacting it requires a meeting; and no exemptions, so any change can be argued as necessary. It describes what would have happened anyway, and gives nobody a reason to protect the budget during the month. The second says that when the budget is exhausted, non-urgent changes to the tile pipeline are frozen until it recovers above twenty-five per cent; that the on-call engineer for the pipeline can declare the freeze without escalation; that security fixes, data-loss fixes and reliability work that would restore the budget are exempt; and that a freeze lasting more than ten working days escalates to a named engineering manager who can either extend it or accept the risk explicitly. Every clause answers a question that would otherwise be answered during an incident by whoever is most insistent.</desc>
<rect x="0" y="0" width="760" height="224" fill="var(--fig-bg)"/>
<rect x="14" y="26" width="366" height="164" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="46" font-size="10" font-weight="600" fill="var(--fig-ink)">"the team will review priorities"</text>
<text x="26" y="70" font-size="8.5" fill="var(--fig-rose-edge)">consequence: none — nothing happens automatically</text>
<text x="26" y="92" font-size="8.5" fill="var(--fig-rose-edge)">owner: none — enacting it requires a meeting</text>
<text x="26" y="114" font-size="8.5" fill="var(--fig-rose-edge)">exemptions: none — so any change can be argued</text>
<text x="26" y="126" font-size="8.5" fill="var(--fig-rose-edge)">as necessary</text>
<text x="26" y="150" font-size="8.5" fill="var(--fig-ink-soft)">describes what would have happened anyway</text>
<text x="26" y="172" font-size="8.5" fill="var(--fig-ink-soft)">gives nobody a reason to protect the budget</text>
<rect x="392" y="26" width="354" height="164" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="404" y="46" font-size="10" font-weight="600" fill="var(--fig-ink)">a policy that decides things</text>
<text x="404" y="70" font-size="8.5" fill="var(--fig-ink-soft)">consequence: non-urgent pipeline changes frozen</text>
<text x="404" y="82" font-size="8.5" fill="var(--fig-ink-soft)">until the budget recovers above 25%</text>
<text x="404" y="104" font-size="8.5" fill="var(--fig-ink-soft)">owner: the pipeline's on-call engineer declares it,</text>
<text x="404" y="116" font-size="8.5" fill="var(--fig-ink-soft)">without escalation</text>
<text x="404" y="138" font-size="8.5" fill="var(--fig-ink-soft)">exempt: security fixes, data-loss fixes, and the</text>
<text x="404" y="150" font-size="8.5" fill="var(--fig-ink-soft)">reliability work that would restore the budget</text>
<text x="404" y="172" font-size="8.5" fill="var(--fig-mint-edge)">way out: a freeze past 10 working days escalates to a named manager</text>
<text x="14" y="212" font-size="9" fill="var(--fig-ink-soft)">Every clause on the right answers a question that would otherwise be settled during an incident by whoever is most insistent.</text>
</svg>
<figcaption><b>Figure 1.</b> The right-hand policy is not stricter — it is decided. Its value is that nobody has to make these calls while the pager is going.</figcaption>
</figure>

## Complete runnable implementation

The policy is a document, and the code is what makes it self-enforcing rather than aspirational.

```python
from dataclasses import dataclass
from enum import IntEnum


class BudgetState(IntEnum):
    HEALTHY = 0        # > 50% remaining
    WATCH = 1          # 25-50% — reliability work is prioritised
    FROZEN = 2         # < 25% — non-urgent pipeline changes blocked
    EXHAUSTED = 3      # 0% — freeze plus mandatory review


# Written in advance. An exemption invented during an incident is
# indistinguishable from ignoring the policy.
EXEMPT_CHANGE_TYPES = frozenset({
    "security-fix",
    "data-loss-fix",
    "reliability",        # the work that would restore the budget
    "rollback",
})

FREEZE_ESCALATION_DAYS = 10


@dataclass(frozen=True, slots=True)
class Policy:
    service: str
    owner_role: str                 # who can declare it, without escalating
    escalates_to: str               # who decides after FREEZE_ESCALATION_DAYS
    recover_to: float = 0.25        # freeze lifts here, NOT at 0% — otherwise
                                    # the pipeline oscillates in and out of freeze


TILE_POLICY = Policy(
    service="tile-pipeline",
    owner_role="tile-pipeline on-call",
    escalates_to="platform engineering manager",
)


def state_for(budget_remaining: float) -> BudgetState:
    if budget_remaining > 0.50:
        return BudgetState.HEALTHY
    if budget_remaining > 0.25:
        return BudgetState.WATCH
    if budget_remaining > 0.0:
        return BudgetState.FROZEN
    return BudgetState.EXHAUSTED


def may_deploy(change_type: str, budget_remaining: float,
               frozen_for_days: float = 0.0) -> tuple[bool, str]:
    """Called by CI. A policy nothing enforces is a preference."""
    state = state_for(budget_remaining)

    if state <= BudgetState.WATCH:
        return True, "budget healthy"

    if change_type in EXEMPT_CHANGE_TYPES:
        return True, f"{change_type} is exempt under the policy"

    if frozen_for_days > FREEZE_ESCALATION_DAYS:
        return False, (
            f"frozen {frozen_for_days:.0f} days — {TILE_POLICY.escalates_to} must "
            "either extend the freeze or accept the risk explicitly"
        )

    return False, (
        f"tile-pipeline budget at {budget_remaining:.0%}; non-urgent changes are "
        f"frozen until it recovers above {TILE_POLICY.recover_to:.0%}"
    )
```

Lifting the freeze at 25% rather than at 0% is the same hysteresis that keeps a paused partition from oscillating: recovering to exactly the threshold means the next bad hour re-freezes, and a freeze that toggles daily stops being taken seriously.

## The degradation ladder

The other half of the policy decides what the pipeline does under overload, rather than leaving it to queue order.

<figure class="fig">
<svg viewBox="0 0 760 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A tile degradation ladder allowing deep zooms to lag first while shallow zooms stay current">
<title>Which tiles are allowed to go stale, decided in advance</title>
<desc>Tile zoom levels are ordered by how much of the audience each serves and how expensive each is to regenerate. Zoom levels zero to nine cover whole regions, so each tile is requested by every viewer looking anywhere in that area, and regenerating one means processing every feature it contains; these must stay current, and they are the last to be allowed to lag. Levels ten to fourteen are neighbourhood scale, shared by many viewers and moderately expensive; they are allowed to lag by minutes under pressure. Levels fifteen and deeper cover a street or a building, are requested by very few viewers each, and are cheap enough to render on demand when someone actually asks; they may lag by hours. Under overload the pipeline therefore sheds rebuild work from the bottom of this ladder upwards, and the effect on a reader is that fine detail in a rarely-viewed street is briefly out of date while every overview anyone looks at stays correct. Without the ladder, queue order decides, which means the tiles that go stale are whichever happened to be enqueued last — frequently the shallow ones, because a large feature edit invalidates them last.</desc>
<rect x="0" y="0" width="760" height="230" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">which tiles may lag, in what order, decided before the overload</text>
<rect x="14" y="30" width="732" height="52" rx="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.8"/>
<text x="26" y="49" font-size="9.5" font-weight="600" fill="var(--fig-ink)">z0–z9 · region overviews — must stay current, shed last</text>
<text x="26" y="66" font-size="9" fill="var(--fig-ink-soft)">every viewer looking anywhere in the area requests these · regenerating one processes every feature it contains</text>
<text x="26" y="78" font-size="9" fill="var(--fig-mint-edge)">target lag: under the freshness objective, always</text>
<rect x="14" y="90" width="732" height="52" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="26" y="109" font-size="9.5" font-weight="600" fill="var(--fig-ink)">z10–z14 · neighbourhood scale — may lag by minutes</text>
<text x="26" y="126" font-size="9" fill="var(--fig-ink-soft)">shared by many viewers, moderately expensive to regenerate</text>
<text x="26" y="138" font-size="9" fill="var(--fig-gold-edge)">target lag under pressure: 15 minutes</text>
<rect x="14" y="150" width="732" height="52" rx="5" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.5"/>
<text x="26" y="169" font-size="9.5" font-weight="600" fill="var(--fig-ink)">z15+ · street and building scale — may lag by hours, shed first</text>
<text x="26" y="186" font-size="9" fill="var(--fig-ink-soft)">very few viewers each · cheap enough to render on demand when somebody actually asks</text>
<text x="26" y="198" font-size="9" fill="var(--fig-peach-edge)">target lag under pressure: 4 hours, or on demand</text>
<text x="14" y="220" font-size="9" fill="var(--fig-ink-soft)">Without the ladder, queue order decides — and a large feature edit enqueues shallow tiles last, so those are the ones that go stale.</text>
</svg>
<figcaption><b>Figure 2.</b> The ladder inverts the default. Left to the queue, overload degrades exactly the tiles that the most people are looking at.</figcaption>
</figure>

```python
# Rebuild priority under pressure. Lower value = rebuilt first.
ZOOM_PRIORITY = {z: (0 if z <= 9 else 1 if z <= 14 else 2) for z in range(0, 23)}

# Maximum acceptable lag per band while the pipeline is under pressure.
DEGRADED_LAG_SECONDS = {0: 60, 1: 900, 2: 14_400}


def rebuild_order(tiles):
    """Shed from the bottom of the ladder upwards.

    Sorting by (band, age) means a shallow tile is always rebuilt before a
    deep one, and within a band the oldest goes first.
    """
    return sorted(tiles, key=lambda t: (ZOOM_PRIORITY[t.z], -t.age_seconds))
```

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| `recover_to` | `float` | Freeze lifts here, not at 0%, or it toggles daily | `0.25` |
| `EXEMPT_CHANGE_TYPES` | frozenset | Written in advance; additions are a policy change, not a judgement call | 4 types |
| `FREEZE_ESCALATION_DAYS` | `int` | After this, a named person must extend or accept the risk | `10` |
| `ZOOM_PRIORITY` | dict | Shallow zooms first — the inverse of what queue order produces | 3 bands |
| `DEGRADED_LAG_SECONDS` | dict | Per band, agreed with whoever consumes the tiles | — |
| `owner_role` | `str` | Someone who can declare the freeze without a meeting | on-call |

</div>

## Gotchas and spatial edge cases

1. **A policy nothing enforces is a preference.** The `may_deploy` check has to run in CI and block the pipeline, not print a warning. A policy enforced by everyone remembering it is enforced during calm periods and forgotten during the ones it exists for.

2. **The exemption list must be short and hard to extend.** Every plausible change can be argued into a category, and a list with a "business critical" entry has no entries at all. Adding one is a policy change with the same review as any other, which is what stops it being a judgement call at the moment of maximum pressure.

3. **The degradation ladder must match how tiles are actually invalidated.** If invalidation is scoped by zoom as [Scoping Tile Invalidation to the Zoom Levels That Changed](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/scoping-tile-invalidation-to-the-zoom-levels-that-changed/) describes, most small edits never enqueue shallow tiles at all, and the ladder mainly governs the large edits — which is the right target.

4. **On-demand rendering for deep zooms needs to exist before it is relied on.** A ladder that allows z15 to lag four hours assumes something renders it when asked. If nothing does, the policy has quietly promised a capability the pipeline does not have.

5. **The budget and the shed rate are the same currency.** Load shedding, described in [Shedding Spatial Load by Geographic Priority](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/shedding-spatial-load-by-geographic-priority/), spends the completeness budget. A pipeline shedding routinely while its freshness budget looks healthy has moved the problem rather than solved it.

6. **Review the policy when it does not fire.** A budget that has never been exhausted in a year means the objective is too loose, and the policy has been costless because it has never applied. That is worth noticing, because a policy that cannot bite provides the same information as no policy at all.

<figure class="fig">
<svg viewBox="0 0 760 196" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Budget remaining over a quarter, with the freeze band and the recovery band marked">
<title>Freezing at zero and lifting at zero makes the policy a toggle</title>
<desc>Budget remaining is traced across a quarter. It falls steadily through a bad month, crosses twenty-five per cent and triggers the freeze. If the freeze lifted the moment the budget returned above zero, the pipeline would spend the following weeks oscillating: a good day pushes the budget just positive, the freeze lifts, a normal day's errors push it negative again, and the freeze returns — several times a week, each transition sending a notification that changes somebody's plans. A policy that toggles that often is one people route around, and the first person to argue that a particular change should not be blocked wins, because everyone already suspects the state is arbitrary. Lifting at twenty-five per cent instead means the freeze ends only once the pipeline has genuinely recovered, so it happens once, is visible, and is worth acting on. The hysteresis is the same mechanism that keeps a paused partition from oscillating, applied to an organisational decision rather than a broker one.</desc>
<rect x="0" y="0" width="760" height="196" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">error budget remaining, across a quarter</text>
<line x1="60" y1="140" x2="720" y2="140" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="60" y1="34" x2="60" y2="140" stroke="var(--fig-line)" stroke-width="1.2"/>
<text x="26" y="44" font-size="8" fill="var(--fig-ink-soft)">100%</text>
<text x="30" y="136" font-size="8" fill="var(--fig-ink-soft)">0%</text>
<rect x="60" y="106" width="660" height="34" fill="var(--fig-rose)" opacity="0.35"/>
<line x1="60" y1="106" x2="720" y2="106" stroke="var(--fig-mint-edge)" stroke-width="1.3" stroke-dasharray="4 3"/>
<text x="640" y="102" font-size="8.5" fill="var(--fig-mint-edge)">lift at 25%</text>
<text x="66" y="128" font-size="8.5" fill="var(--fig-rose-edge)">freeze band</text>
<path d="M60,44 C160,52 240,86 320,118 C360,132 400,136 440,130 C500,120 560,96 620,72 L720,56" fill="none" stroke="var(--fig-ink)" stroke-width="2.2"/>
<circle cx="322" cy="119" r="5" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="240" y="160" font-size="8.5" fill="var(--fig-rose-edge)">freeze declared, once</text>
<circle cx="560" cy="96" r="5" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="516" y="88" font-size="8.5" fill="var(--fig-mint-edge)">lifted, once</text>
<text x="14" y="180" font-size="9" fill="var(--fig-ink-soft)">Lifting at 0% instead would toggle several times a week, and a policy that toggles is one people route around — the first person to argue an exception wins.</text>
</svg>
<figcaption><b>Figure 3.</b> The same hysteresis that keeps a paused partition from oscillating, applied to an organisational decision rather than a broker one.</figcaption>
</figure>

## Verification

```python
import pytest


def test_frozen_budget_blocks_a_feature_change():
    allowed, reason = may_deploy("feature", budget_remaining=0.10)
    assert not allowed and "frozen" in reason


def test_exempt_changes_pass_during_a_freeze():
    for change_type in ("security-fix", "data-loss-fix", "reliability", "rollback"):
        allowed, _ = may_deploy(change_type, budget_remaining=0.0)
        assert allowed, f"{change_type} must remain deployable"


def test_freeze_lifts_with_hysteresis():
    """Lifting at 0% would re-freeze on the next bad hour."""
    assert not may_deploy("feature", budget_remaining=0.20)[0]
    assert may_deploy("feature", budget_remaining=0.30)[0]


def test_long_freeze_escalates_to_a_named_person():
    _, reason = may_deploy("feature", budget_remaining=0.10, frozen_for_days=12)
    assert "platform engineering manager" in reason


def test_shallow_tiles_are_rebuilt_before_deep_ones():
    """The inverse of what queue order produces."""
    tiles = [_tile(z=18, age=3600), _tile(z=6, age=30), _tile(z=12, age=600)]
    assert [t.z for t in rebuild_order(tiles)] == [6, 12, 18]
```

The last test is the one that catches a regression in the thing readers actually experience: the deep tile is by far the oldest, so any ordering by age alone puts it first, and that ordering is exactly what the ladder exists to override.

## Related

- [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/) — the topic this guide belongs to
- [Defining a Freshness SLO for a Spatial Pipeline](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/defining-a-freshness-slo-for-a-spatial-pipeline/) — the objective whose budget this policy governs
- [Scoping Tile Invalidation to the Zoom Levels That Changed](https://www.geospatialwebhook.com/core-event-fundamentals-architecture/tile-update-event-pipelines/scoping-tile-invalidation-to-the-zoom-levels-that-changed/) — reducing the rebuild volume the ladder has to ration
- [Shedding Spatial Load by Geographic Priority](https://www.geospatialwebhook.com/queue-management-retry-delivery/backpressure-flow-control/shedding-spatial-load-by-geographic-priority/) — the same budget, spent at the consumer instead of the renderer
