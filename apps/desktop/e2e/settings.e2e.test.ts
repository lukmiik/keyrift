/**
 * Settings (spec §7.3, M5 exit criteria): each setting is saved to settings.json and applied: the
 * engine takes up the log level, the GUI its theme and keyboard layout. Autostart goes to a fake
 * systemctl (test/fake-systemctl.mjs), never to the user's keyrift.service.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { TestApp } from "../test/test-app.ts";
import { TestEngine } from "../test/test-engine.ts";
import { uinputAvailable } from "../test/test-keyboard.ts";

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) {
    await step();
  }
  cleanup = [];
});

describe.skipIf(!uinputAvailable())("Settings", () => {
  it("saves each setting and applies it", { timeout: 60_000 }, async () => {
    const engine = await TestEngine.start();
    cleanup.push(() => engine.stop());
    const app = await TestApp.start({ socketPath: engine.socketPath, configDir: engine.configDir });
    cleanup.push(() => app.close());
    const w = app.window;
    const settings = () =>
      JSON.parse(readFileSync(join(engine.configDir, "settings.json"), "utf8")) as Record<
        string,
        unknown
      >;
    const pick = async (label: string, option: string) => {
      await w.getByRole("combobox", { name: label }).click();
      await w.getByRole("option", { name: option }).click();
    };
    const darkClass = async () =>
      ((await w.locator("html").getAttribute("class")) ?? "").split(" ").includes("dark");

    await w.getByRole("button", { name: "Settings" }).click();

    // Theme: saved, and the page switches.
    await pick("Theme", "Light");
    await expect.poll(darkClass).toBe(false);
    await pick("Theme", "Dark");
    await expect.poll(darkClass).toBe(true);
    expect(settings().ui).toEqual({ theme: "dark" });

    // Log level: the engine reloads settings.json and takes it up (its status says so).
    await pick("Log level", "Warn");
    const client = await engine.connect();
    cleanup.push(() => client.close());
    await expect
      .poll(async () => (await client.call("status.get", {})).logLevel, { timeout: 5000 })
      .toBe("warn");

    // Tap-hold timeout and the emergency switch: saved; the engine accepts the file.
    const timeout = w.getByRole("textbox", { name: "Timeout" });
    await timeout.fill("300");
    await timeout.press("Enter");
    await w.getByRole("switch", { name: "Emergency release" }).click();
    await expect
      .poll(() => settings())
      .toMatchObject({ tapHold: { timeoutMs: 300 }, emergencyRelease: { enabled: false } });
    await expect.poll(async () => (await client.call("status.get", {})).configIssues).toEqual([]);

    // Autostart: through the fake systemctl; read back after leaving the screen.
    await w.getByRole("switch", { name: "Start at login" }).click();
    await w.getByRole("button", { name: "Keymap" }).click();
    await w.getByRole("button", { name: "Settings" }).click();
    await expect
      .poll(() => w.getByRole("switch", { name: "Start at login" }).getAttribute("aria-checked"))
      .toBe("true");

    // Layout: the Keymap keyboard changes shape (a 60 % keyboard has no F keys).
    await pick("Keyboard layout", "ANSI, 60 %");
    await w.getByRole("button", { name: "Keymap" }).click();
    await w.getByRole("button", { name: /^Q: / }).waitFor();
    // The layout is read from settings.json after the screen opens: wait for the new shape.
    await expect.poll(() => w.getByRole("button", { name: /^F1: / }).count()).toBe(0);
  });

  it("follows GNOME's dark preference with the System theme", { timeout: 60_000 }, async () => {
    const engine = await TestEngine.start();
    cleanup.push(() => engine.stop());
    // Like i3: the portal reports nothing, only gsettings says dark.
    const app = await TestApp.start({
      socketPath: engine.socketPath,
      configDir: engine.configDir,
      env: { FAKE_COLOR_SCHEME: "prefer-dark" },
    });
    cleanup.push(() => app.close());
    const w = app.window;
    const darkClass = async () =>
      ((await w.locator("html").getAttribute("class")) ?? "").split(" ").includes("dark");

    await w.getByRole("button", { name: "Settings" }).click();
    await w.getByRole("combobox", { name: "Theme" }).click();
    await w.getByRole("option", { name: "Light" }).click();
    await expect.poll(darkClass).toBe(false);
    await w.getByRole("combobox", { name: "Theme" }).click();
    await w.getByRole("option", { name: "System" }).click();
    await expect.poll(darkClass).toBe(true);
  });

  it("updates the app through the updater", { timeout: 60_000 }, async () => {
    const engine = await TestEngine.start();
    cleanup.push(() => engine.stop());
    // What a fake updater finds "on GitHub" (src/main/system/updates.ts, fakeUpdater).
    const github = join(engine.configDir, "..", "fake-github.json");
    writeFileSync(github, JSON.stringify({ latest: "9.9.9" }));
    const app = await TestApp.start({
      socketPath: engine.socketPath,
      configDir: engine.configDir,
      env: { KEYRIFT_UPDATE_FAKE: github },
    });
    cleanup.push(() => app.close());
    const w = app.window;
    await w.getByRole("button", { name: "Settings" }).click();
    const updates = w.getByRole("region", { name: "Updates" });

    await updates.getByRole("button", { name: "Check for updates" }).click();
    await updates.getByText("Version 9.9.9 is available.").waitFor();
    await w.getByRole("button", { name: "Settings (update available)" }).waitFor();
    await updates.getByRole("button", { name: "Download 9.9.9" }).click();
    await updates.getByText(/Version 9.9.9 is ready/).waitFor();
    await updates.getByRole("button", { name: "Restart and install" }).click();
    await expect
      .poll(() => (JSON.parse(readFileSync(github, "utf8")) as { installed?: string }).installed)
      .toBe("9.9.9");
  });
});
