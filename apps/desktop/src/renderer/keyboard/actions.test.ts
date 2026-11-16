import type { ActionConfig, LayerConfig } from "@keyrift/config-types";
import { describe, expect, it } from "vite-plus/test";

import { actionKind, actionLabel, KIND_COLORS, keyMeaning } from "./actions.ts";

const LAYERS: LayerConfig[] = [
  {
    id: "base",
    name: "Base",
    keys: {
      KEY_CAPSLOCK: { type: "key", key: "KEY_ESC" },
      KEY_LEFTALT: { type: "layer", mode: "hold", layer: "alt-nav", mods: ["LeftAlt"] },
    },
  },
  { id: "alt-nav", name: "Alt nav", keys: { KEY_H: { type: "key", key: "KEY_LEFT" } } },
];

describe("actionKind", () => {
  it("calls a key with modifiers a combo", () => {
    expect(actionKind({ type: "key", key: "KEY_C" })).toBe("key");
    expect(actionKind({ type: "key", key: "KEY_C", mods: ["LeftCtrl"] })).toBe("combo");
    expect(actionKind({ type: "mods", mods: ["LeftCtrl"] })).toBe("combo");
  });
});

const LABELS: [ActionConfig, string][] = [
  [{ type: "key", key: "KEY_ESC" }, "Esc"],
  [{ type: "key", key: "KEY_C", mods: ["LeftCtrl", "LeftShift"] }, "Ctrl+Shift+C"],
  [{ type: "key", key: "KEY_A", mods: ["RightAlt"] }, "AltGr+A"],
  [{ type: "layer", mode: "hold", layer: "alt-nav" }, "Alt nav"],
  [{ type: "layer", mode: "toggle", layer: "alt-nav" }, "Alt nav (toggle)"],
  [{ type: "layer", mode: "hold", layer: "gone" }, "gone"],
  [
    {
      type: "tapHold",
      tap: { type: "key", key: "KEY_ESC" },
      hold: { type: "mods", mods: ["LeftCtrl"] },
    },
    "Esc / Ctrl",
  ],
  [
    {
      type: "macro",
      steps: [
        { type: "key", key: "KEY_A" },
        { type: "delay", ms: 10 },
      ],
    },
    "Macro (2)",
  ],
  [{ type: "none" }, "None"],
];

describe("actionLabel", () => {
  it.each(LABELS)("%j → %s", (action, label) => {
    expect(actionLabel(action, LAYERS)).toBe(label);
  });
});

describe("keyMeaning", () => {
  it("finds the layer's own action", () => {
    expect(keyMeaning(LAYERS, 1, "KEY_H")).toEqual({
      source: "own",
      action: { type: "key", key: "KEY_LEFT" },
    });
  });

  it("falls through a transparent key to the layer below", () => {
    expect(keyMeaning(LAYERS, 1, "KEY_CAPSLOCK")).toEqual({
      source: "below",
      action: { type: "key", key: "KEY_ESC" },
      layerId: "base",
    });
  });

  it("passes a key through that no layer sets", () => {
    expect(keyMeaning(LAYERS, 1, "KEY_Q")).toEqual({ source: "passthrough" });
  });
});

describe("KIND_COLORS", () => {
  it("gives every kind its own colour, with the same see-through background", () => {
    const colours = Object.values(KIND_COLORS).map(
      (classes) => /\bbg-([a-z]+)-/.exec(classes)?.[1],
    );
    expect(new Set(colours).size).toBe(colours.length);
    for (const classes of Object.values(KIND_COLORS)) {
      expect(classes).toMatch(/\bbg-[a-z]+-\d+\/60\b/);
    }
  });
});
