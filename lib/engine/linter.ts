import { allowanceDeadZones, evaluateCreditPack, type CreditPack } from "./credits";
import type { DiscountReadout } from "./discount";
import type { MigrationReadout } from "./migration";
import { lognormalPartialExpectation, scaleDistribution } from "./stats";
import type { EconomicsReadout, ExpandedOffer, SegmentEconomicsReadout } from "./types";
import type { UsageBand, UsageMetricDefinition, UsagePricing } from "./usage";

const EPSILON = 1e-9;
const DOWNGRADE_MASS_THRESHOLD = 0.3;
const FREE_LEAKAGE_WARNING_THRESHOLD = 0.15;
const COMPETITOR_LOSS_THRESHOLD = 0.25;
const OVERAGE_CLIFF_EXPOSURE_THRESHOLD = 0.2;
const CREDIT_EXPIRY_UTILISATION_THRESHOLD = 0.7;
const ALLOWANCE_DEAD_ZONE_THRESHOLD = 0.05;
const STRANDED_BASE_THRESHOLD = 0.5;
const MIGRATION_CHURN_THRESHOLD = 0.1;
const DISCOUNT_LEAKAGE_WARNING_THRESHOLD = 0.1;

export type LinterSeverity = "info" | "warning";
/**
 * Rule families. **E** economic, **B** behavioral (§4.9); **U** hybrid usage and credits
 * (§4.17); **M** repricing an existing base (§4.18); **P** discount policy (§4.19). Every U rule
 * is gated on the offer carrying a pack or a usage line, every M rule on a migration readout
 * being supplied, and every P rule on a discount readout, so a flat menu with no installed base
 * and no discount policy is provably silent on all of them and every frozen fixture stays
 * unchanged.
 */
export type LinterFindingId =
  | "E1"
  | "E2"
  | "E3"
  | "E4"
  | "E5"
  | "E6"
  | "E7"
  | "B1"
  | "B2"
  | "U1"
  | "U2"
  | "U3"
  | "M1"
  | "M2"
  | "M3"
  | "P1"
  | "P2";

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
  /** Optional metered lines (§4.15). Absent = the U rules never look at this offer. */
  usagePricing?: readonly UsagePricing[];
  /** Optional prepaid packs (§4.17). Absent = the U rules never look at this offer. */
  creditPacks?: readonly CreditPack[];
}

export type LinterAddOn = LinterTier;

export interface LinterSegment {
  id: string;
  name: string;
  seatCount: number;
  /** Optional expected-usage bands (§4.15). Absent = the U rules skip this segment. */
  usageBands?: Readonly<Record<string, UsageBand>>;
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
  /** Optional usage metric catalog (§4.15/§4.17); supplies names and unit kinds to the U rules. */
  usageMetrics?: readonly UsageMetricDefinition[];
  /** Optional installed-base migration readout (§4.18). Absent = the M rules never run. */
  migration?: MigrationReadout;
  /** Optional discount-policy readout (§4.19). Absent = the P rules never run. */
  discount?: DiscountReadout;
  baseline: EconomicsReadout;
  formatMoney?: (value: number) => string;
  formatPercent?: (value: number) => string;
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
 * §4.17 rules for hybrid menus: what a prepaid pack and an included allowance do to a segment
 * that has a usage band. Every one of them iterates offer-by-offer over `creditPacks` or
 * `usagePricing`, so a menu carrying neither produces nothing here — which is what keeps the
 * frozen linter corpus provably silent on the new family.
 */
function hybridFindings(
  input: DesignLinterInput,
  displayMoney: (value: number) => string,
  displayPercent: (value: number) => string,
): LinterFinding[] {
  const findings: LinterFinding[] = [];
  const offers = [...input.tiers, ...input.addOns];
  const metrics = new Map((input.usageMetrics ?? []).map((metric) => [metric.id, metric]));
  const metricName = (metricId: string) => metrics.get(metricId)?.name ?? metricId;
  const unitLabel = (metricId: string) => metrics.get(metricId)?.unitLabel ?? "units";

  for (const offer of offers) {
    for (const pack of offer.creditPacks ?? []) {
      for (const segment of input.segments) {
        const band = segment.usageBands?.[pack.metricId];
        if (!band) continue;
        const readout = evaluateCreditPack(pack, band);

        // U1 — the pack is cheaper per unit than the overage past it, and the segment is
        // materially likely to reach that boundary. The buyer's rational move is to buy a
        // bigger pack or move up a tier, so the overage revenue this pricing implies is
        // largely imaginary.
        if (
          readout.overageCliff &&
          readout.probabilityOfOverage > OVERAGE_CLIFF_EXPOSURE_THRESHOLD
        ) {
          const multiple =
            readout.impliedUnitPrice > 0
              ? (pack.overagePerUnit ?? 0) / readout.impliedUnitPrice
              : Number.POSITIVE_INFINITY;
          findings.push({
            id: "U1",
            severity: "warning",
            title: "Overage cliff past the credit pack",
            message: `${offer.name} charges ${displayMoney(pack.overagePerUnit ?? 0)} per ${metricName(pack.metricId)} past the pack against ${displayMoney(readout.impliedUnitPrice)} inside it${Number.isFinite(multiple) ? ` — ${multiple.toFixed(1)}× the pack rate` : ""}. ${segment.name} exceeds the pack ${displayPercent(readout.probabilityOfOverage)} of the time, so the rational response is to buy a larger pack or move up a tier rather than pay the overage. Revenue modeled at the overage rate is unlikely to arrive.`,
            metrics: {
              impliedUnitPrice: readout.impliedUnitPrice,
              overagePerUnit: pack.overagePerUnit ?? 0,
              probabilityOfOverage: readout.probabilityOfOverage,
            },
            segmentIds: [segment.id],
          });
        }

        // U2 — an expiring pack whose units the segment mostly does not spend. The money is
        // real and already inside MRR; the point is that it is breakage, and buyers who watch
        // credits expire renew differently than buyers who use them.
        const expires = pack.expiresAtPeriodEnd ?? true;
        if (expires && readout.utilisation < CREDIT_EXPIRY_UTILISATION_THRESHOLD) {
          findings.push({
            id: "U2",
            severity: readout.utilisation < 0.5 ? "warning" : "info",
            title: "Credits expire unused",
            message: `${segment.name} is expected to spend ${displayPercent(readout.utilisation)} of ${offer.name}'s ${pack.packUnits} ${unitLabel(pack.metricId)} pack, forfeiting about ${readout.expectedUnusedUnits.toFixed(0)} ${unitLabel(pack.metricId)} — roughly ${displayMoney(readout.expectedBreakageRevenue)} of revenue with no delivery behind it. That is booked MRR, not a modeling error, but it is the part of the price a buyer re-reads at renewal.`,
            metrics: {
              utilisation: readout.utilisation,
              expectedUnusedUnits: readout.expectedUnusedUnits,
              expectedBreakageRevenue: readout.expectedBreakageRevenue,
            },
            segmentIds: [segment.id],
          });
        }
      }
    }

    const lines = offer.usagePricing ?? [];
    if (lines.length === 0) continue;
    for (const segment of input.segments) {
      if (!segment.usageBands) continue;
      // U3 — an allowance a segment never reaches. Deliberately restricted to consumption
      // metrics: an outcome line the buyer does not exhaust means the promised results were
      // not needed, which is a value question rather than a broken fence.
      const consumptionLines = lines.filter(
        (line) => (metrics.get(line.metricId)?.unitKind ?? "consumption") === "consumption",
      );
      for (const zone of allowanceDeadZones(
        consumptionLines,
        segment.usageBands,
        ALLOWANCE_DEAD_ZONE_THRESHOLD,
      )) {
        findings.push({
          id: "U3",
          severity: "info",
          title: "Allowance never binds",
          message: `${offer.name}'s ${zone.includedUnits} ${unitLabel(zone.metricId)} of included ${metricName(zone.metricId)} is reached by ${segment.name} only ${displayPercent(zone.probabilityOfExceeding)} of the time. An allowance is a fence in usage space; this one is a number on a pricing page that never screens anybody in this segment.`,
          metrics: {
            includedUnits: zone.includedUnits,
            probabilityOfExceeding: zone.probabilityOfExceeding,
          },
          segmentIds: [segment.id],
        });
      }
    }
  }
  return findings;
}

/**
 * §4.18 rules for repricing an existing base. All three read numbers the migration engine has
 * already computed — including its own withdraw-the-incumbent counterfactual — so the linter
 * stays a pure critic rather than acquiring a second simulator. Nothing here runs unless a
 * migration readout was supplied.
 */
function migrationFindings(
  migration: MigrationReadout,
  displayMoney: (value: number) => string,
  displayPercent: (value: number) => string,
): LinterFinding[] {
  const findings: LinterFinding[] = [];

  for (const segment of migration.segments) {
    // M1 — the legacy plan is holding a cohort in place, and withdrawing it would earn more
    // even after the churn that withdrawing it causes. That second clause is the whole rule:
    // a sticky legacy plan is only a problem when the counterfactual is better.
    if (
      migration.policy !== "forced-at-renewal" &&
      segment.stayShare > STRANDED_BASE_THRESHOLD &&
      segment.grandfatherOpportunityCost > EPSILON
    ) {
      findings.push({
        id: "M1",
        severity: "warning",
        title: "Grandfathering strands a cohort on the legacy plan",
        message: `${displayPercent(segment.stayShare)} of ${segment.name}'s base stays on ${segment.cells.find((cell) => cell.stays)?.destinationName ?? "the legacy plan"} indefinitely. Withdrawing it would close at ${displayMoney(segment.withdrawnIncumbentMrr)} against ${displayMoney(segment.bridge.closingMrr)} today — ${displayMoney(segment.grandfatherOpportunityCost)} a month, net of the churn that withdrawing it causes. The legacy price, not the fence, is what this cohort is buying.`,
        metrics: {
          stayShare: segment.stayShare,
          grandfatherOpportunityCost: segment.grandfatherOpportunityCost,
          withdrawnIncumbentMrr: segment.withdrawnIncumbentMrr,
        },
        segmentIds: [segment.id],
      });
    }

    // M2 — the migration event itself pushes accounts out. Priced against what the same event
    // wins elsewhere, because "we lost X" is only half of a repricing decision.
    if (segment.churnShare > MIGRATION_CHURN_THRESHOLD) {
      // What the same migration wins from every *other* segment: the trade this churn buys.
      const upsideElsewhere = migration.bridge.expansion - segment.bridge.expansion;
      findings.push({
        id: "M2",
        severity: "warning",
        title: "The migration prices a segment into churn",
        message: `${displayPercent(segment.churnShare)} of ${segment.name}'s base leaves at the migration event, worth ${displayMoney(Math.abs(segment.bridge.churn))} of MRR. The rest of the base expands by ${displayMoney(upsideElsewhere)}${migration.policy === "forced-at-renewal" ? ", and this segment has no legacy plan to fall back to" : ""}. Decide whether that trade is the one you meant to make.`,
        metrics: {
          churnShare: segment.churnShare,
          churnedMrr: Math.abs(segment.bridge.churn),
          upsideElsewhere,
        },
        segmentIds: [segment.id],
      });
    }
  }

  // M3 — an opt-in deadline is a behavioral mechanism, and this model has no behavioral
  // coefficient. It reports the exposure rather than discounting it by an invented
  // take-up rate.
  if (migration.policy === "opt-in-with-deadline" && migration.mrrRequiringBuyerAction > EPSILON) {
    findings.push({
      id: "M3",
      severity: "info",
      title: "Legacy pricing depends on buyers acting by a deadline",
      message: `${displayMoney(migration.mrrRequiringBuyerAction)} of closing MRR sits on accounts that must actively opt in before the deadline to keep it. The model assumes every account that would prefer the legacy plan completes that step; inertia is not modeled here, so treat this figure as the ceiling rather than the forecast.`,
      metrics: { mrrRequiringBuyerAction: migration.mrrRequiringBuyerAction },
    });
  }
  return findings;
}

/**
 * §4.19 rules for what the discount policy does to the menu. Both read numbers the discount
 * engine has already computed through the same envelope, and neither runs without one.
 */
function discountFindings(
  discount: DiscountReadout,
  displayMoney: (value: number) => string,
  displayPercent: (value: number) => string,
): LinterFinding[] {
  const findings: LinterFinding[] = [];

  // P1 — the structural one. A permitted floor on a cheaper tier pushes a higher tier off the
  // envelope, so the fence between them stops screening anybody. This is the finding the
  // dollar figure cannot express: a share going to zero, not a margin going down.
  for (const erosion of discount.fenceErosions) {
    findings.push({
      id: "P1",
      severity: "warning",
      title: "The discount policy has un-fenced the menu",
      message: `A ${displayPercent(erosion.floorFraction)} floor on ${erosion.discountedTierName} makes it beat ${erosion.erodedTierName} for ${erosion.segmentName}'s top decile — the buyers ${erosion.erodedTierName} exists for. That tier takes ${displayPercent(erosion.shareAtList)} of the segment at list, about ${displayMoney(erosion.mrrAtRisk)} of MRR, and the fence between the two stops screening once the floor is reached.${erosion.approver ? ` ${erosion.approver} can authorize that depth.` : ""} The fence you designed is only as strong as the discount you permit.`,
      metrics: {
        floorFraction: erosion.floorFraction,
        shareAtList: erosion.shareAtList,
        mrrAtRisk: erosion.mrrAtRisk,
      },
      segmentIds: [erosion.segmentId],
    });
  }

  // P2 — the dollar figure, computed through the envelope rather than multiplied through, so
  // it includes the buyers who re-sort upward as well as the ones who simply pay less.
  if (discount.discountLeakageShare > DISCOUNT_LEAKAGE_WARNING_THRESHOLD) {
    findings.push({
      id: "P2",
      severity: "warning",
      title: "Permitted discounts move material revenue",
      message: `The permitted floors and their expected hit rates take achieved MRR to ${displayMoney(discount.achievedMrr)} against ${displayMoney(discount.listMrr)} at list — ${displayPercent(discount.discountLeakageShare)}, or ${displayMoney(discount.discountLeakage)}. That figure is computed by re-running the choice model at the discounted prices, so it already includes buyers who move tier rather than only buyers who pay less.`,
      metrics: {
        discountLeakage: discount.discountLeakage,
        discountLeakageShare: discount.discountLeakageShare,
        achievedMrr: discount.achievedMrr,
      },
    });
  }
  return findings;
}

/**
 * Deterministic menu critic. All counterfactual recomputation is injected so
 * the rule engine stays independent of persisted scenario and UI contracts.
 */
export function lintDesign(input: DesignLinterInput): readonly LinterFinding[] {
  const findings: LinterFinding[] = [];
  const displayMoney = input.formatMoney ?? money;
  const displayPercent = input.formatPercent ?? percent;
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
      message: `${segment.id} has ${displayPercent(shareOfBuyers)} of own buying mass below ${maximum.name}. The ${displayMoney(priceGap)} price gap and ${missing.length > 0 ? featureNames(missing, input.features).join(", ") : "value fence"} explain the downgrade path (about ${displayMoney(lowerRevenue)} MRR in lower-value choices).`,
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
      message: `${freeTier.name} absorbs ${displayPercent(absorbedShare)} of would-be paid demand; removing it would ${recoveredMrr >= 0 ? "recover" : "cost"} about ${displayMoney(recoveredMrr)} MRR.`,
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
        message: `${addOn.name} has a net MRR contribution of ${displayMoney(netContribution)} after buyers re-sort without it. Consider a different fence or price.`,
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
        message: `${competitor?.name ?? competitorId} takes ${displayPercent(lossShare)} of ${segment.id} potential (about ${displayMoney(loss)}). It beats ${beaten.length > 0 ? beaten.join(", ") : "the current own menu"} on the envelope.`,
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

  findings.push(...hybridFindings(input, displayMoney, displayPercent));
  if (input.migration) {
    findings.push(...migrationFindings(input.migration, displayMoney, displayPercent));
  }
  if (input.discount) {
    findings.push(...discountFindings(input.discount, displayMoney, displayPercent));
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
        message: `${tier?.name ?? "The top tier"} takes ${displayPercent(topShare)} of buyers and ${displayPercent(topMrrShare)} of MRR. Prune it, or position it deliberately as an anchor or decoy rather than expecting a modeled uplift.`,
        citation: "Tversky & Kahneman (1974) — anchoring heuristic",
        metrics: { topShare, topMrrShare },
      });
    }
  }

  return findings;
}
