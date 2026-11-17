// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { App } from "../App.tsx";
import { MAX_ENTRIES } from "../engine/useLogs.ts";
import { FakeConfig } from "../testing/fake-config.ts";
import { FakeEngine } from "../testing/fake-engine.ts";
import { FakeLogs } from "../testing/fake-logs.ts";
import { FakeSystem } from "../testing/fake-system.ts";
import { FakeSetup } from "../testing/fake-setup.ts";
import { logText, logTime } from "./LogsScreen.tsx";

afterEach(cleanup);

const VERSIONS = { electron: "1", chrome: "1", node: "1", v8: "1" };

/** Opens the Logs screen of the app, with fake engine and logs. */
async function openLogs() {
  const engine = new FakeEngine();
  const logs = new FakeLogs();
  render(
    <App
      engine={engine}
      config={new FakeConfig()}
      logs={logs}
      system={new FakeSystem()}
      setup={new FakeSetup()}
      versions={VERSIONS}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Logs" }));
  await act(() => Promise.resolve());
  return { engine, logs, user };
}

const messages = () =>
  within(screen.getByRole("table", { name: "Log entries" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.lastElementChild?.textContent);

/** Picks `option` in the dropdown labelled `label`. */
async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("LogsScreen", () => {
  it("follows the log only while open", async () => {
    const { logs, user } = await openLogs();
    expect(logs.following).toBe(true);
    await user.click(screen.getByRole("button", { name: "Keymap" }));
    expect(logs.following).toBe(false);
  });

  it("shows errors and warnings, newest first, and more on request", async () => {
    const { logs, user } = await openLogs();
    expect(screen.getByText("No log entries yet.")).toBeDefined();
    act(() =>
      logs.send(
        { level: "info", message: "engine started" },
        { level: "warn", message: "device gone" },
        { level: "error", message: "bad config" },
        { level: "debug", message: "key event" },
        { level: "info", message: "Started keyrift.service.", source: "systemd" },
      ),
    );
    expect(messages()).toEqual(["bad config", "device gone"]);

    await pick(user, "Show", "Info and above");
    expect(messages()).toEqual([
      "systemd: Started keyrift.service.",
      "bad config",
      "device gone",
      "engine started",
    ]);
    await pick(user, "Show", "Everything");
    expect(messages()).toHaveLength(5);
  });

  it("says when nothing matches the filter", async () => {
    const { logs } = await openLogs();
    act(() => logs.send({ level: "info", message: "engine started" }));
    expect(screen.getByText("No entries at this level.")).toBeDefined();
  });

  it("skips entries it already has and keeps the newest", async () => {
    const { logs } = await openLogs();
    act(() => {
      logs.send({ cursor: "x", level: "error", message: "once" });
      logs.send({ cursor: "x", level: "error", message: "once" });
    });
    expect(messages()).toEqual(["once"]);
    act(() =>
      logs.send(...Array.from({ length: MAX_ENTRIES }, () => ({ level: "error" as const }))),
    );
    expect(messages()).toHaveLength(MAX_ENTRIES);
    expect(messages()).not.toContain("once");
  });

  it("shows why the log can't be read", async () => {
    const { logs } = await openLogs();
    act(() => logs.sendError("cannot run journalctl: ENOENT"));
    expect(screen.getByRole("alert").textContent).toContain("cannot run journalctl: ENOENT");
    expect(screen.queryByText("No log entries yet.")).toBeNull();
  });

  it("changes the engine's log level", async () => {
    const { engine, user } = await openLogs();
    expect(screen.getByRole("combobox", { name: "Engine log level" }).textContent).toContain(
      "Info",
    );
    await pick(user, "Engine log level", "Debug");
    expect(engine.calls).toContain("log.setLevel");
    expect(screen.getByRole("combobox", { name: "Engine log level" }).textContent).toContain(
      "Debug",
    );
  });

  it("shows the engine's level, also after leaving the screen or a reload", async () => {
    const { engine, user } = await openLogs();
    await pick(user, "Engine log level", "Debug");
    await user.click(screen.getByRole("button", { name: "Keymap" }));
    await user.click(screen.getByRole("button", { name: "Logs" }));
    const level = () => screen.getByRole("combobox", { name: "Engine log level" }).textContent;
    expect(level()).toContain("Debug");
    // A config reload puts back the saved level; the engine says so in a status event.
    act(() => engine.setStatus({ logLevel: "info" }));
    expect(level()).toContain("Info");
  });

  it("copies the shown entries as text", async () => {
    const { logs, user } = await openLogs();
    act(() =>
      logs.send(
        { level: "warn", message: "first", timeMs: 0 },
        { level: "error", message: "second", timeMs: 1000 },
      ),
    );
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(
      `${logTime(0)} WARN  first\n${logTime(1000)} ERROR second`,
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeDefined();
  });
});

describe("log labels", () => {
  it("shows the date and time", () => {
    expect(logTime(new Date(2026, 10, 16, 9, 5, 7).getTime())).toBe("16 Nov 09:05:07");
  });

  it("marks systemd's lines in the copied text", () => {
    const entry = { cursor: "", timeMs: 0, level: "info", message: "Stopped." } as const;
    expect(logText([{ ...entry, source: "systemd" }])).toBe(
      `${logTime(0)} INFO  systemd: Stopped.`,
    );
  });
});
