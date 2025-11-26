import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { activeDesign } from "@/lib/state/design-editing";
import { simulateScenarioDesign } from "@/lib/state/scenario-economics";
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
    expect(screen.getByText("Give buyers something to choose.")).toBeVisible();
  });

  it("implements roving keyboard focus across studio and nested tabs", () => {
    render(<StudioShell version="1.0.0" />);

    const model = screen.getByRole("tab", { name: "Model" });
    model.focus();
    fireEvent.keyDown(model, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Design", selected: true })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Design" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "Share", selected: true })).toHaveFocus();
    const record = screen.getByRole("tab", { name: "Decision Record" });
    record.focus();
    fireEvent.keyDown(record, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Pricing page", selected: true })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Pricing page" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "Scenario transfer", selected: true })).toHaveFocus();
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

  it("reveals live buyer sorting and matching chart tables after a price change", () => {
    render(<StudioShell version="0.7.0" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Use this template" })[2]);
    fireEvent.click(screen.getByRole("tab", { name: "Simulate" }));

    expect(
      screen.getByRole("heading", { name: "Reveal the menu's economic consequences" }),
    ).toBeVisible();
    const liveKpis = screen.getByLabelText("Live simulation KPIs");
    const mrr = within(liveKpis).getByText("MRR").nextElementSibling;
    const beforeMrr = mrr?.textContent;
    const dotLayout = screen
      .getAllByTestId("buyer-dot")
      .map((dot) => `${dot.getAttribute("cx")}:${dot.getAttribute("cy")}`)
      .join("|");
    const beforeChoiceShare = document.querySelector(
      '[data-testid^="buyer-selection-share-"]',
    )?.textContent;
    const revenue = screen.getByTestId("waterfall-value-Revenue").textContent;

    fireEvent.click(screen.getByRole("button", { name: "View buyer selection as table" }));
    expect(screen.getByRole("table", { name: "Buyer selection table" })).toHaveTextContent(
      beforeChoiceShare ?? "",
    );
    fireEvent.click(screen.getByRole("button", { name: "Show buyer selection chart" }));
    fireEvent.click(screen.getByRole("button", { name: "View value waterfall as table" }));
    expect(screen.getByRole("table", { name: "Value waterfall table" })).toHaveTextContent(
      revenue ?? "",
    );
    fireEvent.click(screen.getByRole("button", { name: "Show value waterfall chart" }));

    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    fireEvent.change(screen.getByLabelText("Enterprise price"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("tab", { name: "Simulate" }));

    expect(
      within(screen.getByLabelText("Live simulation KPIs")).getByText("MRR").nextElementSibling,
    ).not.toHaveTextContent(beforeMrr ?? "");
    expect(
      screen
        .getAllByTestId("buyer-dot")
        .map((dot) => `${dot.getAttribute("cx")}:${dot.getAttribute("cy")}`)
        .join("|"),
    ).not.toBe(dotLayout);
  });

  it("renders exact envelope breakpoints in the mechanism view", () => {
    render(<StudioShell version="1.1.0" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Use this template" })[2]);
    const scenario = scenarioStore.getState().scenario;
    const result = simulateScenarioDesign(scenario, activeDesign(scenario));
    const breakpoint = result?.segments[0].selection.active
      .map((interval) => interval.lower)
      .find((value) => Number.isFinite(value) && value > 0);
    expect(breakpoint).toBeDefined();

    fireEvent.click(screen.getByRole("tab", { name: "Simulate" }));
    fireEvent.click(screen.getByRole("tab", { name: "Mechanism" }));
    expect(screen.getByTestId("mechanism-chart")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "View mechanism as table" }));
    expect(screen.getByRole("table", { name: "Mechanism envelope table" })).toHaveTextContent(
      breakpoint?.toFixed(6) ?? "",
    );
  });

  it("compares design deltas and promotes a challenger", () => {
    render(<StudioShell version="1.1.0" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Use this template" })[1]);
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate active" }));
    fireEvent.change(screen.getByLabelText("Active design name"), {
      target: { value: "Lower scale price" },
    });
    fireEvent.change(screen.getByLabelText("Scale price"), { target: { value: "149" } });
    const copiedDesignId = scenarioStore.getState().scenario.activeDesignId;

    fireEvent.click(screen.getByRole("tab", { name: "Simulate" }));
    fireEvent.click(screen.getByRole("tab", { name: "Compare designs" }));
    expect(screen.getByRole("table", { name: "Design KPI comparison" })).toBeVisible();
    expect(screen.getByTestId("compare-delta-mrr")).not.toHaveTextContent("$0.0");
    fireEvent.click(screen.getByRole("button", { name: "Promote Baseline packaging to active" }));
    expect(scenarioStore.getState().scenario.activeDesignId).not.toBe(copiedDesignId);
  });

  it("runs deterministic uncertainty draws and exposes a tornado table", () => {
    render(<StudioShell version="0.8.0" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Use this template" })[2]);
    fireEvent.click(screen.getByRole("tab", { name: "Analyze" }));

    expect(
      screen.getByRole("heading", { name: "Stress-test the assumptions behind this menu" }),
    ).toBeVisible();
    expect(screen.getByTestId("tornado-chart")).toBeVisible();
    const seed = screen.getByLabelText("Simulation seed");

    fireEvent.change(seed, { target: { value: "42" } });
    const seededP50 = screen.getByTestId("monte-carlo-p50").textContent;
    fireEvent.change(seed, { target: { value: "42" } });
    expect(screen.getByTestId("monte-carlo-p50")).toHaveTextContent(seededP50 ?? "");
    fireEvent.change(seed, { target: { value: "43" } });
    expect(screen.getByTestId("monte-carlo-p50")).not.toHaveTextContent(seededP50 ?? "");

    fireEvent.click(screen.getByRole("button", { name: "View tornado as table" }));
    expect(screen.getByRole("table", { name: "Tornado sensitivity table" })).toBeVisible();
  });

  it("analyzes Van Westendorp survey input, exposes exclusions, and never invents degenerate crossings", () => {
    render(<StudioShell version="0.8.4" />);

    fireEvent.click(screen.getByRole("tab", { name: "Analyze" }));
    fireEvent.click(screen.getByRole("tab", { name: "Research" }));
    expect(
      screen.getByRole("heading", { name: "Measure price perception with fielded responses" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Load demo CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Analyze pasted responses" }));
    const pmc = screen.getByRole("heading", {
      name: "Point of marginal cheapness (PMC)",
    }).parentElement;
    expect(pmc).toHaveTextContent("$27.5");

    fireEvent.change(screen.getByLabelText("Van Westendorp survey CSV"), {
      target: {
        value: "too cheap,cheap,expensive,too expensive\n10,20,40,60\n20,15,45,65",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze pasted responses" }));
    expect(screen.getByText("1 excluded")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Van Westendorp survey CSV"), {
      target: {
        value: "too cheap,cheap,expensive,too expensive\n10,10,10,10\n10,10,10,10",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze pasted responses" }));
    expect(
      screen.getByRole("heading", { name: "Point of marginal cheapness (PMC)" }).parentElement,
    ).toHaveTextContent("Undefined for this data");
  });

  it("reproduces the canonical bundling verdict through the Research workbench", () => {
    render(<StudioShell version="1.1.0" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Use this template" })[1]);
    fireEvent.click(screen.getByRole("tab", { name: "Analyze" }));
    fireEvent.click(screen.getByRole("tab", { name: "Research" }));
    fireEvent.click(screen.getByRole("tab", { name: "Bundling" }));
    expect(
      screen.getByRole("heading", { name: "Compare separate, bundled, and mixed offers" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Show canonical teaching fixture" }));
    expect(
      screen.getByRole("heading", { name: "Pure bundle leads on the searched prices" }),
    ).toBeVisible();
    expect(screen.getByTestId("bundling-verdict")).toHaveTextContent("$20.0 modeled revenue");
    expect(screen.getByTestId("bundling-verdict")).toHaveTextContent("$2.0 above pure components");
  });

  it("surfaces validation errors while importing a complete scenario", () => {
    render(<StudioShell version="0.4.0" />);

    fireEvent.click(screen.getByRole("tab", { name: "Share" }));
    fireEvent.click(screen.getByRole("tab", { name: "Scenario transfer" }));
    fireEvent.change(screen.getByLabelText("Import complete scenario JSON"), {
      target: { value: "{broken" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import JSON" }));

    expect(screen.getByRole("alert")).toHaveTextContent("This is not valid scenario JSON.");
  });

  it("generates a traceable Pricing Decision Record from the current scenario", () => {
    render(<StudioShell version="0.9.0" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Use this template" })[0]);
    fireEvent.click(screen.getByRole("tab", { name: "Share" }));
    expect(screen.getByRole("tab", { name: "Decision Record", selected: true })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Generate current record" }));

    const record = screen.getByTestId("decision-record-document");
    expect(within(record).getByRole("heading", { name: "PLG collaboration tool" })).toBeVisible();
    expect(within(record).getByText("Assumptions and provenance")).toBeVisible();
    expect(within(record).getByText("Validation priorities")).toBeVisible();
    expect(within(record).getByText("Alternatives considered")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download Markdown" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Print / Save PDF" })).toBeVisible();
  });

  it("renders the active design as a theme-aware pricing-page mock", () => {
    render(<StudioShell version="1.1.0" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Use this template" })[1]);
    fireEvent.click(screen.getByRole("tab", { name: "Share" }));
    fireEvent.click(screen.getByRole("tab", { name: "Pricing page" }));

    const mock = screen.getByTestId("pricing-page-mock");
    expect(within(mock).getByText("Build")).toBeVisible();
    expect(within(mock).getByText("Scale")).toBeVisible();
    expect(within(mock).getAllByText("API request capacity")).toHaveLength(2);
    expect(within(mock).getByText("Extended observability")).toBeVisible();
  });
});
