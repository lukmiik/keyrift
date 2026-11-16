/**
 * React hook for the profile list and which profile is active (spec F-CFG-3: chosen in the GUI).
 */
import { useEffect, useState } from "react";

import type { ConfigApi, ConfigProblem } from "../../shared/api.ts";

type ProfileList = {
  /** Profile names, sorted; also has the active one if its file doesn't exist yet. */
  names: string[];
  /** The active profile; null until loaded or if settings.json can't be read. */
  active: string | null;
  /** Why the list or settings couldn't be read. */
  problem: ConfigProblem | null;
};

export type Profiles = ProfileList & {
  /** Reads the list and the active profile again, e.g. after a change. */
  refresh: () => Promise<void>;
};

export function useProfiles(config: ConfigApi): Profiles {
  const [list, setList] = useState<ProfileList>({ names: [], active: null, problem: null });

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

async function loadProfiles(config: ConfigApi): Promise<ProfileList> {
  const [list, current] = await Promise.all([config.listProfiles(), config.activeProfile()]);
  if (!list.ok) return { names: [], active: null, problem: list.problem };
  if (!current.ok) return { names: list.value, active: null, problem: current.problem };
  // The active profile may have no file yet (a fresh config); list it anyway.
  const names = list.value.includes(current.value)
    ? list.value
    : [...list.value, current.value].sort((a, b) => a.localeCompare(b));
  return { names, active: current.value, problem: null };
}
