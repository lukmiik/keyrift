/**
 * React hook behind the Logs screen (spec §7.3, F-UI-6): while the screen is open, main follows the
 * engine's journal and this keeps the entries it sends.
 */
import { useEffect, useState } from "react";

import type { LogEntry, LogsApi } from "../../shared/api.ts";

/** Most entries kept; older ones drop off, so a chatty debug log doesn't fill the memory. */
export const MAX_ENTRIES = 2000;

export type Logs = {
  /** Oldest first, at most MAX_ENTRIES. */
  entries: LogEntry[];
  /** Why the log can't be read (e.g. journalctl is missing); null while it can. */
  error: string | null;
};

export function useLogs(logs: LogsApi): Logs {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stopEntries = logs.onEntries((batch) => {
      setError(null);
      setEntries((current) => {
        // Starting again (StrictMode runs effects twice) resends the recent entries: skip the
        // ones already here.
        const seen = new Set(current.map((entry) => entry.cursor));
        const added = batch.filter((entry) => !seen.has(entry.cursor));
        return added.length === 0 ? current : [...current, ...added].slice(-MAX_ENTRIES);
      });
    });
    const stopErrors = logs.onError(setError);
    void logs.start();
    return () => {
      stopEntries();
      stopErrors();
      // journalctl keeps running until told to stop; no need while the screen is closed.
      void logs.stop();
    };
  }, [logs]);

  return { entries, error };
}
