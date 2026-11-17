/**
 * Tester (spec F-UI-4, M5 exit criteria): keys typed on a virtual keyboard light up on the Tester's
 * keyboard and appear in its event table with what the engine did with them.
 * Needs /dev/uinput access; skipped without it.
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
  layers: [{ id: "base", name: "Base", keys: { KEY_CAPSLOCK: { type: "key", key: "KEY_ESC" } } }],
};

describe.skipIf(!uinputAvailable())("Tester", () => {
  it("shows keys typed on the virtual keyboard", { timeout: 60_000 }, async () => {
    const { engine, keyboard } = await engineWithKeyboard(cleanup, { profile: PROFILE });
    const app = await TestApp.start({ socketPath: engine.socketPath, configDir: engine.configDir });
    cleanup.push(() => app.close());
    const w = app.window;
    await w.getByRole("button", { name: "Tester" }).click();
    // The table appears with the first event; until then the screen says so.
    await w.getByText("No key events yet.").waitFor({ timeout: 5000 });
    const caps = w.getByRole("button", { name: /^Caps: / });

    await keyboard.down("KEY_CAPSLOCK");
    await expect.poll(() => caps.getAttribute("data-lit"), { timeout: 5000 }).toBe("true");
    await keyboard.up("KEY_CAPSLOCK");
    await expect.poll(() => caps.getAttribute("data-lit"), { timeout: 5000 }).toBeNull();

    const rows = w.getByRole("table", { name: "Key events" }).getByRole("row");
    // Header, then one row for the press, filled in by the release: what Caps became and how long
    // it was held.
    await expect.poll(() => rows.nth(1).textContent(), { timeout: 5000 }).toMatch(/\d+ ms/);
    expect(await rows.count()).toBe(2);
    const press = await rows.nth(1).textContent();
    expect(press).toContain("Caps");
    expect(press).toContain("Esc");
  });
});
