import {
  projectTimeDynamics,
  type SegmentTimeDynamics,
  type TimeDynamicsInput,
  type TimeDynamicsReadout,
} from "@/lib/engine/time-dynamics";
import type { EconomicsReadout } from "@/lib/engine/types";

import type { Scenario } from "./schemas";

const DEFAULT_TRIAL_LENGTH = 0;
const DEFAULT_TRIAL_CONVERSION = 1;
const DEFAULT_MONTHLY_RETENTION = 1;
const DEFAULT_CONTRACT_TERM: SegmentTimeDynamics["contractTerm"] = "monthly";

/**
 * State adapter for §4.16 trials & time dynamics. Bridges the durable scenario
 * segment definitions and one design's §4.3 economics readout to the pure
 * `projectTimeDynamics` engine. Segments that omit `timeDynamics` collapse to
 * the zero-default single-period behavior (T-TIME-01), so shipping the
 * extension never changes the acquisition-month numbers a scenario without
 * trials or retention would show.
 */
export function timeDynamicsInputForReadout(
  scenario: Scenario,
  readout: EconomicsReadout,
  periods: number,
): TimeDynamicsInput {
  const segmentsById = new Map(scenario.model.segments.map((segment) => [segment.id, segment]));
  return {
    periods,
    segments: readout.segments.map((segment) => {
      const durable = segmentsById.get(segment.id);
      const dynamics = durable?.timeDynamics;
      const paidBuyers = segment.ownPaidBuyers;
      // §4.3 KPIs are monthly; the extension picks them up as period-0 inputs.
      const monthlyMrr = segment.revenue;
      const arpa = paidBuyers > 0 ? monthlyMrr / paidBuyers : 0;
      return {
        id: segment.id,
        trialLength: dynamics?.trialLengthMonths ?? DEFAULT_TRIAL_LENGTH,
        trialConversion: dynamics?.trialConversion ?? DEFAULT_TRIAL_CONVERSION,
        monthlyRetention: dynamics?.monthlyRetention ?? DEFAULT_MONTHLY_RETENTION,
        contractTerm: dynamics?.contractTerm ?? DEFAULT_CONTRACT_TERM,
        monthlyMrr,
        arpa,
        paidSelectors: paidBuyers,
      };
    }),
  };
}

/**
 * Convenience wrapper that runs a scenario/design's §4.3 readout through the
 * time-dynamics engine at the given horizon. Returns `null` when the scenario
 * has no readout (empty segments) so calling UI need not defensively guard.
 */
export function projectScenarioTimeDynamics(
  scenario: Scenario,
  readout: EconomicsReadout | null,
  periods: number,
): TimeDynamicsReadout | null {
  if (!readout) return null;
  return projectTimeDynamics(timeDynamicsInputForReadout(scenario, readout, periods));
}
