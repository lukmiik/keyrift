import type { ShortcutConfig } from "@keyrift/config-types";
import { describe, expect, it } from "vite-plus/test";

import {
  duplicateOf,
  neverUsed,
  recordedTrigger,
  triggerLabel,
  triggerTaken,
} from "./shortcuts.ts";

const rule = (trigger: ShortcutConfig["trigger"]): ShortcutConfig => ({
  trigger,
  action: { type: "none" },
});

describe("triggerLabel", () => {
  it("puts either-side modifiers first, then side-specific ones, then the key", () => {
    expect(triggerLabel({ mods: ["LeftCtrl", "Super"], key: "KEY_C" })).toBe("Super+LCtrl+C");
    expect(triggerLabel({ key: "KEY_ESC" })).toBe("Esc");
  });
});

describe("duplicateOf", () => {
  it("points each repeated trigger at the first rule that has it", () => {
    const rules = [
      rule({ mods: ["Super"], key: "KEY_C" }),
      rule({ mods: ["Ctrl"], key: "KEY_C" }),
      rule({ mods: ["Super"], key: "KEY_C" }),
      rule({ mods: ["Super"], key: "KEY_V" }),
      rule({ mods: ["Super"], key: "KEY_C" }),
    ];
    expect(duplicateOf(rules)).toEqual([null, null, 0, null, 0]);
  });

  it("ignores the order of the modifiers, like the engine", () => {
    const rules = [
      rule({ mods: ["Ctrl", "Shift"], key: "KEY_T" }),
      rule({ mods: ["Shift", "Ctrl"], key: "KEY_T" }),
    ];
    expect(duplicateOf(rules)).toEqual([null, 0]);
  });

  it("counts either-side and one-side modifiers as different, like the engine", () => {
    const rules = [
      rule({ mods: ["Ctrl"], key: "KEY_C" }),
      rule({ mods: ["LeftCtrl"], key: "KEY_C" }),
    ];
    expect(duplicateOf(rules)).toEqual([null, null]);
  });
});

describe("triggerTaken", () => {
  it("finds another rule with the trigger, but not the rule being edited", () => {
    const rules = [rule({ mods: ["Super"], key: "KEY_C" }), rule({ key: "KEY_F1" })];
    expect(triggerTaken(rules, { mods: ["Super"], key: "KEY_C" }, null)).toBe(0);
    expect(triggerTaken(rules, { mods: ["Super"], key: "KEY_C" }, 0)).toBeNull();
    expect(triggerTaken(rules, { key: "KEY_F2" }, null)).toBeNull();
  });
});

describe("recordedTrigger", () => {
  it("waits for a key that isn't a modifier", () => {
    expect(recordedTrigger([])).toBeNull();
    expect(recordedTrigger(["KEY_LEFTMETA"])).toBeNull();
  });

  it("turns held modifiers into either-side ones, except AltGr", () => {
    expect(recordedTrigger(["KEY_LEFTMETA", "KEY_C"])).toEqual({ mods: ["Super"], key: "KEY_C" });
    expect(recordedTrigger(["KEY_RIGHTCTRL", "KEY_LEFTSHIFT", "KEY_T"])).toEqual({
      mods: ["Ctrl", "Shift"],
      key: "KEY_T",
    });
    expect(recordedTrigger(["KEY_RIGHTALT", "KEY_E"])).toEqual({
      mods: ["RightAlt"],
      key: "KEY_E",
    });
    expect(recordedTrigger(["KEY_F5"])).toEqual({ key: "KEY_F5" });
  });
});

describe("neverUsed", () => {
  it("finds a side-specific rule after an either-side one", () => {
    const rules = [
      rule({ mods: ["Ctrl"], key: "KEY_C" }),
      rule({ mods: ["LeftCtrl"], key: "KEY_C" }),
    ];
    expect(neverUsed(rules)).toEqual([null, [0]]);
  });

  it("keeps both when the side-specific rule comes first", () => {
    const rules = [
      rule({ mods: ["LeftCtrl"], key: "KEY_C" }),
      rule({ mods: ["Ctrl"], key: "KEY_C" }),
    ];
    // Right Ctrl+C still reaches rule 2.
    expect(neverUsed(rules)).toEqual([null, null]);
  });

  it("keeps an either-side rule after rules for each side: both sides held still reach it", () => {
    const rules = [
      rule({ mods: ["LeftCtrl"], key: "KEY_C" }),
      rule({ mods: ["RightCtrl"], key: "KEY_C" }),
      rule({ mods: ["Ctrl"], key: "KEY_C" }),
    ];
    expect(neverUsed(rules)).toEqual([null, null, null]);
  });

  it("lists every earlier rule that takes a part of its presses", () => {
    const rules = [
      rule({ mods: ["LeftCtrl"], key: "KEY_C" }),
      rule({ mods: ["Ctrl"], key: "KEY_C" }),
      rule({ mods: ["Ctrl", "LeftCtrl"], key: "KEY_C" }),
    ];
    // Rule 3 needs Left Ctrl: Left alone goes to rule 1, both sides to rule 2.
    expect(neverUsed(rules)).toEqual([null, null, [0, 1]]);
  });

  it("ignores rules for other keys or other modifiers, and leaves duplicates to duplicateOf", () => {
    const rules = [
      rule({ mods: ["Ctrl"], key: "KEY_C" }),
      rule({ mods: ["Ctrl"], key: "KEY_V" }),
      rule({ mods: ["Ctrl", "Shift"], key: "KEY_C" }),
      rule({ key: "KEY_C" }),
      rule({ mods: ["Ctrl"], key: "KEY_C" }),
    ];
    expect(neverUsed(rules)).toEqual([null, null, null, null, null]);
  });
});
