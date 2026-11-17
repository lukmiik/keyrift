// @vitest-environment happy-dom
import type { Profile } from "@keyrift/config-types";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { App } from "../App.tsx";
import { deepFreeze } from "../config/test-profile.ts";
import { FakeConfig } from "../testing/fake-config.ts";
import { FakeEngine } from "../testing/fake-engine.ts";
import { FakeLogs } from "../testing/fake-logs.ts";
import { FakeSystem } from "../testing/fake-system.ts";
import { FakeSetup } from "../testing/fake-setup.ts";
import { newLayerId } from "./KeymapScreen.tsx";

afterEach(cleanup);

const VERSIONS = { electron: "1", chrome: "1", node: "1", v8: "1" };

/** Like the baseline: Caps → Esc, Right Alt holds "Nav", Mute → None (not on a TKL keyboard). */
const PROFILE: Profile = deepFreeze({
  version: 1,
  layers: [
    {
      id: "base",
      name: "Base",
      keys: {
        KEY_CAPSLOCK: { type: "key", key: "KEY_ESC" },
        KEY_RIGHTALT: { type: "layer", mode: "hold", layer: "nav" },
        KEY_MUTE: { type: "none" },
      },
    },
    { id: "nav", name: "Nav", keys: { KEY_H: { type: "key", key: "KEY_LEFT" } } },
    { id: "num", name: "Num", keys: {} },
  ],
});

async function renderKeymap() {
  render(
    <App
      logs={new FakeLogs()}
      system={new FakeSystem()}
      setup={new FakeSetup()}
      engine={new FakeEngine()}
      config={new FakeConfig({ daily: PROFILE })}
      versions={VERSIONS}
    />,
  );
  await screen.findByRole("tablist", { name: "Layers" });
  return userEvent.setup();
}

const key = (name: string) => screen.getByRole("button", { name });
const tabNames = () =>
  within(screen.getByRole("tablist", { name: "Layers" }))
    .getAllByRole("tab")
    .map((tab) => tab.textContent);

describe("KeymapScreen", () => {
  it("labels and colours each key by what it does", async () => {
    await renderKeymap();

    expect(key("Caps: Esc").dataset.kind).toBe("key");
    expect(key("AltGr: Nav").dataset.kind).toBe("layer");
    expect(key("Q: Q (unchanged)").dataset.kind).toBe("passthrough");
  });

  it("dims transparent keys on an upper layer and shows what they fall through to", async () => {
    const user = await renderKeymap();

    await user.click(screen.getByRole("tab", { name: "Nav" }));
    expect(key("H: ←").dataset.source).toBe("own");
    const caps = key("Caps: Esc");
    expect(caps.dataset.source).toBe("below");
    expect(caps.className).toContain("opacity-40");
  });

  it("lists mapped keys the layout doesn't have under Other keys", async () => {
    await renderKeymap();

    const other = screen.getByRole("list", { name: "Other keys" });
    expect(other.textContent).toBe("Mute: None");
  });

  it("moves the focus with the arrow keys", async () => {
    const user = await renderKeymap();

    await user.click(key("G: G (unchanged)"));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(key("T: T (unchanged)"));
  });

  it("adds a layer and shows it", async () => {
    const user = await renderKeymap();

    await user.click(screen.getByRole("button", { name: "Add layer" }));
    await user.type(screen.getByLabelText("Name"), "Mouse keys{Enter}");

    expect(tabNames()).toEqual(["Base", "Nav", "Num", "Mouse keys"]);
    expect(screen.getByRole("tab", { name: "Mouse keys" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("lists the keys that switch to a layer before deleting it", async () => {
    const user = await renderKeymap();

    await user.click(screen.getByRole("tab", { name: "Nav" }));
    await user.click(screen.getByRole("button", { name: "Delete layer" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("list", { name: "References" }).textContent).toBe(
      "Base: AltGr",
    );
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(tabNames()).toEqual(["Base", "Num"]);
    // The key that switched to it is transparent now.
    expect(key("AltGr: AltGr (unchanged)")).toBeDefined();

    // Undo brings both back.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(tabNames()).toEqual(["Base", "Nav", "Num"]);
    expect(key("AltGr: Nav")).toBeDefined();
  });
});

describe("newLayerId", () => {
  it("makes an id from the name, unique among the layers", () => {
    expect(newLayerId("Alt nav", [])).toBe("alt-nav");
    expect(newLayerId("Żółw & co", [])).toBe("zolw-co");
    expect(newLayerId("!!!", [])).toBe("layer");
    expect(newLayerId("Nav", [{ id: "nav" }, { id: "nav-2" }])).toBe("nav-3");
  });
});
