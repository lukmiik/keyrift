import { describe, expect, it } from "vite-plus/test";

import { applyEdit } from "./profile-edits.ts";
import { testProfile } from "./test-profile.ts";

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
