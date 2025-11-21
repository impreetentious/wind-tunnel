import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBlankScenario, scenarioStore } from "@/lib/state/scenario-store";
import { StudioShell } from "./studio-shell";

beforeEach(() => {
  scenarioStore.getState().replaceScenario(createBlankScenario());
  scenarioStore.temporal.getState().clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.documentElement.dataset.theme = "light";
});

describe("StudioShell", () => {
  it("renders an accessible shell and switches themes", () => {
    render(<StudioShell version="0.1.0" />);

    expect(screen.getByRole("tab", { name: "Model", selected: true })).toBeVisible();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByText("Wind Tunnel v0.1.0")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
  });

  it("changes the active workbench section", () => {
    render(<StudioShell version="0.1.0" />);

    fireEvent.click(screen.getByRole("tab", { name: "Simulate" }));

    expect(screen.getByRole("tab", { name: "Simulate", selected: true })).toBeVisible();
    expect(screen.getByText("Watch assumptions become outcomes.")).toBeVisible();
  });

  it("loads a template, updates live KPIs, and supports matrix arrow navigation", () => {
    render(<StudioShell version="0.5.0" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Use this template" })[0]);
    expect(screen.getByRole("heading", { name: "Make the assumptions visible" })).toBeVisible();

    const potentialLabel = screen.getByText("Potential value");
    const before = potentialLabel.nextElementSibling?.textContent;
    fireEvent.change(
      screen.getByLabelText("Growing teams account-level WTP confidence band P50 (USD)"),
      { target: { value: "250" } },
    );
    expect(potentialLabel.nextElementSibling).not.toHaveTextContent(before ?? "");

    const firstCell = screen.getByLabelText("Shared workspaces value for Growing teams");
    firstCell.focus();
    fireEvent.keyDown(firstCell, { key: "ArrowRight" });
    expect(
      screen.getByLabelText("Shared workspaces value for Scaling organisations"),
    ).toHaveFocus();
  });

  it("keeps model confidence bands P50-centred with inline validation", () => {
    render(<StudioShell version="0.5.0" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Use this template" })[0]);
    const p10 = screen.getByLabelText("Growing teams account-level WTP confidence band P10 (USD)");
    fireEvent.change(p10, { target: { value: "26" } });
    expect(screen.getByText("P10 cannot be greater than P50 (or P90).")).toBeVisible();

    fireEvent.change(p10, { target: { value: "25" } });
    expect(p10).toHaveValue(25);
    expect(
      screen.getByLabelText("Growing teams account-level WTP confidence band P90 (USD)"),
    ).toHaveValue(25);
  });

  it("edits an active design and keeps an alternative in the scenario", () => {
    render(<StudioShell version="0.6.0" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Use this template" })[0]);
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));

    expect(screen.getByRole("heading", { name: "Turn value into tiers and fences" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate active" }));
    fireEvent.change(screen.getByLabelText("Active design name"), {
      target: { value: "Price test" },
    });
    fireEvent.change(screen.getByLabelText("Team price"), { target: { value: "18" } });

    expect(screen.getByLabelText("Active design name")).toHaveValue("Price test");
    expect(screen.getByLabelText("Team price")).toHaveValue(18);
    expect(screen.getByRole("list", { name: "Scenario designs" })).toHaveTextContent("Price test");
  });

  it("surfaces validation errors while importing a complete scenario", () => {
    render(<StudioShell version="0.4.0" />);

    fireEvent.click(screen.getByRole("tab", { name: "Share" }));
    fireEvent.change(screen.getByLabelText("Import complete scenario JSON"), {
      target: { value: "{broken" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import JSON" }));

    expect(screen.getByRole("alert")).toHaveTextContent("This is not valid scenario JSON.");
  });
});
