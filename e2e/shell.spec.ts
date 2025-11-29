import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const baseUrl = "http://127.0.0.1:4173";

/**
 * Theme switches run a colour transition, so `--ink` updates on the root before the
 * painted colours catch up. axe sampling mid-fade can pair a pre-switch foreground with
 * a post-switch background and report a contrast failure that no user ever sees (WebKit
 * reproduces this reliably; Chromium happens to sample a self-consistent pair). Waiting
 * for in-flight transitions keeps the audit deterministic across engines without
 * weakening it.
 */
async function waitForTransitionsToSettle(page: import("@playwright/test").Page) {
  // Poll rather than await once: a transition triggered by the click that precedes this
  // call may not have registered yet, and an empty getAnimations() would resolve early.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
          await frame();
          await Promise.all(
            document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
          );
          await frame();
          return document.getAnimations().length;
        }),
      { timeout: 5000 },
    )
    .toBe(0);
}

async function expectNoSeriousAxeViolations(page: import("@playwright/test").Page) {
  await waitForTransitionsToSettle(page);
  const accessibility = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = accessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(seriousOrCritical).toEqual([]);
}

async function browserTaskDuration(
  session: Awaited<ReturnType<import("@playwright/test").BrowserContext["newCDPSession"]>>,
) {
  const result = await session.send("Performance.getMetrics");
  return result.metrics.find((metric) => metric.name === "TaskDuration")?.value ?? 0;
}

/** Parses a computed transition-duration ("0.01ms" | "1e-05s" | "0.00001s") into seconds. */
function durationSeconds(value: string) {
  const first = value.split(",")[0].trim();
  const numeric = Number.parseFloat(first);
  if (!Number.isFinite(numeric)) return Number.POSITIVE_INFINITY;
  return first.endsWith("ms") ? numeric / 1000 : numeric;
}

async function readDownload(download: import("@playwright/test").Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

// §6 traceability: E2E-01…E2E-09 are the test titles below. E2E-10 (decision-record
// Markdown download + print CSS) is covered by the E2E-08 download assertion plus the
// print-media flow below.
test("E2E-01: the static shell is accessible, private, and theme-aware", async ({ page }) => {
  const unexpectedRequests: string[] = [];

  page.on("request", (request) => {
    if (new URL(request.url()).origin !== baseUrl) {
      unexpectedRequests.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Choose a starting scenario" })).toBeVisible();
  await page.getByRole("button", { name: "Use this template" }).first().click();
  await expect(page.getByRole("heading", { name: "Make the assumptions visible" })).toBeVisible();

  const potential = page.getByText("Potential value").locator("xpath=following-sibling::*");
  const originalPotential = await potential.textContent();
  await page.getByLabel("Growing teams account-level WTP confidence band P50 (USD)").fill("2500");
  await expect(potential).not.toHaveText(originalPotential ?? "");

  await page.getByLabel("Shared workspaces value for Growing teams").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Shared workspaces value for Scaling organisations")).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectNoSeriousAxeViolations(page);

  await page.waitForTimeout(350);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  expect(unexpectedRequests).toEqual([]);
});

test("E2E-02: the Design workbench builds a three-tier menu from blank and surfaces its linter guidance", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a blank model" }).click();

  await page.getByRole("button", { name: "Add feature" }).click();
  await page.getByRole("button", { name: "Add feature" }).click();
  await page.getByRole("button", { name: "Add feature" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();

  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Turn value into tiers and fences" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add paid tier" }).click();
  await page.getByRole("button", { name: "Add paid tier" }).click();
  await page.getByRole("button", { name: "Add paid tier" }).click();
  await expect(
    page.getByRole("heading", { name: "Fence carries no screening information" }).first(),
  ).toBeVisible();

  await page.getByRole("spinbutton", { name: "Tier 1 price", exact: true }).fill("5");
  await page.getByRole("spinbutton", { name: "Tier 2 price", exact: true }).fill("20");
  await page.getByRole("spinbutton", { name: "Tier 3 price", exact: true }).fill("40");

  for (const label of [
    "Feature 1 included in Tier 1",
    "Feature 1 included in Tier 2",
    "Feature 1 included in Tier 3",
    "Feature 2 included in Tier 2",
    "Feature 2 included in Tier 3",
    "Feature 3 included in Tier 3",
  ]) {
    await page.getByLabel(label).check();
  }

  await expect(page.getByRole("heading", { name: "Large downgrade mass" })).toHaveCount(2);
  await expectNoSeriousAxeViolations(page);
});

test("E2E-03: the wind tunnel re-sorts buyers, reconciles chart tables, and respects reduced motion", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).nth(2).click();
  await page.getByRole("tab", { name: "Simulate" }).click();

  await expect(
    page.getByRole("heading", { name: "Reveal the menu's economic consequences" }),
  ).toBeVisible();
  const beforeMrr = await page
    .getByText("MRR", { exact: true })
    .locator("xpath=following-sibling::*")
    .textContent();
  const beforeDots = await page
    .locator('[data-testid="buyer-dot"]')
    .evaluateAll((dots) =>
      dots.map((dot) => `${dot.getAttribute("cx")}:${dot.getAttribute("cy")}`).join("|"),
    );
  const choiceShare = await page
    .locator('[data-testid^="buyer-selection-share-"]')
    .first()
    .textContent();
  const revenue = await page.getByTestId("waterfall-value-Revenue").textContent();

  await page.getByRole("button", { name: "View buyer selection as table" }).click();
  await expect(page.getByRole("table", { name: "Buyer selection table" })).toContainText(
    choiceShare ?? "",
  );
  await page.getByRole("button", { name: "Show buyer selection chart" }).click();
  await page.getByRole("button", { name: "View value waterfall as table" }).click();
  await expect(page.getByRole("table", { name: "Value waterfall table" })).toContainText(
    revenue ?? "",
  );
  await page.getByRole("button", { name: "Show value waterfall chart" }).click();

  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Enterprise price" }).fill("1000");
  await page.getByRole("tab", { name: "Simulate" }).click();

  await expect(
    page.getByText("MRR", { exact: true }).locator("xpath=following-sibling::*"),
  ).not.toHaveText(beforeMrr ?? "");
  await expect
    .poll(() =>
      page
        .locator('[data-testid="buyer-dot"]')
        .evaluateAll((dots) =>
          dots.map((dot) => `${dot.getAttribute("cx")}:${dot.getAttribute("cy")}`).join("|"),
        ),
    )
    .not.toBe(beforeDots);

  // Each engine serializes the collapsed duration differently ("0.01ms", "1e-05s",
  // "0.00001s"), so compare the parsed seconds rather than the spelling.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      page
        .locator('[data-testid="buyer-dot"]')
        .first()
        .evaluate((dot) => getComputedStyle(dot).transitionDuration)
        .then(durationSeconds),
    )
    .toBeLessThan(0.001);
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectNoSeriousAxeViolations(page);
});

test("each warmed template simulation renders within the 16ms P6a interaction budget", async ({
  page,
  browserName,
}) => {
  // The P6a budget is measured through the Chrome DevTools Protocol, which Playwright
  // exposes for Chromium only. The budget is an engine-specific performance gate, not a
  // cross-browser behavioral contract, so it is asserted on Chromium and declared here.
  test.skip(browserName !== "chromium", "Task-duration metrics require CDP (Chromium only)");
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");

  for (const templateIndex of [0, 1, 2]) {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: "Use this template" }).nth(templateIndex).click();

    await page.getByRole("tab", { name: "Simulate" }).click();
    await expect(
      page.getByRole("heading", { name: "Reveal the menu's economic consequences" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Design", exact: true }).click();

    const before = await browserTaskDuration(session);
    await page.getByRole("tab", { name: "Simulate" }).click();
    await expect(
      page.getByRole("heading", { name: "Reveal the menu's economic consequences" }),
    ).toBeVisible();
    await page.evaluate(
      () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())),
    );
    const durationMilliseconds = ((await browserTaskDuration(session)) - before) * 1_000;

    expect(durationMilliseconds).toBeLessThan(16);
  }
});

test("E2E-05: uncertainty draws are seeded, paired, and rendered within the P7a budget", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Task-duration metrics require CDP (Chromium only)");
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");

  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).nth(2).click();
  await page.getByLabel("Mid-market teams account-level WTP confidence band P10 (USD)").fill("300");

  const before = await browserTaskDuration(session);
  await page.getByRole("tab", { name: "Analyze" }).click();
  await expect(
    page.getByRole("heading", { name: "Stress-test the assumptions behind this menu" }),
  ).toBeVisible();
  await expect(page.getByTestId("tornado-chart")).toBeVisible();
  await page.evaluate(
    () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())),
  );
  const durationMilliseconds = ((await browserTaskDuration(session)) - before) * 1_000;
  expect(durationMilliseconds).toBeLessThan(150);

  const seed = page.getByLabel("Simulation seed");
  await seed.fill("42");
  const firstP50 = await page.getByTestId("monte-carlo-p50").textContent();
  await seed.fill("42");
  await expect(page.getByTestId("monte-carlo-p50")).toHaveText(firstP50 ?? "");
  await seed.fill("43");
  await expect(page.getByTestId("monte-carlo-p50")).not.toHaveText(firstP50 ?? "");

  await page.getByRole("button", { name: "View tornado as table" }).click();
  await expect(page.getByRole("table", { name: "Tornado sensitivity table" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("E2E-06: Van Westendorp validates fielded input, interpolates the demo points, and preserves undefined crossings", async ({
  page,
}) => {
  const demoCsv = `too cheap,cheap,expensive,too expensive
10,20,40,60
15,25,45,65
20,30,50,70
25,35,55,75
30,40,60,80`;

  await page.goto("/");
  await page.getByRole("tab", { name: "Analyze" }).click();
  await page.getByRole("tab", { name: "Research" }).click();
  await expect(
    page.getByRole("heading", { name: "Measure price perception with fielded responses" }),
  ).toBeVisible();

  const csv = page.getByLabel("Van Westendorp survey CSV");
  await csv.fill(demoCsv);
  await page.getByRole("button", { name: "Analyze pasted responses" }).click();
  await expect(
    page
      .getByRole("heading", { name: "Point of marginal cheapness (PMC)" })
      .locator("xpath=following-sibling::*"),
  ).toHaveText("$27.5");
  await expect(
    page
      .getByRole("heading", { name: "Point of marginal expensiveness (PME)" })
      .locator("xpath=following-sibling::*"),
  ).toHaveText("$57.5");
  await expect(page.getByText("0 excluded", { exact: true })).toBeVisible();

  await csv.fill(`${demoCsv}\n20,15,45,65`);
  await page.getByRole("button", { name: "Analyze pasted responses" }).click();
  await expect(page.getByText("1 excluded", { exact: true })).toBeVisible();

  await csv.fill(`too cheap,cheap,expensive,too expensive
10,10,10,10
10,10,10,10`);
  await page.getByRole("button", { name: "Analyze pasted responses" }).click();
  await expect(
    page
      .getByRole("heading", { name: "Point of marginal cheapness (PMC)" })
      .locator("xpath=following-sibling::*"),
  ).toHaveText("Undefined for this data");
  await expectNoSeriousAxeViolations(page);
});

test("E2E-07: the canonical bundling fixture reports bundle-beats-components without overclaiming", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).nth(1).click();
  await page.getByRole("tab", { name: "Analyze" }).click();
  await page.getByRole("tab", { name: "Research" }).click();
  await page.getByRole("tab", { name: "Bundling" }).click();
  await page.getByRole("button", { name: "Show canonical teaching fixture" }).click();

  await expect(
    page.getByRole("heading", { name: "Pure bundle leads on the searched prices" }),
  ).toBeVisible();
  await expect(page.getByTestId("bundling-verdict")).toContainText("$20.0 modeled revenue");
  await expect(page.getByTestId("bundling-verdict")).toContainText("$2.0 above pure components");
  await expect(page.getByText(/not a continuous global optimum/)).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

// E2E-08 (§6 P7d-2): 3-attr × 3-level CBC on the shipped synthetic dataset.
test("E2E-08: the synthetic CBC estimates, bridges onto selected cells, and gates honestly", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).first().click();
  await page.getByRole("tab", { name: "Analyze" }).click();
  await page.getByRole("tab", { name: "Research" }).click();
  await page.getByRole("tab", { name: "Conjoint" }).click();

  await expect(
    page.getByRole("heading", {
      name: "Estimate pooled part-worths from a choice-based conjoint",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Load synthetic study" }).click();

  await expect(page.getByRole("heading", { name: "Pooled MNL converged" })).toBeVisible();
  await expect(page.getByTestId("conjoint-part-worth-chart")).toBeVisible();
  await expect(page.getByTestId("conjoint-hit-rate")).toBeVisible();
  await expect(page.getByTestId("conjoint-bridge-disabled")).toHaveCount(0);

  await page.getByLabel("Feature for Speed").selectOption("workspace");
  await page.getByLabel("Reference level for Speed").selectOption("low");
  await page.getByLabel("Target level for Speed").selectOption("high");
  await page.getByRole("button", { name: "Apply pooled part-worths" }).click();

  await expect(
    page.getByText("Updated 1 feature share with pooled conjoint provenance."),
  ).toBeVisible();

  // The bridged cell's pooled provenance travels into the Decision Record's Markdown
  // export, which is where the per-feature provenance trace is expanded.
  await page.getByRole("tab", { name: "Share" }).click();
  await page.getByRole("button", { name: "Generate current record" }).click();
  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Markdown" }).click(),
  ]).then(([event]) => event);
  const markdown = await readDownload(download);
  expect(markdown).toMatch(
    /Shared workspaces.*conjoint, medium confidence — pooled conjoint \(N=\d+\)/,
  );

  await expectNoSeriousAxeViolations(page);
});

// E2E-04 (§6 P6b): mechanism view + A/B compare against the same buyers.
test("E2E-04: the mechanism view renders and A/B compare reports a real delta", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).first().click();

  await page.getByRole("tab", { name: "Simulate" }).click();
  await page.getByRole("tab", { name: "Mechanism" }).click();
  await expect(page.getByTestId("mechanism-chart")).toBeVisible();
  await page.getByRole("button", { name: "View mechanism as table" }).click();
  await expect(page.getByRole("table", { name: "Mechanism envelope table" })).toBeVisible();

  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await page.getByRole("button", { name: "Duplicate active" }).click();
  await page.getByRole("spinbutton", { name: "Team price", exact: true }).fill("18");

  await page.getByRole("tab", { name: "Simulate" }).click();
  await page.getByRole("tab", { name: "Compare designs" }).click();
  // signedMoney prefixes + or − only for a non-zero delta.
  await expect(page.getByTestId("compare-delta-mrr")).toHaveText(/[+−]/);
  await expectNoSeriousAxeViolations(page);
});

test("the conjoint bridge stays gated when the study cannot identify a price effect", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).first().click();
  await page.getByRole("tab", { name: "Analyze" }).click();
  await page.getByRole("tab", { name: "Research" }).click();
  await page.getByRole("tab", { name: "Conjoint" }).click();

  await page.getByRole("button", { name: "Generate task design" }).click();
  await page.getByRole("button", { name: "Load demo CSV" }).click();
  await page.getByRole("button", { name: "Analyze pasted responses" }).click();

  await expect(page.getByTestId("conjoint-bridge-disabled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply pooled part-worths" })).toBeDisabled();
  await expectNoSeriousAxeViolations(page);
});

// The following four flows are the automated evidence cited by docs/ACCESSIBILITY-AUDIT.md.
test("the skip link stays off-canvas until focused, then reveals and targets the workbench", async ({
  page,
  browserName,
}) => {
  await page.goto("/");
  const skip = page.getByRole("link", { name: "Skip to active workbench" });

  // Off-canvas until focused.
  const hidden = await skip.boundingBox();
  expect(hidden?.y ?? 0).toBeLessThan(0);

  // WebKit keeps links out of the sequential tab order unless macOS full keyboard access
  // is on, so the "first tab stop" claim is asserted where links are tabbable by default.
  if (browserName !== "webkit") {
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
  } else {
    await skip.focus();
  }

  const shown = await skip.boundingBox();
  expect(shown?.y ?? -1).toBeGreaterThanOrEqual(0);

  await expect(skip).toHaveAttribute("href", "#workbench-panel");
  await skip.press("Enter");
  await expect(page.locator("#workbench-panel")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("frequently used checkboxes meet a 24 x 24 CSS pixel pointer target", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).first().click();
  await page.getByRole("tab", { name: "Design", exact: true }).click();

  const checkboxes = page.getByRole("checkbox");
  const count = await checkboxes.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const box = await checkboxes.nth(index).boundingBox();
    expect(box, `checkbox ${index} has no box`).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
  }
});

test("the shell reflows to 320 CSS pixels without page-level horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).first().click();

  for (const tab of ["Model", "Design", "Simulate", "Analyze", "Share"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await waitForTransitionsToSettle(page);
    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow, `${tab} overflows horizontally at 320px`).toBeLessThanOrEqual(1);
  }
  await expectNoSeriousAxeViolations(page);
});

test("print media keeps the decision record and drops the non-document controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).first().click();
  await page.getByRole("tab", { name: "Share" }).click();
  await page.getByRole("button", { name: "Generate current record" }).click();
  await expect(page.getByTestId("decision-record-document")).toBeVisible();

  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("decision-record-document")).toBeVisible();
  await expect(page.locator(".no-print").first()).toBeHidden();
  await page.emulateMedia({ media: null });
});

// E2E-09 (§6 P7e): positioning surface — competitors, segment-scoped map, competitor-loss KPI.
test("E2E-09: the positioning surface adds competitors, renders the segment map, and reveals live competitor loss", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).first().click();

  // Baseline: no competitors, so the wind tunnel says so.
  await page.getByRole("tab", { name: "Simulate" }).click();
  await expect(page.getByText("No competitors active")).toBeVisible();

  await page.getByRole("tab", { name: "Analyze" }).click();
  await page.getByRole("tab", { name: "Positioning" }).click();
  await expect(
    page.getByRole("heading", { name: "Competitor alternatives and the segment-scoped map" }),
  ).toBeVisible();

  // Add three competitors and give the first one a dominant value/price so the
  // envelope engine sends real share to it.
  for (let index = 0; index < 3; index += 1) {
    await page.getByTestId("positioning-add-competitor").click();
  }
  await expect(page.getByTestId(/positioning-competitor-card-/)).toHaveCount(3);

  const firstCompetitor = page.getByTestId(/positioning-competitor-card-/).first();
  const firstNameInput = firstCompetitor.getByLabel(/name$/);
  const originalName = (await firstNameInput.inputValue()) || "New competitor";
  await firstCompetitor.getByLabel(`${originalName} price`, { exact: true }).fill("1");
  const perSegmentValueInputs = firstCompetitor.getByLabel(
    new RegExp(`^${originalName} value for `),
  );
  const valueInputCount = await perSegmentValueInputs.count();
  for (let index = 0; index < valueInputCount; index += 1) {
    await perSegmentValueInputs.nth(index).fill("10000");
  }

  // Verify the map renders with tier + competitor markers.
  await expect(page.getByTestId("positioning-chart")).toBeVisible();
  const competitorMarkerCount = await page.getByTestId(/positioning-competitor-marker-/).count();
  expect(competitorMarkerCount).toBeGreaterThan(0);
  await expect(page.getByTestId(/positioning-tier-marker-/).first()).toBeVisible();

  // Per-segment competitor share now reads real values.
  await expect(page.getByTestId(/positioning-share-/).first()).toBeVisible();

  // Simulate exposes the live competitor-loss share KPI.
  await page.getByRole("tab", { name: "Simulate" }).click();
  await expect(page.getByText("No competitors active")).toHaveCount(0);
  await expect(page.getByTestId("waterfall-value-Competitor loss").first()).toBeVisible();

  // Toggle a dark-theme render pass through the map + axe.
  await page.getByRole("tab", { name: "Analyze" }).click();
  await page.getByRole("tab", { name: "Positioning" }).click();
  await expect(page.getByTestId("positioning-chart")).toBeVisible();
  await page.getByRole("button", { name: /Switch to dark theme/i }).click();
  await expect(page.getByTestId("positioning-chart")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("the MaxDiff demo study scores items into normalized importance", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).first().click();
  await page.getByRole("tab", { name: "Analyze" }).click();
  await page.getByRole("tab", { name: "Research" }).click();
  await page.getByRole("tab", { name: "MaxDiff" }).click();

  await expect(
    page.getByRole("heading", { name: "Score item importance with a best-worst survey" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Generate task design" }).click();
  await page.getByRole("button", { name: "Load demo CSV" }).click();
  await page.getByRole("button", { name: "Analyze pasted responses" }).click();

  await expect(page.getByRole("heading", { name: "Normalized importance" })).toBeVisible();
  await expect(page.getByTestId("maxdiff-scores-chart")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});
