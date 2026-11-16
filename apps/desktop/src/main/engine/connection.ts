/**
 * The GUI's lasting link to the engine (main process). Wraps `EngineClient` with what an app that
 * runs for hours needs: it connects in the background, reconnects when the engine restarts, and
 * turns call failures into `CallOutcome`s that can cross to the page.
 *
 * No Electron imports here, so it is tested against a real private engine (connection.test.ts).
 */
import { join } from "node:path";

import type { CallOutcome, ConnectionState } from "../../shared/api.ts";
import type { Method, ParamsOf, ResultOf } from "../../shared/protocol.ts";
import { EngineClient, EngineError, type EventListener } from "./client.ts";

/** Where the engine listens by default; same rule as the engine (`crates/engine/src/paths.rs`). */
export function defaultSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir !== undefined && runtimeDir !== "") {
    return join(runtimeDir, "keyrift.sock");
  }
  return `/tmp/keyrift-${process.env.USER ?? "user"}.sock`;
}

/** Turns a connect error into a short reason for the UI. */
function describeConnectError(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT" || code === "ECONNREFUSED") {
    return "the engine is not running";
  }
  return String(error);
}

export class EngineConnection {
  readonly socketPath: string;
  #retryMs: number;
  #client: EngineClient | null = null;
  #state: ConnectionState = { connected: false, reason: "connecting" };
  #eventListeners = new Set<EventListener>();
  #stateListeners = new Set<(state: ConnectionState) => void>();
  #retryTimer: NodeJS.Timeout | undefined;
  #stopped = false;

  /** `retryMs`: how long to wait before trying again after a failed or lost connection. */
  constructor(socketPath: string, options: { retryMs?: number } = {}) {
    this.socketPath = socketPath;
    this.#retryMs = options.retryMs ?? 1000;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  /** Starts connecting in the background. Watch `onStateChange` to know when it's there. */
  start(): void {
    void this.#connect();
  }

  /** Calls an engine method. Never throws: failures become `{ ok: false, error }`. */
  async call<M extends Method>(method: M, params: ParamsOf<M>): Promise<CallOutcome<ResultOf<M>>> {
    if (this.#client === null) {
      return { ok: false, error: { code: "not_connected", message: this.#reason() } };
    }
    try {
      return { ok: true, result: await this.#client.call(method, params) };
    } catch (error) {
      if (error instanceof EngineError) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      return { ok: false, error: { code: "connection_lost", message: String(error) } };
    }
  }

  /** Calls `listener` for every engine event. Returns a function that stops it. */
  onEvent(listener: EventListener): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  /** Calls `listener` whenever the connection comes or goes. Returns a function that stops it. */
  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  /** Disconnects and stops reconnecting (app quit, end of a test). */
  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#retryTimer);
    await this.#client?.close();
  }

  async #connect(): Promise<void> {
    if (this.#stopped) {
      return;
    }
    let connected;
    try {
      connected = await EngineClient.connect(this.socketPath);
    } catch (error) {
      this.#setState({ connected: false, reason: describeConnectError(error) });
      this.#retryLater();
      return;
    }
    const { client, hello } = connected;
    if (this.#stopped) {
      await client.close();
      return;
    }
    this.#client = client;
    client.onEvent((event) => {
      for (const listener of this.#eventListeners) {
        listener(event);
      }
    });
    // When this connection ends, report it and start over. Not awaited: it waits for as long as
    // the connection lives, in the background.
    void client.closed.then(() => {
      this.#client = null;
      if (!this.#stopped) {
        this.#setState({ connected: false, reason: "the engine stopped" });
        this.#retryLater();
      }
    });
    this.#setState({ connected: true, hello });
  }

  #retryLater(): void {
    if (!this.#stopped) {
      this.#retryTimer = setTimeout(() => void this.#connect(), this.#retryMs);
    }
  }

  #setState(state: ConnectionState): void {
    // Retries while the engine stays down would repeat the same state every second: tell
    // listeners only about changes.
    if (JSON.stringify(state) === JSON.stringify(this.#state)) {
      return;
    }
    this.#state = state;
    for (const listener of this.#stateListeners) {
      listener(state);
    }
  }

  #reason(): string {
    return this.#state.connected ? "" : this.#state.reason;
  }
}
