/**
 * React hook for updating the app: the running version and where an update stands, kept current
 * by main's "updates:changed". `null` until main answered.
 */
import { useEffect, useState } from "react";

import type { UpdateInfo, UpdatesApi } from "../shared/api.ts";

export function useUpdates(updates: UpdatesApi): UpdateInfo | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let active = true;
    // Subscribe first, so a change between the two calls isn't missed.
    const stop = updates.onChange(setInfo);
    void updates.info().then((current) => {
      if (active) setInfo(current);
    });
    return () => {
      active = false;
      stop();
    };
  }, [updates]);

  return info;
}
