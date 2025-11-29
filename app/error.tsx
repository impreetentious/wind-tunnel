"use client";

export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-[-0.04em] text-ink">
        Something in this view stopped working.
      </h1>
      <p className="leading-7 text-muted">
        Your scenario is still saved in this browser. Try again — and if this view keeps failing,
        open Share → Scenario transfer and export your JSON before clearing site data.
      </p>
      <p className="rounded-xl border border-line bg-canvas-raised px-4 py-3 font-mono text-xs text-ink">
        {error.message}
      </p>
      <div>
        <button
          className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong"
          onClick={reset}
          type="button"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
