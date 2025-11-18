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
} as const;

export type GlossaryTermId = keyof typeof glossary;
