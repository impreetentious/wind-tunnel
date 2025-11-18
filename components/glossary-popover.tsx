"use client";

import { useId, useState } from "react";

import { glossary, type GlossaryTermId } from "@/content/glossary";

export function GlossaryPopover({ term }: { term: GlossaryTermId }) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const entry = glossary[term];

  return (
    <span className="relative inline-flex align-middle">
      <button
        aria-controls={descriptionId}
        aria-expanded={open}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-line text-xs font-bold text-muted hover:border-accent hover:text-accent"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="sr-only">What is {entry.label}?</span>
        <span aria-hidden="true">?</span>
      </button>
      {open ? (
        <span
          className="absolute top-7 left-0 z-10 w-72 rounded-xl border border-line bg-canvas-raised p-3 text-left text-xs leading-5 text-muted shadow-[var(--shadow)]"
          id={descriptionId}
          role="tooltip"
        >
          {entry.definition}
        </span>
      ) : null}
    </span>
  );
}
