import { expect, test } from "@playwright/test";

test("Batch 2–5 surfaces connect Model, Design, Analyze, and Share", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).nth(2).click();

  await page.getByRole("button", { name: "Add interaction" }).click();
  await expect(page.getByText("Feature interactions")).toBeVisible();

  await page.getByRole("button", { name: "Add metric" }).click();
  await page.getByLabel("New usage metric metric name").fill("API calls");
  await page.getByLabel("Mid-market teams API calls P90").fill("400");
  await page.getByLabel("Mid-market teams API calls P50").fill("200");
  await page.getByLabel("Mid-market teams API calls P10").fill("100");
  await expect(page.getByText("API calls").first()).toBeVisible();

  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await page.getByRole("button", { name: "Add usage line" }).first().click();
  await page.getByLabel("Growth per unit price").fill("0.01");
  await page.getByLabel("Mid-market teams trial months").fill("1");

  await page.getByRole("tab", { name: "Analyze", exact: true }).click();
  await page.getByRole("tab", { name: "Price search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A local search for more revenue near this menu" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Usage", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Expected metered bill by segment" }),
  ).toBeVisible();
  await expect(page.getByText("Expected effective price")).toBeVisible();
  await page.getByRole("tab", { name: "Time", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Trials, conversion, and retention over time" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Positioning", exact: true }).click();
  await page.getByRole("button", { name: "Add competitor" }).click();
  await expect(page.getByText("Survey shortcut")).toBeVisible();

  await page.getByRole("tab", { name: "Share", exact: true }).click();
  await page.getByRole("tab", { name: "Decision support", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "From a changed assumption to a defensible consequence" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PNG" })).toBeVisible();
});
