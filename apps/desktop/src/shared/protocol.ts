/**
 * The engine's socket protocol (spec §8): newline-delimited JSON over a Unix socket.
 * These types describe the messages; they mirror what the engine sends.
 */

/** Version of the engine's socket protocol this app speaks (spec §8.1). Sent in `hello`. */
export const PROTOCOL_VERSION = "1.0";

/**
 * Whether an engine speaking `version` ("major.minor") can talk to us.
 * Same rule as the engine: only the major version has to match.
 */
export function isCompatible(version: string): boolean {
  const major = version.split(".")[0];
  const ourMajor = PROTOCOL_VERSION.split(".")[0];
  return major !== "" && major === ourMajor;
}

// ---------------------------------------------------------------------------------------------
// Messages on the wire (spec §8.1)
// ---------------------------------------------------------------------------------------------

/** What the app sends, e.g. `{"id": 1, "method": "status.get"}`. */
export type Request = {
  id: number;
  method: string;
  /** Optional: most methods take no parameters. */
  params?: object;
};

/** Why the engine rejected a request, e.g. `{"code": "hello_required", "message": "…"}`. */
export type RpcError = {
  code: string;
  message: string;
};

/**
 * Anything the engine sends, after parsing. A tagged union: `kind` says which shape it is.
 * - "result": the reply to request `id` succeeded
 * - "error": the reply to request `id` failed
 * - "event": a pushed event on a subscribed topic, not a reply to anything
 */
export type ServerMessage =
  | { kind: "result"; id: number; result: unknown }
  | { kind: "error"; id: number; error: RpcError }
  | { kind: "event"; event: EngineEvent };

/** Whether `value` is a plain JSON object (not null, not an array), so its fields can be read. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` has the shape of an `RpcError`. */
function isRpcError(value: unknown): value is RpcError {
  return isObject(value) && typeof value.code === "string" && typeof value.message === "string";
}

/**
 * Turns one line from the engine into a `ServerMessage`.
 * Throws if the line is not valid JSON or not a message the protocol allows: data from outside
 * the app is checked before the rest of the code trusts its types.
 */
export function parseServerMessage(line: string): ServerMessage {
  const value: unknown = JSON.parse(line);
  if (!isObject(value)) {
    throw new Error(`engine message is not a JSON object: ${line}`);
  }
  if (typeof value.event === "string") {
    // Like call results, event data is trusted to match the protocol (spec §8.2): the cast is
    // made once here, so the rest of the app gets typed events.
    return { kind: "event", event: { event: value.event, data: value.data } as EngineEvent };
  }
  if (typeof value.id !== "number") {
    throw new Error(`engine message has neither an id nor an event: ${line}`);
  }
  if (value.error !== undefined) {
    if (!isRpcError(value.error)) {
      throw new Error(`engine error has no code or message: ${line}`);
    }
    return { kind: "error", id: value.id, error: value.error };
  }
  return { kind: "result", id: value.id, result: value.result };
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

/** The engine's state (spec §5.9). */
export type EngineState = "running" | "paused" | "released" | "error";

/** Reply to `hello`. */
export type HelloResult = {
  engineVersion: string;
  protocolVersion: string;
  state: EngineState;
};

/** Event topics a client can subscribe to (spec §8.2). */
export type Topic = "status" | "layer" | "devices" | "config" | "tester";

/** Reply to `subscribe` and `unsubscribe`: every topic the client is subscribed to now. */
export type SubscribeResult = {
  topics: Topic[];
};

/** A problem the engine found in a config file. */
export type ConfigIssue = {
  severity: "error" | "warning";
  /** File the issue is in, relative to the config directory. */
  file: string;
  /** Where in the file, e.g. `layers[1].keys.KEY_H`. */
  path: string;
  message: string;
};

/** Reply to `status.get`, `engine.pause` and `engine.resume`; also the data of `status` events. */
export type Status = {
  state: EngineState;
  engineVersion: string;
  pid: number;
  profile: string;
  activeLayers: string[];
  configIssues: ConfigIssue[];
  /** A config change is waiting until all keys are released. */
  configPending: boolean;
  logLevel: LogLevel;
  devices: {
    /** Grabbed device nodes; one keyboard can have several (e.g. one for media keys). */
    grabbed: number;
    /** Physical keyboards with at least one grabbed node. */
    keyboards: number;
    blocked: { path: string; reason: string }[];
  };
  /** Path of the engine's virtual keyboard; null if it could not be created. */
  outputDevice: string | null;
  recording: boolean;
  /** Added latency in microseconds; the percentiles are missing until a key was pressed. */
  latency: { samples: number; p50Us?: number; p99Us?: number; maxUs?: number };
};

/** Text shown for each engine state, e.g. in the status pill. */
export function stateLabel(state: EngineState): string {
  switch (state) {
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "released":
      return "Released (emergency)";
    case "error":
      return "Error";
  }
}

/** Data of a `tester` event: one key press or release and what the engine did with it. */
export type TesterEventData = {
  timeUs: number;
  device: string;
  key: string;
  pressed: boolean;
  /** What the key resolved to, as the engine describes it (e.g. "LeftCtrl+KEY_C"); null on a release. */
  action: string | null;
  /** Output keys, e.g. `["+KEY_ESC"]` (`+` press, `-` release). */
  outputs: string[];
  layers: string[];
};

/**
 * An event the engine pushes on a subscribed topic (spec §8.2). A discriminated union: checking
 * `event` tells TypeScript which `data` comes with it, so listeners need no casts.
 */
export type EngineEvent =
  | { event: "status"; data: Status }
  | { event: "layer"; data: { layers: string[] } }
  | { event: "devices"; data: { devices: DeviceGroup[] } }
  | { event: "config"; data: ValidationResult }
  | { event: "tester"; data: TesterEventData }
  /** A key pressed while this client records (`record.start`); sent to the recording client only. */
  | { event: "record"; data: { key: string; device: string } };

/** Log levels the engine knows, least to most verbose. */
export type LogLevel = "error" | "warn" | "info" | "debug";

/** One input device node, e.g. `/dev/input/event8`. */
export type DeviceMember = {
  path: string;
  name: string;
  isPointer: boolean;
  hasLetters: boolean;
  grabbed: boolean;
  /** Why the engine could not grab it (another program holds it); null if not blocked. */
  blocked: string | null;
};

/** One physical device: its nodes grouped by USB port (spec §4.1). */
export type DeviceGroup = {
  /** Stable id of the group, e.g. `usb-0000:00:14.0-3.3`. */
  key: string;
  name: string;
  vendorId: string;
  productId: string;
  kind: "keyboard" | "probablyMouse" | "other";
  /** What the engine does with it; "filtered" only happens in tests (`--only-device`). */
  decision: "grab" | "excluded" | "hidden" | "notKeyboard" | "filtered";
  members: DeviceMember[];
};

/** Reply to `config.reload` and `config.validate`: `ok` is false if any issue is an error. */
export type ValidationResult = {
  ok: boolean;
  issues: ConfigIssue[];
};

/** Params of a method that takes none: an empty object. */
type NoParams = Record<string, never>;

/**
 * Every method the engine has (spec §8.2), with the params it takes and the result it returns.
 * A type-level lookup table: `Methods["status.get"]["result"]` is `Status`.
 */
export type Methods = {
  hello: { params: { protocolVersion: string }; result: HelloResult };
  "status.get": { params: NoParams; result: Status };
  "devices.list": { params: NoParams; result: { devices: DeviceGroup[] } };
  "engine.pause": { params: NoParams; result: Status };
  "engine.resume": { params: NoParams; result: Status };
  "config.reload": { params: NoParams; result: ValidationResult };
  "config.validate": {
    params: { text: string; kind: "settings" | "profile"; file?: string };
    result: ValidationResult;
  };
  "log.setLevel": { params: { level: LogLevel }; result: { level: LogLevel } };
  "record.start": { params: NoParams; result: NoParams };
  /** `keys`: evdev names of the keys pressed since `record.start`, e.g. `["KEY_A"]`. */
  "record.stop": { params: NoParams; result: { keys: string[] } };
  subscribe: { params: { topics: Topic[] }; result: SubscribeResult };
  unsubscribe: { params: { topics: Topic[] }; result: SubscribeResult };
};

/** Name of any engine method: `"hello" | "status.get" | …`. */
export type Method = keyof Methods;

/**
 * Every method name, at runtime: types vanish, but main has to check names the page sends.
 * `Record<Method, true>` makes TS insist on listing all of them, so this can't fall behind `Methods`.
 */
const METHOD_NAMES: Record<Method, true> = {
  hello: true,
  "status.get": true,
  "devices.list": true,
  "engine.pause": true,
  "engine.resume": true,
  "config.reload": true,
  "config.validate": true,
  "log.setLevel": true,
  "record.start": true,
  "record.stop": true,
  subscribe: true,
  unsubscribe: true,
};

/** Whether `name` is an engine method (type guard). */
export function isMethod(name: string): name is Method {
  return Object.hasOwn(METHOD_NAMES, name);
}

/** The params type of method `M`. */
export type ParamsOf<M extends Method> = Methods[M]["params"];

/** The result type of method `M`. */
export type ResultOf<M extends Method> = Methods[M]["result"];

/** Turns a request into the line sent to the engine. `params` must match the method. */
export function encodeRequest<M extends Method>(
  id: number,
  method: M,
  params: ParamsOf<M>,
): string {
  const request: Request = { id, method, params };
  return JSON.stringify(request) + "\n";
}
