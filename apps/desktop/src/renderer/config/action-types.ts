/**
 * Rules for the inspector's action type selector: which types are allowed where (the engine's
 * F-TH rules), and how an action becomes another type while keeping what still fits.
 */
import type { ActionConfig, KeyName, LayerConfig, Modifier } from "@keyrift/config-types";

export type ActionType = ActionConfig["type"];

/**
 * Where an action sits. The engine allows only some types there (it rejects the profile
 * otherwise): a tap is a key, modifiers or nothing; a hold may also hold a layer; a shortcut's
 * output is a key, modifiers, nothing or a macro (spec F-SC-1).
 */
export type Slot = "key" | "tap" | "hold" | "shortcut";

export const SLOT_TYPES: Record<Slot, ActionType[]> = {
  key: ["key", "mods", "layer", "tapHold", "macro", "none"],
  tap: ["key", "mods", "none"],
  hold: ["key", "mods", "layer", "none"],
  shortcut: ["key", "mods", "macro", "none"],
};

export const TYPE_LABELS: Record<ActionType, string> = {
  key: "Key",
  mods: "Modifiers",
  layer: "Layer",
  tapHold: "Tap / hold",
  macro: "Macro",
  none: "Nothing (disabled)",
};

/** Side-specific modifiers in a fixed order, so `["LeftShift","LeftCtrl"]` saves as Ctrl+Shift. */
export const MODIFIERS: Modifier[] = [
  "LeftCtrl",
  "LeftShift",
  "LeftAlt",
  "LeftSuper",
  "RightCtrl",
  "RightShift",
  "RightAlt",
  "RightSuper",
];

export function sortModifiers(mods: readonly Modifier[]): Modifier[] {
  return MODIFIERS.filter((mod) => mods.includes(mod));
}

/** Layers a layer action can switch to: every layer but the base layer, which is always on. */
export function targetLayers(layers: LayerConfig[]): LayerConfig[] {
  return layers.slice(1);
}

/** What the conversion needs to know about where the action is. */
export type ActionContext = {
  /** The physical key being edited: the default output key. */
  key: KeyName;
  layers: LayerConfig[];
};

/**
 * A new action of `type`, keeping what fits from `from` (its key, its modifiers, its layer), so
 * trying another type and coming back loses little.
 */
export function convertAction(
  from: ActionConfig | undefined,
  type: ActionType,
  context: ActionContext,
): ActionConfig {
  const key = keyOf(from) ?? context.key;
  const mods = modsOf(from);
  switch (type) {
    case "key":
      return mods.length > 0 ? { type: "key", key, mods } : { type: "key", key };
    case "mods":
      return { type: "mods", mods: mods.length > 0 ? mods : ["LeftCtrl"] };
    case "layer": {
      const layer =
        from?.type === "layer" ? from.layer : (targetLayers(context.layers)[0]?.id ?? "base");
      return { type: "layer", layer, mode: "hold" };
    }
    case "tapHold": {
      // The old action becomes the tap, if a tap may be that.
      const tap =
        from !== undefined && SLOT_TYPES.tap.includes(from.type)
          ? from
          : ({ type: "key", key } satisfies ActionConfig);
      return { type: "tapHold", tap, hold: { type: "mods", mods: ["LeftCtrl"] } };
    }
    case "macro":
      return {
        type: "macro",
        steps: [mods.length > 0 ? { type: "key", key, mods } : { type: "key", key }],
      };
    case "none":
      return { type: "none" };
  }
}

/** The output key inside `action`, if it has one. */
function keyOf(action: ActionConfig | undefined): KeyName | undefined {
  switch (action?.type) {
    case "key":
      return action.key;
    case "tapHold":
      return keyOf(action.tap);
    case "macro": {
      const step = action.steps.find((s) => s.type === "key");
      return step?.type === "key" ? step.key : undefined;
    }
    default:
      return undefined;
  }
}

function modsOf(action: ActionConfig | undefined): Modifier[] {
  switch (action?.type) {
    case "key":
    case "mods":
      return action.mods ?? [];
    default:
      return [];
  }
}
