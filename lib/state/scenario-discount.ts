import {
  evaluateDiscountPolicy,
  type DiscountInput,
  type DiscountReadout,
} from "@/lib/engine/discount";
import { expandOffers } from "@/lib/engine/offers";

import { activeDesign } from "./design-editing";
import { offerExpansionForSegment } from "./scenario-economics";
import type { Scenario } from "./schemas";

/**
 * @spec §4.19 — adapts the durable scenario to the discount-policy engine.
 *
 * The list menu handed to the engine is the *same* expansion `simulateScenarioDesign` uses, so
 * the list-price baseline the leakage is measured against is by construction the number the rest
 * of the studio reports. There is no second definition of "list MRR" to drift.
 */
export function discountInputForScenario(scenario: Scenario): DiscountInput | null {
  const design = activeDesign(scenario);
  const policies = design.discountPolicies ?? [];
  if (policies.length === 0 || scenario.model.segments.length === 0) return null;

  return {
    policies: policies.map((policy) => ({
      tierId: policy.tierId,
      floorFraction: policy.floorFraction,
      ...(policy.approvalBands ? { approvalBands: policy.approvalBands } : {}),
      ...(policy.hitRateBySegment ? { hitRateBySegment: policy.hitRateBySegment } : {}),
    })),
    segments: scenario.model.segments.map((segment) => ({
      id: segment.id,
      name: segment.name,
      prospectCount: segment.prospectBand.p50,
      sigma: segment.withinSegmentSigma,
      listOffers: expandOffers(offerExpansionForSegment(scenario, design, segment)),
    })),
  };
}

export function evaluateScenarioDiscount(scenario: Scenario): DiscountReadout | null {
  const input = discountInputForScenario(scenario);
  return input ? evaluateDiscountPolicy(input) : null;
}
