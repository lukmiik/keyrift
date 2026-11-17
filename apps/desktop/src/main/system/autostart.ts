/**
 * The engine's autostart (spec §7.3 Settings): whether its systemd user unit is enabled, i.e. starts
 * with the desktop session. Runs `systemctl --user`; tests point `systemctl` at a fake.
 */
import { execFile } from "node:child_process";

import type { Autostart, SystemOutcome } from "../../shared/api.ts";

const UNIT = "keyrift.service";

/** Runs `command args`; resolves with stdout and the exit code, or rejects if it can't start. */
function run(
  command: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10_000 }, (error, stdout, stderr) => {
      // A non-zero exit is an answer here (is-enabled exits with 1 for "disabled"), not a failure.
      if (error !== null && typeof error.code !== "number") reject(error);
      else resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
    });
  });
}

export class AutostartControl {
  readonly #systemctl: string;

  constructor(systemctl: string) {
    this.#systemctl = systemctl;
  }

  async state(): Promise<SystemOutcome<Autostart>> {
    try {
      const { stdout, stderr } = await run(this.#systemctl, ["--user", "is-enabled", UNIT]);
      const state = stdout.trim();
      if (state === "enabled") return { ok: true, value: "enabled" };
      // "disabled", and the other states of an installed unit that doesn't start by itself
      // ("static", "indirect", "masked"…).
      if (state !== "" && state !== "not-found") return { ok: true, value: "disabled" };
      // No unit file: systemctl prints nothing (or "not-found") and complains on stderr.
      if (state === "not-found" || /No such file|not found|does not exist/i.test(stderr)) {
        return { ok: true, value: "not-installed" };
      }
      return { ok: false, message: stderr.trim() || "systemctl gave no answer" };
    } catch (error) {
      return { ok: false, message: `cannot run ${this.#systemctl}: ${(error as Error).message}` };
    }
  }

  /** `enabled` comes from the page, so it is checked. */
  async set(enabled: unknown): Promise<SystemOutcome<Autostart>> {
    if (typeof enabled !== "boolean") return { ok: false, message: "not a valid autostart value" };
    try {
      const { code, stderr } = await run(this.#systemctl, [
        "--user",
        enabled ? "enable" : "disable",
        UNIT,
      ]);
      if (code !== 0)
        return { ok: false, message: stderr.trim() || `systemctl exited with ${code}` };
    } catch (error) {
      return { ok: false, message: `cannot run ${this.#systemctl}: ${(error as Error).message}` };
    }
    return this.state();
  }
}
