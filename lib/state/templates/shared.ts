import type { Scenario } from "../schemas";

export const guess = { kind: "guess", confidence: "low" } as const;

export function scenarioBase(
  scenario: Omit<Scenario, "schemaVersion" | "research" | "settings"> &
    Partial<Pick<Scenario, "research" | "settings">>,
): Scenario {
  return {
    schemaVersion: 1,
    research: {},
    settings: { seed: 240715, currency: "USD", theme: "system", locale: "en-US" },
    ...scenario,
  };
}
