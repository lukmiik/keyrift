// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { App } from "./App.tsx";
import { testProfile } from "./config/test-profile.ts";
import { FakeConfig } from "./testing/fake-config.ts";
import { FakeEngine } from "./testing/fake-engine.ts";
import { FakeLogs } from "./testing/fake-logs.ts";
import { FakeSystem } from "./testing/fake-system.ts";
import { FakeSetup } from "./testing/fake-setup.ts";

afterEach(cleanup);

const VERSIONS = { electron: "45.3.2", chrome: "1", node: "2", v8: "3" };

/** Renders the app with fakes; the active profile "daily" is `testProfile()`. */
function renderApp(config = new FakeConfig({ daily: testProfile() })) {
  render(
    <App
      logs={new FakeLogs()}
      system={new FakeSystem()}
      setup={new FakeSetup()}
      engine={new FakeEngine()}
      config={config}
      versions={VERSIONS}
    />,
  );
}

describe("App", () => {
  it("opens on the Keymap screen", () => {
    renderApp();

    expect(screen.getByRole("heading").textContent).toBe("Keymap");
    expect(screen.getByRole("button", { name: "Keymap" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("switches screens from the sidebar", async () => {
    renderApp();

    await userEvent.setup().click(screen.getByRole("button", { name: "Devices" }));
    expect(screen.getByRole("heading").textContent).toBe("Devices");
    expect(screen.getByRole("button", { name: "Devices" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("button", { name: "Keymap" }).hasAttribute("aria-current")).toBe(false);
  });

  it("shows the versions under Settings", async () => {
    renderApp();

    await userEvent.setup().click(screen.getByRole("button", { name: "Settings" }));
    expect((await screen.findByRole("region", { name: "About" })).textContent).toContain("45.3.2");
  });

  it("shows the active profile's layers on the Keymap screen", async () => {
    renderApp();

    const layers = await screen.findByRole("tablist", { name: "Layers" });
    expect(layers.textContent).toBe("BaseNav");
    expect(screen.getByRole("button", { name: "Caps: Esc" })).toBeDefined();
    expect(screen.getByText("Saved")).toBeDefined();
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(true);
  });

  it("says why the profile can't be opened", async () => {
    const config = new FakeConfig();
    config.readProfile = () =>
      Promise.resolve({
        ok: false,
        problem: { file: "profiles/daily.json", message: "not valid JSON", issues: [] },
      });
    renderApp(config);

    expect(
      await screen.findByText(/Cannot open profiles\/daily\.json: not valid JSON/),
    ).toBeDefined();
  });
});
