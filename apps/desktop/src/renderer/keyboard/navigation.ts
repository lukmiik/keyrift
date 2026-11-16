/**
 * Arrow-key movement between keys of different sizes: from one key, find the nearest key in a
 * direction. Used for "roving focus": only one key is a Tab stop, the arrows move between keys.
 */
import type { KeyName } from "@keyrift/config-types";

import type { KeySpec } from "./layouts.ts";

export type Direction = "left" | "right" | "up" | "down";

/** The arrow keys' `event.key` values and their direction. */
export const ARROW_DIRECTIONS: Partial<Record<string, Direction>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

function center(spec: KeySpec): { x: number; y: number } {
  return { x: spec.x + (spec.w ?? 1) / 2, y: spec.y + (spec.h ?? 1) / 2 };
}

/**
 * The key nearest to `from` in `direction`, or null at the edge. Distance along the direction
 * counts once, sideways distance three times, so "down" from G picks B rather than a key further
 * right that is a bit closer.
 */
export function nearestKey(keys: KeySpec[], from: KeyName, direction: Direction): KeyName | null {
  const start = keys.find((spec) => spec.key === from);
  if (start === undefined) return null;
  const a = center(start);
  let best: { key: KeyName; score: number } | null = null;
  for (const spec of keys) {
    const b = center(spec);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const [along, sideways] =
      direction === "left"
        ? [-dx, dy]
        : direction === "right"
          ? [dx, dy]
          : direction === "up"
            ? [-dy, dx]
            : [dy, dx];
    // Only keys that are really further in that direction (not on the same row/column).
    if (along < 0.3) continue;
    const score = along + 3 * Math.abs(sideways);
    if (best === null || score < best.score) best = { key: spec.key, score };
  }
  return best?.key ?? null;
}
