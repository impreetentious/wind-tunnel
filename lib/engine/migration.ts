import { selectOffers } from "./envelope";
import type { ExpandedOffer, SelectOffersOptions } from "./types";

/**
 * Repricing an existing base (§4.18).
 *
 * v1 answers the screening question for **new** buyers in a single period. An installed base is
 * a different question with the same mathematics: an account already running your product is
 * choosing between the plan it is on, the plan you would like it to be on, a competitor, and
 * leaving. The mechanical move — and the reason this belongs in this product rather than in a
 * second one — is that the incumbent plan is **one more offer in the §4.2 envelope**. No new
 * choice model, no new solver, no second definition of revenue.
 *
 * **Where the switching cost goes.** A switching cost is a one-off account-level cost of
 * standing something new up: re-integration, retraining, a migration project. Utility is
 * `ε·V − P`, and that cost is a dollar amount rather than something the buyer's scale factor
 * multiplies, so it belongs on the price side. The envelope pins the outside option at
 * `(V = 0, P = 0)` and cannot carry a shifted one, so the cost is charged where it is actually
 * incurred instead: **every alternative other than the incumbent gets `+switchingCost`**, and
 * the incumbent keeps its grandfathered price. Two consequences worth stating plainly:
 *
 * - Churning to no vendor is modeled **without** the switching cost. What is being priced is
 *   the cost of standing a replacement up, not the cost of stopping. This is the conservative
 *   direction for a repricing decision: it makes churn easier to choose, and a migration tool
 *   that under-predicts churn is the dangerous one.
 * - The switching cost is a **buyer** cost, never vendor revenue. The choice set prices carry
 *   it; the revenue bridge books the offer's own price.
 *
 * **The policy is the choice set.** `grandfather` leaves the incumbent in it. `forced-at-renewal`
 * removes it, so every account must re-choose or leave — which is exactly how a forced migration
 * prices a segment into churn. `opt-in-with-deadline` leaves it in and records that every account
 * staying there has to *do something* by a date: mechanically identical to grandfathering for a
 * rational buyer, and different only through inertia, which this product does not invent a
 * coefficient. The engine reports the exposure instead of modeling the psychology.
 */
export type MigrationPolicy = "grandfather" | "forced-at-renewal" | "opt-in-with-deadline";

export interface IncumbentPlan {
  id: string;
  name: string;
  /** Account-level value of the incumbent's feature set, for this segment. */
  value: number;
  /** What accounts on this plan pay today, at account level. */
  effectivePrice: number;
}

export interface MigrationSegmentInput {
  id: string;
  name: string;
  /** Accounts sitting on the incumbent plan today. */
  baseCount: number;
  sigma: number;
  incumbent: IncumbentPlan;
  /** One-off account-level cost of standing up any alternative. Non-negative. */
  switchingCost: number;
  /** The proposed menu, already expanded for this segment by `expandOffers`. */
  proposedOffers: readonly ExpandedOffer[];
  selectionOptions?: SelectOffersOptions;
}

export interface MigrationInput {
  policy: MigrationPolicy;
  segments: readonly MigrationSegmentInput[];
}

/** One cell of the migration matrix: a cohort of the base and where it lands. */
export interface MigrationCell {
  segmentId: string;
  /** The offer landed on; `null` when the accounts churn at the migration event. */
  destinationOfferId: string | null;
  destinationName: string;
  /** True when the destination is the grandfathered incumbent itself. */
  stays: boolean;
  accounts: number;
  /** Share of this segment's base landing here. */
  share: number;
  /** MRR these accounts pay after the migration, at the destination's own price. */
  revenue: number;
  /** Destination revenue minus what the same accounts used to pay. */
  revenueDelta: number;
}

/**
 * Old MRR reconciled to new. The four movements are exhaustive and disjoint by construction, so
 * `closingMrr = openingMrr + expansion + contraction + churn` holds exactly — the same discipline
 * §4.3's conservation identity applies to the value waterfall.
 */
export interface RevenueBridge {
  openingMrr: number;
  /** Accounts that landed somewhere more expensive. Non-negative. */
  expansion: number;
  /** Accounts that landed somewhere cheaper. Non-positive. */
  contraction: number;
  /** Accounts that left at the migration event. Non-positive. */
  churn: number;
  closingMrr: number;
  /** Opening + the three movements − closing; zero within binary64 error. */
  bridgeResidual: number;
}

export interface MigrationSegmentReadout {
  id: string;
  name: string;
  baseCount: number;
  policy: MigrationPolicy;
  cells: readonly MigrationCell[];
  bridge: RevenueBridge;
  /** Share of the base still on the incumbent plan afterwards. */
  stayShare: number;
  /** Share of the base that leaves at the migration event. */
  churnShare: number;
  /**
   * Closing MRR for this segment if the incumbent were withdrawn instead. Under
   * `forced-at-renewal` this is the actual result; under the other two it is the counterfactual
   * that prices what grandfathering costs.
   */
  withdrawnIncumbentMrr: number;
  /**
   * Withdrawn-incumbent MRR minus this segment's closing MRR. Positive means the legacy plan is
   * holding revenue down; negative means withdrawing it would cost more in churn than it wins.
   * Zero under `forced-at-renewal`, where the incumbent is already gone.
   */
  grandfatherOpportunityCost: number;
  /** MRR that depends on accounts completing an opt-in by the deadline. Zero otherwise. */
  mrrRequiringBuyerAction: number;
}

export interface MigrationReadout {
  policy: MigrationPolicy;
  segments: readonly MigrationSegmentReadout[];
  cells: readonly MigrationCell[];
  bridge: RevenueBridge;
  baseCount: number;
  stayShare: number;
  churnShare: number;
  grandfatherOpportunityCost: number;
  mrrRequiringBuyerAction: number;
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${label} must be a finite, non-negative number.`);
  }
}

function validateSegment(segment: MigrationSegmentInput): void {
  if (!segment.id) throw new RangeError("Every migration segment needs a non-empty ID.");
  assertFiniteNonNegative(segment.baseCount, `Segment “${segment.id}” base count`);
  assertFiniteNonNegative(segment.sigma, `Segment “${segment.id}” sigma`);
  assertFiniteNonNegative(segment.switchingCost, `Segment “${segment.id}” switching cost`);
  assertFiniteNonNegative(segment.incumbent.value, `Segment “${segment.id}” incumbent value`);
  assertFiniteNonNegative(
    segment.incumbent.effectivePrice,
    `Segment “${segment.id}” incumbent price`,
  );
  if (!segment.incumbent.id) {
    throw new RangeError(`Segment “${segment.id}” needs a non-empty incumbent plan ID.`);
  }
  if (segment.proposedOffers.some((offer) => offer.id === incumbentOfferId(segment))) {
    throw new RangeError(
      `Segment “${segment.id}” already has an offer with the incumbent's reserved ID.`,
    );
  }
}

function incumbentOfferId(segment: MigrationSegmentInput): string {
  return `incumbent:${segment.incumbent.id}`;
}

/**
 * The choice set an existing account faces. Proposed offers are re-priced with the switching
 * cost so the envelope sees what the buyer sees; `originalPrices` carries the unshifted price
 * back out, because the switching cost is the buyer's and never the vendor's revenue.
 */
function choiceSet(
  segment: MigrationSegmentInput,
  policy: MigrationPolicy,
): { offers: ExpandedOffer[]; originalPrices: Map<string, number> } {
  const originalPrices = new Map<string, number>();
  const offers: ExpandedOffer[] = [];

  for (const offer of segment.proposedOffers) {
    originalPrices.set(offer.id, offer.effectivePrice);
    if (offer.owner === "outside") {
      offers.push(offer);
      continue;
    }
    offers.push({ ...offer, effectivePrice: offer.effectivePrice + segment.switchingCost });
  }

  if (policy !== "forced-at-renewal") {
    const id = incumbentOfferId(segment);
    originalPrices.set(id, segment.incumbent.effectivePrice);
    offers.push({
      id,
      name: segment.incumbent.name,
      owner: "own",
      kind: "incumbent",
      value: segment.incumbent.value,
      effectivePrice: segment.incumbent.effectivePrice,
      featureIds: [],
    });
  }
  return { offers, originalPrices };
}

interface Landing {
  offer: ExpandedOffer;
  share: number;
}

function landings(segment: MigrationSegmentInput, offers: readonly ExpandedOffer[]): Landing[] {
  const selection = selectOffers(offers, segment.sigma, segment.selectionOptions);
  if (segment.sigma === 0) {
    const selected = selection.offers.find((offer) => offer.id === selection.selectedAtMedianId);
    return selected ? [{ offer: selected, share: 1 }] : [];
  }
  // Zero-share intervals only; a merely tiny share still carries mass the bridge must
  // reconcile, and dropping it would leave a residual that is not floating-point error.
  return selection.active
    .filter((interval) => interval.share !== 0)
    .map((interval) => ({ offer: interval.offer, share: interval.share }));
}

function closingMrrFor(
  segment: MigrationSegmentInput,
  offers: readonly ExpandedOffer[],
  originalPrices: ReadonlyMap<string, number>,
): number {
  return landings(segment, offers).reduce((total, landing) => {
    if (landing.offer.owner !== "own") return total;
    return total + segment.baseCount * landing.share * (originalPrices.get(landing.offer.id) ?? 0);
  }, 0);
}

function simulateSegment(
  segment: MigrationSegmentInput,
  policy: MigrationPolicy,
): MigrationSegmentReadout {
  validateSegment(segment);
  const { offers, originalPrices } = choiceSet(segment, policy);
  const incumbentId = incumbentOfferId(segment);
  const openingMrr = segment.baseCount * segment.incumbent.effectivePrice;

  let expansion = 0;
  let contraction = 0;
  let churn = 0;
  let stayShare = 0;
  let churnShare = 0;

  const cells: MigrationCell[] = landings(segment, offers).map((landing) => {
    const accounts = segment.baseCount * landing.share;
    // A competitor and the outside option are both exits from our revenue; the matrix keeps
    // them apart so the reader can tell "left the category" from "left for a named rival".
    const leaves = landing.offer.owner !== "own";
    const price = leaves ? 0 : (originalPrices.get(landing.offer.id) ?? 0);
    const revenue = accounts * price;
    const revenueDelta = revenue - accounts * segment.incumbent.effectivePrice;
    const stays = landing.offer.id === incumbentId;

    if (leaves) {
      churn += revenueDelta;
      churnShare += landing.share;
    } else if (revenueDelta > 0) {
      expansion += revenueDelta;
    } else {
      contraction += revenueDelta;
    }
    if (stays) stayShare += landing.share;

    return {
      segmentId: segment.id,
      destinationOfferId: leaves && landing.offer.owner === "outside" ? null : landing.offer.id,
      destinationName: landing.offer.name,
      stays,
      accounts,
      share: landing.share,
      revenue,
      revenueDelta,
    };
  });

  const closingMrr = cells.reduce((total, cell) => total + cell.revenue, 0);
  const withdrawn =
    policy === "forced-at-renewal"
      ? { offers, originalPrices }
      : choiceSet(segment, "forced-at-renewal");
  const withdrawnIncumbentMrr = closingMrrFor(segment, withdrawn.offers, withdrawn.originalPrices);

  return {
    id: segment.id,
    name: segment.name,
    baseCount: segment.baseCount,
    policy,
    cells,
    bridge: {
      openingMrr,
      expansion,
      contraction,
      churn,
      closingMrr,
      bridgeResidual: openingMrr + expansion + contraction + churn - closingMrr,
    },
    stayShare,
    churnShare,
    withdrawnIncumbentMrr,
    grandfatherOpportunityCost:
      policy === "forced-at-renewal" ? 0 : withdrawnIncumbentMrr - closingMrr,
    mrrRequiringBuyerAction:
      policy === "opt-in-with-deadline"
        ? cells.reduce((total, cell) => total + (cell.stays ? cell.revenue : 0), 0)
        : 0,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Runs the whole base through the migration event and reconciles old MRR to new.
 *
 * The readout sits **beside** the §4.3 economics rather than replacing it: `simulateEconomics`
 * still answers "what would a fresh buyer choose?", and this answers "what does the base already
 * on us do?". They are different populations and the product never conflates them.
 */
export function simulateMigration(input: MigrationInput): MigrationReadout {
  if (input.segments.length === 0) {
    throw new RangeError("A migration simulation requires at least one segment.");
  }
  const segments = input.segments.map((segment) => simulateSegment(segment, input.policy));
  const baseCount = sum(segments.map((segment) => segment.baseCount));
  const openingMrr = sum(segments.map((segment) => segment.bridge.openingMrr));
  const expansion = sum(segments.map((segment) => segment.bridge.expansion));
  const contraction = sum(segments.map((segment) => segment.bridge.contraction));
  const churn = sum(segments.map((segment) => segment.bridge.churn));
  const closingMrr = sum(segments.map((segment) => segment.bridge.closingMrr));
  const weighted = (pick: (segment: MigrationSegmentReadout) => number) =>
    baseCount === 0
      ? 0
      : sum(segments.map((segment) => pick(segment) * segment.baseCount)) / baseCount;

  return {
    policy: input.policy,
    segments,
    cells: segments.flatMap((segment) => segment.cells),
    bridge: {
      openingMrr,
      expansion,
      contraction,
      churn,
      closingMrr,
      bridgeResidual: openingMrr + expansion + contraction + churn - closingMrr,
    },
    baseCount,
    stayShare: weighted((segment) => segment.stayShare),
    churnShare: weighted((segment) => segment.churnShare),
    grandfatherOpportunityCost: sum(segments.map((segment) => segment.grandfatherOpportunityCost)),
    mrrRequiringBuyerAction: sum(segments.map((segment) => segment.mrrRequiringBuyerAction)),
  };
}
