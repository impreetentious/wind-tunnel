import {
  generateConjointDesign,
  type ConjointAlternative,
  type ConjointAttribute,
  type ConjointObservation,
  type ConjointStudy,
  type ConjointTask,
} from "./conjoint";
import { mulberry32 } from "./montecarlo";

export const recoveryAttributes: ConjointAttribute[] = [
  { id: "speed", name: "Speed", levels: ["low", "medium", "high"] },
  { id: "support", name: "Support", levels: ["self", "priority", "dedicated"] },
  { id: "security", name: "Security", levels: ["basic", "sso", "audit"] },
];

export const recoveryTrueBeta = [0.4, 0.1, 0.3, -0.2, -0.1, 0.25, -0.03, -0.5];

function encoded(alternative: ConjointAlternative): number[] {
  if (alternative.none) return [0, 0, 0, 0, 0, 0, 0, 1];
  const result: number[] = [];
  for (const attribute of recoveryAttributes) {
    const index = attribute.levels.indexOf(alternative.levels?.[attribute.id] ?? "");
    result.push(index === 0 ? 1 : index === 2 ? -1 : 0, index === 1 ? 1 : index === 2 ? -1 : 0);
  }
  result.push(alternative.price ?? 0, 0);
  return result;
}

function sampleChoice(task: ConjointTask, beta: readonly number[], random: () => number): string {
  const utilities = task.alternatives.map((alternative) =>
    encoded(alternative).reduce((sum, value, index) => sum + value * beta[index], 0),
  );
  const maximum = Math.max(...utilities);
  const weights = utilities.map((utility) => Math.exp(utility - maximum));
  const target = random() * weights.reduce((sum, value) => sum + value, 0);
  let cumulative = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cumulative += weights[index];
    if (target <= cumulative) return task.alternatives[index].id;
  }
  return task.alternatives.at(-1)?.id ?? "none";
}

/** Seeded 500-respondent fixture shared by recovery and performance gates. */
export function recoveryStudy(respondents = 500): ConjointStudy {
  const design = generateConjointDesign({
    attributes: recoveryAttributes,
    taskCount: 18,
    alternativesPerTask: 3,
    priceLevels: [10, 30, 50],
    includeNone: true,
    seed: 1708,
  });
  const random = mulberry32(987654321);
  const observations: ConjointObservation[] = [];
  for (let respondent = 0; respondent < respondents; respondent += 1) {
    for (const task of design.tasks) {
      observations.push({
        respondentId: `r${respondent}`,
        taskId: task.id,
        chosenAlternativeId: sampleChoice(task, recoveryTrueBeta, random),
      });
    }
  }
  return {
    attributes: recoveryAttributes,
    tasks: design.tasks,
    observations,
    numericPrice: true,
  };
}
