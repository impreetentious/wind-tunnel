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
