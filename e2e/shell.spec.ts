import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const baseUrl = "http://127.0.0.1:4173";

async function expectNoSeriousAxeViolations(page: import("@playwright/test").Page) {
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

async function readDownload(download: import("@playwright/test").Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

test("the static shell is accessible, private, and theme-aware", async ({ page }) => {
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
  await page.getByLabel("Growing teams account-level WTP confidence band P50 (USD)").fill("250");
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

test("the Design workbench builds a three-tier menu from blank and clears its linter", async ({
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

  await expect(page.getByText("No deterministic issues are firing.")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("the wind tunnel re-sorts buyers, reconciles chart tables, and respects reduced motion", async ({
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

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator('[data-testid="buyer-dot"]').first()).toHaveCSS(
    "transition-duration",
    /(?:0\.01ms|1e-05s)/,
  );
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectNoSeriousAxeViolations(page);
});

test("each warmed template simulation renders within the 16ms P6a interaction budget", async ({
  page,
}) => {
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

test("uncertainty draws are seeded, paired, and rendered within the P7a budget", async ({
  page,
}) => {
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

test("Van Westendorp validates fielded input, interpolates the demo points, and preserves undefined crossings", async ({
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

test("the canonical bundling fixture reports bundle-beats-components without overclaiming", async ({
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
