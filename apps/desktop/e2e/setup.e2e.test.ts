/**
 * Setup wizard (spec §9.3, F-UI-7): on a made-up system with problems (a fake probe, never the real
 * system), the wizard opens, shows what fails and what to run, and its fixes change that system.
 */
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

describe.skipIf(!uinputAvailable())("Setup wizard", () => {
  it("opens on problems and fixes them", { timeout: 60_000 }, async () => {
    const engine = await TestEngine.start();
    cleanup.push(() => engine.stop());
    const app = await TestApp.start({
      socketPath: engine.socketPath,
      configDir: engine.configDir,
      system: {
        sessionGroups: ["input"],
        configuredGroups: ["input"],
        uinputAccess: false,
        uinputBuiltin: false,
        userUnits: ["kanata.service"],
        autostart: "not-installed",
      },
    });
    cleanup.push(() => app.close());
    const w = app.window;
    const checks = w.getByRole("list", { name: "Checks" });
    const mark = (title: string) =>
      checks.getByRole("listitem", { name: title }).getByRole("img").getAttribute("aria-label");

    await checks.waitFor();
    expect(await mark("Groups input and uinput")).toBe("Failed");
    expect(await mark("Access to keyboards and /dev/uinput")).toBe("Failed");
    expect(await mark("uinput loaded at boot")).toBe("Needs attention");
    expect(await mark("No other remapper")).toBe("Needs attention");
    expect(await mark("Engine service")).toBe("Failed");
    await w.getByText("systemctl --user disable --now kanata.service").waitFor();

    await w.getByRole("button", { name: "Fix with one password prompt" }).click();
    // Groups added, but only active after logging in again.
    await expect.poll(() => mark("Groups input and uinput")).toBe("Needs attention");
    expect(await mark("Access to keyboards and /dev/uinput")).toBe("OK");
    expect(await mark("uinput loaded at boot")).toBe("OK");
    await w.getByRole("button", { name: "Install the engine service" }).click();
    await expect.poll(() => mark("Engine service")).toBe("OK");
    expect(app.fakeSystem().fixes).toEqual(["system", "service"]);

    await w.getByText(/^Everything Keyrift needs is in place\. \d warnings:/).waitFor();
    await w.getByRole("button", { name: "Done" }).click();
    await w.getByRole("button", { name: "Keymap" }).waitFor();
  });
});
