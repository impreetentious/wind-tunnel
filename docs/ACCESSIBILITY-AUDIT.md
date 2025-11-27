# Accessibility audit record

Wind Tunnel targets WCAG 2.1 AA and treats that as an engineering intent until
the complete manual matrix below is recorded against a deployed release.

## Automated coverage

The Playwright suite audits every v1 workbench in light and dark themes with
axe-core and fails on serious or critical findings. The same suite checks:

- the horizontal ARIA tab pattern, including roving focus and arrow/Home/End
  keys;
- a skip link that stays off-canvas until focused, reveals itself, and moves to
  the active workbench;
- chart/table parity for buyer sorting and the value waterfall;
- reduced-motion behavior without changing the final state;
- checkbox pointer targets of at least 24 × 24 CSS pixels on the Design surface;
- 320-CSS-pixel reflow across all five workbenches with no page-level horizontal
  scrolling;
- all v1 workbenches in Chromium, Firefox, and WebKit; and
- the print-media Pricing Decision Record with `.no-print` controls removed.

Source: `e2e/shell.spec.ts`. The CI workflow installs all three browser engines.

Two engine-specific carve-outs are declared rather than hidden. The P6a/P7a
interaction budgets are measured through the Chrome DevTools Protocol, which
Playwright exposes for Chromium only, so those two flows skip on Firefox and
WebKit. WebKit keeps links out of the sequential tab order unless macOS full
keyboard access is enabled, so the skip link's "first tab stop" position is
asserted on Chromium and Firefox; its reveal-on-focus and target behavior are
asserted everywhere.

**Not yet automated:** 200% text zoom, forced-colors legibility, chart/table
parity for price sweeps and tornado sensitivity, and screen-reader output. These
are manual rows below and are not claimed as covered.

## Manual release matrix

Do not change the public claim from “WCAG 2.1 AA intent” to “audited” until a
release candidate has a dated pass recorded for every row.

| Check                       | Required evidence                                                                          | Current state                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Complete keyboard workflow  | Model → Design → Simulate → Analyze → Decision Record, including editing and downloads     | Automated coverage present; final manual pass pending                                       |
| Focus order and restoration | Logical order after tab changes, dialogs/popovers, destructive edits, and imports          | Automated tab coverage present; manual pass pending                                         |
| Screen reader smoke         | One full VoiceOver/Safari or NVDA/Firefox path with names, roles, states, and live updates | Pending manual assistive-technology pass                                                    |
| Non-color cues              | Selection, warnings, curves, and comparison states remain understandable without hue       | Code/axe review present; manual pass pending                                                |
| Contrast                    | Text, controls, focus indicators, and chart annotations in both themes                     | Axe coverage present; manual chart review pending                                           |
| Text zoom                   | 200% zoom without loss of content or operation                                             | Not automated; manual browser pass pending                                                  |
| Narrow reflow               | 320 CSS pixels / 400% zoom, no page-level two-dimensional scrolling                        | Automated 320px check present (all five workbenches, tri-browser); 400% manual pass pending |
| Forced colors               | Controls, focus, charts, and selected states remain legible                                | Forced-colors CSS present; not automated; manual Windows pass pending                       |
| Reduced motion              | No meaningful information depends on animation                                             | Automated pass present                                                                      |
| Pointer targets             | Frequently used controls are practical to acquire                                          | Automated checkbox floor present; manual touch pass pending                                 |

## Implementation notes

- Visualizations have semantic tables containing the same numbers.
- Status updates use polite live regions; validation/import failures use alerts.
- Inputs, links, buttons, and tabs receive a three-pixel visible focus ring.
- Print styles preserve text contrast and avoid splitting decision-record units.
- Forced-colors mode adds outlines to filled SVG marks rather than relying on
  color alone.
- Horizontally scrollable regions are `position: relative`. Tailwind's `sr-only`
  is `position: absolute`, so without a positioned ancestor it resolved against
  the initial containing block, escaped the region's clip, and pinned the
  document's width to the region's full extent — the whole page scrolled sideways
  by ~206 px at 320 CSS px even though every visible box was contained. This was
  found by the 320 px flow when it was first written (S30) and fixed in v0.15.1;
  the flow now guards it.
- Axe runs only after in-flight transitions settle. A theme switch updates
  `--ink` on the root before the painted colors catch up, and sampling mid-fade
  can pair a pre-switch foreground with a post-switch background and report a
  contrast failure no user ever sees. WebKit reproduced this reliably.
