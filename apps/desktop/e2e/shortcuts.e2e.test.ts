/**
 * The Shortcuts screen against the real engine: a rule added in the GUI is saved, and the engine
 * accepts the profile.
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

describe("shortcuts screen", () => {
  it("adds the spec's example rule; the engine accepts it", { timeout: 60_000 }, async () => {
    const engine = await TestEngine.start({
      profile: { version: 1, name: "Test", layers: [{ id: "base", keys: {} }], shortcuts: [] },
    });
    cleanup.push(() => engine.stop());
    const reloads = await watchReloads(engine);
    cleanup.push(() => reloads.close());
    const app = await TestApp.start({ socketPath: engine.socketPath, configDir: engine.configDir });
    cleanup.push(() => app.close());
    const w = app.window;

    await w.getByRole("button", { name: "Shortcuts", exact: true }).click();
    await w.getByRole("button", { name: "Add shortcut" }).click();
    const dialog = w.getByRole("dialog");
    // The new rule starts as Super+C → C; make the output Ctrl+Shift+C (spec §6.5's example).
    const output = dialog.getByRole("group", { name: "Output" });
    await output.getByRole("button", { name: "Left Ctrl" }).click();
    await output.getByRole("button", { name: "Left Shift" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await w.getByRole("cell", { name: "Ctrl+Shift+C" }).waitFor({ timeout: 5000 });
    await reloads.next();

    const saved = JSON.parse(
      readFileSync(join(engine.configDir, "profiles/test.json"), "utf8"),
    ) as {
      shortcuts: unknown;
    };
    expect(saved.shortcuts).toEqual([
      {
        trigger: { mods: ["Super"], key: "KEY_C" },
        action: { type: "key", key: "KEY_C", mods: ["LeftCtrl", "LeftShift"] },
      },
    ]);
  });
});
