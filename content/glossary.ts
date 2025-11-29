export const glossary = {
  wtp: {
    label: "WTP",
    definition:
      "Willingness to pay: the account-level monthly value a representative buyer places on the full feature catalog at this segment's seat count.",
  },
  confidenceBand: {
    label: "Confidence band",
    definition:
      "Your uncertainty about the base assumption. P50 is the working value; P10 and P90 describe a symmetric range in log space for later sensitivity analysis.",
  },
  spread: {
    label: "Buyer spread",
    definition:
      "How much buyers within this segment differ from one another. This is distinct from your confidence band about the segment-level assumption.",
  },
  provenance: {
    label: "Provenance",
    definition:
      "Where an assumption came from and how much confidence you place in it. This helps turn model uncertainty into a validation plan.",
  },
  fence: {
    label: "Fence",
    definition:
      "A feature deliberately included in some offers and withheld from others so buyers with different willingness to pay sort themselves into different tiers.",
  },
  captureRate: {
    label: "Capture rate",
    definition:
      "Modeled revenue divided by total catalog potential: the share of all attainable value this menu converts into MRR.",
  },
  buyerSurplus: {
    label: "Buyer surplus",
    definition:
      "Value buyers keep after paying: what an offer is worth to them minus its price. Leaving surplus is deliberate room, not waste — and here it is measured.",
  },
  decoy: {
    label: "Decoy",
    definition:
      "An offer the rational model never selects. Behavioral evidence says a dominated decoy can still lift the tier that dominates it; the linter reports the domination and never invents that uplift.",
  },
  psmPoints: {
    label: "PSM crossing points",
    definition:
      "Van Westendorp markers: PMC and PME bound the acceptable price range; IPP and OPP are the indifference and optimal price points, each read from cumulative response curves.",
  },
  partWorth: {
    label: "Part-worth",
    definition:
      "A conjoint utility weight for one attribute level, estimated from respondents' choices. Differences between levels — not absolute values — carry the meaning.",
  },
  isoUtilityRay: {
    label: "Break-even ray",
    definition:
      "The zero-utility line P = ε·V for a buyer with scale ε: offers priced above that buyer's ray are worse than not buying; offers below it are worth taking.",
  },
  competitorLoss: {
    label: "Competitor loss",
    definition:
      "Catalog potential that buyers take to a competitor instead of your menu or the outside option. It is a loss of your potential — never booked as competitor revenue here.",
  },
} as const;

export type GlossaryTermId = keyof typeof glossary;
