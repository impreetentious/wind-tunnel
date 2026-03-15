import { expect, it } from "vitest";
import { recoveryStudy } from "./conjoint-fixtures";
import { estimateConjoint } from "./conjoint";
import { measure } from "./perf-profile";

// @spec §4.10.1 — run by `npm run perf:conjoint` in an isolated process so
// unrelated unit workers cannot turn scheduler contention into a false engine regression.
it("fits the canonical 500-respondent conjoint study below 100 ms p95", () => {
  const study = recoveryStudy();
  expect(estimateConjoint(study).status).toBe("ok");
  const profile = measure("conjoint-mnl-500", 10, () => {
    estimateConjoint(study);
  });
  expect(profile.p95Ms).toBeLessThan(100);
});
