import type { Scenario } from "./schemas";

type Design = Scenario["designs"][number];
type Tier = Design["tiers"][number];
type AddOn = Design["addOns"][number];

export const MAX_TIERS = 5;
export const MAX_ADD_ONS = 3;

function identifierBase(name: string, fallback: string) {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function nextId(existingIds: readonly string[], base: string) {
  if (!existingIds.includes(base)) return base;
  let suffix = 2;
  while (existingIds.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function updateActiveDesign(scenario: Scenario, updater: (design: Design) => Design): Scenario {
  return {
    ...scenario,
    designs: scenario.designs.map((design) =>
      design.id === scenario.activeDesignId ? updater(design) : design,
    ),
  };
}

export function activeDesign(scenario: Scenario): Design {
  const design = scenario.designs.find((candidate) => candidate.id === scenario.activeDesignId);
  if (!design) throw new RangeError("The scenario does not have an active design.");
  return design;
}

export function selectActiveDesign(scenario: Scenario, designId: string): Scenario {
  if (!scenario.designs.some((design) => design.id === designId)) return scenario;
  return { ...scenario, activeDesignId: designId };
}

export function createDesign(scenario: Scenario, name = "New design"): Scenario {
  const normalizedName = name.trim() || "New design";
  const id = nextId(
    scenario.designs.map((design) => design.id),
    identifierBase(normalizedName, "design"),
  );
  return {
    ...scenario,
    // A ready scenario requires every saved design to contain a tier. Start
    // with one intentionally unfenced card so a new design is editable while
    // the persisted scenario remains valid throughout construction.
    designs: [
      ...scenario.designs,
      {
        id,
        name: normalizedName,
        tiers: [{ id: "tier-1", name: "Tier 1", price: 49, priceMetric: "flat", featureIds: [] }],
        addOns: [],
      },
    ],
    activeDesignId: id,
  };
}

export function duplicateActiveDesign(scenario: Scenario): Scenario {
  const source = activeDesign(scenario);
  const name = `${source.name} copy`;
  const designId = nextId(
    scenario.designs.map((design) => design.id),
    identifierBase(name, "design"),
  );
  const tierIds = new Set<string>();
  const addOnIds = new Set<string>();
  const tiers = source.tiers.map((tier) => {
    const id = nextId([...tierIds], `${tier.id}-copy`);
    tierIds.add(id);
    return { ...tier, id };
  });
  const addOns = source.addOns.map((addOn) => {
    const id = nextId([...addOnIds], `${addOn.id}-copy`);
    addOnIds.add(id);
    return { ...addOn, id };
  });
  return {
    ...scenario,
    designs: [...scenario.designs, { ...source, id: designId, name, tiers, addOns }],
    activeDesignId: designId,
  };
}

export function renameActiveDesign(scenario: Scenario, name: string): Scenario {
  const nextName = name.trim();
  if (!nextName) return scenario;
  return updateActiveDesign(scenario, (design) => ({ ...design, name: nextName }));
}

export function addTier(scenario: Scenario, options: { free?: boolean } = {}): Scenario {
  const design = activeDesign(scenario);
  if (design.tiers.length >= MAX_TIERS) return scenario;
  const isFree = options.free ?? false;
  if (isFree && design.tiers.some((tier) => tier.price === 0)) return scenario;
  const position = design.tiers.length + 1;
  const name = isFree ? "Free" : `Tier ${position}`;
  const id = nextId(
    design.tiers.map((tier) => tier.id),
    identifierBase(name, "tier"),
  );
  const tier: Tier = {
    id,
    name,
    price: isFree ? 0 : 49,
    priceMetric: "flat",
    featureIds: [],
  };
  return updateActiveDesign(scenario, (current) => ({
    ...current,
    tiers: [...current.tiers, tier],
  }));
}

export function removeTier(scenario: Scenario, tierId: string): Scenario {
  return updateActiveDesign(scenario, (design) => ({
    ...design,
    tiers: design.tiers.filter((tier) => tier.id !== tierId),
  }));
}

export function updateTier(
  scenario: Scenario,
  tierId: string,
  updater: (tier: Tier) => Tier,
): Scenario {
  return updateActiveDesign(scenario, (design) => ({
    ...design,
    tiers: design.tiers.map((tier) => (tier.id === tierId ? updater(tier) : tier)),
  }));
}

export function toggleTierFeature(scenario: Scenario, tierId: string, featureId: string): Scenario {
  return updateTier(scenario, tierId, (tier) => ({
    ...tier,
    featureIds: tier.featureIds.includes(featureId)
      ? tier.featureIds.filter((candidate) => candidate !== featureId)
      : [...tier.featureIds, featureId],
  }));
}

export function toggleFreeTier(scenario: Scenario, enabled: boolean): Scenario {
  const design = activeDesign(scenario);
  const freeTier = design.tiers.find((tier) => tier.price === 0);
  if (enabled && !freeTier) return addTier(scenario, { free: true });
  if (!enabled && freeTier) return removeTier(scenario, freeTier.id);
  return scenario;
}

export function addAddOn(scenario: Scenario): Scenario {
  const design = activeDesign(scenario);
  if (design.addOns.length >= MAX_ADD_ONS || scenario.model.features.length === 0) return scenario;
  const position = design.addOns.length + 1;
  const name = `Add-on ${position}`;
  const id = nextId(
    design.addOns.map((addOn) => addOn.id),
    identifierBase(name, "add-on"),
  );
  const addOn: AddOn = {
    id,
    name,
    price: 19,
    priceMetric: "flat",
    featureIds: [scenario.model.features[0].id],
  };
  return updateActiveDesign(scenario, (current) => ({
    ...current,
    addOns: [...current.addOns, addOn],
  }));
}

export function removeAddOn(scenario: Scenario, addOnId: string): Scenario {
  return updateActiveDesign(scenario, (design) => ({
    ...design,
    addOns: design.addOns.filter((addOn) => addOn.id !== addOnId),
  }));
}

export function updateAddOn(
  scenario: Scenario,
  addOnId: string,
  updater: (addOn: AddOn) => AddOn,
): Scenario {
  return updateActiveDesign(scenario, (design) => ({
    ...design,
    addOns: design.addOns.map((addOn) => (addOn.id === addOnId ? updater(addOn) : addOn)),
  }));
}

export function toggleAddOnFeature(
  scenario: Scenario,
  addOnId: string,
  featureId: string,
): Scenario {
  return updateAddOn(scenario, addOnId, (addOn) => {
    const hasFeature = addOn.featureIds.includes(featureId);
    if (hasFeature && addOn.featureIds.length === 1) return addOn;
    return {
      ...addOn,
      featureIds: hasFeature
        ? addOn.featureIds.filter((candidate) => candidate !== featureId)
        : [...addOn.featureIds, featureId],
    };
  });
}
