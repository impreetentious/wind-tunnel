import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StudioShell } from "./studio-shell";

afterEach(() => {
  cleanup();
  document.documentElement.dataset.theme = "light";
});

describe("StudioShell", () => {
  it("renders an accessible shell and switches themes", () => {
    render(<StudioShell version="0.1.0" />);

    expect(screen.getByRole("tab", { name: "Model", selected: true })).toBeVisible();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
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
});
