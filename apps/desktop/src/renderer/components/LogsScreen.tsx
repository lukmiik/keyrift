/**
 * The Logs screen (spec §7.3, F-UI-6): the engine's log from journald, newest first. A filter picks
 * which levels are shown (errors and warnings by default); the engine's own log level decides what
 * gets written from now on, e.g. "debug" for a line per key event while chasing a problem. "Copy" puts the
 * shown entries on the clipboard as text, for a bug report.
 */
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import type { EngineApi, LogEntry, LogsApi } from "../../shared/api.ts";
import type { LogLevel, Status } from "../../shared/protocol.ts";
import { useLogs } from "../engine/useLogs.ts";
import { type Option, SelectField } from "./inspector/fields.tsx";
import { ScreenTitle } from "./ScreenTitle.tsx";
import { Button } from "./ui/button.tsx";

type LogsScreenProps = {
  logs: LogsApi;
  engine: EngineApi;
  /** The engine's status, for its current log level; null while not connected. */
  status: Status | null;
};

/** Levels from most to least severe: showing one level shows the ones before it too. */
const LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];

const SHOW_OPTIONS: Option<LogLevel>[] = [
  { value: "warn", label: "Errors and warnings" },
  { value: "info", label: "Info and above" },
  { value: "debug", label: "Everything" },
];

const LEVEL_OPTIONS: Option<LogLevel>[] = [
  { value: "error", label: "Error" },
  { value: "warn", label: "Warn" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
];

export function LogsScreen({ logs, engine, status }: LogsScreenProps) {
  const { entries, error } = useLogs(logs);
  const [show, setShow] = useState<LogLevel>("warn");
  const [levelError, setLevelError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const visible = entries.filter((entry) => shown(entry.level, show)).reverse();

  async function setLevel(level: LogLevel): Promise<void> {
    const outcome = await engine.call("log.setLevel", { level });
    // On success the engine sends a status event with the new level, which updates the dropdown.
    if (outcome.ok) {
      setLevelError(null);
    } else {
      setLevelError(outcome.error.message);
    }
  }

  async function copy(): Promise<void> {
    // Oldest first, like a log file.
    await navigator.clipboard.writeText(logText([...visible].reverse()));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="flex flex-col gap-4">
      <ScreenTitle title="Logs" />
      <div className="flex flex-wrap items-end gap-4">
        <SelectField label="Show" value={show} options={SHOW_OPTIONS} onChange={setShow} />
        {status !== null && (
          <SelectField
            label="Engine log level"
            // Straight from the engine's status, so it always matches what the engine logs, also
            // after a reload put back the saved level.
            value={status.logLevel}
            options={LEVEL_OPTIONS}
            onChange={(level) => void setLevel(level)}
          />
        )}
        <Button
          variant="outline"
          className="ml-auto"
          disabled={visible.length === 0}
          onClick={() => void copy()}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {status !== null && (
        <p className="text-sm text-muted-foreground">
          Engine log level: what the engine writes to the log from now on; Show only filters what is
          already there. Debug logs every key you press, so leave it on only while chasing a
          problem. It goes back to the saved level when the engine restarts or reloads its config.
        </p>
      )}

      {levelError !== null && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't change the log level: {levelError}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't read the log: {error}
        </p>
      )}

      {visible.length === 0 ? (
        error === null && (
          <p className="text-sm text-muted-foreground">
            {entries.length === 0 ? "No log entries yet." : "No entries at this level."}
          </p>
        )
      ) : (
        <table aria-label="Log entries" className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-4 font-normal">Time</th>
              <th className="py-2 pr-4 font-normal">Level</th>
              <th className="py-2 font-normal">Message</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => (
              <EntryRow key={entry.cursor} entry={entry} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const LEVEL_COLOURS: Record<LogLevel, string> = {
  error: "text-destructive",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-sky-600 dark:text-sky-400",
  debug: "text-muted-foreground",
};

function EntryRow({ entry }: { entry: LogEntry }) {
  return (
    <tr className="border-b align-top">
      <td className="py-1.5 pr-4 whitespace-nowrap text-muted-foreground tabular-nums">
        {logTime(entry.timeMs)}
      </td>
      <td className={`py-1.5 pr-4 font-medium ${LEVEL_COLOURS[entry.level]}`}>
        {levelLabel(entry.level)}
      </td>
      {/* systemd's lines are about the service (started, stopped), not from the engine itself. */}
      <td
        className={`py-1.5 font-mono text-xs leading-5 break-words whitespace-pre-wrap ${entry.source === "systemd" ? "text-muted-foreground" : ""}`}
      >
        {entry.source === "systemd" ? `systemd: ${entry.message}` : entry.message}
      </td>
    </tr>
  );
}

/** Whether an entry at `level` is shown when showing `show` and more severe levels. */
export function shown(level: LogLevel, show: LogLevel): boolean {
  return LEVELS.indexOf(level) <= LEVELS.indexOf(show);
}

function levelLabel(level: LogLevel): string {
  return level.toUpperCase();
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** "16 Nov 09:05:07": the log goes back days, so the date too, in local time. */
export function logTime(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ""} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Entries as plain text, one line each: "16 Nov 09:05:07 WARN message". */
export function logText(entries: LogEntry[]): string {
  return entries
    .map((entry) => {
      const message = entry.source === "systemd" ? `systemd: ${entry.message}` : entry.message;
      return `${logTime(entry.timeMs)} ${levelLabel(entry.level).padEnd(5)} ${message}`;
    })
    .join("\n");
}
