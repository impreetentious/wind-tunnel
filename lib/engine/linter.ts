import { lognormalPartialExpectation, scaleDistribution } from "./stats";
import type { EconomicsReadout, ExpandedOffer, SegmentEconomicsReadout } from "./types";

const EPSILON = 1e-9;
const DOWNGRADE_MASS_THRESHOLD = 0.3;
const FREE_LEAKAGE_WARNING_THRESHOLD = 0.15;
const COMPETITOR_LOSS_THRESHOLD = 0.25;

export type LinterSeverity = "info" | "warning";
export type LinterFindingId = "E1" | "E2" | "E3" | "E4" | "E5" | "E6" | "E7" | "B1" | "B2";

export interface LinterFeature {
  id: string;
  name: string;
}

export interface LinterTier {
  id: string;
  name: string;
  price: number;
  priceMetric: "flat" | "per-seat";
  featureIds: readonly string[];
}

export type LinterAddOn = LinterTier;

export interface LinterSegment {
  id: string;
  name: string;
  seatCount: number;
}

export interface LinterFinding {
  id: LinterFindingId;
  severity: LinterSeverity;
  title: string;
  message: string;
  citation?: string;
  metrics?: Readonly<Record<string, number>>;
  segmentIds?: readonly string[];
}

export interface DesignLinterInput {
  features: readonly LinterFeature[];
  tiers: readonly LinterTier[];
  addOns: readonly LinterAddOn[];
  segments: readonly LinterSegment[];
  baseline: EconomicsReadout;
  /** Supplies an independently re-expanded menu for deterministic counterfactuals. */
  simulate: (menu: {
    tiers: readonly LinterTier[];
    addOns: readonly LinterAddOn[];
  }) => EconomicsReadout;
}

function percent(value: number) {
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

function money(value: number) {
  return `$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function ownOfferAtTier(segment: SegmentEconomicsReadout, tierId: string) {
  return segment.selection.offers.filter(
    (offer) => offer.owner === "own" && offer.tierId === tierId,
  );
}

function activeOfferEntries(segment: SegmentEconomicsReadout) {
  return segment.selection.active.filter((entry) => entry.share > EPSILON);
}

function effectivePrice(tier: LinterTier, seatCount: number) {
  return tier.priceMetric === "per-seat" ? tier.price * seatCount : tier.price;
}

function featureNames(ids: readonly string[], features: readonly LinterFeature[]) {
  const names = new Map(features.map((feature) => [feature.id, feature.name]));
  return ids.map((id) => names.get(id) ?? id);
}

function valueMoment(
  segment: SegmentEconomicsReadout,
  lower: number,
  upper: number,
  share: number,
) {
  if (segment.sigma === 0) return share;
  if (upper <= 0 || upper <= Math.max(0, lower)) return 0;
  return lognormalPartialExpectation(Math.max(0, lower), upper, scaleDistribution(segment.sigma));
}

function competitorLossForOffer(segment: SegmentEconomicsReadout, competitorId: string) {
  if (segment.sigma === 0) {
    const selected = segment.selection.selectedAtMedianId;
    return selected === `competitor:${competitorId}` ? segment.potential : 0;
  }
  return activeOfferEntries(segment)
    .filter((entry) => entry.offer.competitorId === competitorId)
    .reduce(
      (total, entry) =>
        total +
        segment.prospectCount *
          segment.fullCatalogValue *
          valueMoment(segment, entry.lower, entry.upper, entry.share),
      0,
    );
}

function topTierId(input: DesignLinterInput) {
  const totalProspects = input.segments.reduce(
    (total, segment) =>
      total +
      (input.baseline.segments.find((entry) => entry.id === segment.id)?.prospectCount ?? 0),
    0,
  );
  return [...input.tiers].sort((left, right) => {
    const leftAverage =
      input.segments.reduce((total, segment) => {
        const weight =
          input.baseline.segments.find((entry) => entry.id === segment.id)?.prospectCount ?? 0;
        return total + effectivePrice(left, segment.seatCount) * weight;
      }, 0) / Math.max(1, totalProspects);
    const rightAverage =
      input.segments.reduce((total, segment) => {
        const weight =
          input.baseline.segments.find((entry) => entry.id === segment.id)?.prospectCount ?? 0;
        return total + effectivePrice(right, segment.seatCount) * weight;
      }, 0) / Math.max(1, totalProspects);
    return rightAverage - leftAverage || left.id.localeCompare(right.id);
  })[0]?.id;
}

function revenueForOffer(
  segment: SegmentEconomicsReadout,
  predicate: (offer: ExpandedOffer) => boolean,
) {
  return activeOfferEntries(segment)
    .filter((entry) => predicate(entry.offer))
    .reduce(
      (total, entry) => total + entry.share * entry.offer.effectivePrice * segment.prospectCount,
      0,
    );
}

/**
 * Deterministic menu critic. All counterfactual recomputation is injected so
 * the rule engine stays independent of persisted scenario and UI contracts.
 */
export function lintDesign(input: DesignLinterInput): readonly LinterFinding[] {
  const findings: LinterFinding[] = [];
  const offers = [...input.tiers, ...input.addOns];
  const hasFreeTier = input.tiers.some((tier) => tier.price === 0);

  for (const feature of input.features) {
    const offersWithFeature = offers.filter((offer) => offer.featureIds.includes(feature.id));
    if (
      offersWithFeature.length === 0 ||
      (hasFreeTier && offers.length > 0 && offersWithFeature.length === offers.length)
    ) {
      const allOffers = offersWithFeature.length === offers.length;
      findings.push({
        id: "E1",
        severity: "info",
        title: "Fence carries no screening information",
        message: allOffers
          ? `${feature.name} appears in every current offer, so it cannot help buyers sort themselves.`
          : `${feature.name} is not in any current offer, so it cannot help buyers sort themselves.`,
      });
    }
  }

  for (const tier of input.tiers) {
    const perSegment = input.baseline.segments.map((segment) => ({
      segment,
      share: ownOfferAtTier(segment, tier.id).reduce(
        (total, offer) => total + (segment.selection.shares[offer.id] ?? 0),
        0,
      ),
    }));
    if (perSegment.length > 0 && perSegment.every(({ share }) => share <= EPSILON)) {
      findings.push({
        id: "E2",
        severity: "warning",
        title: `${tier.name} is dominated in the rational model`,
        message: `${tier.name} receives zero envelope share in every segment, including every add-on combination built on it. It is inert in this model, though a deliberate asymmetric decoy can have behavioral effects the simulation does not invent a number for.`,
        citation: "Huber, Payne & Puto (1982) — asymmetric dominance effect",
        segmentIds: perSegment.map(({ segment }) => segment.id),
      });
    }
  }

  const inversionKeys = new Set<string>();
  for (const segment of input.segments) {
    for (const expensive of input.tiers) {
      for (const cheaper of input.tiers) {
        if (expensive.id === cheaper.id) continue;
        if (
          effectivePrice(expensive, segment.seatCount) <= effectivePrice(cheaper, segment.seatCount)
        )
          continue;
        const missing = cheaper.featureIds.filter(
          (featureId) => !expensive.featureIds.includes(featureId),
        );
        if (missing.length === 0) continue;
        const key = `${expensive.id}:${cheaper.id}`;
        if (inversionKeys.has(key)) continue;
        inversionKeys.add(key);
        findings.push({
          id: "E3",
          severity: "warning",
          title: "Higher-priced tier has a fence inversion",
          message: `${expensive.name} costs more than ${cheaper.name} for ${segment.name} but omits ${featureNames(missing, input.features).join(", ")}. That breaks a nested upgrade path; it may still be intentional good-better-different packaging.`,
          segmentIds: [segment.id],
        });
      }
    }
  }

  for (const segment of input.baseline.segments) {
    if (segment.ownBuyers <= EPSILON) continue;
    const ownTierOffers = segment.selection.offers.filter(
      (offer) => offer.owner === "own" && offer.kind === "tier",
    );
    const maximum = ownTierOffers.reduce<ExpandedOffer | undefined>(
      (winner, offer) => (!winner || offer.value > winner.value ? offer : winner),
      undefined,
    );
    if (!maximum) continue;
    const belowMax = activeOfferEntries(segment).filter(
      (entry) => entry.offer.owner === "own" && entry.offer.value < maximum.value - EPSILON,
    );
    const lowerBuyerMass = belowMax.reduce(
      (total, entry) => total + entry.share * segment.prospectCount,
      0,
    );
    const shareOfBuyers = lowerBuyerMass / segment.ownBuyers;
    if (shareOfBuyers <= DOWNGRADE_MASS_THRESHOLD) continue;
    const mostSelected = [...belowMax].sort((left, right) => right.share - left.share)[0]?.offer;
    const missing = mostSelected
      ? maximum.featureIds.filter((featureId) => !mostSelected.featureIds.includes(featureId))
      : [];
    const priceGap = mostSelected ? maximum.effectivePrice - mostSelected.effectivePrice : 0;
    const lowerRevenue = revenueForOffer(
      segment,
      (offer) => offer.owner === "own" && offer.value < maximum.value - EPSILON,
    );
    findings.push({
      id: "E4",
      severity: "warning",
      title: "Large downgrade mass",
      message: `${segment.id} has ${percent(shareOfBuyers)} of own buying mass below ${maximum.name}. The ${money(priceGap)} price gap and ${missing.length > 0 ? featureNames(missing, input.features).join(", ") : "value fence"} explain the downgrade path (about ${money(lowerRevenue)} MRR in lower-value choices).`,
      metrics: { shareOfBuyers, lowerValueMrr: lowerRevenue },
      segmentIds: [segment.id],
    });
  }

  for (const freeTier of input.tiers.filter((tier) => tier.price === 0)) {
    const withoutFree = input.simulate({
      tiers: input.tiers.filter((tier) => tier.id !== freeTier.id),
      addOns: input.addOns,
    });
    const absorbedBuyers = Math.max(0, withoutFree.paidBuyers - input.baseline.paidBuyers);
    const absorbedShare =
      withoutFree.paidBuyers === 0 ? 0 : absorbedBuyers / withoutFree.paidBuyers;
    const recoveredMrr = withoutFree.mrr - input.baseline.mrr;
    if (absorbedShare <= EPSILON && recoveredMrr <= EPSILON) continue;
    const recoveredShare = input.baseline.mrr <= EPSILON ? 1 : recoveredMrr / input.baseline.mrr;
    findings.push({
      id: "E5",
      severity: recoveredShare > FREE_LEAKAGE_WARNING_THRESHOLD ? "warning" : "info",
      title: "Free tier leakage",
      message: `${freeTier.name} absorbs ${percent(absorbedShare)} of would-be paid demand; removing it would ${recoveredMrr >= 0 ? "recover" : "cost"} about ${money(recoveredMrr)} MRR.`,
      metrics: { absorbedShare, recoveredMrr },
    });
  }

  for (const addOn of input.addOns) {
    const withoutAddOn = input.simulate({
      tiers: input.tiers,
      addOns: input.addOns.filter((candidate) => candidate.id !== addOn.id),
    });
    const netContribution = input.baseline.mrr - withoutAddOn.mrr;
    if (netContribution < -EPSILON) {
      findings.push({
        id: "E6",
        severity: "warning",
        title: "Add-on cannibalizes the menu",
        message: `${addOn.name} has a net MRR contribution of ${money(netContribution)} after buyers re-sort without it. Consider a different fence or price.`,
        metrics: { netContribution },
      });
    }
  }

  for (const segment of input.baseline.segments) {
    const competitors = segment.selection.offers.filter(
      (offer): offer is ExpandedOffer & { competitorId: string } =>
        offer.owner === "competitor" && typeof offer.competitorId === "string",
    );
    for (const competitorId of new Set(competitors.map((offer) => offer.competitorId))) {
      const loss = competitorLossForOffer(segment, competitorId);
      const lossShare = segment.potential === 0 ? 0 : loss / segment.potential;
      if (lossShare <= COMPETITOR_LOSS_THRESHOLD) continue;
      const competitor = competitors.find((offer) => offer.competitorId === competitorId);
      const competitorEntries = activeOfferEntries(segment).filter(
        (entry) => entry.offer.competitorId === competitorId,
      );
      const beaten = activeOfferEntries(segment)
        .filter(
          (entry) =>
            entry.offer.owner === "own" &&
            competitorEntries.some(
              (competitorEntry) => entry.upper <= competitorEntry.lower + EPSILON,
            ),
        )
        .map((entry) => entry.offer.name);
      findings.push({
        id: "E7",
        severity: "warning",
        title: "Competitor takes material potential",
        message: `${competitor?.name ?? competitorId} takes ${percent(lossShare)} of ${segment.id} potential (about ${money(loss)}). It beats ${beaten.length > 0 ? beaten.join(", ") : "the current own menu"} on the envelope.`,
        metrics: { lossShare, competitorLoss: loss },
        segmentIds: [segment.id],
      });
    }
  }

  const visiblePaidOffers = offers.filter((offer) => offer.price > 0).length;
  if (visiblePaidOffers > 4) {
    findings.push({
      id: "B1",
      severity: "info",
      title: "Menu may create choice overload",
      message: `${visiblePaidOffers} paid offers are visible. Keep the decision easy and validate this directional behavioral risk with your audience rather than assuming a numeric effect.`,
      citation: "Iyengar & Lepper (2000) — choice assortment evidence; replication caveats apply",
      metrics: { visiblePaidOffers },
    });
  }

  const topTier = topTierId(input);
  if (topTier && input.baseline.totalProspects > EPSILON && input.baseline.mrr > EPSILON) {
    const topShare =
      input.baseline.segments.reduce((total, segment) => {
        const shares = ownOfferAtTier(segment, topTier).reduce(
          (sum, offer) => sum + (segment.selection.shares[offer.id] ?? 0),
          0,
        );
        return total + shares * segment.prospectCount;
      }, 0) / input.baseline.totalProspects;
    const topMrr = input.baseline.segments.reduce(
      (total, segment) => total + revenueForOffer(segment, (offer) => offer.tierId === topTier),
      0,
    );
    const topMrrShare = topMrr / input.baseline.mrr;
    if (topShare < 0.02 && topMrrShare < 0.01) {
      const tier = input.tiers.find((candidate) => candidate.id === topTier);
      findings.push({
        id: "B2",
        severity: "info",
        title: "Top tier is a weak anchor",
        message: `${tier?.name ?? "The top tier"} takes ${percent(topShare)} of buyers and ${percent(topMrrShare)} of MRR. Prune it, or position it deliberately as an anchor or decoy rather than expecting a modeled uplift.`,
        citation: "Tversky & Kahneman (1974) — anchoring heuristic",
        metrics: { topShare, topMrrShare },
      });
    }
  }

  return findings;
}
