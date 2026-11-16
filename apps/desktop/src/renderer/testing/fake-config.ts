/**
 * A stand-in for `window.keyrift.config` in component tests: profiles and settings live in memory
 * instead of files, and every save is recorded.
 */
import type { DeviceMatch, Profile, Settings } from "@keyrift/config-types";

import type { ConfigApi, ConfigOutcome, ConfigProblem } from "../../shared/api.ts";
import { setRemapped } from "../../shared/devices.ts";

export class FakeConfig implements ConfigApi {
  /** Profile files by name. */
  readonly profiles = new Map<string, Profile>();
  /** Every save, in order. */
  readonly saves: { name: string; profile: Profile }[] = [];
  active = "daily";
  /** `settings.json`; null means the file doesn't exist. */
  settings: Settings | null = null;
  /** Every device change, in order. */
  readonly deviceChanges: { device: DeviceMatch; probablyMouse: boolean; remap: boolean }[] = [];
  /** Set to make every save fail with this problem. */
  saveProblem: ConfigProblem | null = null;

  constructor(profiles: Record<string, Profile> = {}) {
    for (const [name, profile] of Object.entries(profiles)) {
      this.profiles.set(name, profile);
    }
  }

  activeProfile(): Promise<ConfigOutcome<string>> {
    return Promise.resolve({ ok: true, value: this.active });
  }

  readProfile(name: string): Promise<ConfigOutcome<Profile | null>> {
    return Promise.resolve({ ok: true, value: this.profiles.get(name) ?? null });
  }

  saveProfile(name: string, profile: Profile): Promise<ConfigOutcome<null>> {
    if (this.saveProblem !== null) {
      return Promise.resolve({ ok: false, problem: this.saveProblem });
    }
    this.saves.push({ name, profile });
    this.profiles.set(name, profile);
    return Promise.resolve({ ok: true, value: null });
  }

  readSettings(): Promise<ConfigOutcome<Settings | null>> {
    return Promise.resolve({ ok: true, value: this.settings });
  }

  setDeviceRemapped(
    device: DeviceMatch,
    probablyMouse: boolean,
    remap: boolean,
  ): Promise<ConfigOutcome<null>> {
    if (this.saveProblem !== null) {
      return Promise.resolve({ ok: false, problem: this.saveProblem });
    }
    this.deviceChanges.push({ device, probablyMouse, remap });
    this.settings = setRemapped(this.settings ?? { version: 1 }, device, probablyMouse, remap);
    return Promise.resolve({ ok: true, value: null });
  }

  listProfiles(): Promise<ConfigOutcome<string[]>> {
    return ok([...this.profiles.keys()].sort((a, b) => a.localeCompare(b)));
  }

  setActiveProfile(name: string): Promise<ConfigOutcome<null>> {
    if (!this.profiles.has(name)) return fail(`profiles/${name}.json`, "doesn't exist");
    this.active = name;
    return ok(null);
  }

  createProfile(
    name: string,
    displayName: string,
    copyOf: string | null,
  ): Promise<ConfigOutcome<null>> {
    if (this.profiles.has(name)) return fail(`profiles/${name}.json`, "already exists");
    const source =
      copyOf === null
        ? { version: 1, layers: [{ id: "base", name: "Base", keys: {} }], shortcuts: [] }
        : this.profiles.get(copyOf);
    if (source === undefined) return fail(`profiles/${copyOf}.json`, "doesn't exist");
    this.profiles.set(name, { ...source, name: displayName } as Profile);
    return ok(null);
  }

  renameProfile(from: string, to: string, displayName: string): Promise<ConfigOutcome<null>> {
    const profile = this.profiles.get(from);
    if (profile === undefined) return fail(`profiles/${from}.json`, "doesn't exist");
    if (from !== to && this.profiles.has(to)) return fail(`profiles/${to}.json`, "already exists");
    this.profiles.delete(from);
    this.profiles.set(to, { ...profile, name: displayName });
    if (this.active === from) this.active = to;
    return ok(null);
  }

  deleteProfile(name: string): Promise<ConfigOutcome<null>> {
    if (name === this.active) return fail(`profiles/${name}.json`, "is the active profile");
    this.profiles.delete(name);
    return ok(null);
  }
}

function ok<T>(value: T): Promise<ConfigOutcome<T>> {
  return Promise.resolve({ ok: true, value });
}

function fail(file: string, message: string): Promise<ConfigOutcome<never>> {
  return Promise.resolve({ ok: false, problem: { file, message, issues: [] } });
}
