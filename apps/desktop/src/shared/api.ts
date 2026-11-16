/**
 * The contract between the preload script and the page: what `window.keyrift` offers.
 * Shared by both halves, so it must not import anything Node- or browser-specific.
 */
import type { DeviceMatch, Profile, SchemaIssue, Settings } from "@keyrift/config-types";

import type { EngineEvent, HelloResult, Method, ParamsOf, ResultOf, RpcError } from "./protocol.ts";

/**
 * How a call ended. Errors are returned as data, not thrown: a thrown error loses everything but
 * its message on the way from main to the page, and the page needs `error.code`.
 */
export type CallOutcome<R> = { ok: true; result: R } | { ok: false; error: RpcError };

/** Whether the GUI is connected to the engine right now. */
export type ConnectionState =
  | { connected: true; hello: HelloResult }
  | { connected: false; reason: string };

/** Methods the page may call: every engine method except `hello`, which main does itself. */
export type PageMethod = Exclude<Method, "hello">;

/** The engine, as the page sees it (main holds the real connection, step 5). */
export type EngineApi = {
  /** Calls an engine method. Resolves with the outcome; never rejects. */
  call<M extends PageMethod>(method: M, params: ParamsOf<M>): Promise<CallOutcome<ResultOf<M>>>;
  /** The connection state right now. */
  state(): Promise<ConnectionState>;
  /** Calls `listener` for each engine event (after `subscribe`). Returns a function that stops it. */
  onEvent(listener: (event: EngineEvent) => void): () => void;
  /**
   * Calls `listener` when the connection comes or goes. After a reconnect the engine has forgotten
   * the page's subscriptions, so the page subscribes again here.
   */
  onStateChange(listener: (state: ConnectionState) => void): () => void;
};

/** Why a config file couldn't be read or saved. */
export type ConfigProblem = {
  /** Which file, relative to the config folder, e.g. `profiles/daily.json`. */
  file: string;
  message: string;
  /** Schema problems, one per place in the file; empty for other errors. */
  issues: SchemaIssue[];
};

/** Like `CallOutcome`: a problem is returned as data, never thrown. */
export type ConfigOutcome<T> = { ok: true; value: T } | { ok: false; problem: ConfigProblem };

/** The config folder, as the page sees it (main reads and writes the files, step 8c). */
export type ConfigApi = {
  /** The active profile's name, from `settings.json` ("default" if there is no settings file). */
  activeProfile(): Promise<ConfigOutcome<string>>;
  /** Reads and validates `profiles/<name>.json`. `null` if the file doesn't exist yet. */
  readProfile(name: string): Promise<ConfigOutcome<Profile | null>>;
  /** Validates `profile` and writes it to `profiles/<name>.json` (atomically). */
  saveProfile(name: string, profile: Profile): Promise<ConfigOutcome<null>>;
  /** Names of the profiles in `profiles/` (file names without `.json`), sorted. */
  listProfiles(): Promise<ConfigOutcome<string[]>>;
  /** Makes an existing profile the active one (`settings.json`); the engine switches to it. */
  setActiveProfile(name: string): Promise<ConfigOutcome<null>>;
  /** Creates a profile: a copy of `copyOf`, or with `null` an empty one. Fails if it exists. */
  createProfile(name: string, copyOf: string | null): Promise<ConfigOutcome<null>>;
  /** Renames a profile; it stays active if it was. Fails if `to` exists. */
  renameProfile(from: string, to: string): Promise<ConfigOutcome<null>>;
  /** Deletes a profile that isn't the active one. */
  deleteProfile(name: string): Promise<ConfigOutcome<null>>;
  /** Reads and validates `settings.json`. `null` if the file doesn't exist. */
  readSettings(): Promise<ConfigOutcome<Settings | null>>;
  /**
   * Turns remapping of one device on or off in `settings.json`: a keyboard goes into or out of
   * `devices.excluded`, a probable mouse into or out of `devices.included`.
   */
  setDeviceRemapped(
    device: DeviceMatch,
    probablyMouse: boolean,
    remap: boolean,
  ): Promise<ConfigOutcome<null>>;
};

export type KeyriftApi = {
  /** Versions of the parts Electron is made of, shown on the placeholder page. */
  versions: { electron: string; chrome: string; node: string; v8: string };
  engine: EngineApi;
  config: ConfigApi;
};
