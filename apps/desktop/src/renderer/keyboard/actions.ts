/**
 * What a key does, in the words and colours of the visual keyboard (spec §7.2): one of six kinds,
 * a short label, and, for transparent keys, what they fall through to.
 */
import type { ActionConfig, KeyName, LayerConfig, Modifier } from "@keyrift/config-types";

import { keyLabel } from "./key-labels.ts";

/** The six colour groups of the keyboard. A key with modifiers is a "combo". */
export type ActionKind = "key" | "combo" | "layer" | "tapHold" | "macro" | "none";

export function actionKind(action: ActionConfig): ActionKind {
  switch (action.type) {
    case "key":
      return action.mods !== undefined && action.mods.length > 0 ? "combo" : "key";
    case "mods":
      return "combo";
    case "layer":
      return "layer";
    case "tapHold":
      return "tapHold";
    case "macro":
      return "macro";
    case "none":
      return "none";
  }
}

/** Tailwind classes for a key's background and text, per kind. */
export const KIND_COLORS: Record<ActionKind, string> = {
  key: "bg-sky-900/60 text-sky-100",
  combo: "bg-violet-900/60 text-violet-100",
  layer: "bg-amber-900/60 text-amber-100",
  tapHold: "bg-emerald-900/60 text-emerald-100",
  macro: "bg-rose-900/60 text-rose-100",
  none: "bg-red-950/60 text-red-200",
};

const MOD_LABELS: Record<Modifier, string> = {
  LeftCtrl: "Ctrl",
  LeftShift: "Shift",
  LeftAlt: "Alt",
  LeftSuper: "Super",
  RightCtrl: "RCtrl",
  RightShift: "RShift",
  RightAlt: "AltGr",
  RightSuper: "RSuper",
};

/**
 * The label split for a keycap: for a key with modifiers, the modifiers ("Super", "Ctrl+Shift")
 * go on their own small line above the key ("1"), so short keys don't cut the label off.
 */
export function capLabel(
  action: ActionConfig,
  layers: LayerConfig[],
): { mods: string | null; main: string } {
  if (action.type === "key" && action.mods !== undefined && action.mods.length > 0) {
    return {
      mods: action.mods.map((mod) => MOD_LABELS[mod]).join("+"),
      main: keyLabel(action.key),
    };
  }
  return { mods: null, main: actionLabel(action, layers) };
}

/**
 * A short label for `action`, e.g. "Esc", "Ctrl+C", "Alt nav" (a layer, by its name), "Esc / Ctrl"
 * (tap / hold), "Macro (3)" or "None". `layers` gives the names for layer actions.
 */
export function actionLabel(action: ActionConfig, layers: LayerConfig[]): string {
  switch (action.type) {
    case "key":
      return [...(action.mods ?? []).map((mod) => MOD_LABELS[mod]), keyLabel(action.key)].join("+");
    case "mods":
      return action.mods.map((mod) => MOD_LABELS[mod]).join("+");
    case "layer": {
      const layer = layers.find((l) => l.id === action.layer);
      const name = layer?.name ?? action.layer;
      return action.mode === "toggle" ? `${name} (toggle)` : name;
    }
    case "tapHold":
      return `${actionLabel(action.tap, layers)} / ${actionLabel(action.hold, layers)}`;
    case "macro":
      return `Macro (${action.steps.length})`;
    case "none":
      return "None";
  }
}

/** What a key on layer `index` does: its own action, or (if transparent) the one below it. */
export type KeyMeaning =
  /** The layer sets this key. */
  | { source: "own"; action: ActionConfig }
  /** Transparent: a lower layer sets it (`layerId`). */
  | { source: "below"; action: ActionConfig; layerId: string }
  /** No layer down to the base sets it: the key does its normal thing. */
  | { source: "passthrough" };

/** Looks up `key` on layer `index`, then on each layer below it (spec F-LAY-1). */
export function keyMeaning(layers: LayerConfig[], index: number, key: KeyName): KeyMeaning {
  for (let i = index; i >= 0; i--) {
    const layer = layers[i];
    const action = layer?.keys?.[key];
    if (layer !== undefined && action !== undefined) {
      return i === index
        ? { source: "own", action }
        : { source: "below", action, layerId: layer.id };
    }
  }
  return { source: "passthrough" };
}
