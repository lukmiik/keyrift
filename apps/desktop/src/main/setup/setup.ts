/**
 * The setup wizard's main side: runs the checks and fixes, and remembers whether the wizard was
 * finished once (a file in Electron's data folder), so it shows on the first run.
 */
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SetupCheck, SetupFix, SystemOutcome } from "../../shared/api.ts";
import { type Probe, runChecks } from "./checks.ts";

export class SetupControl {
  readonly #probe: Probe;
  readonly #fix: (kind: SetupFix) => Promise<SystemOutcome<null>>;
  readonly #doneFile: string;

  /** `dataDir`: Electron's data folder, where the "wizard done" mark is kept. */
  constructor(
    probe: Probe,
    fix: (kind: SetupFix) => Promise<SystemOutcome<null>>,
    dataDir: string,
  ) {
    this.#probe = probe;
    this.#fix = fix;
    this.#doneFile = join(dataDir, "setup-done");
  }

  checks(): Promise<SetupCheck[]> {
    return runChecks(this.#probe);
  }

  /** `kind` comes from the page, so it is checked. */
  fix(kind: unknown): Promise<SystemOutcome<null>> {
    if (kind !== "system" && kind !== "service") {
      return Promise.resolve({ ok: false, message: "not a known fix" });
    }
    return this.#fix(kind);
  }

  async firstRun(): Promise<boolean> {
    try {
      await access(this.#doneFile);
      return false;
    } catch {
      return true;
    }
  }

  async markDone(): Promise<void> {
    await writeFile(this.#doneFile, "The setup wizard was finished or skipped.\n");
  }
}
