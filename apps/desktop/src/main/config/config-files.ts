/**
 * Reads and writes the config folder (spec §6.1, F-CFG-5) for the page. Runs in main: the page has
 * no file access, and validation (ajv) can't run under the page's CSP.
 *
 * Every file is validated against the engine's JSON Schema on read and before writing, so the GUI
 * never saves a file the engine would reject on schema grounds.
 */
import { randomUUID } from "node:crypto";
import { access, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  type DeviceMatch,
  type Profile,
  type SchemaIssue,
  type SchemaResult,
  type Settings,
  validateProfile,
  validateSettings,
} from "@keyrift/config-types";

import type { ConfigOutcome, ConfigProblem } from "../../shared/api.ts";
import { setRemapped } from "../../shared/devices.ts";

/** `~/.config/keyrift`, or under `$XDG_CONFIG_HOME` if set; same rule as the engine. */
export function defaultConfigDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "keyrift");
}

/**
 * Whether `name` is a profile name the engine accepts: not empty, no `/` or `\`, not starting with
 * `.`. This also keeps the page from reaching files outside `profiles/` (e.g. `../settings`).
 */
export function isProfileName(name: unknown): name is string {
  return typeof name === "string" && name !== "" && !name.startsWith(".") && !/[/\\\0]/.test(name);
}

/** The engine's default when there is no `settings.json`. */
const DEFAULT_PROFILE = "default";
const SETTINGS_FILE = "settings.json";

export class ConfigFiles {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async activeProfile(): Promise<ConfigOutcome<string>> {
    const read = await this.readSettings();
    if (!read.ok) {
      return read;
    }
    return { ok: true, value: read.value?.activeProfile ?? DEFAULT_PROFILE };
  }

  /** Reads and validates `settings.json`. `null` if it doesn't exist (the engine uses defaults). */
  async readSettings(): Promise<ConfigOutcome<Settings | null>> {
    const read = await this.#readJson(SETTINGS_FILE);
    if (!read.ok) {
      return read;
    }
    if (read.value === null) {
      return { ok: true, value: null };
    }
    const checked = validateSettings(read.value);
    return checked.ok ? checked : invalid(SETTINGS_FILE, checked.issues);
  }

  /**
   * Turns remapping of one device on or off in `settings.json` (F-DEV-3, F-DEV-5), keeping the rest
   * of the file. The engine notices the change and grabs or releases the device. All arguments come
   * from the page, so they are checked here.
   */
  async setDeviceRemapped(
    device: unknown,
    probablyMouse: unknown,
    remap: unknown,
  ): Promise<ConfigOutcome<null>> {
    if (
      !isDeviceMatch(device) ||
      typeof probablyMouse !== "boolean" ||
      typeof remap !== "boolean"
    ) {
      return problem(SETTINGS_FILE, "not a valid device change");
    }
    // Read, change, write: an edit made to the file in between would be lost, but the window for
    // that is a few milliseconds.
    const read = await this.readSettings();
    if (!read.ok) {
      return read;
    }
    const settings = read.value ?? { version: 1 };
    const next = setRemapped(settings, device, probablyMouse, remap);
    if (next === settings) {
      return { ok: true, value: null };
    }
    return this.#writeJson(SETTINGS_FILE, next, validateSettings);
  }

  async readProfile(name: unknown): Promise<ConfigOutcome<Profile | null>> {
    if (!isProfileName(name)) {
      return badName(name);
    }
    const file = profileFile(name);
    const read = await this.#readJson(file);
    if (!read.ok) {
      return read;
    }
    if (read.value === null) {
      return { ok: true, value: null };
    }
    const checked = validateProfile(read.value);
    return checked.ok ? checked : invalid(file, checked.issues);
  }

  /** `profile` is `unknown`: it comes from the page, so it's checked like any outside data. */
  async saveProfile(name: unknown, profile: unknown): Promise<ConfigOutcome<null>> {
    if (!isProfileName(name)) {
      return badName(name);
    }
    const file = profileFile(name);
    return this.#writeJson(file, profile, validateProfile);
  }

  /** Names of the profiles in `profiles/` (file names without `.json`), sorted. */
  async listProfiles(): Promise<ConfigOutcome<string[]>> {
    let files: string[];
    try {
      files = await readdir(join(this.dir, "profiles"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: true, value: [] };
      }
      return problem("profiles/", `cannot read: ${(error as Error).message}`);
    }
    const names = files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length))
      // Also skips the GUI's own temporary files, which start with a dot.
      .filter(isProfileName)
      .sort((a, b) => a.localeCompare(b));
    return { ok: true, value: names };
  }

  /** Makes `name` the active profile in `settings.json`; the engine switches to it. */
  async setActiveProfile(name: unknown): Promise<ConfigOutcome<null>> {
    if (!isProfileName(name)) {
      return badName(name);
    }
    if (!(await this.#exists(profileFile(name)))) {
      return problem(profileFile(name), "doesn't exist");
    }
    const read = await this.readSettings();
    if (!read.ok) {
      return read;
    }
    const settings = read.value ?? { version: 1 };
    if (settings.activeProfile === name) {
      return { ok: true, value: null };
    }
    return this.#writeJson(SETTINGS_FILE, { ...settings, activeProfile: name }, validateSettings);
  }

  /**
   * Creates profile `name`: a copy of profile `copyOf`, or (with `null`) one whose base layer
   * changes nothing. Its `name` field is set to `name`. Fails if the profile exists already.
   */
  async createProfile(name: unknown, copyOf: unknown): Promise<ConfigOutcome<null>> {
    if (!isProfileName(name)) {
      return badName(name);
    }
    if (copyOf !== null && !isProfileName(copyOf)) {
      return badName(copyOf);
    }
    const file = profileFile(name);
    if (await this.#exists(file)) {
      return problem(file, "already exists");
    }
    let profile: Profile = { version: 1, layers: [{ id: "base", name: "Base", keys: {} }] };
    if (copyOf !== null) {
      const read = await this.readProfile(copyOf);
      if (!read.ok) {
        return read;
      }
      if (read.value === null) {
        return problem(profileFile(copyOf), "doesn't exist");
      }
      profile = read.value;
    }
    return this.#writeJson(file, { ...profile, name }, validateProfile);
  }

  /**
   * Renames profile `from` to `to`; it stays active if it was. The steps are ordered so that
   * `activeProfile` never names a missing file (the engine would then pass every key through):
   * write the new file, switch the active profile, then delete the old file.
   */
  async renameProfile(from: unknown, to: unknown): Promise<ConfigOutcome<null>> {
    if (!isProfileName(from)) {
      return badName(from);
    }
    if (!isProfileName(to)) {
      return badName(to);
    }
    if (from === to) {
      return { ok: true, value: null };
    }
    if (await this.#exists(profileFile(to))) {
      return problem(profileFile(to), "already exists");
    }
    const read = await this.readProfile(from);
    if (!read.ok) {
      return read;
    }
    if (read.value === null) {
      return problem(profileFile(from), "doesn't exist");
    }
    const written = await this.#writeJson(profileFile(to), read.value, validateProfile);
    if (!written.ok) {
      return written;
    }
    const active = await this.activeProfile();
    if (!active.ok) {
      return active;
    }
    if (active.value === from) {
      const switched = await this.setActiveProfile(to);
      if (!switched.ok) {
        return switched;
      }
    }
    return this.#remove(profileFile(from));
  }

  /** Deletes a profile. The active one can't be deleted: switch to another profile first. */
  async deleteProfile(name: unknown): Promise<ConfigOutcome<null>> {
    if (!isProfileName(name)) {
      return badName(name);
    }
    const active = await this.activeProfile();
    if (!active.ok) {
      return active;
    }
    if (active.value === name) {
      return problem(profileFile(name), "is the active profile; switch to another one first");
    }
    return this.#remove(profileFile(name));
  }

  async #exists(file: string): Promise<boolean> {
    try {
      await access(join(this.dir, file));
      return true;
    } catch {
      return false;
    }
  }

  async #remove(file: string): Promise<ConfigOutcome<null>> {
    try {
      await rm(join(this.dir, file));
    } catch (error) {
      return problem(file, `cannot delete: ${(error as Error).message}`);
    }
    return { ok: true, value: null };
  }

  /** Validates `value` with `validate` and writes it to `file` as formatted JSON. */
  async #writeJson(
    file: string,
    value: unknown,
    validate: (value: unknown) => SchemaResult<unknown>,
  ): Promise<ConfigOutcome<null>> {
    const checked = validate(value);
    if (!checked.ok) {
      return invalid(file, checked.issues);
    }
    try {
      await writeFileAtomic(join(this.dir, file), `${JSON.stringify(checked.value, null, 2)}\n`);
    } catch (error) {
      return problem(file, `cannot save: ${(error as Error).message}`);
    }
    return { ok: true, value: null };
  }

  /** Reads and parses a JSON file. `null` if it doesn't exist. */
  async #readJson(file: string): Promise<ConfigOutcome<unknown>> {
    let text: string;
    try {
      text = await readFile(join(this.dir, file), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: true, value: null };
      }
      return problem(file, `cannot read: ${(error as Error).message}`);
    }
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch (error) {
      return problem(file, `not valid JSON: ${(error as Error).message}`);
    }
  }
}

/**
 * Replaces `path` with `text` so that a reader (the engine, an editor) only ever sees the old or
 * the new file, never half of it: write a temporary file next to it, flush it to disk, then rename
 * it over the old one. Rename within one folder is atomic on Linux. The temporary name starts with
 * `.`, which the engine's file watcher ignores.
 */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, "w");
    try {
      await handle.writeFile(text);
      await handle.sync(); // On disk before the rename, so a crash can't leave an empty file.
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Whether `value` looks like `{vendorId, productId, name}`; the schema checks the rest. */
function isDeviceMatch(value: unknown): value is DeviceMatch {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.vendorId === "string" && typeof v.productId === "string" && typeof v.name === "string"
  );
}

function profileFile(name: string): string {
  return `profiles/${name}.json`;
}

function problem(
  file: string,
  message: string,
  issues: SchemaIssue[] = [],
): { ok: false; problem: ConfigProblem } {
  return { ok: false, problem: { file, message, issues } };
}

function invalid(file: string, issues: SchemaIssue[]): { ok: false; problem: ConfigProblem } {
  return problem(file, "doesn't match the config schema", issues);
}

function badName(name: unknown): { ok: false; problem: ConfigProblem } {
  return problem("profiles/", `not a valid profile name: ${JSON.stringify(name)}`);
}
