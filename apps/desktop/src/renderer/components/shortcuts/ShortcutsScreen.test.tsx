// @vitest-environment happy-dom
import type { Profile, ShortcutConfig } from "@keyrift/config-types";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { App } from "../../App.tsx";
import { FakeConfig } from "../../testing/fake-config.ts";
import { FakeEngine } from "../../testing/fake-engine.ts";
import { FakeLogs } from "../../testing/fake-logs.ts";
import { FakeSystem } from "../../testing/fake-system.ts";
import { FakeSetup } from "../../testing/fake-setup.ts";

afterEach(cleanup);

const VERSIONS = { electron: "1", chrome: "1", node: "1", v8: "1" };

const SUPER_C: ShortcutConfig = {
  trigger: { mods: ["Super"], key: "KEY_C" },
  action: { type: "key", key: "KEY_C", mods: ["LeftCtrl", "LeftShift"] },
};

/** Opens the Shortcuts screen for a profile with `shortcuts`. */
async function openShortcuts(shortcuts: ShortcutConfig[]) {
  const engine = new FakeEngine();
  const profile: Profile = { version: 1, layers: [{ id: "base", keys: {} }], shortcuts };
  render(
    <App
      logs={new FakeLogs()}
      system={new FakeSystem()}
      setup={new FakeSetup()}
      engine={engine}
      config={new FakeConfig({ daily: profile })}
      versions={VERSIONS}
    />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Shortcuts" }));
  await screen.findByRole("button", { name: "Add shortcut" });
  return { user, engine };
}

/** The table's rows as "trigger → output" text. */
const rows = () =>
  within(screen.getByRole("table", { name: "Shortcuts" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => {
      const cells = within(row).getAllByRole("cell");
      return `${cells[1]?.textContent} → ${cells[2]?.textContent}`;
    });

describe("Shortcuts screen", () => {
  it("lists the rules", async () => {
    await openShortcuts([SUPER_C]);
    expect(rows()).toEqual(["Super+C → Ctrl+Shift+C"]);
  });

  it("adds a rule with a recorded trigger", async () => {
    const { user, engine } = await openShortcuts([]);
    expect(screen.getByText("No shortcuts in this profile yet.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add shortcut" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Record trigger" }));
    act(() => engine.pressKey("KEY_LEFTMETA"));
    expect(within(dialog).getByText("Left Super")).toBeTruthy();
    act(() => engine.pressKey("KEY_V"));
    expect(within(dialog).getByRole("group", { name: "Trigger" }).textContent).toContain(
      "Trigger: Super+V",
    );

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(rows()).toEqual(["Super+V → C"]);
  });

  it("doesn't save a trigger another rule has", async () => {
    const { user } = await openShortcuts([SUPER_C]);
    await user.click(screen.getByRole("button", { name: "Add shortcut" }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByRole("alert").textContent).toBe("Rule 1 already uses Super+C.");
    expect(within(dialog).getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(
      true,
    );
    // One more modifier makes it a different trigger.
    await user.click(within(dialog).getByRole("button", { name: "Shift (either side)" }));
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("offers only the outputs a shortcut may have", async () => {
    const { user } = await openShortcuts([]);
    await user.click(screen.getByRole("button", { name: "Add shortcut" }));
    const output = within(screen.getByRole("dialog")).getByRole("group", { name: "Output" });
    await user.click(within(output).getByRole("combobox", { name: "Type" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Key", "Modifiers", "Macro", "Nothing (disabled)"]);
  });

  it("edits and deletes a rule", async () => {
    const { user } = await openShortcuts([
      SUPER_C,
      { trigger: { key: "KEY_F1" }, action: { type: "none" } },
    ]);
    await user.click(screen.getByRole("button", { name: "Edit rule 1" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Shift (either side)" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(rows()).toEqual(["Shift+Super+C → Ctrl+Shift+C", "F1 → None"]);

    await user.click(screen.getByRole("button", { name: "Delete rule 1" }));
    expect(rows()).toEqual(["F1 → None"]);
  });

  it("flags rules with the same trigger, which the engine rejects", async () => {
    await openShortcuts([
      SUPER_C,
      SUPER_C,
      { trigger: { key: "KEY_F1" }, action: { type: "none" } },
    ]);
    expect(screen.getByText("Same trigger as rule 1")).toBeTruthy();
    // Only the repeated rule is tinted; it repeats rule 1, whose index is 0 (which is falsy).
    const tinted = within(screen.getByRole("table", { name: "Shortcuts" }))
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.classList.contains("bg-destructive/10"));
    expect(tinted).toEqual([false, true, false]);
    expect(screen.getByText(/The engine rejects a profile with two rules/)).toBeTruthy();
  });

  it("flags rules that an earlier rule always matches first", async () => {
    const ctrlC = (mods: ShortcutConfig["trigger"]["mods"]): ShortcutConfig => ({
      trigger: { mods, key: "KEY_C" },
      action: { type: "none" },
    });
    await openShortcuts([ctrlC(["Ctrl"]), ctrlC(["LeftCtrl"])]);

    expect(screen.getByText("Never used: rule 1 matches first")).toBeTruthy();
    const tinted = within(screen.getByRole("table", { name: "Shortcuts" }))
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.classList.contains("bg-amber-500/10"));
    expect(tinted).toEqual([false, true]);
  });

  it("moves a rule up, which makes a never-used rule work", async () => {
    const ctrlC = (mods: ShortcutConfig["trigger"]["mods"]): ShortcutConfig => ({
      trigger: { mods, key: "KEY_C" },
      action: { type: "none" },
    });
    const { user } = await openShortcuts([ctrlC(["Ctrl"]), ctrlC(["LeftCtrl"])]);
    expect(screen.getByRole("button", { name: "Move rule 1 up" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Move rule 2 down" }).hasAttribute("disabled")).toBe(
      true,
    );

    await user.click(screen.getByRole("button", { name: "Move rule 2 up" }));
    expect(rows()).toEqual(["LCtrl+C → None", "Ctrl+C → None"]);
    expect(screen.queryByText(/Never used/)).toBeNull();
  });
});
