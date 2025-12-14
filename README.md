# Wind Tunnel

**A wind tunnel for SaaS pricing & packaging decisions.** Model your buyers as explicit assumptions, design tiers and fences as a screening mechanism, and watch segments self-select — revealing revenue, conversion, and the surplus you're leaving on the table, before you ship a price.

## The idea

Most SaaS packaging is decided by gut and competitor-copying. But Good/Better/Best isn't decoration — it's a _screening mechanism_ (second-degree price discrimination): a menu designed so buyers with different willingness-to-pay sort themselves into the right tier. Once you write your assumptions down — who the segments are, what they'd pay, which features they value — the menu's consequences stop being opinions. They can be computed.

Wind Tunnel runs entirely on **your assumptions, made explicit**. It is not a billing tool and not an optimizer that needs live revenue data. It's useful before your first customer exists: a think-before-you-ship reasoning layer for the highest-leverage decision most SaaS teams make on vibes.

## What it does

- **Model** — buyer segments with P50-centred size and willingness-to-pay bands, within-segment buyer spread, a keyboard-navigable segment × feature value matrix, provenance tags, and immediate engine-backed KPIs. Three template scenarios give you a practical first run.
- **Design** — editable tiers, feature fences, free tier, add-ons, flat or per-seat pricing, and multiple design alternatives. The built-in linter flags dominated tiers, fence inversions, free-tier leakage (in dollars), cannibalization, competitor loss, and directional behavioral considerations without inventing numeric effects.
- **Simulate** — closed-form self-selection turns the active model and menu into live MRR, conversion, ARPA, capture rate, buyer sorting, a reconciled value waterfall, and a 400-point residual price sweep for each tier.
- **Analyze — Uncertainty** — seeded Monte Carlo over assumption uncertainty, P10/P50/P90 MRR bands, paired design win rates, and a tornado chart that tells you _which assumption to validate first_.
- **Analyze — Research** — survey-first Van Westendorp price sensitivity with manual/CSV input, exclusion reporting, cumulative curves, interpolated points, and a clearly labeled illustrative mode. Choice-based conjoint, MaxDiff and bundling economics are available alongside it.
- **Analyze — Elasticity and price search** — own-price and revenue elasticity, a cross-tier substitution heatmap, and a price search that reports the best menu it found by local search, presented as a candidate rather than a proven optimum.
- **Analyze — Positioning** — competitor entry (per-segment values with an "overall" default), a segment-scoped Pareto price-value map with P10/P50/P90 break-even rays and direct-dominance verdicts, per-segment competitor share, and a live competitor-loss KPI.
- **Communicate** — an exportable Pricing Decision Record and a pricing-page mock.

The economics is the point: the engine concentrates correctness in one primitive (utility upper-envelope selection over an offer menu). Every formula is tested against closed-form results, and a value-conservation identity must hold on every simulation. `docs/MODEL-SPEC.md` states the math in full.

## What it is not

No accounts, no server, no telemetry, no data connectors. Fully client-side: your assumptions stay in your browser; compact model/design configurations can share as URLs, while full survey data travels only in an explicit JSON export.

## Limitations

- **Some engines are not reachable from the interface.** Usage-based pricing, trials and multi-period time dynamics, hierarchical-Bayes conjoint estimation, scenario version-diffing, and PNG/slide export are implemented, tested, and specified in the math spec, but no screen exposes them.
- **Assumptions in, assumptions out.** There is no market data and no calibration against your actual revenue. The engine is exact given your inputs; it has no opinion about whether those inputs are right.
- **Accessibility** is built to WCAG 2.1 AA and checked with automated axe scans across three browsers in both themes. It has not been independently audited.

## Stack

Next.js (App Router, static export) · React · TypeScript (strict) · Tailwind CSS · Zustand · Zod · hand-rolled SVG visualization · Vitest + fast-check · Playwright. Fully client-side, with no server. The static bundle is portable to any static host.

## Project docs

- `docs/MODEL-SPEC.md` — the normative math specification the engine implements.
- `docs/STATIC-HOST-HEADERS.md` — CSP and equivalent static-host security headers.
- `docs/DATA-LIFECYCLE.md` — every persistence surface, its retention model, and its recovery path.

## Run locally

Requires Node `24.11.1` (see `.nvmrc`).

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Verify

```sh
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run e2e
```

`npm run e2e` serves the static export locally and verifies the light/dark shell, zero serious or critical axe violations, and the same-origin request allowlist.

Individual checks can also be run on their own: `npm run privacy`, `npm run bundle-size`, `npm run web-vitals`, `npm run spec-coverage`.

## Build and deploy

```sh
npm run build
```

This emits a portable static site in `out/` — it also runs the privacy scan and enforces a 360 KiB gzip client-JavaScript budget as part of the build. `npm start` serves that build locally. The output serves from any static host; `docs/STATIC-HOST-HEADERS.md` gives the security headers to set there.

## License

[MIT](LICENSE) © 2025 Sidakpreet Singh

---

**Version:** v0.20.6
