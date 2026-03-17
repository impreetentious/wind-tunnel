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
  U1: "The comparison is the pack's own implied unit price against the rate charged past it. A cliff is a pricing choice, not an error — but the overage revenue it implies assumes buyers who do not shop for a bigger pack.",
  U2: "Breakage is computed from the segment's usage band, not assumed. It is revenue you keep; the finding is about what an unused balance does to a renewal conversation.",
  U3: "A dead allowance is only measured against this segment's usage band. Outcome-priced lines are excluded: an unspent outcome allowance is a value question, not a broken fence.",
  M1: "The comparison is against withdrawing the legacy plan and letting the same buyers re-choose, churn included. A sticky legacy cohort is only a problem when that counterfactual earns more.",
  M2: "Churn here is buyers choosing the outside option or a competitor once the migration changes what they face. It is priced against what the same migration wins elsewhere, not reported alone.",
  M3: "Opt-in take-up is behavior, and this model has no behavioral coefficient. The figure is the exposure if everyone who would prefer the legacy plan acts in time — a ceiling, not a forecast.",
  P1: "Erosion is checked at the deepest discount the policy permits, not at the average one granted. A floor that un-fences the menu does so on the first deal that reaches it.",
  P2: "Achieved MRR is the choice model re-run at discounted prices, so it counts buyers who change tier as well as buyers who pay less. It is separate from free-tier leakage (E5) and trial conversion.",
};
