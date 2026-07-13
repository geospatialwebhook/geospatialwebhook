# Phase plan — geospatialwebhook.com

> The schedule to grow this site phase-by-phase, generated from the Django `Site` model. **No OpenRouter / no API** — you (Claude Code) do the work, grounded in the real markdown under `content/`.

- **Niche:** Python Geospatial Webhook & Event-Driven Architecture
- **Audience:** Platform engineers, GIS backend devs, real-time spatial app builders, SaaS founders
- **Live now:** 51 pages, 177,396 words
- **Current phase:** expansion
- **Next phase to build:** maturity

## How to upgrade a phase

Work through every step in order. **Do not skip the uplift, the term cleanup, the SVG render check, or the finish/deploy steps** — those were the gaps in earlier runs.

1. **Read & orient.** Read this whole file, then skim `content/` to learn what exists and the writing tone.
2. **Uplift EVERY existing page (not just new ones).** Bring all current pages — from earlier phases — up to the Page blueprint below: its page anatomy, frontmatter, JSON-LD schema, the custom SVG visuals, and the mandatory wiki-style interlinking. Old pages must reach the *current* standard, not be left as they were. Two presentation fixes that apply site-wide:
   - **Convert any Mermaid diagrams to hand-authored inline SVGs** (in the "Custom visuals" style). No `mermaid` code fences, `.mermaid` containers, or mermaid runtime may remain — the `mermaid_check` gate enforces this.
   - **Restyle inline `<code>` to blend with the prose** — no background box or border, body-text colour, and not coloured like a link (this is a CSS change in the site's stylesheet; block code in `<pre>` keeps its box). The `inline_code_check` gate enforces this.
3. **Build the next phase.** Add this phase's page mix (see schedule), slotting pages into the existing hierarchy, each built to the same blueprint standard.
4. **Upgrade the homepage AND site navigation to reflect the new content.** This is mandatory every phase — new pages must not be left orphaned or unreachable:
   - **Navigation:** update the primary/header nav, footer, and any nav data/menu files (e.g. `_data/nav.*`, `_data/menu.*`, layout includes). Every section/topic area must be reachable from the nav; remove links to pages that no longer exist.
   - **Homepage:** refresh the hero, the section/topic cards, any "featured", "start here", "popular" or "latest" lists, and any counts/overview copy — surface the newly added sections and the strongest new pages.
   - **Site-wide:** ensure breadcrumbs and `sitemap.xml` include the new URLs, and wire the new pages in with the same wiki-style interlinking standard.
5. **Keep it niche-specific.** Section topics must be drawn from this niche, not generic placeholders.
6. **Remove internal IA/SEO terms from visible copy.** The words *pillar*, *cluster*, *long-tail* (and "hub and spoke", "supporting page", etc.) are internal labels — they must not appear in reader-facing prose. Scan and fix:

   ```bash
   python3 /home/martin/WebstormProjects/_qa/term_lint.py geospatialwebhook.com
   ```
   (Legit domain uses of "cluster" — e.g. a Kafka/DB cluster — are fine; rewrite only the information-architecture sense.)
7. **Author custom SVG visuals** per the "Custom visuals" section, then **build the site and verify the SVGs render correctly ON THE PAGE** — the page's CSS/typography must not leak in and break them. Fix and rebuild until clean:

   ```bash
   cd /home/martin/WebstormProjects/geospatialwebhook.com && npm run build
   python3 /home/martin/WebstormProjects/_qa/qa_gates.py geospatialwebhook.com
   ```
   `qa_gates.py` runs every shared deterministic gate against the BUILT site and must report `ALL PASS`: term_lint (IA/SEO term leaks), svg_check (inline-SVG validity + hidden/overlapping/clipped/low-contrast labels), mermaid_check (no Mermaid left un-converted to SVG), inline_code_check (inline <code> blends with prose — no box/border, body colour, not link-like), a11y_check (FULL-PAGE WCAG 2 A/AA via axe-core — contrast, alt text, link names, lang, duplicate ids, heading order, keyboard-scrollable regions), links_check (internal links + anchors resolve), jsonld_check (structured-data validity), seo_meta_check (title/description/canonical/og/one-h1 + cross-page duplicates), render_check (no uncaught JS errors / broken same-origin assets), markup_lint (no unrendered markdown or template leakage), sitemap_check (sitemap ↔ built pages), dup_content_check (no near-duplicate article prose), and perf_check (Lighthouse mobile performance budget over a sampled set). Fix the site until every gate passes.
8. **Record completion** (re-runs `qa_gates` and will NOT advance the phase unless they all pass; then updates page/word count, advances current→next phase, and rewrites this plan ready for the next phase). From the Django project (`/home/martin/PycharmProjects/Django-Pillar-Cluster-Long-Tail`):

   ```bash
   .venv/bin/python manage.py finish_phase geospatialwebhook.com --completed maturity \
       --blueprint "/home/martin/WebstormProjects/geospatialwebhook.com/_plan/blueprint.json"
   ```
9. **Commit & deploy.** Build, deploy to Cloudflare, and push to GitHub:

   ```bash
   cd /home/martin/WebstormProjects/geospatialwebhook.com
   npm run deploy          # build + wrangler deploy (auth from the site .env)
   git add -A && git commit -m "Upgrade to maturity phase" && git push
   ```

## QA refresh (uplift to standard — NO new phase)

Use this when you want to bring the site **fully up to the current standard and pass every gate, without building the next phase** — the site stays on its current phase (`expansion`).

### Automated (recommended)

Run **`/qa-refresh`** (or just say *"do a QA refresh"*) — it runs the `qa_refresh` workflow for this site, which performs everything below automatically: rewrites every page to standard (incl. hand-authored SVGs and Mermaid→SVG), restyles inline code + homepage + navigation, then builds, fixes until every gate passes, records the uplift and deploys. Direct call:

   ```
   Workflow({scriptPath: "/home/martin/WebstormProjects/_qa/qa_refresh_workflow.js", args: "geospatialwebhook.com"})
   ```

### Manual (what the workflow does, step by step)

**`refresh_site` does NOT do the uplift for you — YOU must do the actual work first.** It is only the bookkeeping/verification step: it re-syncs counts, re-detects the phase (no advance), re-exports this plan, and runs `qa_gates`. It will **refuse to record the uplift unless every gate passes**, so you cannot mark a site "uplifted" without having genuinely rewritten the pages and fixed the SVGs.

Do the checklist above **but SKIP step 3 (Build the next phase)** — i.e. actually rewrite EVERY existing page to the blueprint (2: anatomy, frontmatter, schema, wiki interlinking, hand-authored SVGs, no Mermaid, blended inline code), update homepage & navigation (4), keep it niche-specific (5), term cleanup (6), and pass the SVG + `qa_gates` checks (7). Then record the refresh and deploy:

   ```bash
   .venv/bin/python manage.py refresh_site geospatialwebhook.com \
       --blueprint "/home/martin/WebstormProjects/geospatialwebhook.com/_plan/blueprint.json"
   cd /home/martin/WebstormProjects/geospatialwebhook.com
   npm run deploy
   git add -A && git commit -m "QA refresh (expansion)" && git push
   ```

## Phase schedule

| # | Phase | Status | Adds | Target total | Focus |
|---|-------|--------|------|--------------|-------|
| 1 | 1. Foundation | ✅ done | 2-3 pillars + 10-14 clusters + 8-12 long-tails | ~22 | Establish core authority: the main pillars and their primary clusters, with enough long-tails to validate demand. Get a consistent page skeleton in place. |
| 2 | 2. Expansion | ✅ done | 1-2 pillars + 7-10 clusters + 18-25 long-tails | ~50 | Broaden coverage: fill out each pillar's clusters and add the high-intent long-tails around them. Strengthen interlinking between siblings. |
| 3 | 3. Maturity | ➡️ NEXT | 4-6 clusters + 28-40 long-tails | ~82 | Deepen the long tail: comprehensive how-tos, comparisons and edge-case pages under existing clusters. Ensure FAQ blocks and schema on every page. |
| 4 | 4. Authority | … future | 2-3 clusters + 20-30 long-tails | ~105 | Complete topical authority: remaining gaps, advanced/expert pages, and a tight internal link graph so every page is 1-2 clicks from its pillar. |

## Priorities for the next phase (maturity)

- Queue management & retry/backoff pillar: the site description calls this out explicitly but no pillar yet covers retry strategies, exponential backoff with jitter, or dead-letter queue design for spatial payloads — high-value gap
- Monitoring & observability cluster: production metrics specific to geo workloads (partition skew, geometry validation failure rate, consumer lag per geographic shard) are mentioned in pillars but have no dedicated cluster or long-tail pages
- Comparison long-tails: add 'H3 vs S2 vs Quadkey for spatial partitioning', 'Redis Streams vs Kafka for geospatial webhooks', and 'Protocol Buffers vs GeoJSON for high-frequency spatial events' — high search-intent, zero current coverage
- Webhook security cluster: webhook-security-boundaries exists as a directory but may need long-tail depth on HMAC-SHA256 signing for spatial payloads, IP allowlisting patterns, and replay attack prevention

## Page blueprint

_(tailored to this site)_

- **Frontmatter (every page):** title, description, slug, type, breadcrumb, datePublished, dateModified
- **Schema (JSON-LD):** Article, BreadcrumbList, HowTo, FAQPage
- **Interlinking:** Every page must inline-link the first mention of any concept that has its own page, woven naturally into prose — not in a list. Examples: 'normalize geometries to a canonical CRS before serialization, as covered in [CRS Normalization Strategies](/spatial-payload-routing-parsing/crs-normalization-strategies/)'; 'apply an idempotency key derived from the feature hash, following the approach in [Event Key Generation for Spatial Data](/idempotency-spatial-deduplication/event-key-generation-for-spatial-data/)'; 'trigger incremental tile invalidation via [Tile Update Event Pipelines](/core-event-fundamentals-architecture/tile-update-event-pipelines/)'. Cluster and long-tail pages must also include an up-link sentence in the opening paragraph referencing their parent pillar, e.g., 'This cluster is part of [Core Event Fundamentals & Architecture](/core-event-fundamentals-architecture/).' Every page ends with a compact 'Related' block (3-5 links) using descriptive anchor text drawn from this niche (no generic 'click here').

### pillar pages  (~4500 words)
- Lead paragraph: what problem this architectural domain solves and who it targets (platform engineers, GIS backend devs, real-time spatial app builders)
- Anatomy of the core concept: labeled components of a spatial event / pipeline / system, with a structured list or mermaid diagram
- Architectural patterns section: 2-3 named patterns (e.g., pub/sub with geographic partitioning, event sourcing for spatial state, stream processing), each with prose and inline code snippet
- Python implementation & serialization: async patterns, broker integration, serialization format tradeoffs (JSON vs Protobuf vs MessagePack) with code example
- Spatial-specific concerns: CRS normalization, spatial indexing strategies (H3/S2/Quadkey), geometry validation before dispatch
- Production hardening: failure modes, idempotency, dead-letter queues with spatial context, monitoring metrics specific to geo workloads (partition skew, geometry validation failure rate)
- FAQ accordion: 4-6 questions specific to this pillar's domain (e.g., 'When should I partition by H3 vs S2?', 'How do I handle mixed CRS in an event stream?')
- Related block: 4-5 inline links to clusters and sibling pillars

### cluster pages  (~3500 words)
- One-sentence answer / TL;DR at the very top (bold), plus up-link to parent pillar
- Prerequisites checklist: Python version, libraries (shapely, pyproj, aiohttp, etc.), broker, spatial DB — rendered as interactive checkboxes
- Architecture blueprint: numbered 3-4 layer breakdown with a mermaid flow diagram showing data path from spatial mutation to consumer
- Step-by-step implementation: numbered steps, each with a purpose sentence followed by a runnable Python code block (FastAPI/aiohttp/asyncio patterns)
- Spatial validation & error handling: geometry topology checks, CRS alignment code, schema validation with Pydantic, and what to do on failure
- Retry, backoff & delivery guarantees: exponential backoff with jitter code, at-least-once vs exactly-once tradeoffs for spatial payloads
- Verification: how to confirm the pipeline works end-to-end (test harness, log assertions, or integration test snippet)
- Troubleshooting table: symptom | likely spatial cause | fix (responsive horizontal-scroll table)
- FAQ accordion: 3-4 questions scoped to this cluster's specific implementation
- Related block: 3-4 links (parent pillar + sibling clusters + relevant long-tails)

### long_tail pages  (~2000 words)
- Direct answer sentence (bold, immediately actionable — no preamble), plus up-link to parent cluster and grandparent pillar
- When to use this pattern: 2-3 bullet conditions that make this specific approach appropriate over alternatives
- Complete runnable code block: self-contained Python example (no placeholder TODOs) with inline comments explaining spatial-specific choices
- Parameter / option reference table: key arguments, types, spatial constraints, and defaults — horizontally scrollable
- Gotchas & spatial edge cases: precision loss, coordinate ring orientation, CRS mismatch on merge, geometry validity after transformation — as a numbered list
- Minimal verification snippet: a pytest or quick script the reader can run to confirm correctness
- Related block: 2-3 links (parent cluster, one sibling long-tail, one pillar)

> All code blocks must be syntax-highlighted Python; use mermaid for pipeline/architecture diagrams (flowchart LR or sequenceDiagram). The color scheme is peach-pink/minty-green/earthy-brown — mermaid theme variables should use these tones. Interactive checkboxes in prerequisites ([ ] rendered as toggleable). FAQ sections rendered as accordions. Tables must be horizontally scrollable on mobile. Inline code uses light background matching site palette. No external links in new pages beyond RFC 7946 and CloudEvents spec (already present in content). CRS references should always include the EPSG code. H3, S2, and Quadkey should be linked to their own pages when those pages exist.

## Custom visuals (SVG)

When upgrading or building any page, add a custom, hand-authored inline SVG wherever a visual would genuinely raise quality (architecture/data-flow diagrams, sequence or state diagrams, comparison matrices, timelines, annotated illustrations). Do NOT add decorative or generic stock-style images. Each SVG must: be original and specific to the page's content; match the site's existing design system (colours, fonts, stroke weight); be responsive (viewBox, no fixed pixel width) and accessible (<title>/<desc>, role="img", aria-label); and use currentColor / CSS variables so it adapts to light/dark themes. Prefer one strong diagram that explains the hardest concept on the page over many small ones. Pillar pages should almost always carry a top-level overview diagram. If the site has any Mermaid diagrams (```mermaid blocks, .mermaid containers, or a mermaid runtime), convert each one to a hand-authored inline SVG in this same style — no Mermaid should remain.
