/**
 * GUI tests: the real app (built, hidden window) against a private engine.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { watchReloads } from "../test/config-reloads.ts";
import { TestApp } from "../test/test-app.ts";
import type { Status } from "../src/shared/protocol.ts";
import { TestEngine } from "../test/test-engine.ts";
import { uinputAvailable } from "../test/test-keyboard.ts";

// Everything a test starts, stopped after it even when it fails.
let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) {
    await step();
  }
  cleanup = [];
});

/** Starts a private engine (with `profile` active, if given) and the app pointed at it. */
async function startAppWithEngine(profile?: object): Promise<{ app: TestApp; engine: TestEngine }> {
  const engine = await TestEngine.start({ profile });
  cleanup.push(() => engine.stop());
  const app = await TestApp.start({ socketPath: engine.socketPath, configDir: engine.configDir });
  cleanup.push(() => app.close());
  return { app, engine };
}

describe.skipIf(!uinputAvailable())("engine control and profile menu", () => {
  it("show the engine's state and profile", { timeout: 300_000 }, async () => {
    const { app } = await startAppWithEngine();
    const panel = app.window.getByRole("region", { name: "Engine" });
    const header = app.window.locator("header");
    const sidebar = app.window.locator("aside");

    // Playwright waits (up to 5 s) until the element has this text: the app needs a moment to
    // connect and ask for the status.
    await panel.getByRole("status").getByText("Active").waitFor({ timeout: 5000 });
    expect(await panel.textContent()).toContain("0 keyboards");
    await sidebar.getByRole("button", { name: "Profile: test" }).waitFor({ timeout: 5000 });
    // The Tailwind CSS loaded: the page's CSP lets the built stylesheet through.
    // (Through the element's own window: this file is type-checked without browser types.)
    const border = await header.evaluate(
      (h) => h.ownerDocument.defaultView?.getComputedStyle(h).borderBottomWidth,
    );
    expect(border).toBe("1px");
  });

  it("pauses and resumes the real engine", async () => {
    const { app, engine } = await startAppWithEngine();
    const pill = app.window.getByRole("status");
    await pill.getByText("Active").waitFor({ timeout: 5000 });

    await app.window.getByRole("switch", { name: "Remapping" }).click();
    await pill.getByText("Paused").waitFor({ timeout: 5000 });
    // Ask the engine itself, not the page: is it really paused?
    const client = await engine.connect();
    expect(await client.call("status.get", {})).toMatchObject({ state: "paused" });
    await client.close();

    await app.window.getByRole("switch", { name: "Remapping" }).click();
    await pill.getByText("Active").waitFor({ timeout: 5000 });
  });

  it("follows the engine: paused from outside, stopped", async () => {
    const { app, engine } = await startAppWithEngine();
    const pill = app.window.getByRole("status");
    await pill.getByText("Active").waitFor({ timeout: 5000 });

    // Change the engine from outside the app; the status event must reach the page.
    const client = await engine.connect();
    await client.call("engine.pause", {});
    await client.close();
    await pill.getByText("Paused").waitFor({ timeout: 5000 });

    await engine.stop();
    await pill.getByText("Not connected").waitFor({ timeout: 5000 });
  });
});

describe.skipIf(!uinputAvailable())("versions line", () => {
  it("shows the Electron version from the preload", async () => {
    const { app } = await startAppWithEngine();

    // The versions live under About on the Settings screen.
    await app.window.getByRole("button", { name: "Settings" }).click();
    const about = app.window.getByRole("region", { name: "About" });

    await about.getByText("Electron", { exact: true }).waitFor({ timeout: 5000 });
    // Any version number, so the test survives Electron upgrades.
    expect(await about.textContent()).toMatch(/Electron\s*\d+\.\d+\.\d+/);
  });
});

describe.skipIf(!uinputAvailable())("keymap screen", () => {
  it("shows the layers of the engine's active profile", async () => {
    const { app } = await startAppWithEngine({
      version: 1,
      name: "Test",
      layers: [
        { id: "base", name: "Base", keys: { KEY_CAPSLOCK: { type: "key", key: "KEY_ESC" } } },
        { id: "nav", name: "Nav" },
      ],
    });
    const layers = app.window.getByRole("tablist", { name: "Layers" });

    await layers.getByRole("tab", { name: "Nav" }).waitFor({ timeout: 5000 });
    expect(await layers.textContent()).toBe("BaseNav");
    // The keyboard is drawn: keys are placed with style properties, which the CSP must allow.
    const caps = app.window.getByRole("button", { name: "Caps: Esc" });
    expect(await caps.evaluate((b) => b.getBoundingClientRect().width)).toBeCloseTo(1.75 * 52 - 4);
    // Nothing was changed, so nothing needs saving.
    await app.window.getByText("Saved", { exact: true }).waitFor({ timeout: 5000 });
  });

  it(
    "adds, renames and deletes a layer, and the engine applies each save",
    { timeout: 60_000 },
    async () => {
      const { app, engine } = await startAppWithEngine();
      const w = app.window;
      const file = join(engine.configDir, "profiles", "test.json");
      const reloads = await watchReloads(engine);
      cleanup.push(() => reloads.close());
      const nextReload = reloads.next;
      const layerList = () =>
        (JSON.parse(readFileSync(file, "utf8")) as { layers: { id: string; name?: string }[] })
          .layers;
      await w.getByRole("tablist", { name: "Layers" }).waitFor({ timeout: 5000 });

      await w.getByRole("button", { name: "Add layer" }).click();
      await w.getByLabel("Name", { exact: true }).fill("Mouse");
      await w.getByRole("button", { name: "Add", exact: true }).click();
      await nextReload();
      expect(layerList()).toContainEqual({ id: "mouse", name: "Mouse", keys: {} });

      await w.getByRole("button", { name: "Rename layer" }).click();
      await w.getByLabel("Name", { exact: true }).fill("Mouse keys");
      await w.getByRole("button", { name: "Rename", exact: true }).click();
      await nextReload();
      expect(layerList()).toContainEqual({ id: "mouse", name: "Mouse keys", keys: {} });

      await w.getByRole("button", { name: "Delete layer" }).click();
      await w.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      await nextReload();
      expect(layerList().map((layer) => layer.id)).toEqual(["base"]);
    },
  );
});

describe.skipIf(!uinputAvailable())("devices screen", () => {
  it("enables a remembered keyboard again", async () => {
    const { app, engine } = await startAppWithEngine();
    // An excluded keyboard that isn't plugged in. The test engine sees no devices at all.
    const settingsFile = join(engine.configDir, "settings.json");
    const k120 = { vendorId: "0x046d", productId: "0xc31c", name: "Logitech K120" };
    writeFileSync(
      settingsFile,
      JSON.stringify({ version: 1, activeProfile: "test", devices: { excluded: [k120] } }),
    );

    await app.window.getByRole("button", { name: "Devices" }).click();
    const devices = app.window.getByRole("list", { name: "Devices" });
    await devices.getByText("Logitech K120").waitFor({ timeout: 5000 });
    expect(await devices.textContent()).toContain("Not connected");

    await app.window.getByRole("switch", { name: "Remap Logitech K120" }).click();
    // The row goes away once main has rewritten settings.json without the exclusion.
    await devices.getByText("Logitech K120").waitFor({ state: "detached", timeout: 5000 });
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual({
      version: 1,
      activeProfile: "test",
    });
  });
});

/** Asks the engine for its status until `check` passes (at most 5 s); returns the last status. */
async function waitForEngine(engine: TestEngine, check: (status: Status) => boolean) {
  const client = await engine.connect();
  try {
    const deadline = Date.now() + 5000;
    while (true) {
      const status = await client.call("status.get", {});
      if (check(status) || Date.now() > deadline) return status;
      await sleep(50);
    }
  } finally {
    await client.close();
  }
}

describe.skipIf(!uinputAvailable())("profile menu", () => {
  it(
    "creates, renames and deletes a profile, and the engine follows",
    { timeout: 60_000 },
    async () => {
      const { app, engine } = await startAppWithEngine();
      const w = app.window;
      const profileFile = (name: string) => join(engine.configDir, "profiles", `${name}.json`);
      const openMenu = async (current: string) => {
        await w.getByRole("button", { name: `Profile: ${current}` }).click();
      };

      // Create: the new profile becomes active in the engine.
      await openMenu("test");
      await w.getByRole("menuitem", { name: "New profile…" }).click();
      await w.getByLabel("Name", { exact: true }).fill("gaming");
      await w.getByRole("button", { name: "Create" }).click();
      expect(await waitForEngine(engine, (s) => s.profile === "gaming")).toMatchObject({
        profile: "gaming",
        configIssues: [],
      });

      // Rename: the file moves, and the engine follows the new name.
      await openMenu("gaming");
      await w.getByRole("menuitem", { name: "Rename…" }).click();
      await w.getByLabel("Name", { exact: true }).fill("play");
      await w.getByRole("button", { name: "Rename" }).click();
      expect(await waitForEngine(engine, (s) => s.profile === "play")).toMatchObject({
        profile: "play",
        configIssues: [],
      });
      expect(existsSync(profileFile("gaming"))).toBe(false);

      // Delete: after confirming, the engine is back on "test" and the file is gone.
      await openMenu("play");
      await w.getByRole("menuitem", { name: "Delete…" }).click();
      await w.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      expect(await waitForEngine(engine, (s) => s.profile === "test")).toMatchObject({
        profile: "test",
        configIssues: [],
      });
      await w.getByRole("button", { name: "Profile: test" }).waitFor({ timeout: 5000 });
      expect(existsSync(profileFile("play"))).toBe(false);
    },
  );

  it("exports a profile and imports it back as a new one", { timeout: 60_000 }, async () => {
    const { app, engine } = await startAppWithEngine();
    const w = app.window;
    const shared = join(engine.configDir, "..", "shared.json");

    // Export: the file is the profile as saved in the config folder.
    await app.stubFileDialogs({ save: shared });
    await w.getByRole("button", { name: "Profile: test" }).click();
    await w.getByRole("menuitem", { name: "Export…" }).click();
    await expect
      .poll(() => (existsSync(shared) ? JSON.parse(readFileSync(shared, "utf8")) : null))
      .toEqual(JSON.parse(readFileSync(join(engine.configDir, "profiles/test.json"), "utf8")));

    // Import it renamed, as someone else's profile: it is added and the engine switches to it.
    writeFileSync(
      shared,
      JSON.stringify({ ...JSON.parse(readFileSync(shared, "utf8")), name: "Shared" }),
    );
    await app.stubFileDialogs({ open: shared });
    await w.getByRole("button", { name: "Profile: test" }).click();
    await w.getByRole("menuitem", { name: "Import…" }).click();
    expect(await waitForEngine(engine, (s) => s.profile === "shared")).toMatchObject({
      profile: "shared",
      configIssues: [],
    });
    await w.getByRole("button", { name: "Profile: Shared" }).waitFor({ timeout: 5000 });
  });
});
