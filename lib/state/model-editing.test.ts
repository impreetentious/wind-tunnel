import { describe, expect, it } from "vitest";

import { editAllocationShare, editDirectFeatureValue, editP50CenteredBand } from "./model-editing";
import { plgCollaborationTemplate } from "./templates";

describe("P50-centred model editing", () => {
  it("mirrors confidence-band endpoints and accepts a deterministic band", () => {
    const band = { p10: 20, p50: 25, p90: 31.25 };

    const lower = editP50CenteredBand(band, "p10", 10);
    expect(lower).toEqual({ ok: true, value: { p10: 10, p50: 25, p90: 62.5 } });

    const median = editP50CenteredBand(band, "p50", 40);
    expect(median.ok).toBe(true);
    if (median.ok) {
      expect(median.value.p10 * median.value.p90).toBeCloseTo(40 * 40, 10);
    }

    const deterministic = editP50CenteredBand({ p10: 25, p50: 25, p90: 25 }, "p50", 60);
    expect(deterministic).toEqual({ ok: true, value: { p10: 60, p50: 60, p90: 60 } });
  });

  it("rejects nonpositive and unordered band values without changing persisted data", () => {
    const band = { p10: 20, p50: 25, p90: 31.25 };
    expect(editP50CenteredBand(band, "p50", 0)).toEqual({
      ok: false,
      error: "Enter a positive number.",
    });
    expect(editP50CenteredBand(band, "p10", 26)).toEqual({
      ok: false,
      error: "P10 cannot be greater than P50 (or P90).",
    });
  });

  it("keeps allocations conserved and lets direct values redefine total WTP", () => {
    const allocation = editAllocationShare(plgCollaborationTemplate, "team", "workspace", 50);
    expect(allocation.ok).toBe(true);
    if (allocation.ok) {
      const segment = allocation.value.model.segments[0];
      expect(Object.values(segment.featureAllocation).reduce((sum, value) => sum + value, 0)).toBe(
        1,
      );
      expect(segment.featureAllocation.workspace).toBe(0.5);
    }

    const direct = editDirectFeatureValue(plgCollaborationTemplate, "team", "workspace", 20);
    expect(direct.ok).toBe(true);
    if (direct.ok) {
      const segment = direct.value.model.segments[0];
      expect(segment.wtpBand.p50).toBe(215);
      expect(Object.values(segment.featureAllocation).reduce((sum, value) => sum + value, 0)).toBe(
        1,
      );
    }
  });
});
