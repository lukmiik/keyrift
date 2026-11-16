/**
 * A stand-in for `window.keyrift.engine` in component tests: no Electron, no engine process.
 * Tests set the connection and status, and see which methods the page called.
 */
import type { CallOutcome, ConnectionState, EngineApi, PageMethod } from "../../shared/api.ts";
import type { DeviceGroup, EngineEvent, ParamsOf, Status, Topic } from "../../shared/protocol.ts";

/** A plausible status; pass fields to change. */
export function fakeStatus(fields: Partial<Status> = {}): Status {
  return {
    state: "running",
    engineVersion: "0.1.0",
    pid: 1234,
    profile: "daily",
    activeLayers: ["base"],
    configIssues: [],
    configPending: false,
    logLevel: "info",
    devices: { grabbed: 3, blocked: [] },
    outputDevice: "/dev/input/event30",
    recording: false,
    latency: { samples: 0 },
    ...fields,
  };
}

const CONNECTED: ConnectionState = {
  connected: true,
  hello: { engineVersion: "0.1.0", protocolVersion: "1.0", state: "running" },
};

export class FakeEngine implements EngineApi {
  /** Every method the page called, in order. */
  readonly calls: PageMethod[] = [];
  /** Every topic the page subscribed to (the engine adds topics, it never replaces them). */
  subscribedTopics: Topic[] = [];
  /** Set to make the next engine.pause/engine.resume fail with this message. */
  failNextToggle: string | null = null;
  #connection: ConnectionState;
  #status: Status;
  #devices: DeviceGroup[];
  #eventListeners = new Set<(event: EngineEvent) => void>();
  #stateListeners = new Set<(state: ConnectionState) => void>();

  constructor(options: { connected?: boolean; status?: Status; devices?: DeviceGroup[] } = {}) {
    this.#connection =
      options.connected === false
        ? { connected: false, reason: "the engine is not running" }
        : CONNECTED;
    this.#status = options.status ?? fakeStatus();
    this.#devices = options.devices ?? [];
  }

  // Answers like the real engine for the methods the header uses. The cast is needed because
  // TypeScript can't tie each `if` branch to the generic result type.
  call<M extends PageMethod>(method: M, params: ParamsOf<M>): Promise<CallOutcome<never>> {
    this.calls.push(method);
    if (!this.#connection.connected) {
      return answer({ ok: false, error: { code: "not_connected", message: "not connected" } });
    }
    if (method === "engine.pause" || method === "engine.resume") {
      if (this.failNextToggle !== null) {
        const message = this.failNextToggle;
        this.failNextToggle = null;
        return answer({ ok: false, error: { code: "internal", message } });
      }
      // Like the engine: change state, tell subscribers, answer with the new status.
      this.setStatus({ state: method === "engine.pause" ? "paused" : "running" });
    }
    if (method === "subscribe") {
      const topics = (params as ParamsOf<"subscribe">).topics;
      this.subscribedTopics = [...new Set([...this.subscribedTopics, ...topics])];
      return answer({ ok: true, result: { topics: this.subscribedTopics } });
    }
    if (method === "devices.list") {
      return answer({ ok: true, result: { devices: this.#devices } });
    }
    return answer({ ok: true, result: this.#status });
  }

  state(): Promise<ConnectionState> {
    return Promise.resolve(this.#connection);
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  /** Changes the status and sends a status event, like the engine after a change. */
  setStatus(fields: Partial<Status>): void {
    this.#status = { ...this.#status, ...fields };
    this.#emit({ event: "status", data: this.#status });
  }

  /** Changes the active layers and sends only a layer event, like the engine on a layer key. */
  setLayers(layers: string[]): void {
    this.#status = { ...this.#status, activeLayers: layers };
    this.#emit({ event: "layer", data: { layers } });
  }

  /** Changes the number of grabbed devices and sends a devices event, like plugging one in. */
  setGrabbed(grabbed: number): void {
    this.#status = { ...this.#status, devices: { ...this.#status.devices, grabbed } };
    this.#emit({ event: "devices", data: { devices: this.#devices } });
  }

  /** Changes the device list and sends a devices event, like plugging one in or excluding it. */
  setDevices(devices: DeviceGroup[]): void {
    this.#devices = devices;
    this.#emit({ event: "devices", data: { devices } });
  }

  #emit(event: EngineEvent): void {
    for (const listener of this.#eventListeners) listener(event);
  }

  /** Simulates the engine stopping (main reports the lost connection). */
  disconnect(reason = "the engine stopped"): void {
    this.#connection = { connected: false, reason };
    for (const listener of this.#stateListeners) listener(this.#connection);
  }

  /** Number of listeners still registered: 0 after the page cleaned up. */
  get listenerCount(): number {
    return this.#eventListeners.size + this.#stateListeners.size;
  }
}

function answer(outcome: CallOutcome<unknown>): Promise<CallOutcome<never>> {
  return Promise.resolve(outcome as CallOutcome<never>);
}
