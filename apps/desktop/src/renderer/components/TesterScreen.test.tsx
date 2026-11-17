// @vitest-environment happy-dom
import type { Profile } from "@keyrift/config-types";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { App } from "../App.tsx";
import { deepFreeze } from "../config/test-profile.ts";
import { MAX_ROWS } from "../engine/useTester.ts";
import { FakeConfig } from "../testing/fake-config.ts";
import { FakeEngine } from "../testing/fake-engine.ts";
import { FakeLogs } from "../testing/fake-logs.ts";
import { FakeSystem } from "../testing/fake-system.ts";
import { FakeSetup } from "../testing/fake-setup.ts";
import { FakeUpdates } from "../testing/fake-updates.ts";
import { actionText, outputsText, resultOf, timeLabel } from "./TesterScreen.tsx";

afterEach(cleanup);

const VERSIONS = { electron: "1", chrome: "1", node: "1", v8: "1" };

const PROFILE: Profile = deepFreeze({
  version: 1,
  layers: [
    { id: "base", name: "Base", keys: { KEY_CAPSLOCK: { type: "key", key: "KEY_ESC" } } },
    { id: "alt-nav", name: "Alt nav", keys: { KEY_H: { type: "key", key: "KEY_LEFT" } } },
  ],
});

/** Opens the Tester screen of the app, with a fake engine. */
async function openTester() {
  const engine = new FakeEngine();
  render(
    <App
      logs={new FakeLogs()}
      system={new FakeSystem()}
      setup={new FakeSetup()}
      updates={new FakeUpdates()}
      engine={engine}
      config={new FakeConfig({ daily: PROFILE })}
      versions={VERSIONS}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Tester" }));
  // Subscribing is async: wait until the screen listens.
  await act(() => Promise.resolve());
  return { engine, user };
}

const key = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}: `) });
const rows = () => within(screen.getByRole("table", { name: "Key events" })).getAllByRole("row");

describe("TesterScreen", () => {
  it("listens to the engine's key events only while open", async () => {
    const { engine, user } = await openTester();
    expect(engine.subscribedTopics).toContain("tester");

    await user.click(screen.getByRole("button", { name: "Keymap" }));
    expect(engine.subscribedTopics).not.toContain("tester");
  });

  it("lights up held keys and lists each press once, with its hold time", async () => {
    const { engine } = await openTester();
    expect(screen.getByText("No key events yet.")).toBeDefined();

    act(() =>
      engine.sendTester({
        key: "KEY_CAPSLOCK",
        pressed: true,
        timeUs: 1_000_000,
        action: "KEY_ESC",
        outputs: ["+KEY_ESC"],
      }),
    );
    expect(key("Caps").dataset.lit).toBe("true");
    expect(rows()[1]?.textContent).toContain("held…");
    act(() =>
      engine.sendTester({
        key: "KEY_CAPSLOCK",
        pressed: false,
        timeUs: 1_120_000,
        outputs: ["-KEY_ESC"],
      }),
    );
    expect(key("Caps").dataset.lit).toBeUndefined();

    // Header row, then one row for the press, filled in by the release.
    const [, press] = rows();
    expect(rows()).toHaveLength(2);
    expect(press?.textContent).toContain("Caps");
    expect(press?.textContent).toContain("Esc");
    expect(press?.textContent).toContain("Base");
    expect(press?.textContent).toContain("120 ms");
    // One keyboard: no device column.
    expect(screen.queryByRole("columnheader", { name: "Device" })).toBeNull();
  });

  it("shows the device column once two keyboards sent keys", async () => {
    const { engine } = await openTester();
    act(() => {
      engine.sendTester({ key: "KEY_A", pressed: true, device: "Keyboard one" });
      engine.sendTester({ key: "KEY_B", pressed: true, device: "Keyboard two" });
    });
    expect(screen.getByRole("columnheader", { name: "Device" })).toBeDefined();
  });

  it("shows the layer that is on top", async () => {
    const { engine } = await openTester();
    act(() => engine.sendTester({ key: "KEY_H", pressed: true, layers: ["base", "alt-nav"] }));
    expect(key("H").getAttribute("aria-label")).toBe("H: ←");
    expect(rows()[1]?.textContent).toContain("Base → Alt nav");
  });

  it("pauses the table but keeps lighting keys, and clears it", async () => {
    const { engine, user } = await openTester();
    act(() => engine.sendTester({ key: "KEY_A", pressed: true }));
    await user.click(screen.getByRole("button", { name: "Pause" }));

    act(() => engine.sendTester({ key: "KEY_B", pressed: true }));
    expect(key("B").dataset.lit).toBe("true");
    expect(rows()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Resume" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("table")).toBeNull();
  });

  it(`keeps the newest ${MAX_ROWS} events`, async () => {
    const { engine } = await openTester();
    act(() => {
      for (let i = 0; i <= MAX_ROWS; i++) engine.sendTester({ key: "KEY_A", pressed: true });
    });
    expect(rows()).toHaveLength(MAX_ROWS + 1);
  });
});

describe("tester labels", () => {
  const layers = PROFILE.layers ?? [];

  it("spells out keys and layer names in the engine's action text", () => {
    expect(actionText("LeftCtrl+KEY_C", layers)).toBe("LeftCtrl+C");
    expect(actionText("layer Hold alt-nav", layers)).toBe("Alt nav layer (hold)");
    expect(actionText("tap-hold(KEY_ESC, layer Hold alt-nav)", layers)).toBe(
      "tap-hold(Esc, Alt nav layer (hold))",
    );
  });

  it("sums up what the apps received", () => {
    const result = (action: string | null, press: string[], release: string[] | null = null) =>
      resultOf({ action, pressOutputs: press, releaseOutputs: release }, layers);
    expect(result("LeftCtrl+KEY_C", ["+KEY_LEFTCTRL", "+KEY_C"])).toEqual({
      text: "Ctrl+C",
      note: null,
    });
    // Alt+J on Alt nav: Alt is let go for a plain Down, and pressed again on release.
    expect(
      result(
        "KEY_DOWN (release held mods)",
        ["-KEY_LEFTALT", "+KEY_DOWN"],
        ["-KEY_DOWN", "+KEY_LEFTALT"],
      ),
    ).toEqual({ text: "Down", note: "Alt let go" });
    expect(result("layer Hold alt-nav", ["+KEY_LEFTALT"])).toEqual({
      text: "Alt nav layer (hold)",
      note: "Alt held",
    });
    // Tab on Alt nav: Alt is still held by the layer, so the apps get Alt+Tab.
    expect(
      resultOf(
        {
          action: "KEY_TAB",
          pressOutputs: ["+KEY_TAB"],
          releaseOutputs: null,
          heldBefore: ["KEY_LEFTALT"],
        },
        layers,
      ).text,
    ).toBe("Alt+Tab");
    expect(result("macro (4 steps)", ["+KEY_H", "-KEY_H", "+KEY_I", "-KEY_I"]).text).toBe("H I");
    expect(result("none", []).text).toBe("Nothing");
    // A tap-hold decides on release (tap) or later: until then, the engine's description.
    expect(result("tap-hold(KEY_ESC, LeftCtrl)", []).text).toBe("tap-hold(Esc, LeftCtrl)");
    expect(result("tap-hold(KEY_ESC, LeftCtrl)", [], ["+KEY_ESC", "-KEY_ESC"]).text).toBe("Esc");
  });

  it("shows output events as arrows", () => {
    expect(outputsText(["+KEY_LEFTCTRL", "+KEY_C", "-KEY_C"])).toBe("↓Left Ctrl ↓C ↑C");
  });

  it("shows the time with milliseconds", () => {
    expect(timeLabel(new Date(2026, 10, 16, 9, 5, 7, 42).getTime())).toBe("09:05:07.042");
  });
});
