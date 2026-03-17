# Wind Tunnel

**A wind tunnel for SaaS pricing & packaging decisions.** Model your buyers as explicit assumptions, design tiers and fences as a screening mechanism, and watch segments self-select — revealing revenue, conversion, and the surplus you're leaving on the table, before you ship a price.

## The idea

Most SaaS packaging is decided by gut and competitor-copying. But Good/Better/Best isn't decoration — it's a _screening mechanism_ (second-degree price discrimination): a menu designed so buyers with different willingness-to-pay sort themselves into the right tier. Once you write your assumptions down — who the segments are, what they'd pay, which features they value — the menu's consequences stop being opinions. They can be computed.

Wind Tunnel runs entirely on **your assumptions, made explicit**. It is not a billing tool and not an optimizer that needs live revenue data. It's useful before your first customer exists: a think-before-you-ship reasoning layer for the highest-leverage decision most SaaS teams make on vibes.

## What it does

- **Model** — buyer segments with P50-centred size and willingness-to-pay bands, within-segment buyer spread, a keyboard-navigable segment × feature value matrix, usage metrics and bands, provenance tags, and immediate engine-backed KPIs. Three template scenarios give you a practical first run.
- **Design** — editable tiers, feature fences, free tier, add-ons, flat, per-seat, metered or prepaid-credit pricing, trial and retention assumptions, and multiple design alternatives. The built-in linter flags dominated tiers, fence inversions, free-tier leakage (in dollars), cannibalization, competitor loss, and directional behavioral considerations without inventing numeric effects.
- **Simulate** — closed-form self-selection turns the active model and menu into live MRR, conversion, ARPA, capture rate, buyer sorting, a reconciled value waterfall, and a 400-point residual price sweep for each tier.
- **Analyze — Uncertainty** — seeded Monte Carlo over assumption uncertainty, P10/P50/P90 MRR bands, paired design win rates, and a tornado chart that tells you _which assumption to validate first_.
- **Analyze — Research** — survey-first Van Westendorp price sensitivity with manual/CSV input, exclusion reporting, cumulative curves, interpolated points, and a clearly labeled illustrative mode. Choice-based conjoint, MaxDiff and bundling economics are available alongside it.
- **Analyze — Elasticity and price search** — own-price and revenue elasticity, a cross-tier substitution heatmap, and a price search that reports the best menu it found by local search, presented as a candidate rather than a proven optimum.
- **Analyze — Usage** — the expected metered bill by segment, plus prepaid credit packs priced against each segment's own usage band: expected utilisation, the probability of overage, the overage cliff, and **breakage** — the units a buyer is expected to pay for and never spend — reported as a disclosed share of revenue rather than as an addition to it.
- **Analyze — Migration** — repricing an existing base rather than selling to a new one. The legacy plan enters each account's choice set as one more alternative in the same envelope, with the switching cost charged on every move away from it, and the readout is a migration matrix (who lands where, who churns at the event) and a revenue bridge that reconciles old MRR to new exactly. Grandfathering, forced-at-renewal, and opt-in-with-deadline are three choice sets, not three engines.
- **Analyze — Discounts** — list price is a ceiling; achieved price is a policy outcome. Set a permitted floor and expected hit rate per tier and the effective menu runs through the same choice engine, reporting discount leakage in dollars and **fence erosion**: the floors that make a discounted Better beat an undiscounted Best for the buyers Best was built for.
- **Analyze — Positioning** — competitor entry (per-segment values with an "overall" default), a segment-scoped Pareto price-value map with P10/P50/P90 break-even rays and direct-dominance verdicts, per-segment competitor share, and a live competitor-loss KPI.
- **Communicate** — an exportable Pricing Decision Record, pricing-page mock, browser-local scenario history and diffs, readiness and model-limit disclosures, PNG/ZIP decision snapshots, and a worked tutorial.

The economics is the point: the engine concentrates correctness in one primitive (utility upper-envelope selection over an offer menu). Every formula is tested against closed-form results, and a value-conservation identity must hold on every simulation. `docs/MODEL-SPEC.md` states the math in full.

## What it is not

No accounts, no server, no telemetry, no data connectors. Fully client-side: your assumptions stay in your browser; compact model/design configurations can share as URLs, while full survey data travels only in an explicit JSON export.

## Limitations

- **Advanced conjoint estimation is opt-in, not the default screen.** Pooled MNL is what the research flow estimates automatically. The deterministic hierarchical-Bayes sampler runs only when you ask for per-respondent part-worths, because it is slow enough to be felt, and it is offered only once the pooled fit is identifiable — HB on a degenerate design returns numbers that are confident and wrong. The D-efficient task generator is likewise a choice alongside the random-balanced default, and reports when its search failed to beat that baseline.
- **Assumptions in, assumptions out.** There is no market data and no calibration against your actual revenue. The engine is exact given your inputs; it has no opinion about whether those inputs are right.
- **Usage is an expected cost, not a joint distribution.** Metered lines, allowances, and credit packs are priced against each segment's usage band as a per-segment expected bill, not as a per-buyer joint distribution over consumption and buyer scale. Breakage is computed from that band rather than assumed, and it is always shown as a slice of revenue — never a sixth term in the value waterfall.
- **Migration and discount results sit beside the headline numbers, never inside them.** MRR, conversion, and capture rate are about new buyers at list price. The installed base is a different population and the permitted menu is a different menu; mixing either into the headline would answer a question you did not ask. Discount leakage assumes the stated hit rates land at the permitted floor — a mixture over cohorts, not a distribution over discount depth.
- **Opt-in take-up and other inertia are not modeled.** A migration policy that depends on buyers acting by a deadline reports the full exposure as a ceiling. The tool does not invent a behavioral coefficient to discount it, here or anywhere else.
- **Accessibility** is built to WCAG 2.1 AA and checked with automated axe scans across three browsers in both themes. It has not been independently audited.

## Stack

Next.js (App Router, static export) · React · TypeScript (strict) · Tailwind CSS · Zustand · Zod · hand-rolled SVG visualization · Vitest + fast-check · Playwright. Fully client-side, with no server. The static bundle is portable to any static host.

## Project docs

- `docs/MODEL-SPEC.md` — the normative math specification the engine implements.
- `docs/STATIC-HOST-HEADERS.md` — CSP and equivalent static-host security headers.
- `docs/DATA-LIFECYCLE.md` — every persistence surface, its retention model, and its recovery path.

## Run locally

Requires Node `24.14.0` (see `.nvmrc`).

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

[MIT](LICENSE) © 2025-2026 Sidakpreet Singh

---

**Version:** v0.22.10
