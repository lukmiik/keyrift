/**
 * Tray (spec F-UI-5, F-UI-8, M5 exit criteria): the tray follows the engine's state, and a toggled
 * layer gives a notification. The tray icon isn't on screen in tests; its state is read from main.
 * Needs /dev/uinput access for the layer part; skipped without it.
 */
import { afterEach, describe, expect, it } from "vite-plus/test";

import { TestApp } from "../test/test-app.ts";
import { engineWithKeyboard, uinputAvailable } from "../test/test-keyboard.ts";

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
    {
      id: "base",
      name: "Base",
      keys: { KEY_F1: { type: "layer", layer: "games", mode: "toggle" } },
    },
    { id: "games", name: "Games", keys: {} },
  ],
};

describe.skipIf(!uinputAvailable())("Tray", () => {
  it("follows the engine and notifies toggled layers", { timeout: 60_000 }, async () => {
    const { engine, keyboard, client } = await engineWithKeyboard(cleanup, { profile: PROFILE });
    const app = await TestApp.start({ socketPath: engine.socketPath, configDir: engine.configDir });
    cleanup.push(() => app.close());
    const view = async () => (await app.trayState()).view;

    await expect.poll(view, { timeout: 5000 }).toMatchObject({
      icon: "running",
      tooltip: "Keyrift: Active · Test · Base",
      toggle: { label: "Pause remapping" },
    });

    // A toggled layer: the tooltip shows it, and a notification says it turned on, then off.
    await keyboard.down("KEY_F1");
    await keyboard.up("KEY_F1");
    await expect.poll(view).toMatchObject({ tooltip: "Keyrift: Active · Test · Base → Games" });
    await keyboard.down("KEY_F1");
    await keyboard.up("KEY_F1");
    await expect
      .poll(async () => (await app.trayState()).notifications)
      .toEqual(["Games layer on", "Games layer off"]);

    // Paused from elsewhere (here the engine's own client): the tray turns grey with Resume.
    await client.call("engine.pause", {});
    await expect
      .poll(view)
      .toMatchObject({ icon: "paused", toggle: { label: "Resume remapping" } });

    // Without the engine: grey, nothing to pause.
    await engine.stop();
    await expect
      .poll(view, { timeout: 5000 })
      .toEqual({ icon: "paused", tooltip: "Keyrift: engine not running", toggle: null });
  });
});
