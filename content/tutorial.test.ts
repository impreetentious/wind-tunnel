import { describe, expect, it } from "vitest";
import {
  advanceTutorial,
  currentTutorialStep,
  INITIAL_TUTORIAL_STATE,
  restartTutorial,
  TUTORIAL_STEPS,
} from "./tutorial";

describe("in-app tutorial (M-13)", () => {
  it("returns null when inactive", () => {
    expect(currentTutorialStep(INITIAL_TUTORIAL_STATE)).toBeNull();
  });

  it("advances through every step then deactivates", () => {
    let state = restartTutorial();
    for (let index = 0; index < TUTORIAL_STEPS.length; index += 1) {
      const step = currentTutorialStep(state);
      expect(step).toBeDefined();
      expect(step?.id).toBe(TUTORIAL_STEPS[index].id);
      state = advanceTutorial(state);
    }
    expect(state.active).toBe(false);
    expect(currentTutorialStep(state)).toBeNull();
  });

  it("clamps an out-of-range step index rather than throwing", () => {
    const step = currentTutorialStep({ active: true, stepIndex: 9_999 });
    expect(step?.id).toBe(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1].id);
  });

  it("carries a stable step id for every entry (no duplicates)", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(TUTORIAL_STEPS.length);
  });
});
