import { describe, expect, it } from "vitest";

import { scenarioTemplates } from "./templates";
import {
  createIllustrativeVanWestendorpStudy,
  parseVanWestendorpCsv,
  scenarioWithVanWestendorpStudy,
  VAN_WESTENDORP_DEMO_CSV,
  vanWestendorpCsv,
} from "./vanwest";

describe("Van Westendorp scenario records", () => {
  // @spec §4.7
  it("parses the documented CSV shape and reports row-specific input errors", () => {
    const parsed = parseVanWestendorpCsv(`${VAN_WESTENDORP_DEMO_CSV}\n10,not-a-price,40,60`);

    expect(parsed.responses).toHaveLength(5);
    expect(parsed.errors).toEqual([
      { line: 7, message: "Every price must be a non-negative number." },
    ]);
    expect(vanWestendorpCsv(parsed.responses)).toBe(VAN_WESTENDORP_DEMO_CSV);
  });

  // @spec §4.7
  it("keeps illustrative records explicit and separate from fielded survey data", () => {
    const scenario = scenarioTemplates[0].scenario;
    const illustrative = createIllustrativeVanWestendorpStudy(scenario);
    const updated = scenarioWithVanWestendorpStudy(scenario, illustrative);

    expect(illustrative.source).toBe("illustrative");
    expect(illustrative.responses).toHaveLength(scenario.model.segments.length * 4);
    expect(updated.research.vanWestendorp).toEqual(illustrative);
  });

  it("removes the research key instead of retaining an undefined artifact", () => {
    const scenario = scenarioTemplates[0].scenario;
    const illustrative = createIllustrativeVanWestendorpStudy(scenario);
    const attached = scenarioWithVanWestendorpStudy(scenario, illustrative);
    const removed = scenarioWithVanWestendorpStudy(attached, undefined);

    expect(Object.keys(removed.research)).not.toContain("vanWestendorp");
  });
});
