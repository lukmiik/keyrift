/**
 * Record (spec F-UI-3, F-MAC-2): keys typed on a virtual keyboard reach the test engine and the
 * app's Record buttons.
 * Needs /dev/uinput access; skipped without it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { watchReloads } from "../test/config-reloads.ts";
import { TestApp } from "../test/test-app.ts";
import { engineWithKeyboard, uinputAvailable } from "../test/test-keyboard.ts";

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) {
    await step();
  }
  cleanup = [];
});

describe.skipIf(!uinputAvailable())("test keyboard", () => {
  it("reaches only the test engine, which records it", { timeout: 60_000 }, async () => {
    const { keyboard, client } = await engineWithKeyboard(cleanup);

    await client.call("record.start", {});
    await keyboard.tap("KEY_F2");
    await keyboard.tap("KEY_CAPSLOCK");
    await sleep(100);
    expect(await client.call("record.stop", {})).toEqual({ keys: ["KEY_F2", "KEY_CAPSLOCK"] });
  });
});

describe.skipIf(!uinputAvailable())("Record buttons", () => {
  it("take keys typed on the virtual keyboard", { timeout: 60_000 }, async () => {
    const { engine, keyboard } = await engineWithKeyboard(cleanup);
    const reloads = await watchReloads(engine);
    cleanup.push(() => reloads.close());
    const app = await TestApp.start({ socketPath: engine.socketPath, configDir: engine.configDir });
    cleanup.push(() => app.close());
    const w = app.window;
    const inspector = w.getByRole("region", { name: "Inspector" });

    // A key field: the next key pressed becomes the output key.
    await w.getByRole("button", { name: "Caps: Caps (unchanged)" }).click();
    await inspector.getByRole("combobox", { name: "Type" }).click();
    await w.getByRole("option", { name: "Key", exact: true }).click();
    await inspector.getByRole("button", { name: "Record Output key" }).click();
    await inspector.getByText("Press a key…").waitFor({ timeout: 5000 });
    await keyboard.tap("KEY_F5");
    await w.getByRole("button", { name: "Caps: F5" }).waitFor({ timeout: 5000 });

    // Macro steps: every key until Stop.
    await inspector.getByRole("combobox", { name: "Type" }).click();
    await w.getByRole("option", { name: "Macro", exact: true }).click();
    await inspector.getByRole("button", { name: "Record steps" }).click();
    await inspector.getByText("Press keys…").waitFor({ timeout: 5000 });
    await keyboard.tap("KEY_H");
    await keyboard.tap("KEY_I");
    await inspector.getByText("H I").waitFor({ timeout: 5000 });
    await inspector.getByRole("button", { name: "Stop recording" }).click();
    await w.getByRole("button", { name: "Caps: Macro (3)" }).waitFor({ timeout: 5000 });

    await reloads.next();
    const saved = JSON.parse(
      readFileSync(join(engine.configDir, "profiles/test.json"), "utf8"),
    ) as {
      layers: { keys: object }[];
    };
    expect(saved.layers[0]?.keys).toEqual({
      KEY_CAPSLOCK: {
        type: "macro",
        steps: [
          { type: "key", key: "KEY_F5" },
          { type: "key", key: "KEY_H" },
          { type: "key", key: "KEY_I" },
        ],
      },
    });
  });
});
