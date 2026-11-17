/**
 * The engine's log, read from journald (spec §7.3 Logs, F-UI-6). The engine logs to stdout and
 * systemd stores each line in the journal with its priority; `journalctl --output json --follow`
 * prints the stored entries as JSON lines and then waits for new ones.
 */
import { type ChildProcess, spawn } from "node:child_process";

import type { LogEntry } from "../../shared/api.ts";
import type { LogLevel } from "../../shared/protocol.ts";
import { LineSplitter } from "../engine/line-splitter.ts";

/** Entries read from the journal when following starts; older ones are left out. */
export const HISTORY_LINES = 500;

/** journalctl's arguments: the user unit's entries as JSON, the last HISTORY_LINES, then new ones. */
export const JOURNALCTL_ARGS = [
  "--user",
  "--unit",
  "keyrift.service",
  "--output",
  "json",
  "--no-pager",
  "--lines",
  String(HISTORY_LINES),
  "--follow",
];

/** Syslog priority (0 emergency … 7 debug) → the engine's level names. */
function levelOf(priority: number): LogLevel {
  if (priority <= 3) return "error";
  if (priority === 4) return "warn";
  if (priority <= 6) return "info";
  return "debug";
}

/** A journal field as text. journalctl prints non-UTF-8 values as arrays of bytes. */
function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((byte) => typeof byte === "number")) {
    return Buffer.from(value).toString("utf8");
  }
  return null;
}

/**
 * One line of `journalctl --output json` as a log entry; null for lines that aren't one. The
 * engine's lines start with their level ("  INFO config applied"), which the priority already
 * says, so it is cut off.
 */
export function parseJournalLine(line: string): LogEntry | null {
  let fields: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    fields = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const message = text(fields.MESSAGE);
  const cursor = text(fields.__CURSOR);
  const time = Number(text(fields.__REALTIME_TIMESTAMP));
  if (message === null || cursor === null || !Number.isFinite(time)) return null;
  const priority = Number(text(fields.PRIORITY) ?? "6");
  // systemd's own lines about the unit ("Started keyrift.service") vs. the engine's.
  const source = text(fields.SYSLOG_IDENTIFIER) === "systemd" ? "systemd" : "engine";
  return {
    cursor,
    // The journal counts µs since 1970; JavaScript dates use ms.
    timeMs: Math.floor(time / 1000),
    level: levelOf(Number.isFinite(priority) ? priority : 6),
    message:
      source === "engine" ? message.replace(/^\s*(ERROR|WARN|INFO|DEBUG|TRACE)\s+/, "") : message,
    source,
  };
}

export type JournalListener = {
  /** New entries, oldest first. */
  entries: (entries: LogEntry[]) => void;
  /** journalctl couldn't start or stopped with an error. */
  error: (message: string) => void;
};

/**
 * Runs `journalctl` (or `command`, e.g. a fake in tests) and passes its entries on until `stop`.
 * Each chunk of output becomes one batch, so the history arrives in a few large batches.
 */
export class JournalFollower {
  readonly #process: ChildProcess;
  #stopped = false;

  constructor(command: string, listener: JournalListener) {
    this.#process = spawn(command, JOURNALCTL_ARGS, { stdio: ["ignore", "pipe", "pipe"] });
    const lines = new LineSplitter();
    let stderr = "";
    this.#process.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      const entries = lines
        .push(chunk)
        .map(parseJournalLine)
        .filter((entry) => entry !== null);
      if (entries.length > 0) listener.entries(entries);
    });
    this.#process.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    // E.g. ENOENT: journalctl isn't installed.
    this.#process.on("error", (error) => {
      if (!this.#stopped) listener.error(`cannot run ${command}: ${error.message}`);
    });
    this.#process.on("exit", (code) => {
      if (this.#stopped || code === 0) return;
      listener.error(stderr.trim() || `${command} exited with code ${String(code)}`);
    });
  }

  stop(): void {
    this.#stopped = true;
    this.#process.kill();
  }
}
