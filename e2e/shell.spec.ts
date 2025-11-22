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
