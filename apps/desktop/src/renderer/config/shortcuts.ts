/**
 * Shortcut rules (spec F-SC-1, §5.5): `trigger` (modifiers + key) → action. Helpers for the
 * Shortcuts screen: labels, the duplicate check (the same rule as the engine's, which rejects a
 * profile with duplicate triggers) and turning recorded key presses into a trigger.
 */
import type {
  KeyName,
  ShortcutConfig,
  TriggerConfig,
  TriggerModifier,
} from "@keyrift/config-types";

import { keyLabel } from "../keyboard/key-labels.ts";

/** Either-side modifiers first (what people mean by "Ctrl+C"), then the side-specific ones. */
export const GENERIC_MODIFIERS: TriggerModifier[] = ["Ctrl", "Shift", "Alt", "Super"];
export const SIDE_MODIFIERS: TriggerModifier[] = [
  "LeftCtrl",
  "LeftShift",
  "LeftAlt",
  "LeftSuper",
  "RightCtrl",
  "RightShift",
  "RightAlt",
  "RightSuper",
];
const ORDER = [...GENERIC_MODIFIERS, ...SIDE_MODIFIERS];

export const TRIGGER_MODIFIER_LABELS: Record<TriggerModifier, string> = {
  Ctrl: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
  Super: "Super",
  LeftCtrl: "LCtrl",
  LeftShift: "LShift",
  LeftAlt: "LAlt",
  LeftSuper: "LSuper",
  RightCtrl: "RCtrl",
  RightShift: "RShift",
  RightAlt: "AltGr",
  RightSuper: "RSuper",
};

/** `mods` without repeats, in a fixed order. */
export function sortTriggerModifiers(mods: readonly TriggerModifier[]): TriggerModifier[] {
  return ORDER.filter((mod) => mods.includes(mod));
}

/** E.g. "Super+C", "LCtrl+Shift+Esc". */
export function triggerLabel(trigger: TriggerConfig): string {
  return [
    ...sortTriggerModifiers(trigger.mods ?? []).map((mod) => TRIGGER_MODIFIER_LABELS[mod]),
    keyLabel(trigger.key),
  ].join("+");
}

/**
 * The same text for triggers the engine treats as duplicates: the same set of modifiers (order and
 * repeats don't matter) and the same key. "Ctrl" and "LeftCtrl" count as different, like in the
 * engine.
 */
function triggerSignature(trigger: TriggerConfig): string {
  return [...sortTriggerModifiers(trigger.mods ?? []), trigger.key].join("+");
}

/**
 * For each rule, the index of an earlier rule with the same trigger, or null. The engine rejects a
 * profile with duplicates, so the screen flags every rule that has a non-null entry.
 */
export function duplicateOf(shortcuts: readonly ShortcutConfig[]): (number | null)[] {
  const first = new Map<string, number>();
  return shortcuts.map((shortcut, index) => {
    const signature = triggerSignature(shortcut.trigger);
    const earlier = first.get(signature);
    if (earlier !== undefined) return earlier;
    first.set(signature, index);
    return null;
  });
}

/** Whether `trigger` is already used by a rule other than `except` (the one being edited). */
export function triggerTaken(
  shortcuts: readonly ShortcutConfig[],
  trigger: TriggerConfig,
  except: number | null,
): number | null {
  const signature = triggerSignature(trigger);
  const index = shortcuts.findIndex(
    (shortcut, i) => i !== except && triggerSignature(shortcut.trigger) === signature,
  );
  return index === -1 ? null : index;
}

/** The two sides of each either-side modifier. */
const SIDES: Record<string, readonly TriggerModifier[]> = {
  Ctrl: ["LeftCtrl", "RightCtrl"],
  Shift: ["LeftShift", "RightShift"],
  Alt: ["LeftAlt", "RightAlt"],
  Super: ["LeftSuper", "RightSuper"],
};

/**
 * Whether `trigger` matches while exactly the side modifiers `held` are down, like the engine
 * (`Trigger::matches`): each side-specific modifier is held, each either-side one has at least one
 * side held, and nothing else is held.
 */
function matchesHeld(trigger: TriggerConfig, held: ReadonlySet<TriggerModifier>): boolean {
  const mods = trigger.mods ?? [];
  const allowed = new Set(mods.flatMap((mod) => SIDES[mod] ?? [mod]));
  return (
    [...held].every((mod) => allowed.has(mod)) &&
    mods.every((mod) => (SIDES[mod] ?? [mod]).some((side) => held.has(side)))
  );
}

/**
 * For each rule, the earlier rules that match every key press it matches, or null. The first
 * matching rule wins (spec §5.5), so such a rule is never used: e.g. "Ctrl+C" before "LCtrl+C".
 * Duplicates are reported by `duplicateOf` and get null here. Checks every combination of held
 * modifiers (2^8), so a rule hidden by several earlier ones together is found too.
 */
export function neverUsed(shortcuts: readonly ShortcutConfig[]): (number[] | null)[] {
  const duplicates = duplicateOf(shortcuts);
  const helds = Array.from(
    { length: 1 << SIDE_MODIFIERS.length },
    (_, mask) => new Set(SIDE_MODIFIERS.filter((_, bit) => (mask & (1 << bit)) !== 0)),
  );
  return shortcuts.map((rule, index) => {
    if (duplicates[index] !== null) return null;
    const earlier = shortcuts
      .slice(0, index)
      .map((other, i) => ({ other, i }))
      .filter(({ other }) => other.trigger.key === rule.trigger.key);
    if (earlier.length === 0) return null;
    const takenBy = new Set<number>();
    for (const held of helds) {
      if (!matchesHeld(rule.trigger, held)) continue;
      const first = earlier.find(({ other }) => matchesHeld(other.trigger, held));
      if (first === undefined) return null;
      takenBy.add(first.i);
    }
    return takenBy.size > 0 ? [...takenBy].sort((a, b) => a - b) : null;
  });
}

/** The trigger modifier for a pressed modifier key. AltGr stays its own key; the rest either side. */
const MODIFIER_KEYS: Partial<Record<KeyName, TriggerModifier>> = {
  KEY_LEFTCTRL: "Ctrl",
  KEY_RIGHTCTRL: "Ctrl",
  KEY_LEFTSHIFT: "Shift",
  KEY_RIGHTSHIFT: "Shift",
  KEY_LEFTALT: "Alt",
  KEY_RIGHTALT: "RightAlt",
  KEY_LEFTMETA: "Super",
  KEY_RIGHTMETA: "Super",
};

/**
 * The trigger for keys pressed while recording, e.g. Left Super then C → "Super+C". Null until a
 * key that isn't a modifier is pressed: that key ends the trigger.
 */
export function recordedTrigger(keys: readonly KeyName[]): TriggerConfig | null {
  const key = keys.at(-1);
  if (key === undefined || MODIFIER_KEYS[key] !== undefined) return null;
  const mods = sortTriggerModifiers(
    keys.slice(0, -1).flatMap((pressed) => MODIFIER_KEYS[pressed] ?? []),
  );
  return mods.length > 0 ? { mods, key } : { key };
}
