---
title: "Alert Rules That Survive a Bursty Spatial Stream"
description: "A threshold alert on a bursty spatial metric fires on every rush hour and is muted within a fortnight. Burn-rate rules over two windows fire on regressions and stay quiet through bursts — without waiting hours to notice an outage."
slug: "alert-rules-that-survive-a-bursty-spatial-stream"
type: "article"
breadcrumb: "Monitoring & Observability for Spatial Pipelines > SLOs & Alerting for Spatial Webhook Pipelines > Alert Rules That Survive a Bursty Spatial Stream"
datePublished: "2026-08-08"
dateModified: "2026-08-08"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Alert Rules That Survive a Bursty Spatial Stream",
      "description": "Spatial traffic is bursty by nature, so a threshold alert on freshness fires on every rush hour until somebody mutes it. This guide builds two-window burn-rate rules that distinguish a ninety-second burst from a sustained regression, and adds the per-shard alerts the fleet aggregate cannot see.",
      "url": "https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/alert-rules-that-survive-a-bursty-spatial-stream/",
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
        {"@type": "ListItem", "position": 4, "name": "Alert Rules That Survive a Bursty Spatial Stream", "item": "https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/alert-rules-that-survive-a-bursty-spatial-stream/"}
      ]
    },
    {
      "@type": "HowTo",
      "name": "Write alert rules for a bursty spatial stream",
      "step": [
        {"@type": "HowToStep", "position": 1, "name": "Alert on budget burn rate rather than on the raw indicator"},
        {"@type": "HowToStep", "position": 2, "name": "Require a short and a long window to be burning simultaneously"},
        {"@type": "HowToStep", "position": 3, "name": "Add an absent() alert per shard, because a dead shard leaves the aggregate"},
        {"@type": "HowToStep", "position": 4, "name": "Test the rules against recorded bursts before shipping them"}
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does a threshold alert fail on spatial traffic?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because spatial traffic is bursty by construction — a shift change, a weather event or a bulk import produces a spike that resolves on its own in a minute or two. A threshold on the indicator cannot tell that spike from a sustained regression, so it fires on both. After a fortnight of pages that were resolved by waiting, the alert is muted, and the regression it was written for arrives to a silent pager."}
        },
        {
          "@type": "Question",
          "name": "What do the two windows in a burn-rate alert do?",
          "acceptedAnswer": {"@type": "Answer", "text": "The short window makes the alert fast and the long window makes it stick. Requiring both to be burning means a ninety-second burst never fires, because the long window has not moved, while a genuine regression fires within minutes because the short window responds immediately. Using either alone reintroduces one of the two failures: the short window alone is a threshold alert with extra steps, and the long window alone takes hours to notice a total outage."}
        },
        {
          "@type": "Question",
          "name": "Why is an absent() alert needed alongside the burn-rate rules?",
          "acceptedAnswer": {"@type": "Answer", "text": "Because a shard that stops emitting entirely leaves the aggregate rather than dragging it down. When a consumer crashes hard, its series goes stale, min() stops seeing it, and the fleet ratio improves at the exact moment a region went dark. No burn-rate rule can detect that, because from the rules' point of view nothing is burning — the events simply stopped being counted."}
        }
      ]
    }
  ]
}
</script>

**Alert on how fast the error budget is being consumed, over a short and a long window that must both be burning — and add an `absent()` rule per shard, because a consumer that dies stops emitting entirely and improves the fleet aggregate on its way out.**

This guide sits under [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/), within [Monitoring & Observability for Spatial Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/). It turns the objective from [Defining a Freshness SLO for a Spatial Pipeline](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/defining-a-freshness-slo-for-a-spatial-pipeline/) into pages worth answering.

## When to use this pattern

- Alerts on this pipeline are muted, routed to a channel nobody reads, or answered with "it cleared on its own".
- Traffic has predictable bursts — shift changes, weather events, scheduled imports — that are not incidents.
- An objective exists, because burn rate is defined against a budget and there is no budget without one.

## One signal, two very different events

<figure class="fig">
<svg viewBox="0 0 760 232" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A burst and a regression producing the same threshold crossing but different two-window burn-rate behaviour">
<title>The threshold cannot tell these apart; the two windows can</title>
<desc>Two incidents are plotted on the same freshness indicator. The first is a burst: a shift change pushes freshness above the objective for about ninety seconds and it recovers without intervention. The second is a regression: a bad deploy pushes freshness above the objective and it stays there. A threshold alert crosses on both and pages on both, so an operator answers the burst, finds it already resolved, and learns that this page does not need answering — which is the response that mutes the alert before the regression arrives. The five-minute burn-rate window also rises on both, because it responds quickly by design. The one-hour window barely moves during the burst, since ninety seconds of elevated error contributes little to an hour of measurement, but climbs steadily during the regression. Requiring both windows to be burning therefore fires on the second and stays silent through the first, and the delay this costs is about two minutes — the time the long window needs to accumulate enough of a sustained regression to cross.</desc>
<rect x="0" y="0" width="760" height="232" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="9.5" font-weight="600" fill="var(--fig-gold-edge)">a 90-second burst — a shift change</text>
<line x1="70" y1="76" x2="360" y2="76" stroke="var(--fig-line)" stroke-width="1.1"/>
<line x1="70" y1="46" x2="360" y2="46" stroke="var(--fig-rose-edge)" stroke-width="1" stroke-dasharray="3 3"/>
<text x="70" y="42" font-size="7.5" fill="var(--fig-rose-edge)">objective</text>
<path d="M70,70 L150,70 L165,36 L200,34 L215,70 L360,70" fill="none" stroke="var(--fig-gold-edge)" stroke-width="2"/>
<text x="70" y="96" font-size="8" fill="var(--fig-ink-soft)">threshold alert: FIRES · 5 m burn: rises · 1 h burn: barely moves</text>
<text x="70" y="112" font-size="8.5" fill="var(--fig-mint-edge)">two-window rule: silent — correctly</text>
<text x="400" y="18" font-size="9.5" font-weight="600" fill="var(--fig-rose-edge)">a sustained regression — a bad deploy</text>
<line x1="410" y1="76" x2="740" y2="76" stroke="var(--fig-line)" stroke-width="1.1"/>
<line x1="410" y1="46" x2="740" y2="46" stroke="var(--fig-rose-edge)" stroke-width="1" stroke-dasharray="3 3"/>
<path d="M410,70 L470,70 L490,36 L740,32" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2.2"/>
<text x="410" y="96" font-size="8" fill="var(--fig-ink-soft)">threshold alert: FIRES · 5 m burn: rises · 1 h burn: climbs steadily</text>
<text x="410" y="112" font-size="8.5" fill="var(--fig-rose-edge)">two-window rule: FIRES, within about 2 minutes</text>
<rect x="14" y="128" width="366" height="92" rx="6" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.5"/>
<text x="26" y="148" font-size="9.5" font-weight="600" fill="var(--fig-ink)">what the threshold alert costs</text>
<text x="26" y="168" font-size="8.5" fill="var(--fig-ink-soft)">the operator answers the burst, finds it resolved,</text>
<text x="26" y="180" font-size="8.5" fill="var(--fig-ink-soft)">and learns this page does not need answering</text>
<text x="26" y="200" font-size="8.5" fill="var(--fig-rose-edge)">the alert is muted before the regression arrives</text>
<text x="26" y="214" font-size="8.5" fill="var(--fig-ink-soft)">— which is how a pipeline ends up with silent pagers</text>
<rect x="392" y="128" width="354" height="92" rx="6" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.6"/>
<text x="404" y="148" font-size="9.5" font-weight="600" fill="var(--fig-ink)">what the two-window rule costs</text>
<text x="404" y="168" font-size="8.5" fill="var(--fig-ink-soft)">about two minutes of extra latency on a genuine</text>
<text x="404" y="180" font-size="8.5" fill="var(--fig-ink-soft)">regression, while the long window accumulates</text>
<text x="404" y="200" font-size="8.5" fill="var(--fig-mint-edge)">in exchange for a page that is always worth answering</text>
<text x="404" y="214" font-size="8.5" fill="var(--fig-ink-soft)">— which is the only property that keeps it unmuted</text>
</svg>
<figcaption><b>Figure 1.</b> The two-minute delay is the entire cost, and it buys the property that decides whether an alert still exists in six months.</figcaption>
</figure>

## Complete runnable implementation

{% raw %}
```yaml
# 99% freshness over 30 days → a 1% error budget.
# Burn rate = observed error ratio ÷ budget. A rate of 1 exhausts the budget
# exactly at the end of the window; 14.4 exhausts it in about 50 hours.
groups:
  - name: spatial-freshness-alerts
    interval: 30s
    rules:
      # ---- fast burn: page. Short window makes it quick, long makes it stick.
      - alert: SpatialFreshnessBudgetBurningFast
        expr: |
          (1 - fleet:freshness_ratio:rate5m) > (14.4 * 0.01)
          and
          (1 - fleet:freshness_ratio:rate1h) > (14.4 * 0.01)
        for: 2m
        labels:
          severity: page
        annotations:
          summary: "Freshness budget burning 14x — worst shard is behind"
          runbook: "Check per-shard lag before touching the consumer fleet"

      # ---- slow burn: ticket. Catches the regression nobody notices.
      - alert: SpatialFreshnessBudgetBurningSlow
        expr: |
          (1 - fleet:freshness_ratio:rate6h) > (3 * 0.01)
          and
          (1 - fleet:freshness_ratio:rate1d) > (3 * 0.01)
        for: 15m
        labels:
          severity: ticket

      # ---- a shard that stops emitting IMPROVES the aggregate. No burn-rate
      # rule can see that, because nothing is burning — the events simply
      # stopped being counted.
      - alert: SpatialShardSilent
        expr: |
          absent_over_time(
            spatial_event_freshness_seconds_count{shard=~"metro-.*"}[10m]
          )
        for: 5m
        labels:
          severity: page
        annotations:
          summary: "Shard {{ $labels.shard }} has emitted nothing for 10 minutes"

      # ---- one shard failing while the fleet looks fine. min() catches this
      # in the aggregate, but naming the shard is what makes the page actionable.
      - alert: SpatialShardBehind
        expr: |
          shard:freshness_ratio:rate30m < 0.90
          and
          shard:freshness_ratio:rate6h < 0.95
        for: 10m
        labels:
          severity: ticket
        annotations:
          summary: "Shard {{ $labels.shard }} below objective for 6 hours"
```
{% endraw %}

The burn-rate multipliers are not arbitrary. A rate of 14.4 against a 30-day window exhausts the budget in about 50 hours, which is short enough to warrant waking someone; a rate of 3 exhausts it in about 10 days, which warrants a ticket. Choosing them by how long the budget would last is what makes the severity defensible.

<figure class="fig">
<svg viewBox="0 0 760 226" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A shard going silent, showing the fleet ratio improving as the failing shard leaves the aggregate">
<title>The aggregate improves when a region goes dark</title>
<desc>Twelve shards are aggregated with min, and the fleet freshness ratio is plotted. For the first period the metro shard is struggling at a ratio of zero point eight two while the others sit near zero point nine nine, so min reports zero point eight two and the burn-rate alerts are firing correctly. The metro consumer then crashes hard enough to stop emitting metrics at all. Its series goes stale, min no longer sees it, and the fleet ratio jumps to zero point nine nine — the number improves at the exact moment the region stopped being served. Every burn-rate alert resolves, the incident channel goes quiet, and the dashboard shows a recovery. Nothing in the burn-rate family can detect this, because from their point of view there is no error: the events are not late, they are absent. The absent_over_time rule per known shard is the only thing that fires, and it has to enumerate the shards explicitly, because a rule that only watches series that exist cannot notice one that does not.</desc>
<rect x="0" y="0" width="760" height="226" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">fleet freshness ratio = min(shards)</text>
<line x1="60" y1="150" x2="700" y2="150" stroke="var(--fig-line)" stroke-width="1.2"/>
<line x1="60" y1="34" x2="60" y2="150" stroke="var(--fig-line)" stroke-width="1.2"/>
<text x="26" y="46" font-size="8" fill="var(--fig-ink-soft)">1.00</text>
<text x="26" y="120" font-size="8" fill="var(--fig-ink-soft)">0.80</text>
<line x1="60" y1="58" x2="700" y2="58" stroke="var(--fig-mint-edge)" stroke-width="1" stroke-dasharray="3 3"/>
<text x="620" y="54" font-size="8" fill="var(--fig-mint-edge)">objective 0.99</text>
<path d="M60,112 L340,110" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2.2"/>
<path d="M340,110 L344,52 L700,50" fill="none" stroke="var(--fig-rose-edge)" stroke-width="2.2"/>
<line x1="340" y1="34" x2="340" y2="150" stroke="var(--fig-line)" stroke-width="1.3" stroke-dasharray="3 3"/>
<text x="346" y="32" font-size="8.5" fill="var(--fig-ink-soft)">metro consumer stops emitting</text>
<text x="80" y="132" font-size="8.5" fill="var(--fig-rose-edge)">metro struggling at 0.82 — burn-rate alerts firing correctly</text>
<text x="360" y="76" font-size="8.5" fill="var(--fig-rose-edge)">min() no longer sees it · ratio jumps to 0.99 · every alert resolves</text>
<text x="360" y="92" font-size="8.5" fill="var(--fig-ink-soft)">the dashboard shows a recovery, and the region is not being served at all</text>
<rect x="14" y="170" width="732" height="46" rx="5" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.5"/>
<text x="26" y="189" font-size="9.5" font-weight="600" fill="var(--fig-ink)">No burn-rate rule can see this — the events are not late, they are absent</text>
<text x="26" y="201" font-size="9" fill="var(--fig-ink-soft)">absent_over_time per known shard is the only rule that fires, and it must enumerate the shards:</text>
<text x="26" y="213" font-size="9" fill="var(--fig-ink-soft)">a rule watching series that exist cannot notice one that does not.</text>
</svg>
<figcaption><b>Figure 2.</b> The recovery on this chart is the incident. Every alert resolving simultaneously is itself a signal, and only an explicitly enumerated absence check catches it.</figcaption>
</figure>

## Parameter reference

<div class="table-scroll">

| Name | Type | Spatial constraint | Default |
|---|---|---|---|
| Fast burn multiplier | `float` | Budget exhausted in ~50 h; page-worthy | `14.4` |
| Slow burn multiplier | `float` | Budget exhausted in ~10 days; ticket-worthy | `3` |
| Short window | duration | Fast enough to catch a regression in minutes | `5m` / `6h` |
| Long window | duration | Long enough that a burst does not move it | `1h` / `1d` |
| `for` | duration | Additional damping; small, since the windows already damp | `2m` / `15m` |
| Shard list in `absent` | regex | Must enumerate known shards explicitly | `metro-.*` |

</div>

## Gotchas and spatial edge cases

1. **`absent_over_time` needs the shards named.** A rule matching whatever series exist cannot notice a series that stopped existing, so the shard set has to come from configuration and be updated when a region is added. A newly onboarded region with no absence rule is a region that can go dark silently.

2. **Quiet shards produce `NaN` and poison `min()`.** A shard with no traffic in the evaluation window divides by a near-zero rate, and `NaN` propagates differently across Prometheus versions. Gate the per-shard recording rule on a minimum event rate, which also stops overnight quiet periods from firing the shard-behind alert.

3. **Every alert resolving at once is a signal.** A pipeline whose entire alert set clears simultaneously has usually lost its metrics rather than fixed its problem. A meta-alert on the count of series reporting is cheap and catches an exporter outage that otherwise reads as a clean bill of health.

4. **Burn-rate thresholds must be recomputed when the objective changes.** The multipliers are relative to the budget, so tightening from 99% to 99.5% halves the budget and doubles the effective burn for the same error rate. Shipping a new target without new alert thresholds either floods or silences the pager.

5. **Test the rules against recorded bursts, not synthetic ones.** `promtool test rules` accepts input series, and a real shift-change burst has a shape that a hand-written ramp does not — in particular it usually comes with a simultaneous traffic increase, which changes the denominator as well as the numerator.

6. **A per-shard page needs the shard in the annotation.** "Freshness budget burning" sends an operator to a dashboard; "shard metro-3 below objective for 6 hours" sends them to a consumer. The label is available and omitting it costs the first ten minutes of every incident.

<figure class="fig">
<svg viewBox="0 0 760 190" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Burn-rate multipliers mapped to how long the error budget would last, and the severity each earns">
<title>The multiplier is a deadline, which is what makes the severity arguable</title>
<desc>Four burn rates are mapped to how long a thirty-day error budget survives at each. At one times the budget rate the budget lasts exactly the thirty-day window, which is by definition acceptable and warrants nothing. At three times it is exhausted in about ten days, which is slow enough to fix during working hours and fast enough that ignoring it loses the month — a ticket. At six times it lasts five days. At fourteen point four times it is gone in about fifty hours, which is short enough that waiting until morning means the budget is spent before anyone looks, so it earns a page. Choosing the multipliers this way makes the severity defensible in a way that a threshold picked from a dashboard never is: the question "why does this page and that one not" has an answer in hours rather than in preference, and when somebody proposes tightening the objective the multipliers can be recomputed rather than re-argued.</desc>
<rect x="0" y="0" width="760" height="190" fill="var(--fig-bg)"/>
<text x="14" y="18" font-size="10" font-weight="600" fill="var(--fig-ink)">burn rate → how long a 30-day budget survives → severity</text>
<rect x="14" y="30" width="732" height="30" rx="4" fill="var(--fig-mint)" stroke="var(--fig-mint-edge)" stroke-width="1.3"/>
<text x="26" y="49" font-size="9" fill="var(--fig-ink)">1× — budget lasts the full 30 days · acceptable by definition · no alert</text>
<rect x="14" y="64" width="732" height="30" rx="4" fill="var(--fig-gold)" stroke="var(--fig-gold-edge)" stroke-width="1.4"/>
<text x="26" y="83" font-size="9" fill="var(--fig-ink)">3× — gone in ~10 days · fixable in working hours, but ignoring it loses the month · ticket</text>
<rect x="14" y="98" width="732" height="30" rx="4" fill="var(--fig-peach)" stroke="var(--fig-peach-edge)" stroke-width="1.4"/>
<text x="26" y="117" font-size="9" fill="var(--fig-ink)">6× — gone in ~5 days · the middle ground most fleets skip</text>
<rect x="14" y="132" width="732" height="30" rx="4" fill="var(--fig-rose)" stroke="var(--fig-rose-edge)" stroke-width="1.6"/>
<text x="26" y="151" font-size="9" fill="var(--fig-ink)">14.4× — gone in ~50 hours · waiting until morning spends it before anyone looks · page</text>
<text x="14" y="174" font-size="9" fill="var(--fig-ink-soft)">"Why does this page and that one not" then has an answer in hours rather than in preference — and</text>
<text x="14" y="186" font-size="9" fill="var(--fig-ink-soft)">tightening the objective becomes a recomputation rather than an argument.</text>
</svg>
<figcaption><b>Figure 3.</b> Deriving the multiplier from a deadline is what lets the severity survive a review. A number chosen from a dashboard cannot answer why it is the number.</figcaption>
</figure>

## Verification

```python
import subprocess
import textwrap


def promtool(cases: str) -> None:
    open("/tmp/tests.yml", "w").write(cases)
    subprocess.run(["promtool", "test", "rules", "/tmp/tests.yml"], check=True)


def test_ninety_second_burst_does_not_page():
    """The case that mutes a threshold alert."""
    promtool(textwrap.dedent("""
        rule_files: [/etc/prometheus/spatial-freshness.yml]
        tests:
          - interval: 30s
            input_series:
              - series: 'fleet:freshness_ratio:rate5m'
                values: '1+0x8 0.2+0x3 1+0x40'
              - series: 'fleet:freshness_ratio:rate1h'
                values: '1+0x8 0.98+0x3 1+0x40'
            alert_rule_test:
              - eval_time: 6m
                alertname: SpatialFreshnessBudgetBurningFast
                exp_alerts: []
    """))


def test_sustained_regression_pages_within_five_minutes():
    promtool(textwrap.dedent("""
        rule_files: [/etc/prometheus/spatial-freshness.yml]
        tests:
          - interval: 30s
            input_series:
              - series: 'fleet:freshness_ratio:rate5m'
                values: '1+0x4 0.5+0x60'
              - series: 'fleet:freshness_ratio:rate1h'
                values: '1+0x4 0.5+0x60'
            alert_rule_test:
              - eval_time: 5m
                alertname: SpatialFreshnessBudgetBurningFast
                exp_alerts:
                  - exp_labels: {severity: page}
    """))


def test_silent_shard_pages_even_though_the_ratio_improved():
    """The failure no burn-rate rule can see."""
    promtool(textwrap.dedent("""
        rule_files: [/etc/prometheus/spatial-freshness.yml]
        tests:
          - interval: 30s
            input_series:
              - series: 'spatial_event_freshness_seconds_count{shard="metro-3"}'
                values: '0+10x10 _x40'
            alert_rule_test:
              - eval_time: 16m
                alertname: SpatialShardSilent
                exp_alerts:
                  - exp_labels: {severity: page, shard: metro-3}
    """))
```

The first test is the one that justifies the whole design, and it is worth running in CI rather than once at review time — a later edit that drops the long-window clause from the expression passes every other test and reintroduces the threshold alert exactly.

## Related

- [SLOs & Alerting for Spatial Webhook Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/) — the topic this guide belongs to
- [Defining a Freshness SLO for a Spatial Pipeline](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/defining-a-freshness-slo-for-a-spatial-pipeline/) — the objective these rules are written against
- [An Error-Budget Policy for Tile Pipelines](https://www.geospatialwebhook.com/monitoring-observability-spatial/slo-alerting-spatial-pipelines/an-error-budget-policy-for-tile-pipelines/) — what happens after the slow-burn ticket is filed
- [Detecting Partition Skew in H3-Sharded Streams](https://www.geospatialwebhook.com/monitoring-observability-spatial/consumer-lag-partition-skew/detecting-partition-skew-in-h3-sharded-streams/) — where the shard-behind alert sends the operator
