/**
 * The contract between the preload script and the page: what `window.keyrift` offers.
 * Shared by both halves, so it must not import anything Node- or browser-specific.
 */
import type { DeviceMatch, Profile, SchemaIssue, Settings } from "@keyrift/config-types";

import type {
  EngineEvent,
  HelloResult,
  LogLevel,
  Method,
  ParamsOf,
  ResultOf,
  RpcError,
} from "./protocol.ts";

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

/**
 * A profile in the list: `file` is its file name without `.json` (what the engine and the other
 * calls use), `name` what the user called it (the file's `name` field, or `file` without one).
 */
export type ProfileEntry = { file: string; name: string };

/** The config folder, as the page sees it (main reads and writes the files, step 8c). */
export type ConfigApi = {
  /** The active profile's name, from `settings.json` ("default" if there is no settings file). */
  activeProfile(): Promise<ConfigOutcome<string>>;
  /** Reads and validates `profiles/<name>.json`. `null` if the file doesn't exist yet. */
  readProfile(name: string): Promise<ConfigOutcome<Profile | null>>;
  /** Validates `profile` and writes it to `profiles/<name>.json` (atomically). */
  saveProfile(name: string, profile: Profile): Promise<ConfigOutcome<null>>;
  /** The profiles in `profiles/`, sorted by display name. */
  listProfiles(): Promise<ConfigOutcome<ProfileEntry[]>>;
  /** Makes an existing profile the active one (`settings.json`); the engine switches to it. */
  setActiveProfile(name: string): Promise<ConfigOutcome<null>>;
  /**
   * Creates profile `name` (the file name) with `displayName` as its `name` field: a copy of
   * `copyOf`, or with `null` an empty one. Fails if it exists.
   */
  createProfile(
    name: string,
    displayName: string,
    copyOf: string | null,
  ): Promise<ConfigOutcome<null>>;
  /**
   * Renames profile `from` to `to` and sets its `name` field to `displayName`; it stays active if
   * it was. With `to` equal to `from` only the `name` field changes. Fails if `to` exists.
   */
  renameProfile(from: string, to: string, displayName: string): Promise<ConfigOutcome<null>>;
  /** Deletes a profile that isn't the active one. */
  deleteProfile(name: string): Promise<ConfigOutcome<null>>;
  /**
   * Asks where to save profile `name` (a save dialog) and writes it there. Resolves to the path,
   * or `null` if the user cancelled.
   */
  exportProfile(name: string): Promise<ConfigOutcome<string | null>>;
  /**
   * Asks for a profile file (an open dialog) and adds it as a new profile, renamed if its name is
   * taken. Resolves to the new profile, or `null` if the user cancelled.
   */
  importProfile(): Promise<ConfigOutcome<ProfileEntry | null>>;
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
  /**
   * Changes settings from the Settings screen in `settings.json`, keeping the rest of the file.
   * Each group given is merged into the file's (e.g. `{ ui: { theme: "light" } }` keeps the other
   * `ui` fields). The engine reloads the file and applies the change.
   */
  updateSettings(changes: SettingsChanges): Promise<ConfigOutcome<null>>;
};

/** The parts of `settings.json` the Settings screen changes, each group in part. */
export type SettingsChanges = {
  tapHold?: Partial<NonNullable<Settings["tapHold"]>>;
  emergencyRelease?: Partial<NonNullable<Settings["emergencyRelease"]>>;
  logLevel?: Settings["logLevel"];
  ui?: Partial<NonNullable<Settings["ui"]>>;
};

/** Whether the engine's user unit starts with the desktop session (`systemctl --user is-enabled`). */
export type Autostart = "enabled" | "disabled" | "not-installed";

/** What a system command gave, or why it failed (e.g. systemctl's error message). */
export type SystemOutcome<T> = { ok: true; value: T } | { ok: false; message: string };

/** `settings.ui.theme`: "system" follows the desktop's light/dark preference. */
export type Theme = NonNullable<NonNullable<Settings["ui"]>["theme"]>;

/** The system around the app: the engine's systemd unit, the window's light/dark theme and the tray. */
export type SystemApi = {
  /** Whether the window should be dark: the theme setting, or for "system" the desktop's. */
  dark(): Promise<boolean>;
  /** Calls `listener` when that changes. Returns a function that stops it. */
  onDarkChange(listener: (dark: boolean) => void): () => void;
  autostart(): Promise<SystemOutcome<Autostart>>;
  /**
   * Enables or disables the unit (`systemctl --user enable/disable`) and answers with the new
   * state; a running engine keeps running.
   */
  setAutostart(enabled: boolean): Promise<SystemOutcome<Autostart>>;
  /**
   * "Show in the tray": whether closing the window keeps Keyrift running in the tray, and it starts
   * there at login (a login entry in ~/.config/autostart).
   */
  tray(): Promise<SystemOutcome<boolean>>;
  /** Turns it on or off; answers with the new value. */
  setTray(enabled: boolean): Promise<SystemOutcome<boolean>>;
};

/** One entry of the engine's log, from journald (spec §7.3 Logs). */
export type LogEntry = {
  /** The journal's id for the entry: unique, for React's `key`. */
  cursor: string;
  /** When it was logged, ms since 1970. */
  timeMs: number;
  level: LogLevel;
  message: string;
  /** "systemd" for systemd's own lines about the unit (started, stopped, crashed). */
  source: "engine" | "systemd";
};

/** The engine's log, as the page sees it (main runs journalctl). */
export type LogsApi = {
  /**
   * Starts following the log: the recent entries, then new ones as they come, to `onEntries`.
   * Starting again restarts from the recent entries.
   */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Calls `listener` with each batch of entries, oldest first. Returns a function that stops it. */
  onEntries(listener: (entries: LogEntry[]) => void): () => void;
  /** Calls `listener` when the log can't be read (e.g. journalctl is missing). */
  onError(listener: (message: string) => void): () => void;
};

/** One check of the setup wizard (spec §9.3). */
export type SetupCheck = {
  id: "groups" | "devices" | "uinput-boot" | "remappers" | "service";
  title: string;
  /** "fail": Keyrift can't work like this; "warn": it works, but something needs attention. */
  status: "ok" | "warn" | "fail";
  /** What was found, in a sentence or two. */
  detail: string;
  /** What the wizard can fix: "system" with one password prompt, "service" without. */
  fix: SetupFix | null;
  /** Commands for the user to run themselves (e.g. stopping another remapper). */
  commands: readonly string[];
};

export type SetupFix = "system" | "service";

/** The setup wizard's checks and fixes (main runs them). */
export type SetupApi = {
  checks(): Promise<SetupCheck[]>;
  /** Runs a fix: "system" asks for the password once (pkexec); "service" installs the user unit. */
  fix(kind: SetupFix): Promise<SystemOutcome<null>>;
  /** True until the wizard was finished or skipped once. */
  firstRun(): Promise<boolean>;
  /** Remembers that the wizard was finished or skipped. */
  markDone(): Promise<void>;
};

/** Where updating the app stands (Settings → Updates). */
export type UpdateState =
  /** This build can't update itself, e.g. a development build. */
  | { status: "unavailable"; reason: string }
  /** Not checked yet. */
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number }
  /** Downloaded: installing restarts the app. */
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

/** The running app's version and where updating stands. */
export type UpdateInfo = { current: string; state: UpdateState };

/** Updating the app from GitHub Releases (main runs electron-updater). */
export type UpdatesApi = {
  info(): Promise<UpdateInfo>;
  /** Looks for a newer release. */
  check(): Promise<void>;
  /** Downloads the newer release that `check` found. */
  download(): Promise<void>;
  /** Installs the download (one password prompt for .deb and pacman) and restarts Keyrift. */
  install(): Promise<void>;
  /** Calls `listener` when the state changes. Returns a function that stops it. */
  onChange(listener: (info: UpdateInfo) => void): () => void;
};

export type KeyriftApi = {
  /** Versions of the parts Electron is made of, shown on the placeholder page. */
  versions: { electron: string; chrome: string; node: string; v8: string };
  engine: EngineApi;
  config: ConfigApi;
  logs: LogsApi;
  system: SystemApi;
  setup: SetupApi;
  updates: UpdatesApi;
};
