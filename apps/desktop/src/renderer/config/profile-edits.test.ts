import { describe, expect, it } from "vite-plus/test";

import type { Profile } from "@keyrift/config-types";

import { applyEdit, layerReferences } from "./profile-edits.ts";
import { deepFreeze, testProfile } from "./test-profile.ts";

/** Base with Caps → Esc and two keys that switch to "nav" (one inside a tap-hold); "nav", "num". */
function linkedProfile(): Profile {
  return deepFreeze({
    version: 1,
    layers: [
      {
        id: "base",
        keys: {
          KEY_CAPSLOCK: { type: "key", key: "KEY_ESC" },
          KEY_RIGHTALT: { type: "layer", mode: "hold", layer: "nav" },
          KEY_SPACE: {
            type: "tapHold",
            tap: { type: "key", key: "KEY_SPACE" },
            hold: { type: "layer", mode: "hold", layer: "nav" },
          },
        },
      },
      { id: "nav", keys: { KEY_H: { type: "key", key: "KEY_LEFT" } } },
      { id: "num", keys: {} },
    ],
  });
}

describe("applyEdit", () => {
  describe("setKey", () => {
    it("maps a key on a layer", () => {
      const before = testProfile();
      const after = applyEdit(before, {
        type: "setKey",
        layerId: "nav",
        key: "KEY_H",
        action: { type: "key", key: "KEY_LEFT" },
      });

      expect(after.layers?.[1].keys).toEqual({ KEY_H: { type: "key", key: "KEY_LEFT" } });
      // A new profile; the old one is untouched (it is frozen, so changing it would have thrown).
      expect(after).not.toBe(before);
      expect(before.layers?.[1].keys).toEqual({});
      // The layer that didn't change is shared, not copied.
      expect(after.layers?.[0]).toBe(before.layers?.[0]);
    });

    it("replaces a key's existing action", () => {
      const after = applyEdit(testProfile(), {
        type: "setKey",
        layerId: "base",
        key: "KEY_CAPSLOCK",
        action: { type: "none" },
      });

      expect(after.layers?.[0].keys).toEqual({ KEY_CAPSLOCK: { type: "none" } });
    });

    it("changes nothing on a layer that doesn't exist", () => {
      const before = testProfile();
      const after = applyEdit(before, {
        type: "setKey",
        layerId: "nope",
        key: "KEY_H",
        action: { type: "none" },
      });

      expect(after).toBe(before);
    });
  });

  describe("clearKey", () => {
    it("clears capslock from base", () => {
      const before = testProfile();
      const after = applyEdit(before, {
        type: "clearKey",
        layerId: "base",
        key: "KEY_CAPSLOCK",
      });

      expect(after.layers?.[0].keys).not.toHaveProperty("KEY_CAPSLOCK");
      expect(before.layers?.[0].keys).toHaveProperty("KEY_CAPSLOCK");
    });

    it("changes nothing for a key that isn't mapped", () => {
      const before = testProfile();
      const after = applyEdit(before, { type: "clearKey", layerId: "nav", key: "KEY_H" });

      expect(after).toBe(before);
    });
  });

  describe("renameLayer", () => {
    it("renames a layer", () => {
      const before = testProfile();
      const after = applyEdit(before, { type: "renameLayer", layerId: "nav", layerName: "Arrows" });

      expect(after.layers?.[1]).toEqual({ id: "nav", name: "Arrows", keys: {} });
      expect(before.layers?.[1].name).toBe("Nav");
    });

    it("changes nothing when the name is the same", () => {
      const before = testProfile();
      const after = applyEdit(before, { type: "renameLayer", layerId: "nav", layerName: "Nav" });

      expect(after).toBe(before);
    });

    it("changes nothing for an unknown layer", () => {
      const before = testProfile();
      const after = applyEdit(before, { type: "renameLayer", layerId: "nope", layerName: "X" });

      expect(after).toBe(before);
    });
  });

  describe("addLayer", () => {
    it("adds an empty layer at the end", () => {
      const after = applyEdit(testProfile(), { type: "addLayer", id: "num", name: "Numpad" });

      expect(after.layers?.map((layer) => layer.id)).toEqual(["base", "nav", "num"]);
      expect(after.layers?.[2]).toEqual({ id: "num", name: "Numpad", keys: {} });
    });

    it("changes nothing if the id is taken", () => {
      const before = testProfile();
      expect(applyEdit(before, { type: "addLayer", id: "nav", name: "Other" })).toBe(before);
    });
  });

  describe("removeLayer", () => {
    it("removes a layer", () => {
      const after = applyEdit(testProfile(), { type: "removeLayer", layerId: "nav" });

      expect(after.layers?.map((layer) => layer.id)).toEqual(["base"]);
    });

    it("never removes the base layer", () => {
      const before = testProfile();
      expect(applyEdit(before, { type: "removeLayer", layerId: "base" })).toBe(before);
    });

    it("changes nothing for an unknown layer", () => {
      const before = testProfile();
      expect(applyEdit(before, { type: "removeLayer", layerId: "nope" })).toBe(before);
    });
  });
});

describe("layer references", () => {
  it("finds every key that switches to a layer, also inside a tap-hold", () => {
    expect(layerReferences(linkedProfile(), "nav")).toEqual([
      { layerId: "base", key: "KEY_RIGHTALT" },
      { layerId: "base", key: "KEY_SPACE" },
    ]);
    expect(layerReferences(linkedProfile(), "num")).toEqual([]);
  });

  it("makes those keys transparent when the layer is removed", () => {
    const after = applyEdit(linkedProfile(), { type: "removeLayer", layerId: "nav" });
    expect(after.layers?.map((layer) => layer.id)).toEqual(["base", "num"]);
    expect(after.layers?.[0].keys).toEqual({ KEY_CAPSLOCK: { type: "key", key: "KEY_ESC" } });
  });
});

describe("shortcuts", () => {
  const superC = {
    trigger: { mods: ["Super" as const], key: "KEY_C" as const },
    action: { type: "key" as const, key: "KEY_C" as const, mods: ["LeftCtrl" as const] },
  };
  const f1 = { trigger: { key: "KEY_F1" as const }, action: { type: "none" as const } };

  it("adds, replaces and removes rules", () => {
    const added = applyEdit(applyEdit(testProfile(), { type: "addShortcut", shortcut: superC }), {
      type: "addShortcut",
      shortcut: f1,
    });
    expect(added.shortcuts).toEqual([superC, f1]);

    const replaced = applyEdit(added, { type: "setShortcut", index: 0, shortcut: f1 });
    expect(replaced.shortcuts).toEqual([f1, f1]);

    const removed = applyEdit(added, { type: "removeShortcut", index: 0 });
    expect(removed.shortcuts).toEqual([f1]);
    // The last one leaves an empty list, like the baseline profile's `"shortcuts": []`.
    expect(applyEdit(removed, { type: "removeShortcut", index: 0 }).shortcuts).toEqual([]);
  });

  it("returns the same profile for a rule that doesn't exist", () => {
    const profile = testProfile();
    expect(applyEdit(profile, { type: "removeShortcut", index: 0 })).toBe(profile);
    expect(applyEdit(profile, { type: "setShortcut", index: 3, shortcut: f1 })).toBe(profile);
  });
});
