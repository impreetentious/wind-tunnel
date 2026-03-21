import { expect, it } from "vitest";
import { recoveryStudy } from "./conjoint-fixtures";
import { estimateConjoint } from "./conjoint";
import { measure } from "./perf-profile";

// @spec §4.10.1 — run by `npm run perf:conjoint` in an isolated process so
// unrelated unit workers cannot turn scheduler contention into a false engine regression.
//
// Baseline: 72.6 ms p95 over 10 fits, measured on an idle developer machine
// (median 65.1 ms, worst 72.6 ms). The bound is set at ~3.4x that rather than
// hugging it, because this now runs on shared CI runners that are routinely
// several times slower than a local machine — a bound at 100 ms would have made
// the gate report runner jitter as an engine regression. At 250 ms it still
// catches the order-of-magnitude slowdown that an accidental O(n^2) or a lost
// memoization would produce, which is what this gate is for. Re-measure and
// re-derive this number rather than nudging it upward when it trips.
it("fits the canonical 500-respondent conjoint study below 250 ms p95", () => {
  const study = recoveryStudy();
  expect(estimateConjoint(study).status).toBe("ok");
  const profile = measure("conjoint-mnl-500", 10, () => {
    estimateConjoint(study);
  });
  expect(profile.p95Ms).toBeLessThan(250);
});
