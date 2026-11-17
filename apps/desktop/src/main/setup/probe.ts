/**
 * The setup checks' view of the system (checks.ts `Probe`): the real one, and a fake one described
 * by a JSON file (KEYRIFT_SETUP_FAKE) for GUI tests, which its fixes change like real ones would.
 */
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { release, userInfo } from "node:os";

import type { Autostart, SetupFix } from "../../shared/api.ts";
import type { AutostartControl } from "../system/autostart.ts";
import type { Probe } from "./checks.ts";

/** Runs a command and resolves with its stdout ("" if it fails or exits non-zero). */
function output(command: string, args: string[], anyExit = false): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 10_000 }, (error, stdout) =>
      // anyExit: keep the output of a command that exits non-zero on purpose (`systemctl
      // is-active` prints "failed" and exits 3). Not started at all: no output either way.
      resolve(error === null || (anyExit && typeof error.code === "number") ? stdout : ""),
    );
  });
}

const words = (text: string) => text.split(/\s+/).filter((word) => word !== "");

export function realProbe(autostart: AutostartControl): Probe {
  const username = userInfo().username;
  return {
    username,
    sessionGroups: async () => words(await output("id", ["-Gn"])),
    configuredGroups: async () => words(await output("id", ["-Gn", username])),
    canOpen: async (path, write) => {
      try {
        await access(path, write ? constants.R_OK | constants.W_OK : constants.R_OK);
        return true;
      } catch {
        return false;
      }
    },
    list: async (dir) => readdir(dir).catch(() => []),
    read: async (path) => readFile(path, "utf8").catch(() => null),
    kernelRelease: () => Promise.resolve(release()),
    processes: async () => {
      const pids = (await readdir("/proc").catch(() => [])).filter((name) => /^\d+$/.test(name));
      const names = await Promise.all(
        pids.map((pid) => readFile(`/proc/${pid}/comm`, "utf8").catch(() => "")),
      );
      return names.map((name) => name.trim()).filter((name) => name !== "");
    },
    unitEnabled: async (scope, unit) =>
      (
        await output("systemctl", [...(scope === "user" ? ["--user"] : []), "is-enabled", unit])
      ).trim() === "enabled",
    unitActiveState: async (scope, unit) =>
      (
        await output(
          "systemctl",
          [...(scope === "user" ? ["--user"] : []), "is-active", unit],
          true,
        )
      ).trim(),
    autostart: async () => {
      const state = await autostart.state();
      return state.ok ? state.value : "not-installed";
    },
  };
}

/** The system a fake probe describes (GUI tests write it as JSON). */
export type FakeSystemState = {
  sessionGroups: string[];
  configuredGroups: string[];
  uinputAccess: boolean;
  keyboardAccess: boolean;
  uinputBuiltin: boolean;
  uinputAtBoot: boolean;
  processes: string[];
  userUnits: string[];
  systemUnits: string[];
  /** Enabled units that are running now; the others count as failed. */
  activeUnits: string[];
  autostart: Autostart;
  /** Fixes run so far, in order: what a test checks. */
  fixes: SetupFix[];
};

/** All checks pass: the default for GUI tests that aren't about the wizard. */
export const HEALTHY_SYSTEM: FakeSystemState = {
  sessionGroups: ["input", "uinput"],
  configuredGroups: ["input", "uinput"],
  uinputAccess: true,
  keyboardAccess: true,
  uinputBuiltin: true,
  uinputAtBoot: false,
  processes: [],
  userUnits: [],
  systemUnits: [],
  activeUnits: [],
  autostart: "enabled",
  fixes: [],
};

/** A probe over the JSON file at `path`, read on every check so a test can change it. */
export function fakeProbe(path: string): { probe: Probe; fix: (kind: SetupFix) => Promise<void> } {
  const state = async (): Promise<FakeSystemState> => ({
    ...HEALTHY_SYSTEM,
    ...(JSON.parse(await readFile(path, "utf8").catch(() => "{}")) as Partial<FakeSystemState>),
  });
  const probe: Probe = {
    username: "tester",
    sessionGroups: async () => (await state()).sessionGroups,
    configuredGroups: async () => (await state()).configuredGroups,
    canOpen: async (file) => {
      const s = await state();
      return file === "/dev/uinput" ? s.uinputAccess : s.keyboardAccess;
    },
    list: async (dir) => {
      const s = await state();
      if (dir === "/dev/input") return ["event0"];
      return dir === "/etc/modules-load.d" && s.uinputAtBoot ? ["keyrift.conf"] : [];
    },
    read: async (file) => {
      const s = await state();
      if (file.endsWith("modules.builtin")) {
        return s.uinputBuiltin ? "kernel/drivers/input/misc/uinput.ko\n" : "";
      }
      return file === "/etc/modules-load.d/keyrift.conf" ? "uinput\n" : null;
    },
    kernelRelease: () => Promise.resolve("6.0.0-test"),
    processes: async () => (await state()).processes,
    unitEnabled: async (scope, unit) =>
      (await state())[scope === "user" ? "userUnits" : "systemUnits"].includes(unit),
    unitActiveState: async (_scope, unit) =>
      (await state()).activeUnits.includes(unit) ? "active" : "failed",
    autostart: async () => (await state()).autostart,
  };
  // What a real fix changes: the system one adds the groups (active after logging in again),
  // installs the udev rule (access) and the modules-load file; the service one enables the unit.
  const fix = async (kind: SetupFix) => {
    const s = await state();
    const next: FakeSystemState =
      kind === "system"
        ? {
            ...s,
            configuredGroups: [...new Set([...s.configuredGroups, "input", "uinput"])],
            uinputAccess: true,
            keyboardAccess: true,
            uinputAtBoot: true,
          }
        : { ...s, autostart: "enabled" };
    await writeFile(path, JSON.stringify({ ...next, fixes: [...s.fixes, kind] }));
  };
  return { probe, fix };
}
