/**
 * Updating the app from GitHub Releases (Settings → Updates). electron-updater does the work: it
 * reads `latest-linux.yml` from the newest release, downloads the package this install came from
 * (it knows from `resources/package-type`: deb, pacman, or none for the AppImage) and installs it:
 * `dpkg -i` / `pacman -U` behind one password prompt (pkexec), or for the AppImage by replacing the
 * file. Then the app restarts; the new app restarts an older engine (engine-binary.ts).
 *
 * `UpdateControl` turns the updater's events into one `UpdateState` the page shows. Tests use a fake
 * updater (`fakeUpdater`), so they never reach GitHub or install anything.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { UpdateInfo, UpdateState } from "../../shared/api.ts";

/** The part of electron-updater's `autoUpdater` used here. */
export type Updater = {
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  /** Installs the downloaded update and restarts the app (`isForceRunAfter`). */
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
  on(event: "update-available", listener: (info: { version: string }) => void): unknown;
  on(event: "update-not-available", listener: () => void): unknown;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  on(event: "update-downloaded", listener: (info: { version: string }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
};

export class UpdateControl {
  readonly #updater: Updater | null;
  readonly #current: string;
  readonly #onChange: (info: UpdateInfo) => void;
  #state: UpdateState;

  /**
   * `updater` null: this build can't update itself (`unavailable` says why), e.g. a development
   * build, which has no release to update from.
   */
  constructor(
    current: string,
    updater: Updater | null,
    unavailable: string,
    onChange: (info: UpdateInfo) => void,
  ) {
    this.#current = current;
    this.#updater = updater;
    this.#onChange = onChange;
    this.#state =
      updater === null ? { status: "unavailable", reason: unavailable } : { status: "idle" };
    updater?.on("update-available", (info) =>
      this.#set({ status: "available", version: info.version }),
    );
    updater?.on("update-not-available", () => this.#set({ status: "up-to-date" }));
    updater?.on("download-progress", (progress) => {
      if (this.#state.status === "downloading") {
        this.#set({ ...this.#state, percent: Math.floor(progress.percent) });
      }
    });
    updater?.on("update-downloaded", (info) =>
      this.#set({ status: "ready", version: info.version }),
    );
    // Installing runs only from "ready"; any other error is about checking or downloading.
    updater?.on("error", (error) =>
      this.#set({ status: "error", message: describe(error, this.#state.status === "ready") }),
    );
  }

  info(): UpdateInfo {
    return { current: this.#current, state: this.#state };
  }

  /** Asks GitHub for the newest release. Ignored while a download runs or one is ready. */
  async check(): Promise<void> {
    if (
      this.#updater === null ||
      ["checking", "downloading", "ready"].includes(this.#state.status)
    ) {
      return;
    }
    this.#set({ status: "checking" });
    // A failure also arrives as an "error" event; catching here keeps it from being unhandled.
    await this.#updater.checkForUpdates().catch(() => undefined);
  }

  /** Downloads the update that `check` found. */
  async download(): Promise<void> {
    if (this.#updater === null || this.#state.status !== "available") return;
    this.#set({ status: "downloading", version: this.#state.version, percent: 0 });
    await this.#updater.downloadUpdate().catch(() => undefined);
  }

  /** Installs the downloaded update and restarts Keyrift. */
  install(): void {
    if (this.#updater === null || this.#state.status !== "ready") return;
    this.#updater.quitAndInstall(false, true);
  }

  #set(state: UpdateState): void {
    this.#state = state;
    this.#onChange(this.info());
  }
}

/**
 * A short message for the page; electron-updater's errors can carry whole HTTP responses, whose text
 * mentions things like "authentication token" even when nothing was installed.
 */
function describe(error: Error, installing: boolean): string {
  const firstLine = error.message.split("\n")[0] ?? "";
  if (installing) {
    // The real reason (e.g. pkexec's "Not authorized") is the only clue to an install that
    // fails without a password prompt, so it is shown, not just logged.
    const reason = firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
    return `Installing failed or the password prompt was closed; nothing was changed. (${reason})`;
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|net::/i.test(error.message)) {
    return "Couldn't reach GitHub. Check the internet connection.";
  }
  // GitHub answers 404 for a missing or private repository's releases.
  if (/HttpError: 404|status(Code)?:? 404/i.test(error.message)) {
    return "Couldn't find Keyrift's releases on GitHub.";
  }
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}

/** What a fake updater does, from a JSON file (KEYRIFT_UPDATE_FAKE in GUI tests). */
export type FakeUpdaterState = {
  /** The newest version "on GitHub"; the current one means up to date. */
  latest: string;
  /** Makes `check` fail with this message. */
  fail?: string;
  /** Set by the fake when the app installed the update: the version installed. */
  installed?: string;
};

/**
 * An updater that reads what is "on GitHub" from the JSON file at `path` and records an install
 * there instead of installing (the app doesn't quit either: the test closes it).
 */
export function fakeUpdater(path: string, current: string): Updater {
  const listeners = new Map<string, ((...args: never[]) => void)[]>();
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  };
  const read = () => JSON.parse(readFileSync(path, "utf8")) as FakeUpdaterState;
  // Events come a moment later, like the real updater's, so the page sees "checking" first.
  const later = (fn: () => void) =>
    new Promise<void>((resolve) => setTimeout(() => (fn(), resolve()), 50));
  return {
    checkForUpdates: () =>
      later(() => {
        const state = read();
        if (state.fail !== undefined) emit("error", new Error(state.fail));
        else if (state.latest === current) emit("update-not-available");
        else emit("update-available", { version: state.latest });
      }),
    downloadUpdate: async () => {
      for (const percent of [30, 70, 100])
        await later(() => emit("download-progress", { percent }));
      await later(() => emit("update-downloaded", { version: read().latest }));
    },
    quitAndInstall: () => {
      writeFileSync(path, JSON.stringify({ ...read(), installed: read().latest }));
    },
    on: (event: string, listener: (...args: never[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return undefined;
    },
  } as Updater;
}

/** The logger electron-updater accepts (`autoUpdater.logger`). */
export type UpdaterLogger = {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
  debug(message: string): void;
};

/**
 * A logger that appends to `path`, so a failed update leaves the updater's own steps and errors
 * (e.g. the exact `pkexec` command and its output) behind. Writing never throws: a log that can't
 * be written must not break updating.
 */
export function fileLogger(path: string): UpdaterLogger {
  const write = (level: string, message: unknown) => {
    const text = message instanceof Error ? (message.stack ?? message.message) : String(message);
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${new Date().toISOString()} ${level} ${text}\n`);
    } catch {
      // Nowhere better to report it.
    }
  };
  return {
    info: (m) => write("INFO", m),
    warn: (m) => write("WARN", m),
    error: (m) => write("ERROR", m),
    debug: (m) => write("DEBUG", m),
  };
}
