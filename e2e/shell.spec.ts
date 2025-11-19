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
