// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { App } from "../App.tsx";
import { FakeConfig } from "../testing/fake-config.ts";
import { FakeEngine } from "../testing/fake-engine.ts";
import { FakeLogs } from "../testing/fake-logs.ts";
import { FakeSetup, okCheck } from "../testing/fake-setup.ts";
import { FakeUpdates } from "../testing/fake-updates.ts";
import { FakeSystem } from "../testing/fake-system.ts";

afterEach(cleanup);

const VERSIONS = { electron: "1", chrome: "1", node: "1", v8: "1" };

function renderApp(setup: FakeSetup, engine = new FakeEngine()) {
  render(
    <App
      engine={engine}
      config={new FakeConfig()}
      logs={new FakeLogs()}
      system={new FakeSystem()}
      setup={setup}
      updates={new FakeUpdates()}
      versions={VERSIONS}
    />,
  );
  return { engine, user: userEvent.setup() };
}

const FAILING = [
  okCheck({
    id: "groups",
    title: "Groups input and uinput",
    status: "fail",
    detail: "You aren't in uinput.",
    fix: "system",
  }),
  okCheck({ id: "devices" }),
  okCheck({
    id: "remappers",
    title: "No other remapper",
    status: "warn",
    detail: "Found kanata.",
    commands: ["systemctl --user disable --now kanata.service"],
  }),
  okCheck({ id: "service", title: "Engine service", status: "fail", fix: "service" }),
];

describe("SetupWizard", () => {
  it("opens when a check fails, and fixes what it can", async () => {
    const setup = new FakeSetup({ checks: FAILING });
    const { user } = renderApp(setup);
    const checks = await screen.findByRole("list", { name: "Checks" });
    const mark = (title: string) =>
      within(within(checks).getByRole("listitem", { name: title }))
        .getByRole("img")
        .getAttribute("aria-label");
    expect(mark("Groups input and uinput")).toBe("Failed");
    expect(mark("No other remapper")).toBe("Needs attention");
    expect(screen.getByText("systemctl --user disable --now kanata.service")).toBeDefined();
    expect(screen.getByText(/checks? failed: Keyrift can't work until/)).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Fix with one password prompt" }));
    await user.click(await screen.findByRole("button", { name: "Install the engine service" }));
    expect(setup.fixes).toEqual(["system", "service"]);
    // The checks run again after each fix, which takes a moment.
    await waitFor(() => expect(mark("Groups input and uinput")).toBe("OK"));
    // Nothing fails any more (a warning is left): Done instead of Skip.
    expect(
      screen.getByText(
        "Everything Keyrift needs is in place. 1 warning: Keyrift works now, but may run into trouble later.",
      ),
    ).toBeDefined();
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(setup.done).toBe(true);
    expect(screen.getByRole("button", { name: "Keymap" })).toBeDefined();
  });

  it("opens on the first run even when everything passes", async () => {
    renderApp(new FakeSetup({ firstRun: true }));
    expect(await screen.findByRole("region", { name: "Setup" })).toBeDefined();
  });

  it("stays closed when the setup was done and nothing fails", async () => {
    renderApp(new FakeSetup());
    await act(() => Promise.resolve());
    expect(screen.queryByRole("region", { name: "Setup" })).toBeNull();
  });

  it("shows why a fix failed", async () => {
    const setup = new FakeSetup({ checks: FAILING });
    setup.failWith = "The password prompt was closed; nothing was changed.";
    const { user } = renderApp(setup);
    await user.click(await screen.findByRole("button", { name: "Fix with one password prompt" }));
    expect(screen.getByRole("alert").textContent).toContain("password prompt was closed");
  });

  it("checks that the engine gets a key", async () => {
    const { engine, user } = renderApp(new FakeSetup({ firstRun: true }));
    await user.click(await screen.findByRole("button", { name: "Press any key" }));
    expect(screen.getByText("Press any key on your keyboard…")).toBeDefined();
    act(() => engine.pressKey("KEY_A"));
    expect(screen.getByText("The engine got A. Keyrift works.")).toBeDefined();
  });

  it("opens again from Settings", async () => {
    const { user } = renderApp(new FakeSetup());
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Run setup again" }));
    expect(screen.getByRole("region", { name: "Setup" })).toBeDefined();
  });
});
