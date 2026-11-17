// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { App } from "../App.tsx";
import { FakeConfig } from "../testing/fake-config.ts";
import { FakeEngine } from "../testing/fake-engine.ts";
import { FakeLogs } from "../testing/fake-logs.ts";
import { FakeSystem } from "../testing/fake-system.ts";
import { FakeSetup } from "../testing/fake-setup.ts";
import { FakeUpdates } from "../testing/fake-updates.ts";
import { layoutLabel } from "./SettingsScreen.tsx";

afterEach(cleanup);

const VERSIONS = { electron: "45.3.2", chrome: "1", node: "1", v8: "1" };

/** Opens the Settings screen of the app, with fakes. */
async function openSettings(config = new FakeConfig(), updates = new FakeUpdates()) {
  const engine = new FakeEngine();
  const system = new FakeSystem();
  render(
    <App
      engine={engine}
      config={config}
      logs={new FakeLogs()}
      system={system}
      setup={new FakeSetup()}
      updates={updates}
      versions={VERSIONS}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^Settings/ }));
  await screen.findByRole("region", { name: "General" });
  return { engine, config, system, updates, user };
}

/** Picks `option` in the dropdown named `label`. */
async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("SettingsScreen", () => {
  it("shows the engine's defaults without a settings.json", async () => {
    await openSettings();
    // textContent ends with the dropdown's arrow, hence toContain.
    expect(screen.getByRole("combobox", { name: "Theme" }).textContent).toContain("Dark");
    expect(screen.getByRole("combobox", { name: "Keyboard layout" }).textContent).toContain(
      "ISO, TKL (no numpad)",
    );
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Timeout" }).value).toBe("200");
    expect(screen.getByLabelText("Emergency keys").textContent).toBe("Left Ctrl + Space + Esc");
    expect(screen.getByRole("combobox", { name: "Log level" }).textContent).toContain("Info");
  });

  it("saves each dropdown into settings.json", async () => {
    const { config, user } = await openSettings();
    await pick(user, "Theme", "Light");
    await pick(user, "Keyboard layout", "ANSI, 60 %");
    await pick(user, "Strategy", "Timeout only");
    await pick(user, "Log level", "Warn");
    expect(config.settings).toEqual({
      version: 1,
      ui: { theme: "light", physicalLayout: "ansi-60" },
      tapHold: { strategy: "timeout-only" },
      logLevel: "warn",
    });
    // The help under Strategy follows the choice.
    expect(screen.getByText(/longer than the timeout/)).toBeDefined();
  });

  it("saves the timeout when the box is left, and only valid numbers", async () => {
    const { config, user } = await openSettings();
    const box = screen.getByRole("textbox", { name: "Timeout" });
    await user.clear(box);
    await user.type(box, "20000");
    await user.tab();
    expect(screen.getByText("From 1 to 10000")).toBeDefined();
    expect(config.settings).toBeNull();

    await user.clear(box);
    await user.type(box, "250{Enter}");
    expect(config.settings?.tapHold).toEqual({ timeoutMs: 250 });
  });

  it("turns the emergency release off and records new keys", async () => {
    const { config, engine, user } = await openSettings();
    await user.click(screen.getByRole("switch", { name: "Emergency release" }));
    expect(config.settings?.emergencyRelease).toEqual({ enabled: false });

    await user.click(screen.getByRole("button", { name: "Record" }));
    const done = screen.getByRole("button", { name: "Done" });
    act(() => engine.pressKey("KEY_LEFTCTRL"));
    // One key isn't enough: pressed by accident it would release the keyboards.
    expect(done.hasAttribute("disabled")).toBe(true);
    act(() => {
      engine.pressKey("KEY_LEFTCTRL");
      engine.pressKey("KEY_F12");
    });
    expect(screen.getByLabelText("Emergency keys").textContent).toBe("Left Ctrl + F12");
    await user.click(done);
    expect(config.settings?.emergencyRelease).toEqual({
      enabled: false,
      keys: ["KEY_LEFTCTRL", "KEY_F12"],
    });
  });

  it("enables autostart, or explains why it can't", async () => {
    const { system, user } = await openSettings();
    const toggle = screen.getByRole("switch", { name: "Start at login" });
    await user.click(toggle);
    expect(system.autostartChanges).toEqual([true]);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    system.failWith = "Access denied";
    await user.click(toggle);
    expect(screen.getByText("Couldn't change it: Access denied")).toBeDefined();
  });

  it("shows the save problem", async () => {
    const config = new FakeConfig();
    config.saveProblem = { file: "settings.json", message: "cannot write", issues: [] };
    const { user } = await openSettings(config);
    await pick(user, "Theme", "Light");
    expect(screen.getByRole("alert").textContent).toContain("settings.json: cannot write");
  });

  it("follows main's light/dark answer", async () => {
    const { system } = await openSettings();
    const dark = () => document.documentElement.classList.contains("dark");
    expect(dark()).toBe(true);
    act(() => system.setDark(false));
    expect(dark()).toBe(false);
  });

  it("shows the versions", async () => {
    await openSettings();
    const about = within(screen.getByRole("region", { name: "About" }));
    expect(about.getByText(/^0\.1\.0/)).toBeDefined();
    expect(about.getByText(/45\.3\.2/)).toBeDefined();
  });

  it("names the layouts", () => {
    expect(layoutLabel("iso-full")).toBe("ISO, full size");
    expect(layoutLabel("ansi-75")).toBe("ANSI, 75 %");
  });

  it("finds, downloads and installs an update", async () => {
    const updates = new FakeUpdates();
    updates.latest = "0.2.0";
    const { user } = await openSettings(undefined, updates);
    const region = screen.getByRole("region", { name: "Updates" });
    expect(within(region).getByText("Keyrift 0.1.0")).toBeDefined();

    await user.click(within(region).getByRole("button", { name: "Check for updates" }));
    expect(within(region).getByText("Version 0.2.0 is available.")).toBeDefined();
    // The sidebar points at Settings while an update waits there.
    expect(screen.getByRole("button", { name: "Settings (update available)" })).toBeDefined();

    await user.click(within(region).getByRole("button", { name: "Download 0.2.0" }));
    expect(within(region).getByText(/Version 0.2.0 is ready/)).toBeDefined();
    await user.click(within(region).getByRole("button", { name: "Restart and install" }));
    expect(updates.installed).toBe(true);
  });

  it("shows progress while downloading and says when it is up to date", async () => {
    const updates = new FakeUpdates();
    const { user } = await openSettings(undefined, updates);
    const region = screen.getByRole("region", { name: "Updates" });

    await user.click(within(region).getByRole("button", { name: "Check for updates" }));
    expect(within(region).getByText("Keyrift is up to date.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Settings" })).toBeDefined();

    act(() => updates.set({ status: "downloading", version: "0.2.0", percent: 40 }));
    expect(within(region).getByText("Downloading version 0.2.0… 40%")).toBeDefined();
    expect(
      within(region).getByRole<HTMLButtonElement>("button", { name: "Download 0.2.0" }).disabled,
    ).toBe(true);
  });

  it("says why a build can't update itself", async () => {
    const updates = new FakeUpdates();
    updates.state = {
      status: "unavailable",
      reason: "Development builds don't update themselves.",
    };
    await openSettings(undefined, updates);
    const region = screen.getByRole("region", { name: "Updates" });
    expect(within(region).getByText("Development builds don't update themselves.")).toBeDefined();
    expect(within(region).queryByRole("button")).toBeNull();
  });
});
