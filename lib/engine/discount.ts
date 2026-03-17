import { selectOfferAtScale, selectOffers } from "./envelope";
import { lognormalQuantile, scaleDistribution } from "./stats";
import type { ExpandedOffer, SelectOffersOptions } from "./types";

/**
 * Discount-policy leakage (§4.19).
 *
 * List price is a ceiling; achieved price is a policy outcome. Every §4.3 number in this studio
 * is computed at list, which is the right answer for the menu you *designed* and the wrong one
 * for the menu your buyers are actually offered. This module evaluates the second one, and it
 * does so through the same upper envelope (§4.2) as everything else — a discount is a price, and
 * prices are what the envelope already takes.
 *
 * **Two readouts, and the second is the interesting one.**
 *
 * - `discountLeakage` — list MRR minus achieved MRR, in dollars. It is deliberately *not*
 *   `hit rate × discount × revenue`: at a discounted price buyers also re-sort, and some of them
 *   re-sort upward. Running the discounted menu through the envelope catches that; multiplying
 *   through cannot.
 * - **Fence erosion** — the structural one. A menu is a screen: each tier is meant to be chosen
 *   by the buyers it was built for. When a discounted Better beats an undiscounted Best *for the
 *   buyers Best was built for*, the screen is dismantled and no dollar figure says so.
 *
 *   The test is deliberately not "the higher tier's share goes to zero". It cannot: a
 *   strictly-higher-value line always wins the envelope again at a high enough ε, so that
 *   predicate would never fire and the rule would be decorative. What is asked instead is
 *   whether the segment's **P90 buyer** — the top decile, the buyers the top tier exists for —
 *   reached the higher tier at list and takes the discounted lower one at the permitted floor.
 *   That is the doc's sentence made checkable, in the same P10/P50/P90 idiom §4.11 uses for
 *   break-even rays. At `σ = 0` the segment is a point mass and the P90 buyer is the only buyer.
 *
 * **How deals are split.** Rather than invent a per-deal discount distribution, the population
 * is partitioned into named scenarios that the envelope evaluates exactly:
 *
 * - one **list** cohort, of share `1 − Σ_p hitRate_p`, facing the undiscounted menu;
 * - one cohort per policy `p`, of share `hitRate_p`, facing the menu with **only tier p** at its
 *   permitted floor.
 *
 * That mirrors how discounting actually happens — a rep concedes on the line being negotiated,
 * not across the whole price list — and it is what makes fence erosion visible, since erosion is
 * precisely a discounted Better beating an undiscounted Best. The assumption is a mixture over
 * cohorts rather than a joint distribution over discount depth and ε, and it is stated here and
 * in the UI rather than buried.
 *
 * **Naming.** `linter.ts` already uses "leakage" for the free tier and `time-dynamics.ts` for
 * trial conversion. This concept is `discountLeakage` everywhere, never the bare word.
 */

/** Approval required to reach a given depth. Reported, never simulated as a friction. */
export interface DiscountApprovalBand {
  /** Deepest discount this approver may authorize, as a fraction of list. */
  upToFraction: number;
  approver: string;
}

export interface DiscountPolicy {
  tierId: string;
  /** Deepest discount the policy permits, as a fraction of list. `0.2` is 20% off. */
  floorFraction: number;
  approvalBands?: readonly DiscountApprovalBand[];
  /** Expected share of a segment's deals that reach the floor on this tier. */
  hitRateBySegment?: Readonly<Record<string, number>>;
}

export interface DiscountSegmentInput {
  id: string;
  name: string;
  prospectCount: number;
  sigma: number;
  /** The list menu, already expanded for this segment by `expandOffers`. */
  listOffers: readonly ExpandedOffer[];
  selectionOptions?: SelectOffersOptions;
}

export interface DiscountInput {
  segments: readonly DiscountSegmentInput[];
  policies: readonly DiscountPolicy[];
}

/**
 * A higher-value tier that the permitted floor on a cheaper one takes off the envelope. The
 * fence was doing screening work at list and stops doing any at the floor.
 */
export interface FenceErosion {
  segmentId: string;
  segmentName: string;
  discountedTierId: string;
  discountedTierName: string;
  /** Depth that causes it, as a fraction of the discounted tier's list price. */
  floorFraction: number;
  erodedTierId: string;
  erodedTierName: string;
  /** The buyer scale at which the flip is checked: the segment's P90, or 1 when σ = 0. */
  topDecileScale: number;
  /** The eroded tier's envelope share at list — the screening the floor destroys. */
  shareAtList: number;
  /** That share's MRR at list: what the erosion puts at risk in this segment. */
  mrrAtRisk: number;
  /** Deepest approver the policy names, when it names any. */
  approver?: string;
}

export interface DiscountCohort {
  /** `null` for the undiscounted cohort; otherwise the tier being discounted. */
  tierId: string | null;
  /** Share of this segment's deals in this cohort. */
  weight: number;
  /** MRR this cohort contributes, already weighted. */
  mrr: number;
}

export interface DiscountSegmentReadout {
  id: string;
  name: string;
  /** MRR if every deal closed at list — the designed menu's own answer. */
  listMrr: number;
  /** MRR after the policy's permitted floors and the re-sorting they cause. */
  achievedMrr: number;
  /** List minus achieved. Positive is revenue the policy gives away. */
  discountLeakage: number;
  /** Leakage as a share of list MRR; zero when list MRR is zero. */
  discountLeakageShare: number;
  /** Share of this segment's deals that receive any discount. */
  discountedShare: number;
  cohorts: readonly DiscountCohort[];
  fenceErosions: readonly FenceErosion[];
}

export interface DiscountReadout {
  segments: readonly DiscountSegmentReadout[];
  listMrr: number;
  achievedMrr: number;
  discountLeakage: number;
  discountLeakageShare: number;
  fenceErosions: readonly FenceErosion[];
}

const EPSILON = 1e-9;

function assertFraction(value: number, label: string): void {
  if (!(Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError(`${label} must be a fraction between 0 and 1.`);
  }
}

function validate(input: DiscountInput): void {
  const tierIds = new Set<string>();
  for (const policy of input.policies) {
    if (!policy.tierId) throw new RangeError("Every discount policy needs a tier ID.");
    if (tierIds.has(policy.tierId)) {
      throw new RangeError(`Tier “${policy.tierId}” has more than one discount policy.`);
    }
    tierIds.add(policy.tierId);
    assertFraction(policy.floorFraction, `Discount floor for “${policy.tierId}”`);
    for (const [segmentId, rate] of Object.entries(policy.hitRateBySegment ?? {})) {
      assertFraction(rate, `Discount hit rate for “${policy.tierId}” in “${segmentId}”`);
    }
    for (const band of policy.approvalBands ?? []) {
      assertFraction(band.upToFraction, `Approval band for “${policy.tierId}”`);
    }
  }
  for (const segment of input.segments) {
    if (!segment.id) throw new RangeError("Every discount segment needs a non-empty ID.");
    if (!(Number.isFinite(segment.prospectCount) && segment.prospectCount >= 0)) {
      throw new RangeError(
        `Segment “${segment.id}” prospect count must be finite and non-negative.`,
      );
    }
    const total = input.policies.reduce(
      (sum, policy) => sum + (policy.hitRateBySegment?.[segment.id] ?? 0),
      0,
    );
    if (total > 1 + EPSILON) {
      throw new RangeError(
        `Discount hit rates for segment “${segment.id}” sum to ${total.toFixed(3)}; a deal cannot be discounted on more than all of the menu.`,
      );
    }
  }
}

/** The plain tier offer — no add-ons — whose list price the floor is a fraction of. */
function plainTierOffer(
  offers: readonly ExpandedOffer[],
  tierId: string,
): ExpandedOffer | undefined {
  return offers.find(
    (offer) =>
      offer.owner === "own" && offer.tierId === tierId && (offer.addOnIds?.length ?? 0) === 0,
  );
}

/**
 * The menu one cohort faces: every offer built on `tierId` loses the same **absolute** amount,
 * the floor applied to that tier's own list price. Discounting a tier does not discount the
 * add-ons bolted onto it — those are separate lines with their own prices.
 */
function discountedMenu(
  offers: readonly ExpandedOffer[],
  tierId: string,
  floorFraction: number,
): readonly ExpandedOffer[] {
  const plain = plainTierOffer(offers, tierId);
  if (!plain) return offers;
  const reduction = plain.effectivePrice * floorFraction;
  if (reduction <= 0) return offers;
  return offers.map((offer) =>
    offer.owner === "own" && offer.tierId === tierId
      ? { ...offer, effectivePrice: Math.max(0, offer.effectivePrice - reduction) }
      : offer,
  );
}

/** Own-offer shares by tier, and the MRR they imply for a segment. */
function tierOutcome(
  segment: DiscountSegmentInput,
  offers: readonly ExpandedOffer[],
): { mrr: number; shareByTier: Map<string, number> } {
  const selection = selectOffers(offers, segment.sigma, segment.selectionOptions);
  const shareByTier = new Map<string, number>();
  let mrr = 0;
  for (const offer of selection.offers) {
    const share = selection.shares[offer.id] ?? 0;
    if (offer.owner !== "own") continue;
    mrr += segment.prospectCount * share * offer.effectivePrice;
    if (offer.tierId) {
      shareByTier.set(offer.tierId, (shareByTier.get(offer.tierId) ?? 0) + share);
    }
  }
  return { mrr, shareByTier };
}

/** The own tier the buyer at this scale picks, or `null` when they pick a competitor or leave. */
function tierAtScale(
  segment: DiscountSegmentInput,
  offers: readonly ExpandedOffer[],
  scale: number,
): string | null {
  const chosen = selectOfferAtScale(offers, scale, segment.selectionOptions);
  return chosen.owner === "own" ? (chosen.tierId ?? null) : null;
}

function deepestApprover(policy: DiscountPolicy): string | undefined {
  const bands = [...(policy.approvalBands ?? [])].sort(
    (left, right) => right.upToFraction - left.upToFraction,
  );
  // The band that has to sign for the deepest permitted discount, not the deepest band defined.
  return bands.find((band) => band.upToFraction + EPSILON >= policy.floorFraction)?.approver;
}

function simulateSegment(
  segment: DiscountSegmentInput,
  policies: readonly DiscountPolicy[],
): DiscountSegmentReadout {
  const atList = tierOutcome(segment, segment.listOffers);
  const cohorts: DiscountCohort[] = [];
  const fenceErosions: FenceErosion[] = [];
  let discountedShare = 0;
  let achievedMrr = 0;
  // The buyers the top of the menu exists for. A point-mass segment has exactly one buyer.
  const topDecileScale =
    segment.sigma === 0 ? 1 : lognormalQuantile(0.9, scaleDistribution(segment.sigma));
  const topTierAtList = tierAtScale(segment, segment.listOffers, topDecileScale);

  for (const policy of policies) {
    const weight = policy.hitRateBySegment?.[segment.id] ?? 0;
    const plain = plainTierOffer(segment.listOffers, policy.tierId);
    if (!plain) continue;
    const menu = discountedMenu(segment.listOffers, policy.tierId, policy.floorFraction);
    const outcome = tierOutcome(segment, menu);

    if (weight > 0) {
      discountedShare += weight;
      achievedMrr += weight * outcome.mrr;
      cohorts.push({ tierId: policy.tierId, weight, mrr: weight * outcome.mrr });
    }

    // Fence erosion is a property of the *policy*, not of how often it is used: a floor that
    // un-fences the menu does so on the first deal that reaches it. It is therefore checked on
    // every policy, including one with a zero hit rate.
    if (topTierAtList && topTierAtList !== policy.tierId) {
      const eroded = plainTierOffer(segment.listOffers, topTierAtList);
      const flipsToDiscounted = tierAtScale(segment, menu, topDecileScale) === policy.tierId;
      if (eroded && flipsToDiscounted && eroded.value > plain.value + EPSILON) {
        const shareAtList = atList.shareByTier.get(topTierAtList) ?? 0;
        const approver = deepestApprover(policy);
        fenceErosions.push({
          segmentId: segment.id,
          segmentName: segment.name,
          discountedTierId: policy.tierId,
          discountedTierName: plain.name,
          floorFraction: policy.floorFraction,
          erodedTierId: topTierAtList,
          erodedTierName: eroded.name,
          topDecileScale,
          shareAtList,
          mrrAtRisk: segment.prospectCount * shareAtList * eroded.effectivePrice,
          ...(approver ? { approver } : {}),
        });
      }
    }
  }

  const listWeight = Math.max(0, 1 - discountedShare);
  achievedMrr += listWeight * atList.mrr;
  cohorts.unshift({ tierId: null, weight: listWeight, mrr: listWeight * atList.mrr });

  const discountLeakage = atList.mrr - achievedMrr;
  return {
    id: segment.id,
    name: segment.name,
    listMrr: atList.mrr,
    achievedMrr,
    discountLeakage,
    discountLeakageShare: atList.mrr <= EPSILON ? 0 : discountLeakage / atList.mrr,
    discountedShare,
    cohorts,
    fenceErosions,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Evaluates the effective menu a discount policy permits, segment by segment.
 *
 * The result sits beside §4.3's list-price economics rather than replacing them: the designed
 * menu and the permitted menu are two different questions, and a tool that quietly answered the
 * second while labelling it the first would be doing the thing this module exists to expose.
 */
export function evaluateDiscountPolicy(input: DiscountInput): DiscountReadout {
  validate(input);
  const segments = input.segments.map((segment) => simulateSegment(segment, input.policies));
  const listMrr = sum(segments.map((segment) => segment.listMrr));
  const achievedMrr = sum(segments.map((segment) => segment.achievedMrr));
  const discountLeakage = listMrr - achievedMrr;
  return {
    segments,
    listMrr,
    achievedMrr,
    discountLeakage,
    discountLeakageShare: listMrr <= EPSILON ? 0 : discountLeakage / listMrr,
    fenceErosions: segments.flatMap((segment) => segment.fenceErosions),
  };
}
