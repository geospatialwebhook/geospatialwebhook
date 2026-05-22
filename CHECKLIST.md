# Geospatial Webhook Site - Build Checklist

## Setup
- [x] Initialize 11ty project with package.json and dependencies
- [x] Configure .eleventy.js (input dir, output, passthrough copies, collections)
- [x] Set up directory structure (src, layouts, includes, assets)

## Design System
- [x] Define Whimsical Garden color palette (peach-pink, mint, earthy brown)
- [x] Set up CSS variables (colors, spacing, typography, radii, shadows)
- [x] Define responsive breakpoints (mobile, tablet, desktop, widescreen)
- [x] Typography stack (Fraunces display, Inter body, JetBrains Mono code)

## Branding & Icons
- [x] Custom SVG logo (colorful, represents geospatial webhooks)
- [x] Generate favicon.ico (16+32 multi-resolution)
- [x] PWA icons (192px, 512px, maskable)
- [x] Apple touch icon (180px)
- [x] Theme color meta tags

## Layout & Navigation
- [x] Base template (base.njk)
- [x] Sticky header with logo, home + content nav links
- [x] Header active-page indicator (icon + text, aria-current)
- [x] Mobile-friendly compact nav (icon-only collapse, horizontal scroll)
- [x] Footer with section links (sticks to bottom on short pages via flex layout)
- [x] Hover effects on all interactive elements

## Front Page
- [x] Hero section with gradient title
- [x] CTA buttons with colorful icons linking to main sections
- [x] 2-3 paragraphs of site description
- [x] Section preview cards with descriptions
- [x] "What you'll learn" card grid
- [x] Hover effects, responsive layout

## Content Page Rendering
- [x] Styled colorful gradient page titles
- [x] Elegant header and paragraph styling
- [x] Inline code (light background, no border, blends in)
- [x] Codeblocks with Prism syntax highlighting + light background
- [x] Copy-to-clipboard button on codeblocks
- [x] Code QA — all 38 Python blocks parse cleanly via ast.parse
- [x] Breadcrumbs reflecting URL hierarchy
- [x] Related/sibling content links in sidebar
- [x] Tables — styled and horizontally scrollable (.table-wrap)
- [x] Styled links with hover effects (dashed underline on hover)
- [x] Anchor links account for sticky header height (scroll-margin-top + JS fallback)
- [x] [ ] / [x] rendered as interactive checkboxes (no list bullet, line-through when checked)
- [x] FAQ accordion JS converts FAQ sections automatically (no FAQs in current content)
- [x] Mermaid conversion for ASCII pipeline diagrams, themed to match site palette

## PWA
- [x] manifest.json with name, icons, theme color, start_url, maskable icon
- [x] Service worker with network-first navigation + stale-while-revalidate assets
- [x] Apple iOS meta tags (apple-mobile-web-app-capable, status-bar, icon)
- [x] Offline fallback page (/offline/)

## Responsive & Polish
- [x] Mobile layout (no horizontal overflow — `min-width: 0` on grid items)
- [x] Tablet layout
- [x] Desktop layout (wide, not narrow column — 1180px content max)
- [x] Widescreen optimization (1320–1440px max at >1500px breakpoints)
- [x] No external links beyond what content already contains
- [x] Build site cleanly with `npx @11ty/eleventy` (27 files, no warnings)

## Build commands
- `npm run build` — produce static site in `_site/`
- `npm run serve` — eleventy dev server with reload
