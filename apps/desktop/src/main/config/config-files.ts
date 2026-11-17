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

import type { ConfigOutcome, ConfigProblem, ProfileEntry } from "../../shared/api.ts";
import { setRemapped } from "../../shared/devices.ts";
import { byName } from "../../shared/profiles.ts";
import { slugify } from "../../shared/slug.ts";

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
/** The parts of settings.json the Settings screen may change (`updateSettings`). */
const SETTINGS_GROUPS = new Set(["tapHold", "emergencyRelease", "logLevel", "ui"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

  /**
   * Merges `changes` from the Settings screen into `settings.json`, keeping the rest of the file.
   * Only the groups the screen edits are taken; the result is validated before it is written.
   */
  async updateSettings(changes: unknown): Promise<ConfigOutcome<null>> {
    if (typeof changes !== "object" || changes === null || Array.isArray(changes)) {
      return problem(SETTINGS_FILE, "not a valid settings change");
    }
    const read = await this.readSettings();
    if (!read.ok) {
      return read;
    }
    const next: Record<string, unknown> = { ...(read.value ?? { version: 1 }) };
    for (const [group, value] of Object.entries(changes)) {
      if (!SETTINGS_GROUPS.has(group)) {
        return problem(SETTINGS_FILE, `"${group}" can't be changed here`);
      }
      const current = next[group];
      // Object groups (tapHold, ui…) are merged field by field; plain values (logLevel) replaced.
      next[group] =
        isPlainObject(value) && isPlainObject(current) ? { ...current, ...value } : value;
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

  /**
   * The profiles in `profiles/`, sorted by display name. A profile that can't be read or has no
   * `name` is listed by its file name, so it can still be switched to, renamed or deleted.
   */
  async listProfiles(): Promise<ConfigOutcome<ProfileEntry[]>> {
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
      .filter(isProfileName);
    const entries = await Promise.all(
      names.map(async (file) => {
        const read = await this.readProfile(file);
        const name = read.ok ? read.value?.name : undefined;
        return { file, name: name !== undefined && name.trim() !== "" ? name : file };
      }),
    );
    return { ok: true, value: entries.sort(byName) };
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
   * Creates profile `name` (the file name): a copy of profile `copyOf`, or (with `null`) one whose
   * base layer changes nothing and that has no shortcuts. Its `name` field is set to
   * `displayName`. Fails if the profile exists already.
   */
  async createProfile(
    name: unknown,
    displayName: unknown,
    copyOf: unknown,
  ): Promise<ConfigOutcome<null>> {
    if (!isProfileName(name)) {
      return badName(name);
    }
    if (!isDisplayName(displayName)) {
      return badName(displayName);
    }
    if (copyOf !== null && !isProfileName(copyOf)) {
      return badName(copyOf);
    }
    const file = profileFile(name);
    if (await this.#exists(file)) {
      return problem(file, "already exists");
    }
    let profile: Profile = {
      version: 1,
      layers: [{ id: "base", name: "Base", keys: {} }],
      shortcuts: [],
    };
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
    return this.#writeJson(file, { ...profile, name: displayName }, validateProfile);
  }

  /**
   * Renames profile `from` to `to` and sets its `name` field to `displayName`; it stays active if
   * it was. The steps are ordered so that `activeProfile` never names a missing file (the engine
   * would then pass every key through): write the new file, switch the active profile, then
   * delete the old file. With `to` equal to `from`, only the `name` field changes.
   */
  async renameProfile(
    from: unknown,
    to: unknown,
    displayName: unknown,
  ): Promise<ConfigOutcome<null>> {
    if (!isProfileName(from)) {
      return badName(from);
    }
    if (!isProfileName(to)) {
      return badName(to);
    }
    if (!isDisplayName(displayName)) {
      return badName(displayName);
    }
    if (from !== to && (await this.#exists(profileFile(to)))) {
      return problem(profileFile(to), "already exists");
    }
    const read = await this.readProfile(from);
    if (!read.ok) {
      return read;
    }
    if (read.value === null) {
      return problem(profileFile(from), "doesn't exist");
    }
    const renamed = { ...read.value, name: displayName };
    if (from === to) {
      return this.#writeJson(profileFile(to), renamed, validateProfile);
    }
    const written = await this.#writeJson(profileFile(to), renamed, validateProfile);
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

  /**
   * Writes profile `name` to `path` (anywhere, e.g. a file the user picked to share it), as the same
   * formatted JSON the config folder has. The profile is checked first, so a broken one isn't
   * passed on.
   */
  async exportProfile(name: unknown, path: string): Promise<ConfigOutcome<null>> {
    if (!isProfileName(name)) {
      return badName(name);
    }
    const read = await this.readProfile(name);
    if (!read.ok) {
      return read;
    }
    if (read.value === null) {
      return problem(profileFile(name), "doesn't exist");
    }
    try {
      await writeFileAtomic(path, `${JSON.stringify(read.value, null, 2)}\n`);
    } catch (error) {
      return problem(basename(path), `cannot save: ${(error as Error).message}`);
    }
    return { ok: true, value: null };
  }

  /**
   * Adds the profile in the file at `path` (e.g. one exported on another computer) as a new
   * profile. It is checked like any profile. It never replaces one: a name that is taken gets a
   * number ("Daily (2)"), and so does its file name. Without a `name` field the file's name is used.
   */
  async importProfile(path: string): Promise<ConfigOutcome<ProfileEntry>> {
    const source = basename(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      const reason = error instanceof SyntaxError ? "not valid JSON" : "cannot read";
      return problem(source, `${reason}: ${(error as Error).message}`);
    }
    const checked = validateProfile(parsed);
    if (!checked.ok) {
      return invalid(source, checked.issues);
    }
    const listed = await this.listProfiles();
    if (!listed.ok) {
      return listed;
    }
    const wanted = checked.value.name?.trim() || source.replace(/\.json$/i, "");
    const names = new Set(listed.value.map((entry) => entry.name));
    const files = new Set(listed.value.map((entry) => entry.file));
    let name = wanted;
    for (let n = 2; names.has(name); n++) name = `${wanted} (${n})`;
    const slug = slugify(name, "profile");
    let file = slug;
    for (let n = 2; files.has(file); n++) file = `${slug}-${n}`;
    const written = await this.#writeJson(
      profileFile(file),
      { ...checked.value, name },
      validateProfile,
    );
    return written.ok ? { ok: true, value: { file, name } } : written;
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

/** A profile's display name (its `name` field): any text that isn't blank. */
function isDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
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
