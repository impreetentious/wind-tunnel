import { simulateEconomics } from "./economics";
import { lognormalQuantile, scaleDistribution } from "./stats";
import type { ExpandedOffer, TieMode } from "./types";

export type BundlingRegime = "components" | "pure-bundle" | "mixed";

export interface BundlingSegment {
  id: string;
  prospectCount: number;
  sigma: number;
  valueA: number;
  valueB: number;
}

export interface BundlingPrices {
  /** Undefined is the documented “not offered” sentinel. */
  a?: number;
  b?: number;
  bundle?: number;
}

export interface BundlingInput {
  segments: readonly BundlingSegment[];
  tieMode?: TieMode;
}

export interface BundlingCandidateGrid {
  a: readonly number[];
  b: readonly number[];
  bundle: readonly number[];
}

export interface BundlingRegimeResult {
  regime: BundlingRegime;
  prices: BundlingPrices;
  revenue: number;
  evaluatedMenus: number;
}

export interface BundlingAnalysis {
  components: BundlingRegimeResult;
  pureBundle: BundlingRegimeResult;
  mixed: BundlingRegimeResult;
  best: BundlingRegimeResult;
  candidates: BundlingCandidateGrid;
  tieMode: TieMode;
}

const EPSILON = 1e-9;

function validate(input: BundlingInput) {
  if (input.segments.length === 0)
    throw new RangeError("Bundling analysis needs at least one segment.");
  const ids = new Set<string>();
  for (const segment of input.segments) {
    if (!segment.id || ids.has(segment.id))
      throw new RangeError("Bundling segment IDs must be non-empty and unique.");
    ids.add(segment.id);
    for (const [label, value] of Object.entries({
      "prospect count": segment.prospectCount,
      sigma: segment.sigma,
      "value A": segment.valueA,
      "value B": segment.valueB,
    })) {
      if (!(Number.isFinite(value) && value >= 0)) {
        throw new RangeError(
          `Bundling segment “${segment.id}” ${label} must be finite and non-negative.`,
        );
      }
    }
  }
}

function offer(
  id: string,
  name: string,
  value: number,
  price: number,
  featureIds: string[],
): ExpandedOffer {
  return {
    id,
    name,
    owner: "own",
    kind: "tier",
    value,
    effectivePrice: price,
    featureIds,
  };
}

function offersFor(segment: BundlingSegment, regime: BundlingRegime, prices: BundlingPrices) {
  const offers: ExpandedOffer[] = [
    {
      id: "outside",
      name: "Outside option",
      owner: "outside",
      kind: "outside",
      value: 0,
      effectivePrice: 0,
      featureIds: [],
    },
  ];
  if (regime === "components") {
    if (prices.a === undefined || prices.b === undefined) {
      throw new RangeError("Pure components requires prices for both goods.");
    }
    offers.push(
      offer("good-a", "Good A", segment.valueA, prices.a, ["a"]),
      offer("good-b", "Good B", segment.valueB, prices.b, ["b"]),
      offer("goods-ab", "Goods A + B", segment.valueA + segment.valueB, prices.a + prices.b, [
        "a",
        "b",
      ]),
    );
  } else {
    if (regime === "mixed" && prices.a !== undefined) {
      offers.push(offer("good-a", "Good A", segment.valueA, prices.a, ["a"]));
    }
    if (regime === "mixed" && prices.b !== undefined) {
      offers.push(offer("good-b", "Good B", segment.valueB, prices.b, ["b"]));
    }
    if (prices.bundle !== undefined) {
      offers.push(
        offer("goods-ab", "Goods A + B", segment.valueA + segment.valueB, prices.bundle, [
          "a",
          "b",
        ]),
      );
    }
  }
  return offers;
}

function validMenu(regime: BundlingRegime, prices: BundlingPrices) {
  if (regime === "components") return prices.a !== undefined && prices.b !== undefined;
  if (regime === "pure-bundle") return prices.bundle !== undefined;
  if (prices.a === undefined && prices.b === undefined && prices.bundle === undefined) return false;
  return !(
    prices.a !== undefined &&
    prices.b !== undefined &&
    prices.bundle !== undefined &&
    prices.bundle > prices.a + prices.b + EPSILON
  );
}

/** Evaluates one exact menu through the standard upper-envelope economics engine. */
export function evaluateBundlingRegime(
  input: BundlingInput,
  regime: BundlingRegime,
  prices: BundlingPrices,
) {
  validate(input);
  if (!validMenu(regime, prices))
    throw new RangeError("The bundling menu is not valid for its regime.");
  return simulateEconomics({
    segments: input.segments.map((segment) => ({
      id: segment.id,
      prospectCount: segment.prospectCount,
      fullCatalogValue: segment.valueA + segment.valueB,
      sigma: segment.sigma,
      offers: offersFor(segment, regime, prices),
      selectionOptions: { tieMode: input.tieMode ?? "conservative" },
    })),
  });
}

function unique(values: readonly number[]) {
  return [
    ...new Set(values.map((value) => (Object.is(value, -0) ? 0 : Number(value.toPrecision(14))))),
  ]
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
}

function candidatesFor(input: BundlingInput, value: (segment: BundlingSegment) => number) {
  const exact = input.segments.flatMap((segment) => {
    const distribution = scaleDistribution(segment.sigma);
    const scales =
      segment.sigma === 0
        ? [1]
        : [0.1, 0.5, 0.9].map((probability) => lognormalQuantile(probability, distribution));
    return scales.flatMap((scale) => {
      const candidate = value(segment) * scale;
      return [candidate, candidate > 0 ? candidate * (1 - 1e-6) : 0];
    });
  });
  return unique([0, ...exact]);
}

function candidateGrid(input: BundlingInput): BundlingCandidateGrid {
  return {
    a: candidatesFor(input, (segment) => segment.valueA),
    b: candidatesFor(input, (segment) => segment.valueB),
    bundle: candidatesFor(input, (segment) => segment.valueA + segment.valueB),
  };
}

function better(candidate: BundlingRegimeResult, best: BundlingRegimeResult | undefined) {
  if (!best || candidate.revenue > best.revenue + EPSILON) return true;
  if (candidate.revenue < best.revenue - EPSILON) return false;
  const total =
    (candidate.prices.a ?? 0) + (candidate.prices.b ?? 0) + (candidate.prices.bundle ?? 0);
  const bestTotal = (best.prices.a ?? 0) + (best.prices.b ?? 0) + (best.prices.bundle ?? 0);
  return total < bestTotal - EPSILON;
}

function search(
  input: BundlingInput,
  regime: BundlingRegime,
  menus: Iterable<BundlingPrices>,
): BundlingRegimeResult {
  let best: BundlingRegimeResult | undefined;
  let evaluatedMenus = 0;
  for (const prices of menus) {
    if (!validMenu(regime, prices)) continue;
    evaluatedMenus += 1;
    const candidate: BundlingRegimeResult = {
      regime,
      prices,
      revenue: evaluateBundlingRegime(input, regime, prices).mrr,
      evaluatedMenus,
    };
    if (better(candidate, best)) best = candidate;
  }
  if (!best) throw new RangeError(`No valid ${regime} bundling menu was searched.`);
  return { ...best, evaluatedMenus };
}

function* componentMenus(grid: BundlingCandidateGrid) {
  for (const a of grid.a) for (const b of grid.b) yield { a, b };
}

function* bundleMenus(grid: BundlingCandidateGrid) {
  for (const bundle of grid.bundle) yield { bundle };
}

function* mixedMenus(grid: BundlingCandidateGrid) {
  const aCandidates: (number | undefined)[] = [undefined, ...grid.a];
  const bCandidates: (number | undefined)[] = [undefined, ...grid.b];
  const bundleCandidates: (number | undefined)[] = [undefined, ...grid.bundle];
  for (const a of aCandidates) {
    for (const b of bCandidates) {
      for (const bundle of bundleCandidates) yield { a, b, bundle };
    }
  }
  // The exact component regime is nested by offering the combined purchase at
  // the sum of its parts, even when that sum is not otherwise a grid point.
  for (const a of grid.a) for (const b of grid.b) yield { a, b, bundle: a + b };
}

/** Searches the finite, disclosed price grid and never claims a continuous global optimum. */
export function analyzeBundling(input: BundlingInput): BundlingAnalysis {
  validate(input);
  const candidates = candidateGrid(input);
  const components = search(input, "components", componentMenus(candidates));
  const pureBundle = search(input, "pure-bundle", bundleMenus(candidates));
  const mixed = search(input, "mixed", mixedMenus(candidates));
  const best = [components, pureBundle, mixed].reduce((winner, candidate) =>
    better(candidate, winner) ? candidate : winner,
  );
  return {
    components,
    pureBundle,
    mixed,
    best,
    candidates,
    tieMode: input.tieMode ?? "conservative",
  };
}
