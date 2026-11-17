/**
 * The setup wizard's fixes (spec §9.3). "system": adds the user to the groups and installs
 * Keyrift's udev rule and modules-load file, all as root through one `pkexec` password prompt.
 * "service": installs and starts the engine's systemd user unit (`keyrift service install`).
 */
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import modulesLoad from "../../../../../packaging/modules-load.d/keyrift.conf?raw";
import udevRule from "../../../../../packaging/udev/70-keyrift.rules?raw";
import type { SystemOutcome } from "../../shared/api.ts";

/** A user name that is safe to put in a shell script (POSIX portable names). */
export function isSafeUsername(name: string): boolean {
  return /^[a-z_][a-z0-9_-]*\$?$/i.test(name);
}

/**
 * The root shell script for the "system" fix. `dir` holds the rule and modules-load files to
 * install. Every step is safe to repeat, so running it twice changes nothing more.
 */
export function systemFixScript(username: string, dir: string): string {
  if (!isSafeUsername(username)) throw new Error(`unusual user name: ${username}`);
  return [
    "set -e",
    // Most distributions have `input`; `uinput` usually has to be created.
    "groupadd -f input",
    "groupadd -f uinput",
    `usermod -aG input,uinput ${username}`,
    `install -m 644 '${dir}/70-keyrift.rules' /etc/udev/rules.d/70-keyrift.rules`,
    `install -m 644 '${dir}/keyrift.conf' /etc/modules-load.d/keyrift.conf`,
    // Load uinput now (no-op if built in) and apply the rule to devices already there.
    "modprobe uinput || true",
    "udevadm control --reload",
    "udevadm trigger --subsystem-match=input --subsystem-match=misc",
  ].join("\n");
}

/** pkexec's exit codes when the user closed the password prompt or got the password wrong. */
const PKEXEC_DISMISSED = 126;
const PKEXEC_NOT_AUTHORISED = 127;

/** Runs the "system" fix through `pkexec` (or a stand-in). */
export async function runSystemFix(pkexec: string, username: string): Promise<SystemOutcome<null>> {
  // The files go through a folder only this user can write, readable by root.
  const dir = await mkdtemp(join(tmpdir(), "keyrift-setup-"));
  try {
    await writeFile(join(dir, "70-keyrift.rules"), udevRule);
    await writeFile(join(dir, "keyrift.conf"), modulesLoad);
    await chmod(dir, 0o755);
    const script = systemFixScript(username, dir);
    return await new Promise((resolve) => {
      execFile(pkexec, ["sh", "-c", script], (error, _stdout, stderr) => {
        if (error === null) resolve({ ok: true, value: null });
        else if (error.code === PKEXEC_DISMISSED || error.code === PKEXEC_NOT_AUTHORISED) {
          resolve({ ok: false, message: "The password prompt was closed; nothing was changed." });
        } else {
          resolve({ ok: false, message: stderr.trim() || error.message });
        }
      });
    });
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Runs `keyrift service install`: writes, enables and starts the engine's user unit. */
export function runServiceFix(cli: string): Promise<SystemOutcome<null>> {
  return new Promise((resolve) => {
    execFile(cli, ["service", "install"], { timeout: 30_000 }, (error, _stdout, stderr) => {
      if (error === null) resolve({ ok: true, value: null });
      else resolve({ ok: false, message: stderr.trim() || `cannot run ${cli}: ${error.message}` });
    });
  });
}
