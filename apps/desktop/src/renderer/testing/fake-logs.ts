/**
 * A stand-in for `window.keyrift.logs` in component tests: entries and errors are sent by the test
 * instead of journalctl.
 */
import type { LogEntry, LogsApi } from "../../shared/api.ts";

export class FakeLogs implements LogsApi {
  /** True between `start` and `stop`. */
  following = false;
  readonly #entryListeners = new Set<(entries: LogEntry[]) => void>();
  readonly #errorListeners = new Set<(message: string) => void>();

  start(): Promise<void> {
    this.following = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.following = false;
    return Promise.resolve();
  }

  onEntries(listener: (entries: LogEntry[]) => void): () => void {
    this.#entryListeners.add(listener);
    return () => this.#entryListeners.delete(listener);
  }

  onError(listener: (message: string) => void): () => void {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }

  /** Sends entries as main would; fields left out get defaults. */
  send(...entries: Partial<LogEntry>[]): void {
    const full = entries.map((entry, i) => ({
      cursor: `c${String(this.#sent + i)}`,
      timeMs: 0,
      level: "info" as const,
      message: "",
      source: "engine" as const,
      ...entry,
    }));
    this.#sent += entries.length;
    for (const listener of this.#entryListeners) listener(full);
  }

  sendError(message: string): void {
    for (const listener of this.#errorListeners) listener(message);
  }

  #sent = 0;
}
