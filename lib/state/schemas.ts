import { z } from "zod";

/** The persisted-data format. Increment only alongside an explicit migration. */
export const SCHEMA_VERSION = 1;

export const MAX_SCENARIO_BYTES = 2 * 1024 * 1024;
export const MAX_SHARE_HASH_CHARS = 8 * 1024;
export const MAX_SHARE_DECOMPRESSED_BYTES = 64 * 1024;

const identifierSchema = z.string().trim().min(1).max(80);
const labelSchema = z.string().trim().min(1).max(120);
const nonNegativeNumber = z.number().finite().min(0);
const positiveNumber = z.number().finite().positive();

export const quantileBandSchema = z
  .strictObject({
    p10: positiveNumber,
    p50: positiveNumber,
    p90: positiveNumber,
  })
  .superRefine((band, context) => {
    if (band.p10 > band.p50 || band.p50 > band.p90) {
      context.addIssue({
        code: "custom",
        message: "A confidence band must be ordered P10 ≤ P50 ≤ P90.",
      });
    }

    const expectedMedian = Math.sqrt(band.p10 * band.p90);
    const scale = Math.max(1, expectedMedian, band.p50);
    if (Math.abs(expectedMedian - band.p50) > scale * 1e-10) {
      context.addIssue({
        code: "custom",
        message: "P50 must be the geometric midpoint of P10 and P90.",
      });
    }
  });

export const provenanceSchema = z
  .strictObject({
    kind: z.enum(["guess", "interview", "survey", "conjoint", "benchmark"]),
    confidence: z.enum(["low", "medium", "high"]),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((provenance, context) => {
    if (provenance.kind === "benchmark" && !provenance.note) {
      context.addIssue({
        code: "custom",
        message: "A benchmark assumption needs a source note.",
        path: ["note"],
      });
    }
  });

export const featureSchema = z.strictObject({
  id: identifierSchema,
  name: labelSchema,
});

/**
 * A non-additive value adjustment for one unordered feature pair (§4.1.1).
 * `valueFraction` is expressed as a fraction of the segment's full-catalog P50
 * WTP so it scales per segment exactly like the additive allocation shares:
 * positive is a complement, negative a substitute. Bounded to ±100% of WTP.
 */
export const featureInteractionSchema = z.strictObject({
  featureIds: z.tuple([identifierSchema, identifierSchema]),
  valueFraction: z.number().finite().min(-1).max(1),
  note: z.string().trim().max(200).optional(),
});

export const segmentSchema = z.strictObject({
  id: identifierSchema,
  name: labelSchema,
  prospectBand: quantileBandSchema,
  seatCount: z.number().int().min(1),
  wtpBand: quantileBandSchema,
  withinSegmentSigma: nonNegativeNumber.max(2),
  featureAllocation: z.record(identifierSchema, nonNegativeNumber),
  provenance: z.strictObject({
    prospectCount: provenanceSchema,
    willingnessToPay: provenanceSchema,
    featureValues: z.record(identifierSchema, provenanceSchema),
  }),
});

const priceMetricSchema = z.enum(["flat", "per-seat"]);

export const tierSchema = z.strictObject({
  id: identifierSchema,
  name: labelSchema,
  price: nonNegativeNumber,
  priceMetric: priceMetricSchema,
  featureIds: z.array(identifierSchema).max(12),
});

export const addOnSchema = z.strictObject({
  id: identifierSchema,
  name: labelSchema,
  price: nonNegativeNumber,
  priceMetric: priceMetricSchema,
  featureIds: z.array(identifierSchema).min(1).max(12),
});

export const designSchema = z.strictObject({
  id: identifierSchema,
  name: labelSchema,
  tiers: z.array(tierSchema).max(5),
  addOns: z.array(addOnSchema).max(3),
});

export const competitorSchema = z.strictObject({
  id: identifierSchema,
  name: labelSchema,
  price: nonNegativeNumber,
  priceMetric: priceMetricSchema,
  valueBySegment: z.record(identifierSchema, nonNegativeNumber),
});

const researchPrice = z.number().finite().min(0);

/** Durable PSM records retain both valid and monotonicity-violating rows. */
export const vanWestendorpResponseSchema = z.strictObject({
  tooCheap: researchPrice,
  cheap: researchPrice,
  expensive: researchPrice,
  tooExpensive: researchPrice,
});

export const vanWestendorpStudySchema = z.strictObject({
  source: z.enum(["survey", "illustrative"]),
  responses: z.array(vanWestendorpResponseSchema).max(1_000),
});

/** Durable Conjoint records persist the full study needed to re-run the pooled MNL estimator. */
export const conjointAttributeSchema = z.strictObject({
  id: identifierSchema,
  name: labelSchema,
  levels: z.array(labelSchema).min(2).max(4),
});

export const conjointAlternativeSchema = z.strictObject({
  id: identifierSchema,
  levels: z.record(identifierSchema, labelSchema).optional(),
  price: z.number().finite().min(0).optional(),
  none: z.literal(true).optional(),
});

export const conjointTaskSchema = z.strictObject({
  id: identifierSchema,
  alternatives: z.array(conjointAlternativeSchema).min(2).max(5),
});

export const conjointObservationSchema = z.strictObject({
  respondentId: identifierSchema,
  taskId: identifierSchema,
  chosenAlternativeId: identifierSchema,
});

export const conjointStudySchema = z
  .strictObject({
    attributes: z.array(conjointAttributeSchema).min(1).max(5),
    tasks: z.array(conjointTaskSchema).min(1).max(30),
    observations: z.array(conjointObservationSchema).max(50_000),
    numericPrice: z.boolean(),
  })
  .superRefine((study, context) => {
    uniqueIds(study.attributes, "Conjoint attribute", context, ["attributes"]);
    uniqueIds(study.tasks, "Conjoint task", context, ["tasks"]);
    const levelsByAttribute = new Map(
      study.attributes.map((attribute) => [attribute.id, new Set(attribute.levels)]),
    );
    const alternativesByTask = new Map<string, Set<string>>();
    study.tasks.forEach((task, taskIndex) => {
      uniqueIds(task.alternatives, "Conjoint alternative", context, [
        "tasks",
        taskIndex,
        "alternatives",
      ]);
      alternativesByTask.set(task.id, new Set(task.alternatives.map((entry) => entry.id)));
      task.alternatives.forEach((alternative, alternativeIndex) => {
        if (alternative.none) return;
        for (const attribute of study.attributes) {
          const level = alternative.levels?.[attribute.id];
          if (level === undefined || !levelsByAttribute.get(attribute.id)?.has(level)) {
            context.addIssue({
              code: "custom",
              message: `Concept “${alternative.id}” needs a valid level for attribute “${attribute.id}”.`,
              path: ["tasks", taskIndex, "alternatives", alternativeIndex, "levels"],
            });
          }
        }
        if (study.numericPrice && alternative.price === undefined) {
          context.addIssue({
            code: "custom",
            message: `Concept “${alternative.id}” needs a numeric price in a numeric-price study.`,
            path: ["tasks", taskIndex, "alternatives", alternativeIndex, "price"],
          });
        }
      });
    });
    study.observations.forEach((observation, observationIndex) => {
      const alternatives = alternativesByTask.get(observation.taskId);
      if (!alternatives) {
        context.addIssue({
          code: "custom",
          message: `Observation references unknown task “${observation.taskId}”.`,
          path: ["observations", observationIndex, "taskId"],
        });
        return;
      }
      if (!alternatives.has(observation.chosenAlternativeId)) {
        context.addIssue({
          code: "custom",
          message: `Observation chooses an alternative that task “${observation.taskId}” does not show.`,
          path: ["observations", observationIndex, "chosenAlternativeId"],
        });
      }
    });
  });

/** Durable MaxDiff records persist item labels, tasks, and best-worst picks. */
export const maxDiffItemSchema = z.strictObject({
  id: identifierSchema,
  name: labelSchema,
});

export const maxDiffTaskSchema = z.strictObject({
  id: identifierSchema,
  itemIds: z.array(identifierSchema).min(3).max(5),
});

export const maxDiffResponseSchema = z.strictObject({
  respondentId: identifierSchema,
  taskId: identifierSchema,
  bestItemId: identifierSchema,
  worstItemId: identifierSchema,
});

export const maxDiffStudySchema = z
  .strictObject({
    items: z.array(maxDiffItemSchema).min(2).max(12),
    tasks: z.array(maxDiffTaskSchema).min(1).max(30),
    responses: z.array(maxDiffResponseSchema).max(50_000),
  })
  .superRefine((study, context) => {
    uniqueIds(study.items, "MaxDiff item", context, ["items"]);
    uniqueIds(study.tasks, "MaxDiff task", context, ["tasks"]);
    const itemIds = new Set(study.items.map((item) => item.id));
    study.tasks.forEach((task, taskIndex) => {
      if (new Set(task.itemIds).size !== task.itemIds.length) {
        context.addIssue({
          code: "custom",
          message: `Task “${task.id}” repeats an item.`,
          path: ["tasks", taskIndex, "itemIds"],
        });
      }
      const unknown = task.itemIds.find((itemId) => !itemIds.has(itemId));
      if (unknown) {
        context.addIssue({
          code: "custom",
          message: `Task “${task.id}” shows unknown item “${unknown}”.`,
          path: ["tasks", taskIndex, "itemIds"],
        });
      }
    });
  });

export const researchArtifactsSchema = z.strictObject({
  vanWestendorp: vanWestendorpStudySchema.optional(),
  conjoint: conjointStudySchema.optional(),
  maxDiff: maxDiffStudySchema.optional(),
});

export const settingsSchema = z.strictObject({
  seed: z.number().int().min(0).max(4_294_967_295),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter ISO currency code."),
  theme: z.enum(["system", "light", "dark"]),
});

const modelSchema = z.strictObject({
  features: z.array(featureSchema).max(12),
  segments: z.array(segmentSchema).max(6),
  interactions: z.array(featureInteractionSchema).max(12).default([]),
});

function uniqueIds(
  entries: readonly { id: string }[],
  label: string,
  context: z.RefinementCtx,
  path: readonly (string | number)[],
) {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      context.addIssue({
        code: "custom",
        message: `${label} IDs must be unique.`,
        path: [...path, index, "id"],
      });
    }
    seen.add(entry.id);
  });
}

function hasExactlyKeys(record: Record<string, unknown>, expected: ReadonlySet<string>) {
  const keys = Object.keys(record);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

export const scenarioSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: identifierSchema,
    name: labelSchema,
    status: z.enum(["draft", "ready"]),
    model: modelSchema,
    designs: z.array(designSchema).min(1),
    activeDesignId: identifierSchema,
    competitors: z.array(competitorSchema).max(6),
    research: researchArtifactsSchema.default({}),
    settings: settingsSchema,
  })
  .superRefine((scenario, context) => {
    const featureIds = new Set(scenario.model.features.map((feature) => feature.id));
    const segmentIds = new Set(scenario.model.segments.map((segment) => segment.id));

    uniqueIds(scenario.model.features, "Feature", context, ["model", "features"]);
    uniqueIds(scenario.model.segments, "Segment", context, ["model", "segments"]);
    uniqueIds(scenario.designs, "Design", context, ["designs"]);
    uniqueIds(scenario.competitors, "Competitor", context, ["competitors"]);

    if (!scenario.designs.some((design) => design.id === scenario.activeDesignId)) {
      context.addIssue({
        code: "custom",
        message: "The active design must belong to this scenario.",
        path: ["activeDesignId"],
      });
    }

    const seenInteractionPairs = new Set<string>();
    scenario.model.interactions.forEach((interaction, interactionIndex) => {
      const [a, b] = interaction.featureIds;
      if (a === b) {
        context.addIssue({
          code: "custom",
          message: "A feature interaction must reference two different features.",
          path: ["model", "interactions", interactionIndex, "featureIds"],
        });
      }
      for (const featureId of interaction.featureIds) {
        if (!featureIds.has(featureId)) {
          context.addIssue({
            code: "custom",
            message: `Interaction references unknown feature “${featureId}”.`,
            path: ["model", "interactions", interactionIndex, "featureIds"],
          });
        }
      }
      const pairKey = [a, b].sort().join("|");
      if (seenInteractionPairs.has(pairKey)) {
        context.addIssue({
          code: "custom",
          message: "Each feature pair may have at most one interaction.",
          path: ["model", "interactions", interactionIndex, "featureIds"],
        });
      }
      seenInteractionPairs.add(pairKey);
    });

    scenario.model.segments.forEach((segment, segmentIndex) => {
      if (!hasExactlyKeys(segment.featureAllocation, featureIds)) {
        context.addIssue({
          code: "custom",
          message: "Feature allocations must include every catalog feature exactly once.",
          path: ["model", "segments", segmentIndex, "featureAllocation"],
        });
      }
      if (!hasExactlyKeys(segment.provenance.featureValues, featureIds)) {
        context.addIssue({
          code: "custom",
          message: "Feature provenance must include every catalog feature exactly once.",
          path: ["model", "segments", segmentIndex, "provenance", "featureValues"],
        });
      }

      const allocationTotal = Object.values(segment.featureAllocation).reduce(
        (sum, value) => sum + value,
        0,
      );
      if (Math.abs(allocationTotal - 1) > 1e-9) {
        context.addIssue({
          code: "custom",
          message: "Feature allocations must sum to 1.",
          path: ["model", "segments", segmentIndex, "featureAllocation"],
        });
      }
    });

    scenario.designs.forEach((design, designIndex) => {
      uniqueIds(design.tiers, "Tier", context, ["designs", designIndex, "tiers"]);
      uniqueIds(design.addOns, "Add-on", context, ["designs", designIndex, "addOns"]);

      [...design.tiers, ...design.addOns].forEach((offer, offerIndex) => {
        const unknownFeature = offer.featureIds.find((featureId) => !featureIds.has(featureId));
        if (unknownFeature) {
          context.addIssue({
            code: "custom",
            message: `Offer references unknown feature “${unknownFeature}”.`,
            path: ["designs", designIndex, "offers", offerIndex, "featureIds"],
          });
        }
        if (new Set(offer.featureIds).size !== offer.featureIds.length) {
          context.addIssue({
            code: "custom",
            message: "Offer feature fences must not repeat a feature.",
            path: ["designs", designIndex, "offers", offerIndex, "featureIds"],
          });
        }
      });
    });

    scenario.competitors.forEach((competitor, competitorIndex) => {
      if (!hasExactlyKeys(competitor.valueBySegment, segmentIds)) {
        context.addIssue({
          code: "custom",
          message: "Competitor values must include every current segment exactly once.",
          path: ["competitors", competitorIndex, "valueBySegment"],
        });
      }
    });

    if (scenario.status === "ready") {
      if (scenario.model.features.length === 0 || scenario.model.segments.length < 2) {
        context.addIssue({
          code: "custom",
          message: "A ready scenario needs 2–6 segments and at least one catalog feature.",
          path: ["model"],
        });
      }
      if (scenario.designs.some((design) => design.tiers.length === 0)) {
        context.addIssue({
          code: "custom",
          message: "A ready scenario needs at least one tier in every design.",
          path: ["designs"],
        });
      }
    }
  });

/** The compact URL shape intentionally omits research artifacts. */
export const sharePayloadSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: identifierSchema,
  name: labelSchema,
  status: z.enum(["draft", "ready"]),
  model: modelSchema,
  designs: z.array(designSchema).min(1),
  activeDesignId: identifierSchema,
  competitors: z.array(competitorSchema).max(6),
  settings: settingsSchema,
});

export type Scenario = z.infer<typeof scenarioSchema>;
export type SharePayload = z.infer<typeof sharePayloadSchema>;
export type ScenarioSettings = z.infer<typeof settingsSchema>;
export type VanWestendorpStudy = z.infer<typeof vanWestendorpStudySchema>;
export type ConjointStudyRecord = z.infer<typeof conjointStudySchema>;
export type MaxDiffStudyRecord = z.infer<typeof maxDiffStudySchema>;

export function formatValidationIssues(issues: readonly z.core.$ZodIssue[]) {
  const first = issues[0];
  if (!first) return "The scenario is not valid.";
  const path = first.path.length > 0 ? ` at ${first.path.join(".")}` : "";
  return `${first.message}${path}`;
}

export function isScenarioVersion(value: unknown): value is { schemaVersion: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    typeof value.schemaVersion === "number"
  );
}
