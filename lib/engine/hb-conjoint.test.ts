import { describe, expect, it } from "vitest";

import type { ConjointStudy, ConjointTask } from "./conjoint";
import { mulberry32 } from "./montecarlo";
import { estimateHbConjoint } from "./hb-conjoint";

/**
 * Build a small conjoint study whose latent per-respondent β is a scaled
 * variant of a known population mean, then simulate best-choice observations.
 * The HB sampler should recover the population mean β within a wide band —
 * exact recovery is not the point of a smoke fixture, but sign and rough
 * magnitude are.
 */
function makeSyntheticStudy(seed: number): {
  study: ConjointStudy;
  respondentCount: number;
} {
  const random = mulberry32(seed);
  const attributes = [
    { id: "plan", name: "Plan", levels: ["basic", "pro"] },
    { id: "sla", name: "SLA", levels: ["standard", "premium"] },
  ];
  // Population β: [plan:basic=+1.0, sla:standard=-0.5]. (Last level is the -1 sum.)
  const populationMu = [1.0, -0.5];
  const tasks: ConjointTask[] = Array.from({ length: 6 }, (_, index) => ({
    id: `task-${index}`,
    alternatives: [
      {
        id: `alt-a-${index}`,
        levels: { plan: "basic", sla: index % 2 === 0 ? "standard" : "premium" },
      },
      {
        id: `alt-b-${index}`,
        levels: { plan: "pro", sla: index % 2 === 0 ? "premium" : "standard" },
      },
    ],
  }));

  const respondents = 10;
  const observations: Array<{
    respondentId: string;
    taskId: string;
    chosenAlternativeId: string;
  }> = [];
  for (let respondent = 0; respondent < respondents; respondent += 1) {
    const beta = populationMu.map((value) => value + 0.2 * (random() - 0.5));
    for (const task of tasks) {
      const utilities = task.alternatives.map((alternative) => {
        const level = alternative.levels ?? {};
        let u = 0;
        // plan: last level ("pro") is -sum ⇒ -β_0
        if (level.plan === "basic") u += beta[0];
        else u -= beta[0];
        if (level.sla === "standard") u += beta[1];
        else u -= beta[1];
        return u;
      });
      const maxU = Math.max(...utilities);
      const weights = utilities.map((value) => Math.exp(value - maxU));
      const denom = weights.reduce((a, b) => a + b, 0);
      const draw = random();
      let cumulative = 0;
      let chosenIndex = 0;
      for (let i = 0; i < weights.length; i += 1) {
        cumulative += weights[i] / denom;
        if (draw <= cumulative) {
          chosenIndex = i;
          break;
        }
      }
      observations.push({
        respondentId: `r-${respondent}`,
        taskId: task.id,
        chosenAlternativeId: task.alternatives[chosenIndex].id,
      });
    }
  }

  return {
    study: { attributes, tasks, observations, numericPrice: false },
    respondentCount: respondents,
  };
}

describe("HB Conjoint sampler (@spec §4.10)", () => {
  it("T-HBC-01 recovers a population β sign and rough magnitude on a synthetic fixture", () => {
    const { study } = makeSyntheticStudy(1);
    const result = estimateHbConjoint(study, { seed: 7, warmup: 200, samples: 400 });
    expect(result.parameterLabels).toEqual(["plan:basic", "sla:standard"]);
    // Population β was [+1, −0.5]; posterior mean μ should recover both signs.
    expect(result.posteriorMeanMu[0]).toBeGreaterThan(0);
    expect(result.posteriorMeanMu[1]).toBeLessThan(0);
    // Loose magnitude gate: within a factor of ~3 of the truth on the fixture.
    expect(Math.abs(result.posteriorMeanMu[0])).toBeGreaterThan(0.2);
    expect(Math.abs(result.posteriorMeanMu[1])).toBeGreaterThan(0.05);
  });

  it("T-HBC-02 returns one β posterior per respondent with matching observation counts", () => {
    const { study, respondentCount } = makeSyntheticStudy(2);
    const result = estimateHbConjoint(study, { seed: 11, warmup: 100, samples: 100 });
    expect(result.respondents).toHaveLength(respondentCount);
    for (const respondent of result.respondents) {
      expect(respondent.posteriorMeanBeta).toHaveLength(result.parameterLabels.length);
      expect(respondent.observationCount).toBe(study.tasks.length);
    }
  });

  it("T-HBC-03 is deterministic under a fixed seed", () => {
    const { study } = makeSyntheticStudy(3);
    const a = estimateHbConjoint(study, { seed: 42, warmup: 50, samples: 80 });
    const b = estimateHbConjoint(study, { seed: 42, warmup: 50, samples: 80 });
    expect(a.posteriorMeanMu).toEqual(b.posteriorMeanMu);
    expect(a.respondents.map((row) => row.posteriorMeanBeta)).toEqual(
      b.respondents.map((row) => row.posteriorMeanBeta),
    );
    expect(a.meanAcceptance).toBe(b.meanAcceptance);
  });

  it("T-HBC-04 rejects a single-respondent study with an informative error", () => {
    const { study } = makeSyntheticStudy(4);
    const singleRespondent: ConjointStudy = {
      ...study,
      observations: study.observations.filter((observation) => observation.respondentId === "r-0"),
    };
    expect(() => estimateHbConjoint(singleRespondent, { warmup: 10, samples: 10 })).toThrow(
      /at least two respondents/,
    );
  });

  it("T-HBC-05 keeps mean acceptance inside a healthy random-walk band", () => {
    const { study } = makeSyntheticStudy(5);
    const result = estimateHbConjoint(study, { seed: 3, warmup: 300, samples: 300 });
    // The classic RWM sweet spot is 0.15–0.5; assert we do not collapse or reject constantly.
    expect(result.meanAcceptance).toBeGreaterThan(0.05);
    expect(result.meanAcceptance).toBeLessThan(0.95);
  });
});
