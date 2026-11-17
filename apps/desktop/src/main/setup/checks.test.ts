import { describe, expect, it } from "vite-plus/test";

import type { Probe } from "./checks.ts";
import { runChecks } from "./checks.ts";

/** A probe for a healthy system, with `fields` changed. */
function probe(fields: Partial<Probe> = {}): Probe {
  return {
    username: "alice",
    sessionGroups: () => Promise.resolve(["alice", "input", "uinput"]),
    configuredGroups: () => Promise.resolve(["alice", "input", "uinput"]),
    canOpen: () => Promise.resolve(true),
    list: (dir) => Promise.resolve(dir === "/dev/input" ? ["event0", "mice"] : []),
    read: (path) =>
      Promise.resolve(
        path.endsWith("modules.builtin") ? "kernel/drivers/input/misc/uinput.ko\n" : null,
      ),
    kernelRelease: () => Promise.resolve("6.0.0"),
    processes: () => Promise.resolve(["systemd", "bash"]),
    unitEnabled: () => Promise.resolve(false),
    unitActiveState: () => Promise.resolve("inactive"),
    autostart: () => Promise.resolve("enabled"),
    ...fields,
  };
}

async function check(id: string, fields: Partial<Probe> = {}) {
  const found = (await runChecks(probe(fields))).find((c) => c.id === id);
  if (found === undefined) throw new Error(`no check ${id}`);
  return found;
}

describe("runChecks", () => {
  it("passes everything on a healthy system", async () => {
    expect((await runChecks(probe())).map((c) => c.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
  });

  it("checks the groups, and asks to log in again after adding them", async () => {
    const without = { sessionGroups: () => Promise.resolve(["alice", "input"]) };
    expect(
      await check("groups", { ...without, configuredGroups: () => Promise.resolve(["input"]) }),
    ).toMatchObject({ status: "fail", fix: "system", detail: expect.stringContaining("uinput") });
    expect(await check("groups", without)).toMatchObject({
      status: "warn",
      fix: null,
      detail: expect.stringContaining("log out and in again"),
    });
  });

  it("checks /dev/uinput and keyboard access", async () => {
    const denied = await check("devices", {
      canOpen: (path) => Promise.resolve(path !== "/dev/uinput"),
    });
    expect(denied).toMatchObject({ status: "fail", fix: "system" });
    expect(denied.detail).toMatch(/^\/dev\/uinput can't be opened\./);
  });

  it("finds uinput in a modules-load file when it isn't built in", async () => {
    const files: Record<string, string> = { "/etc/modules-load.d/keyrift.conf": "uinput\n" };
    const notBuiltIn = {
      list: (dir: string) =>
        Promise.resolve(dir === "/etc/modules-load.d" ? ["keyrift.conf"] : ["event0"]),
      read: (path: string) => Promise.resolve(files[path] ?? null),
    };
    expect(await check("uinput-boot", notBuiltIn)).toMatchObject({
      status: "ok",
      detail: "Loaded at boot (/etc/modules-load.d/keyrift.conf).",
    });
    expect(await check("uinput-boot", { read: () => Promise.resolve(null) })).toMatchObject({
      status: "warn",
      fix: "system",
    });
  });

  it("names other remappers with the commands to stop them", async () => {
    // Like the author's machine: kanata's user unit is enabled, but failed at login.
    const enabledOnly = await check("remappers", {
      unitEnabled: (scope, unit) => Promise.resolve(scope === "user" && unit === "kanata.service"),
      unitActiveState: () => Promise.resolve("failed"),
    });
    expect(enabledOnly).toMatchObject({
      status: "warn",
      commands: ["systemctl --user disable --now kanata.service"],
    });
    expect(enabledOnly.detail).toBe(
      "kanata isn't running, but its service is enabled, so it tries to start at every login " +
        "(it failed last time). Disable it, so it can't fight Keyrift for the keyboards once it " +
        "does start.",
    );

    // Its unit is active: running, so Keyrift can't have the keyboards.
    const active = await check("remappers", {
      unitEnabled: (_scope, unit) => Promise.resolve(unit === "keyd.service"),
      unitActiveState: () => Promise.resolve("active"),
    });
    expect(active).toMatchObject({
      status: "fail",
      commands: ["sudo systemctl disable --now keyd.service"],
    });
    expect(active.detail).toMatch(/^keyd is running and starts at every login\. Two remappers/);

    const running = await check("remappers", {
      processes: () => Promise.resolve(["keyd", "input-remapper-s"]),
    });
    expect(running).toMatchObject({
      status: "fail",
      commands: ["pkill keyd", "pkill input-remapper-"],
    });
  });

  it("checks the engine service", async () => {
    expect(
      await check("service", { autostart: () => Promise.resolve("not-installed") }),
    ).toMatchObject({ status: "fail", fix: "service" });
    expect(await check("service", { autostart: () => Promise.resolve("disabled") })).toMatchObject({
      status: "warn",
      fix: "service",
    });
  });
});
