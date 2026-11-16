/**
 * The inspector against the real engine (spec §12 M4): one key per action type is set in the GUI,
 * and each save is validated and applied by the engine.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { watchReloads } from "../test/config-reloads.ts";
import { TestApp } from "../test/test-app.ts";
import { TestEngine } from "../test/test-engine.ts";

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) {
    await step();
  }
  cleanup = [];
});

const PROFILE = {
  version: 1,
  name: "Test",
  layers: [
    { id: "base", name: "Base", keys: {} },
    { id: "nav", name: "Nav", keys: {} },
  ],
};

describe("inspector", () => {
  it(
    "sets one key per action type; the engine accepts each save",
    { timeout: 90_000 },
    async () => {
      const engine = await TestEngine.start({ profile: PROFILE });
      cleanup.push(() => engine.stop());
      const reloads = await watchReloads(engine);
      cleanup.push(() => reloads.close());
      const app = await TestApp.start({
        socketPath: engine.socketPath,
        configDir: engine.configDir,
      });
      cleanup.push(() => app.close());
      const w = app.window;
      const inspector = w.getByRole("region", { name: "Inspector" });
      await w.getByRole("tablist", { name: "Layers" }).waitFor({ timeout: 5000 });

      /** Selects the keyboard key `key` (its label, e.g. "Q") and picks `type` in the inspector. */
      const setType = async (key: string, type: string, within = inspector) => {
        await w.getByRole("button", { name: `${key}: ${key} (unchanged)`, exact: true }).click();
        await within.getByRole("combobox", { name: "Type" }).first().click();
        await w.getByRole("option", { name: type, exact: true }).click();
      };

      // Key, with the output picked by searching.
      await setType("Q", "Key");
      const picker = inspector.getByRole("combobox", { name: "Output key" });
      await picker.fill("esc");
      await w.getByRole("option", { name: /^Esc/ }).click();
      await reloads.next();

      await setType("W", "Modifiers");
      await reloads.next();

      await setType("E", "Layer");
      await reloads.next();

      // Tap-hold: tap is the key itself, hold switches to the layer.
      await setType("R", "Tap / hold");
      const hold = inspector.getByRole("group", { name: "Hold" });
      await hold.getByRole("combobox", { name: "Type" }).click();
      await w.getByRole("option", { name: "Layer", exact: true }).click();
      await reloads.next();

      await setType("T", "Macro");
      await inspector.getByRole("button", { name: "Add delay" }).click();
      await reloads.next();

      await setType("Y", "Nothing (disabled)");
      await reloads.next();

      const saved = JSON.parse(
        readFileSync(join(engine.configDir, "profiles/test.json"), "utf8"),
      ) as {
        layers: { keys: object }[];
      };
      expect(saved.layers[0]?.keys).toEqual({
        KEY_Q: { type: "key", key: "KEY_ESC" },
        KEY_W: { type: "mods", mods: ["LeftCtrl"] },
        KEY_E: { type: "layer", layer: "nav", mode: "hold" },
        KEY_R: {
          type: "tapHold",
          tap: { type: "key", key: "KEY_R" },
          hold: { type: "layer", layer: "nav", mode: "hold" },
        },
        KEY_T: {
          type: "macro",
          steps: [
            { type: "key", key: "KEY_T" },
            { type: "delay", ms: 50 },
          ],
        },
        KEY_Y: { type: "none" },
      });
    },
  );
});
