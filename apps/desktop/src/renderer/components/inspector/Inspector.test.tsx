// @vitest-environment happy-dom
import type { Profile } from "@keyrift/config-types";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { App } from "../../App.tsx";
import { deepFreeze } from "../../config/test-profile.ts";
import { FakeConfig } from "../../testing/fake-config.ts";
import { FakeEngine } from "../../testing/fake-engine.ts";
import { FakeLogs } from "../../testing/fake-logs.ts";
import { FakeSystem } from "../../testing/fake-system.ts";
import { FakeSetup } from "../../testing/fake-setup.ts";

afterEach(cleanup);

const VERSIONS = { electron: "1", chrome: "1", node: "1", v8: "1" };

const PROFILE: Profile = deepFreeze({
  version: 1,
  layers: [
    {
      id: "base",
      name: "Base",
      keys: { KEY_CAPSLOCK: { type: "key", key: "KEY_ESC" } },
    },
    { id: "nav", name: "Nav", keys: {} },
  ],
});

/** Opens the Keymap screen and selects the key named `keyName` (e.g. "Caps"). */
async function inspect(keyName: string) {
  const engine = new FakeEngine();
  const config = new FakeConfig({ daily: PROFILE });
  render(
    <App
      logs={new FakeLogs()}
      system={new FakeSystem()}
      setup={new FakeSetup()}
      engine={engine}
      config={config}
      versions={VERSIONS}
    />,
  );
  await screen.findByRole("tablist", { name: "Layers" });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: new RegExp(`^${keyName}: `) }));
  return { user, engine, config, inspector: screen.getByRole("region", { name: "Inspector" }) };
}

/** The keyboard key `name`'s label, e.g. "Esc" for "Caps: Esc". */
const keyLabel = (name: string) =>
  screen
    .getByRole("button", { name: new RegExp(`^${name}: `) })
    .getAttribute("aria-label")
    ?.slice(name.length + 2);

/** Picks `option` in the dropdown labelled `label` inside `within`. */
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  label: string,
  option: string,
) {
  await user.click(within(container).getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("Inspector", () => {
  it("closes with its button, by clicking the key again, or with Escape", async () => {
    const { user, inspector } = await inspect("Q");
    const region = () => screen.queryByRole("region", { name: "Inspector" });

    await user.click(within(inspector).getByRole("button", { name: "Close inspector" }));
    expect(region()).toBeNull();

    const q = screen.getByRole("button", { name: /^Q: / });
    await user.click(q);
    expect(region()).not.toBeNull();
    await user.click(q);
    expect(region()).toBeNull();
    expect(q.getAttribute("aria-pressed")).toBe("false");

    await user.click(q);
    await user.keyboard("{Escape}");
    expect(region()).toBeNull();
  });

  it("shows a transparent key and sets an action on it", async () => {
    const { user, inspector } = await inspect("Q");
    expect(inspector.textContent).toContain("Not set on this layer, so it does its normal thing");

    await choose(user, inspector, "Type", "Nothing (disabled)");
    expect(keyLabel("Q")).toBe("None");
    expect(within(inspector).getByText("The key does nothing.")).toBeTruthy();
  });

  it("picks an output key by searching", async () => {
    const { user, inspector } = await inspect("Caps");
    const picker = within(inspector).getByRole("combobox", { name: "Output key" });
    await user.clear(picker);
    await user.type(picker, "backsp");
    await user.click(await screen.findByRole("option", { name: /^Backspace/ }));
    expect(keyLabel("Caps")).toBe("Backspace");
  });

  it("records the output key from the engine", async () => {
    const { user, engine, inspector } = await inspect("Caps");
    await user.click(within(inspector).getByRole("button", { name: "Record Output key" }));
    expect(engine.recorded).toEqual([]);
    expect(within(inspector).getByText("Press a key…")).toBeTruthy();

    act(() => engine.pressKey("KEY_F5"));
    expect(keyLabel("Caps")).toBe("F5");
    await act(() => Promise.resolve());
    expect(engine.recorded).toBeNull(); // stopped after one key
    expect(within(inspector).getByRole("button", { name: "Record Output key" })).toBeTruthy();
  });

  it("adds modifiers to a key, making it a combo", async () => {
    const { user, inspector } = await inspect("Caps");
    await user.click(within(inspector).getByRole("button", { name: "Left Ctrl" }));
    expect(keyLabel("Caps")).toBe("Ctrl+Esc");
  });

  it("releases only some held modifiers", async () => {
    const { user, config, inspector } = await inspect("Caps");
    await choose(user, inspector, "Modifiers already held", "Release only some…");
    const release = within(inspector).getByRole("group", { name: "Release these" });
    await user.click(within(release).getByRole("button", { name: "Left Ctrl" }));
    await waitFor(() =>
      expect(config.saves.at(-1)?.profile.layers?.[0]?.keys?.KEY_CAPSLOCK).toEqual({
        type: "key",
        key: "KEY_ESC",
        releaseHeld: ["LeftCtrl", "LeftAlt"],
      }),
    );
  });

  it("offers only the types a tap and a hold may have", async () => {
    const { user, inspector } = await inspect("Caps");
    await choose(user, inspector, "Type", "Tap / hold");
    expect(keyLabel("Caps")).toBe("Esc / Ctrl");

    const tap = within(inspector).getByRole("group", { name: "Tap" });
    await user.click(within(tap).getByRole("combobox", { name: "Type" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Key", "Modifiers", "Nothing (disabled)"]);
    await user.keyboard("{Escape}");

    const hold = within(inspector).getByRole("group", { name: "Hold" });
    await choose(user, hold, "Type", "Layer");
    expect(keyLabel("Caps")).toBe("Esc / Nav");
    // A hold can only hold a layer, so there is no mode to choose.
    expect(within(hold).queryByRole("combobox", { name: "Mode" })).toBeNull();
  });

  it("sets a tap-hold's own timeout, and an empty box means the default", async () => {
    const { user, config, inspector } = await inspect("Caps");
    await choose(user, inspector, "Type", "Tap / hold");
    const timeout = within(inspector).getByRole("textbox", { name: "Timeout (ms)" });
    /** Caps in the last saved profile (autosave runs 500 ms after the last change). */
    const savedCaps = () => config.saves.at(-1)?.profile.layers?.[0]?.keys?.KEY_CAPSLOCK;

    await user.type(timeout, "0");
    expect(within(inspector).getByText("From 1 to 10000")).toBeTruthy();
    await user.clear(timeout);
    await user.type(timeout, "250");
    await waitFor(() => expect(savedCaps()).toMatchObject({ type: "tapHold", timeoutMs: 250 }));

    await user.clear(timeout);
    await waitFor(() => expect(savedCaps()).not.toHaveProperty("timeoutMs"));
    expect(savedCaps()).toMatchObject({ type: "tapHold" });
  });

  it("records macro steps until stopped", async () => {
    const { user, engine, inspector } = await inspect("Q");
    await choose(user, inspector, "Type", "Macro");
    expect(keyLabel("Q")).toBe("Macro (1)");

    await user.click(within(inspector).getByRole("button", { name: "Record steps" }));
    act(() => {
      engine.pressKey("KEY_H");
      engine.pressKey("KEY_I");
    });
    expect(within(inspector).getByText("H I")).toBeTruthy();
    await user.click(within(inspector).getByRole("button", { name: "Stop recording" }));
    expect(keyLabel("Q")).toBe("Macro (3)");
  });

  it("keeps a wrong delay in the box with a message, and saves only valid ones", async () => {
    const { user, inspector } = await inspect("Q");
    await choose(user, inspector, "Type", "Macro");
    await user.click(within(inspector).getByRole("button", { name: "Add delay" }));
    const delay = within(inspector).getByRole("textbox", { name: "Step 2 delay (ms)" });

    await user.clear(delay);
    await user.type(delay, "99999");
    expect(within(inspector).getByText("From 0 to 60000")).toBeTruthy();
    expect((delay as HTMLInputElement).value).toBe("99999");
  });

  it("clears a key back to transparent", async () => {
    const { user, inspector } = await inspect("Caps");
    await user.click(within(inspector).getByRole("button", { name: "Clear" }));
    expect(keyLabel("Caps")).toBe("Caps (unchanged)");
    expect(inspector.textContent).toContain("Not set on this layer");
  });
});
