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

  await page.getByRole("tab", { name: "Design" }).click();
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

  await page.getByRole("tab", { name: "Design" }).click();
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
    await page.getByRole("tab", { name: "Design" }).click();

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
