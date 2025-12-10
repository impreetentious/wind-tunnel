# Wind Tunnel

**A wind tunnel for SaaS pricing & packaging decisions.** Model your buyers as explicit assumptions, design tiers and fences as a screening mechanism, and watch segments self-select — revealing revenue, conversion, and the surplus you're leaving on the table, before you ship a price.

> **Status: §15 Batches 3–5 — usage-based pricing, trials and time dynamics, Hierarchical Bayes conjoint, scenario version diffing, locale-aware formatting, PNG/slide export, the worked tutorial script, decision-readiness and model-limit disclosures, and the engine perf profile plus static Web-Vitals gate — are locally complete as engine, state, content, and documentation layers (latest committed version v0.19.11). 223 unit tests run green. These Batch 3–5 layers are deliberately **not yet wired into the workbenches**, so they carry no UI or browser coverage; the Chromium E2E matrix (with Firefox/WebKit for E2E-09) was last run at v0.18.x, and `npm run build`, `bundle-size`, and `web-vitals` have not been re-run since the engine additions. Accessibility remains a stated WCAG 2.1 AA _intent_, not an audited claim: the manual assistive-technology matrix, 200% zoom, forced-colors, and screen-reader passes are still pending, as are remote CI and deployment. Buyer-distribution math, economics, elasticity and cross-tier substitution, the joint price optimizer (local search, not truth), non-additive feature interactions, usage-based surcharges, multi-period trial and retention projection, Van Westendorp PSM, bundling regimes, Conjoint MNL estimation with derivative-gated Newton-Raphson and its Hierarchical Bayes extension, MaxDiff-lite scoring, competitive positioning (Pareto staircase, break-even rays, direct-dominance verdict), and the Pricing Decision Record have tested pure-engine contracts; scenarios persist locally and share safely, and the Model (incl. feature interactions), Design, Simulate, and Analyze (Uncertainty, Elasticity, Price search, Research, Positioning) plus Share workbenches make assumptions, evidence, decisions, mechanism envelopes, design comparisons, bundling verdicts, and pricing-page previews inspectable.**

## The idea

Most SaaS packaging is decided by gut and competitor-copying. But Good/Better/Best isn't decoration — it's a _screening mechanism_ (second-degree price discrimination): a menu designed so buyers with different willingness-to-pay sort themselves into the right tier. Once you write your assumptions down — who the segments are, what they'd pay, which features they value — the menu's consequences stop being opinions. They can be computed.

Wind Tunnel runs entirely on **your assumptions, made explicit**. It is not a billing tool and not an optimizer that needs live revenue data. It's useful before your first customer exists: a think-before-you-ship reasoning layer for the highest-leverage decision most SaaS teams make on vibes.

## Product target (v1.0 core + v1.1 extensions)

- **Model** — now available: buyer segments with P50-centred size and WTP bands, within-segment buyer spread, a keyboard-navigable segment × feature value matrix, provenance tags, and immediate engine-backed KPIs. The three template scenarios provide a practical first run.
- **Design** — now available: editable tiers, feature fences, free tier, add-ons, flat or per-seat pricing, and multiple design alternatives. The built-in linter flags dominated tiers, fence inversions, free-tier leakage (in dollars), cannibalization, competitor loss, and directional behavioral considerations without inventing numeric effects.
- **Simulate** — now available: closed-form self-selection turns the active model and menu into live MRR, conversion, ARPA, capture rate, buyer sorting, a reconciled value waterfall, and a 400-point residual price sweep for each tier. The mechanism diagram, A/B comparison, and user-facing competitor-loss share follow in v1.1.
- **Analyze — Uncertainty** — now available: seeded Monte Carlo over assumption uncertainty, P10/P50/P90 MRR bands, paired design win rates, and a tornado chart that tells you _which assumption to validate first_.
- **Analyze — Research** — now available: survey-first Van Westendorp PSM with manual/CSV input, exclusion reporting, cumulative curves, interpolated points, and a clearly labeled illustrative mode. The v1.1 extensions add Choice-Based Conjoint, MaxDiff-lite, and bundling economics.
- **Analyze — Positioning** — now available: competitor entry (per-segment values with an "overall" default), a segment-scoped Pareto price-value map with P10/P50/P90 break-even rays and direct-dominance verdicts, per-segment competitor share, and a live competitor-loss KPI wired into the wind tunnel.
- **Communicate** — v1.0 ships the exportable Pricing Decision Record; the pricing-page mock follows in v1.1.

The economics is the point: the planned engine concentrates correctness in one primitive (utility upper-envelope selection over an offer menu). Its release gate requires every formula to be tested against closed-form results and a value-conservation identity to hold on every simulation. See `docs/MODEL-SPEC.md` for the normative math contract.

## What it is not

No accounts, no server, no telemetry, no data connectors. Fully client-side: your assumptions stay in your browser; compact model/design configurations can share as URLs, while full survey data travels only in an explicit JSON export.

## Stack

Next.js (App Router, static export) · React · TypeScript (strict) · Tailwind CSS · Zustand · Zod — fully client-side, with no server. Vercel is the selected deployment target; it is not connected or deployed yet, and the future static bundle remains portable to any static host. The plan requires light + dark themes, WCAG 2.1 AA intent with a recorded audit before any stronger claim, hand-rolled SVG visualization, Vitest + fast-check property tests against the economics contract, and Playwright end-to-end checks.

## Roadmap

| Phase   | Delivers                                                                 | Status                                                                           |
| ------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| P0      | Scaffold, CI, deployed shell                                             | Locally complete; remote CI + deploy pending owner                               |
| P1–P2   | Economics engine (selection, KPIs, surplus, sweeps) + math spec          | P2 locally complete                                                              |
| P3      | Scenarios: persistence, import/export, share-by-URL, templates           | P3 locally complete                                                              |
| P4      | Model surface: segments, bands, value matrix, templates                  | P4 locally complete                                                              |
| P5      | Design surface + design linter                                           | Locally complete                                                                 |
| P6a     | **v1.0 core:** live wind-tunnel reveal                                   | Locally complete                                                                 |
| P7a     | **v1.0 core:** Monte Carlo + tornado                                     | Locally complete                                                                 |
| P7b     | **v1.0 core:** Van Westendorp                                            | Locally complete                                                                 |
| P8      | **v1.0 core:** Pricing Decision Record export                            | Locally complete                                                                 |
| P9      | **v1.0 core:** hardening, accessibility & performance audit → **v1.0.0** | Partial: automated gates + docs done; manual matrix, user test, live URL pending |
| P6b/P8b | **v1.1 extensions:** mechanism + A/B and pricing-page mock               | Locally complete                                                                 |
| P7c–P7e | **v1.1 extensions:** bundling, CBC + MaxDiff, competitive positioning    | Locally complete                                                                 |

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

`npm run build` produces the portable static bundle in `out/` and applies the 360 KiB gzip client-JavaScript gate (raised from 320 KiB to carry the §15 parked-scope mission). The browser check serves that export locally and verifies the light/dark shell, zero serious or critical axe violations, and the same-origin request allowlist.

## License

[MIT](LICENSE) © 2025 Sidakpreet Singh
