import type { KeyboardEvent } from "react";

/** Implements the horizontal ARIA tab-list keyboard pattern with roving focus. */
export function handleHorizontalTabKey<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  tabs: readonly T[],
  active: T,
  select: (tab: T) => void,
  elementId: (tab: T) => string,
) {
  if (!(["ArrowLeft", "ArrowRight", "Home", "End"] as const).includes(event.key as never)) {
    return;
  }
  event.preventDefault();
  const current = Math.max(0, tabs.indexOf(active));
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowRight"
          ? (current + 1) % tabs.length
          : (current - 1 + tabs.length) % tabs.length;
  const next = tabs[nextIndex];
  select(next);
  document.getElementById(elementId(next))?.focus();
}
