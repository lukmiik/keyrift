/**
 * The headline GUI test (spec §12 M4): starting from an empty config folder, the baseline profile
 * (spec §6.6, `examples/config/profiles/daily.json`) is rebuilt by clicking through the app, and
 * the saved file is semantically equal to it. The engine then runs it without config issues.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { KeyName, Profile } from "@keyrift/config-types";
import type { Locator, Page } from "playwright-core";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { TestApp } from "../test/test-app.ts";
import { TestEngine } from "../test/test-engine.ts";
import { uinputAvailable } from "../test/test-keyboard.ts";

const BASELINE = join(import.meta.dirname, "../../../examples/config/profiles/daily.json");

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) {
    await step();
  }
  cleanup = [];
});

/** Clicks through the inspector for one key. */
class KeymapDriver {
  readonly #w: Page;
  readonly #inspector: Locator;

  constructor(w: Page) {
    this.#w = w;
    this.#inspector = w.getByRole("region", { name: "Inspector" });
  }

  async layer(name: string): Promise<void> {
    await this.#w.getByRole("tab", { name, exact: true }).click();
  }

  /** Selects the keyboard key whose accessible name starts with `name` (e.g. "Caps", "AltGr"). */
  async select(name: string): Promise<void> {
    await this.#w
      .getByRole("group", { name: "Keyboard" })
      .getByRole("button", { name: new RegExp(`^${name}: `) })
      .click();
  }

  /** Picks `option` in the inspector's dropdown `label` (the first one, i.e. not a nested one). */
  async choose(label: string, option: string): Promise<void> {
    await this.#inspector.getByRole("combobox", { name: label, exact: true }).first().click();
    await this.#w.getByRole("option", { name: option, exact: true }).click();
  }

  /** Makes the selected (transparent) key send `output`, with `mods` toggled on in `group`. */
  async key(output: KeyName | null, mods: string[] = [], group = "With modifiers"): Promise<void> {
    await this.choose("Type", "Key");
    if (output !== null) {
      await this.#inspector.getByRole("combobox", { name: "Output key" }).fill(output);
      // Options show the evdev name in their own element, which identifies them exactly.
      await this.#w
        .getByRole("option")
        .filter({ has: this.#w.getByText(output, { exact: true }) })
        .click();
    }
    await this.toggle(group, mods);
  }

  async toggle(group: string, mods: string[]): Promise<void> {
    for (const mod of mods) {
      await this.#inspector
        .getByRole("group", { name: group })
        .getByRole("button", { name: mod, exact: true })
        .click();
    }
  }
}

describe.skipIf(!uinputAvailable())("baseline profile", () => {
  it("is rebuilt in the GUI from an empty config", { timeout: 180_000 }, async () => {
    const engine = await TestEngine.start({ empty: true });
    cleanup.push(() => engine.stop());
    const app = await TestApp.start({ socketPath: engine.socketPath, configDir: engine.configDir });
    cleanup.push(() => app.close());
    const w = app.window;
    const keymap = new KeymapDriver(w);

    // A new profile "Daily" (saved as daily.json), made active.
    await w.getByRole("button", { name: "Profile: default" }).click();
    await w.getByRole("menuitem", { name: "New profile" }).click();
    await w.getByLabel("Name", { exact: true }).fill("Daily");
    await w.getByRole("button", { name: "Create", exact: true }).click();
    await w.getByRole("button", { name: "Profile: daily" }).waitFor({ timeout: 5000 });

    // Layers. The id comes from the name, so "Workspaces" first, renamed afterwards.
    for (const name of ["Alt nav", "Workspaces"]) {
      await w.getByRole("button", { name: "Add layer" }).click();
      await w.getByLabel("Name", { exact: true }).fill(name);
      await w.getByRole("button", { name: "Add", exact: true }).click();
    }
    await w.getByRole("button", { name: "Rename layer" }).click();
    await w.getByLabel("Name", { exact: true }).fill("Workspaces & Polish");
    await w.getByRole("button", { name: "Rename", exact: true }).click();

    // Base: Esc ↔ Caps, Left Alt holds "Alt nav" with Alt, AltGr holds "Workspaces & Polish".
    await keymap.layer("Base");
    await keymap.select("Esc");
    await keymap.key("KEY_CAPSLOCK");
    await keymap.select("Caps");
    await keymap.key("KEY_ESC");
    await keymap.select("Left Alt");
    await keymap.choose("Type", "Layer");
    await keymap.toggle("Also hold modifiers", ["Left Alt"]);
    await keymap.select("AltGr");
    await keymap.choose("Type", "Layer");
    await keymap.choose("Layer", "Workspaces & Polish");

    // Alt nav: H J K L → arrows, releasing the held Left Alt.
    await keymap.layer("Alt nav");
    for (const [key, arrow] of [
      ["H", "KEY_LEFT"],
      ["J", "KEY_DOWN"],
      ["K", "KEY_UP"],
      ["L", "KEY_RIGHT"],
    ] as const) {
      await keymap.select(key);
      await keymap.key(arrow);
      // "Release only some…" starts with Left Alt.
      await keymap.choose("Modifiers already held", "Release only some…");
    }

    // Workspaces & Polish: AltGr letters for Polish, Super+digit for workspaces.
    await keymap.layer("Workspaces & Polish");
    for (const letter of ["A", "E", "O", "S", "L", "Z", "X", "C", "N"]) {
      await keymap.select(letter);
      // A new action starts from what the key falls through to; L falls through to Alt nav's
      // Right, so its output key is picked.
      await keymap.key(letter === "L" ? "KEY_L" : null, ["AltGr (Right Alt)"]);
    }
    for (const [key, output] of [
      ["F", "KEY_1"],
      ["Caps", "KEY_2"],
      ["Space", "KEY_3"],
      ["J", "KEY_4"],
      ["K", "KEY_5"],
      ["R", "KEY_6"],
      ["M", "KEY_7"],
      ["G", "KEY_8"],
      ["I", "KEY_9"],
      ["T", "KEY_0"],
      ["Q", null],
      ["D", null],
    ] as const) {
      await keymap.select(key);
      await keymap.key(output, ["Left Super"]);
    }

    // The saved file equals the baseline (apart from `$schema`, an editor hint).
    const file = join(engine.configDir, "profiles/daily.json");
    const { $schema: _hint, ...expected } = JSON.parse(
      readFileSync(BASELINE, "utf8"),
    ) as Profile & {
      $schema: string;
    };
    let saved: unknown = null;
    for (let i = 0; i < 100; i++) {
      saved = JSON.parse(readFileSync(file, "utf8"));
      if (JSON.stringify(sortKeys(saved)) === JSON.stringify(sortKeys(expected))) break;
      await sleep(50);
    }
    expect(saved).toEqual(expected);

    // The engine runs it: active profile daily, no config issues.
    const client = await engine.connect();
    cleanup.push(() => client.close());
    for (let i = 0; i < 100; i++) {
      const status = await client.call("status.get", {});
      if (status.profile === "daily" && !status.configPending) break;
      await sleep(50);
    }
    expect(await client.call("status.get", {})).toMatchObject({
      state: "running",
      profile: "daily",
      configIssues: [],
    });
  });
});

/** `value` with object keys sorted, so two JSON values can be compared as text. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => [key, sortKeys(inner)]),
  );
}
