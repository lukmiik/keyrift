/**
 * Record (spec F-UI-3, F-MAC-2): keys typed on a virtual keyboard reach the test engine and the
 * app's Record buttons.
 * Needs /dev/uinput access; skipped without it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vite-plus/test";

import type { EngineClient } from "../src/main/engine/client.ts";
import { watchReloads } from "../test/config-reloads.ts";
import { TestApp } from "../test/test-app.ts";
import { TestEngine } from "../test/test-engine.ts";
import { TestKeyboard, uinputAvailable } from "../test/test-keyboard.ts";

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) {
    await step();
  }
  cleanup = [];
});

/** Waits until the engine has grabbed `count` devices; fails after 5 s. */
async function waitGrabbed(client: EngineClient, count: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (true) {
    const status = await client.call("status.get", {});
    if (status.devices.grabbed === count) return;
    if (status.devices.blocked.length > 0) {
      // Keys are only typed once the test engine holds the keyboard, so nothing leaked.
      throw new Error(
        "another program grabbed the test keyboard first, probably a keyrift.service older " +
          "than the rule that makes normal engines skip `keyrift-test-*` devices: update it",
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`engine grabbed ${status.devices.grabbed} devices, expected ${count}`);
    }
    await sleep(20);
  }
}

/** A private engine with a virtual keyboard that only it grabs. */
async function engineWithKeyboard() {
  const engine = await TestEngine.start();
  cleanup.push(() => engine.stop());
  const keyboard = await TestKeyboard.attach(engine);
  cleanup.push(() => keyboard.close());
  const client = await engine.connect();
  cleanup.push(() => client.close());
  // Type nothing until the test engine holds the keyboard.
  await waitGrabbed(client, 1);
  return { engine, keyboard, client };
}

describe.skipIf(!uinputAvailable())("test keyboard", () => {
  it("reaches only the test engine, which records it", { timeout: 60_000 }, async () => {
    const { keyboard, client } = await engineWithKeyboard();

    await client.call("record.start", {});
    await keyboard.tap("KEY_F2");
    await keyboard.tap("KEY_CAPSLOCK");
    await sleep(100);
    expect(await client.call("record.stop", {})).toEqual({ keys: ["KEY_F2", "KEY_CAPSLOCK"] });
  });
});

describe.skipIf(!uinputAvailable())("Record buttons", () => {
  it("take keys typed on the virtual keyboard", { timeout: 60_000 }, async () => {
    const { engine, keyboard } = await engineWithKeyboard();
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
