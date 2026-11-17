/**
 * React hook for the profile list and which profile is active (spec F-CFG-3: chosen in the GUI).
 */
import { useEffect, useState } from "react";

import type { ConfigApi, ConfigProblem, ProfileEntry } from "../../shared/api.ts";
import { byName } from "../../shared/profiles.ts";

type ProfileList = {
  /** The profiles, sorted by display name; also has the active one if its file doesn't exist yet. */
  list: ProfileEntry[];
  /** The active profile's file name; null until loaded or if settings.json can't be read. */
  active: string | null;
  /** Why the list or settings couldn't be read. */
  problem: ConfigProblem | null;
};

export type Profiles = ProfileList & {
  /** Reads the list and the active profile again, e.g. after a change. */
  refresh: () => Promise<void>;
};

export function useProfiles(config: ConfigApi): Profiles {
  const [list, setList] = useState<ProfileList>({ list: [], active: null, problem: null });

  useEffect(() => {
    let active = true;
    void loadProfiles(config).then((loaded) => {
      if (active) setList(loaded);
    });
    return () => {
      active = false;
    };
  }, [config]);

  return { ...list, refresh: async () => setList(await loadProfiles(config)) };
}

/** The display name of profile `file` in `list`, or `file` itself if it isn't listed. */
export function displayName(list: ProfileEntry[], file: string): string {
  return list.find((entry) => entry.file === file)?.name ?? file;
}

async function loadProfiles(config: ConfigApi): Promise<ProfileList> {
  const [list, current] = await Promise.all([config.listProfiles(), config.activeProfile()]);
  if (!list.ok) return { list: [], active: null, problem: list.problem };
  if (!current.ok) return { list: list.value, active: null, problem: current.problem };
  // The active profile may have no file yet (a fresh config); list it anyway.
  const entries = list.value.some((entry) => entry.file === current.value)
    ? list.value
    : [...list.value, { file: current.value, name: current.value }].sort(byName);
  return { list: entries, active: current.value, problem: null };
}
