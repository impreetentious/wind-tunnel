import type { LinterFindingId } from "@/lib/engine/linter";

export const linterExplainers: Record<LinterFindingId, string> = {
  E1: "A fence only screens when some buyers receive it and others do not.",
  E2: "Zero envelope share means the current rational model never selects this offer. A decoy can be intentional, but its behavioral effect is not quantified here.",
  E3: "A nested ladder makes the upgrade path legible. Non-nested offers can be deliberate when buyer jobs differ.",
  E4: "This is a price-and-fence trade-off, not an automatic failure. Check whether lower-value selection is intentional before changing it.",
  E5: "This compares the current menu with the same menu minus the free tier; it is a counterfactual, not a forecast of causal behavior.",
  E6: "Net contribution includes the tier-mix shift after the add-on disappears, so it is more informative than add-on revenue alone.",
  E7: "Competitor loss belongs in the own-catalog waterfall. It is not competitor revenue or buyer surplus.",
  B1: "Choice-overload evidence is directional and context-sensitive. The linter flags menu complexity; it never invents an uplift or penalty.",
  B2: "Anchoring is a behavioral consideration, not an economics multiplier. Decide whether the top tier has a deliberate strategic role.",
};
