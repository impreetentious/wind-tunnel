# Release checklist

This checklist covers a static Wind Tunnel release. Deployment itself remains
an owner action.

## Code gate

- [ ] Use the Node version in `.nvmrc` and run `npm ci` from a clean checkout.
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run test`
- [ ] Review every seeded-engine golden snapshot diff; it is a model-change review event, not noise.
- [ ] `npm run spec-coverage`
- [ ] `npm run build` (privacy scan plus the 360 KiB gzip gate enforced by `scripts/check-bundle-size.mjs`)
- [ ] `npm run e2e` in Chromium, Firefox, and WebKit
- [ ] `npm audit` returns no release-blocking production finding
- [ ] `git diff --check` and a fresh changed-file review are clean

## Product gate

- [ ] Each worked template opens with non-trivial, conserved economics.
- [ ] A user can move from a template to a downloaded Pricing Decision Record.
- [ ] Markdown values reconcile with the visible active scenario.
- [ ] Illustrative Van Westendorp data is labeled “SIMULATED — not evidence.”
- [ ] Compact sharing excludes research; full JSON retains it.
- [ ] Empty, invalid, and degenerate states explain the next action.
- [ ] All shipped features are documented; deferred features are not marketed.

## Accessibility and performance gate

- [ ] Complete `docs/ACCESSIBILITY-AUDIT.md` manual matrix.
- [ ] Axe reports zero serious/critical findings in every view and both themes.
- [ ] Verify 200% text, 320px reflow, forced colors, and reduced motion.
- [ ] Re-record warmed interaction and 1,000-draw Monte Carlo budgets.
- [ ] Confirm every chart has a numerically equivalent table.

## Deployment handoff

- [ ] Connect the intended GitHub branch to Vercel without adding server code.
- [ ] Confirm `vercel.json` security headers on the public response.
- [ ] Run the static request allowlist against the public URL.
- [ ] Test the public URL in the tri-browser matrix.
- [ ] Record the deployed commit, release version, date, and rollback target.
- [ ] Follow `docs/RELEASE-RUNBOOK.md` for rollback and verification.
