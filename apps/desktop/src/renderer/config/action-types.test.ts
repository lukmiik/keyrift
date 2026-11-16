import type { ActionConfig, LayerConfig } from "@keyrift/config-types";
import { describe, expect, it } from "vite-plus/test";

import { type ActionContext, convertAction, sortModifiers } from "./action-types.ts";

const layers: LayerConfig[] = [{ id: "base" }, { id: "nav" }, { id: "num" }];
const context: ActionContext = { key: "KEY_CAPSLOCK", layers };
const ctrlC: ActionConfig = { type: "key", key: "KEY_C", mods: ["LeftCtrl"] };

describe("convertAction", () => {
  it("starts from the physical key when there is nothing to keep", () => {
    expect(convertAction(undefined, "key", context)).toEqual({ type: "key", key: "KEY_CAPSLOCK" });
    expect(convertAction(undefined, "layer", context)).toEqual({
      type: "layer",
      layer: "nav",
      mode: "hold",
    });
    expect(convertAction(undefined, "none", context)).toEqual({ type: "none" });
  });

  it("keeps the key and the modifiers", () => {
    expect(convertAction(ctrlC, "mods", context)).toEqual({ type: "mods", mods: ["LeftCtrl"] });
    expect(convertAction(ctrlC, "macro", context)).toEqual({ type: "macro", steps: [ctrlC] });
    expect(convertAction({ type: "mods", mods: ["LeftAlt"] }, "key", context)).toEqual({
      type: "key",
      key: "KEY_CAPSLOCK",
      mods: ["LeftAlt"],
    });
  });

  it("makes the old action the tap of a tap-hold, if a tap may be that", () => {
    expect(convertAction(ctrlC, "tapHold", context)).toEqual({
      type: "tapHold",
      tap: ctrlC,
      hold: { type: "mods", mods: ["LeftCtrl"] },
    });
    const layer: ActionConfig = { type: "layer", layer: "num", mode: "toggle" };
    expect(convertAction(layer, "tapHold", context)).toMatchObject({
      tap: { type: "key", key: "KEY_CAPSLOCK" },
    });
  });

  it("takes the key back out of a tap-hold or a macro", () => {
    const tapHold = convertAction(ctrlC, "tapHold", context);
    expect(convertAction(tapHold, "key", context)).toEqual({ type: "key", key: "KEY_C" });
    const macro: ActionConfig = { type: "macro", steps: [{ type: "delay", ms: 5 }, ctrlC] };
    expect(convertAction(macro, "key", context)).toEqual({ type: "key", key: "KEY_C" });
  });
});

describe("sortModifiers", () => {
  it("orders modifiers the same way every time", () => {
    expect(sortModifiers(["RightAlt", "LeftShift", "LeftCtrl"])).toEqual([
      "LeftCtrl",
      "LeftShift",
      "RightAlt",
    ]);
  });
});
