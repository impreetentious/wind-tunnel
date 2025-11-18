# Wind Tunnel

**A wind tunnel for SaaS pricing & packaging decisions.** Model your buyers as explicit assumptions, design tiers and fences as a screening mechanism, and watch segments self-select — revealing revenue, conversion, and the surplus you're leaving on the table, before you ship a price.

> **Status: P4 model contracts in progress (v0.5.0).** The static shell and local checks are ready; remote CI and deployment remain pending. Buyer-distribution math and economics have a tested pure-engine contract, while P50-centred model-editing boundaries and their validation coverage are now in place. The Model workbench and Design surface remain ahead.

## The idea

Most SaaS packaging is decided by gut and competitor-copying. But Good/Better/Best isn't decoration — it's a _screening mechanism_ (second-degree price discrimination): a menu designed so buyers with different willingness-to-pay sort themselves into the right tier. Once you write your assumptions down — who the segments are, what they'd pay, which features they value — the menu's consequences stop being opinions. They can be computed.

Wind Tunnel runs entirely on **your assumptions, made explicit**. It is not a billing tool and not an optimizer that needs live revenue data. It's useful before your first customer exists: a think-before-you-ship reasoning layer for the highest-leverage decision most SaaS teams make on vibes.

## Product target (v1.0 core + v1.1 extensions)

- **Model** — buyer segments with willingness-to-pay _distributions_ (not point guesses), a segment × feature value matrix, and provenance tags for every assumption (guess / interview / survey / conjoint / benchmark).
- **Design** — tiers, feature fences, free tier, add-ons, flat or per-seat pricing — with a built-in linter that flags dominated tiers, fence inversions, free-tier leakage (in dollars), cannibalization, and competitor loss.
- **Simulate** — v1.0 uses closed-form self-selection so every edit instantly re-sorts buyers into tiers, with revenue, conversion, ARPA, capture rate, a value waterfall, and per-tier demand curves. The mechanism diagram, A/B comparison, and user-facing competitor-loss share follow in v1.1.
- **Analyze — Uncertainty** — Monte Carlo over your assumption uncertainty with a tornado chart that tells you _which assumption to validate first_.
- **Analyze — Research** — v1.0 includes uncertainty and Van Westendorp; the v1.1 extensions add Choice-Based Conjoint, MaxDiff-lite, and bundling economics.
- **Analyze — Positioning** — v1.0 builds and tests competitor alternatives as a core engine/linter path; user-facing competitor entry, loss-share readouts, and the segment-scoped map arrive together in v1.1.
- **Communicate** — v1.0 ships the exportable Pricing Decision Record; the pricing-page mock follows in v1.1.

The economics is the point: the planned engine concentrates correctness in one primitive (utility upper-envelope selection over an offer menu). Its release gate requires every formula to be tested against closed-form results and a value-conservation identity to hold on every simulation.

## What it is not

No accounts, no server, no telemetry, no data connectors. Fully client-side: your assumptions stay in your browser; compact model/design configurations can share as URLs, while full survey data travels only in an explicit JSON export.

## Planned stack

Next.js (App Router, static export) · React · TypeScript (strict) · Tailwind CSS · Zustand · Zod — fully client-side, with no server. Vercel is the selected deployment target; it is not connected or deployed yet, and the future static bundle remains portable to any static host. The plan requires light + dark themes, WCAG 2.1 AA intent with a recorded audit before any stronger claim, hand-rolled SVG visualization, Vitest + fast-check property tests against the economics contract, and Playwright end-to-end checks.

## Roadmap

| Phase   | Delivers                                                                 | Status              |
| ------- | ------------------------------------------------------------------------ | ------------------- |
| P0      | Scaffold, CI, deployed shell                                             | —                   |
| P1–P2   | Economics engine (selection, KPIs, surplus, sweeps) + math spec          | P2 locally complete |
| P3      | Scenarios: persistence, import/export, share-by-URL, templates           | P3 locally complete |
| P4      | Model surface: segments, bands, value matrix, templates                  | P4 contracts        |
| P5      | Design surface + design linter                                           | —                   |
| P6a     | **v1.0 core:** live wind-tunnel reveal                                   | —                   |
| P7a–P7b | **v1.0 core:** Monte Carlo + tornado and Van Westendorp                  | —                   |
| P8      | **v1.0 core:** Pricing Decision Record export                            | —                   |
| P9      | **v1.0 core:** hardening, accessibility & performance audit → **v1.0.0** | —                   |
| P6b/P8b | **v1.1 extensions:** mechanism + A/B and pricing-page mock               | Deferred until v1.0 |
| P7c–P7e | **v1.1 extensions:** bundling, CBC + MaxDiff, competitive positioning    | Deferred until v1.0 |

## Project docs

- `docs/MODEL-SPEC.md` — the math contract (extracted in Phase 1; every engine test cites it).
- `docs/STATIC-HOST-HEADERS.md` — CSP and equivalent static-host security headers.

## Run locally

Use the Node version pinned in `.nvmrc`, then install the exact dependency graph and start the static shell:

```sh
npm ci
npm run dev
```

Before a change is ready for review, run:

```sh
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run e2e
```

`npm run build` produces the portable static bundle in `out/` and applies the 300 KiB gzip client-JavaScript gate. The browser check serves that export locally and verifies the light/dark shell, zero serious or critical axe violations, and the same-origin request allowlist.

## License

[MIT](LICENSE) © 2025 Sidakpreet Singh

## AI Agent Instructions

Never commit or push unless the owner explicitly asks. Before any authorized
commit, use the owner-assigned release version and update the Version Control
string below with the real current commit time in IST (`Asia/Kolkata`). Align
that version in `package.json` and both root version fields in
`package-lock.json` in the same commit. Historical v0.8.11–v0.9.7 timestamps
were owner-directed exceptions; do not rewrite pushed history.

- **Base Format Version:** 0.5.0
- **Portfolio Version:** v0.5.0_2025-11-18_21:41:30 (IST)
