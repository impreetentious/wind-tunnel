import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const baseUrl = "http://127.0.0.1:4173";

test("the static shell is accessible, private, and theme-aware", async ({ page }) => {
  const unexpectedRequests: string[] = [];

  page.on("request", (request) => {
    if (new URL(request.url()).origin !== baseUrl) {
      unexpectedRequests.push(request.url());
    }
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Describe the buyers before you price them." }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const accessibility = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = accessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );

  expect(seriousOrCritical).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
});
