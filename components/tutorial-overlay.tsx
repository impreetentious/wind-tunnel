"use client";

import { useEffect, useState } from "react";

import {
  advanceTutorial,
  currentTutorialStep,
  INITIAL_TUTORIAL_STATE,
  restartTutorial,
  TUTORIAL_STEPS,
  type TutorialSurface,
  type TutorialState,
} from "@/content/tutorial";

export function TutorialOverlay({
  onNavigate,
}: {
  onNavigate: (surface: TutorialSurface) => void;
}) {
  const [state, setState] = useState<TutorialState>(INITIAL_TUTORIAL_STATE);
  const step = currentTutorialStep(state);
  useEffect(() => {
    if (!step) return;
    onNavigate(step.surface);
    const timer = window.setTimeout(
      () =>
        document
          .querySelector(`[data-tour="${step.anchor ?? ""}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" }),
      80,
    );
    return () => window.clearTimeout(timer);
  }, [onNavigate, step]);
  if (!step)
    return (
      <button
        className="min-h-10 rounded-lg border border-line bg-canvas-raised px-3 text-sm font-semibold text-ink hover:border-accent"
        onClick={() => setState(restartTutorial())}
        type="button"
      >
        Worked example
      </button>
    );
  return (
    <div
      aria-describedby="tutorial-body"
      aria-labelledby="tutorial-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-end bg-black/35 p-4 sm:place-items-center"
      role="dialog"
    >
      <section className="w-full max-w-lg rounded-2xl border border-line bg-canvas-raised p-5 shadow-xl">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Worked example · {state.stepIndex + 1} / {TUTORIAL_STEPS.length}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-ink" id="tutorial-title">
          {step.title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted" id="tutorial-body">
          {step.body}
        </p>
        <div className="mt-5 flex flex-wrap justify-between gap-3">
          <button
            className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm font-semibold text-ink hover:border-accent"
            onClick={() => setState(INITIAL_TUTORIAL_STATE)}
            type="button"
          >
            Close
          </button>
          <button
            className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong"
            onClick={() => setState((current) => advanceTutorial(current))}
            type="button"
          >
            {state.stepIndex + 1 === TUTORIAL_STEPS.length ? "Finish walkthrough" : "Next step"}
          </button>
        </div>
      </section>
    </div>
  );
}
