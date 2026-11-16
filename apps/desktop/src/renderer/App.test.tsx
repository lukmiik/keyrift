// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { App } from "./App.tsx";
import { FakeEngine } from "./testing/fake-engine.ts";

afterEach(cleanup);

const VERSIONS = { electron: "45.3.2", chrome: "1", node: "2", v8: "3" };

describe("App", () => {
  it("opens on the Keymap screen", () => {
    render(<App engine={new FakeEngine()} versions={VERSIONS} />);

    expect(screen.getByRole("heading").textContent).toBe("Keymap");
    expect(screen.getByRole("button", { name: "Keymap" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("switches screens from the sidebar", async () => {
    render(<App engine={new FakeEngine()} versions={VERSIONS} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Devices" }));
    expect(screen.getByRole("heading").textContent).toBe("Devices");
    expect(screen.getByRole("button", { name: "Devices" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("button", { name: "Keymap" }).hasAttribute("aria-current")).toBe(false);
  });

  it("shows the versions under Settings", async () => {
    render(<App engine={new FakeEngine()} versions={VERSIONS} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText(/Electron 45\.3\.2/)).toBeDefined();
  });
});
