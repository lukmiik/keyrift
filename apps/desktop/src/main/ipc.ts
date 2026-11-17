/**
 * IPC between main and the page (step 5): main answers the page's engine calls and pushes engine
 * events and connection changes to every window. The preload (src/preload) is the other end.
 *
 * Channel names, shared with the preload:
 * - "engine:call"   page → main, invoke: (method, params) → CallOutcome
 * - "engine:state"  page → main, invoke: () → ConnectionState
 * - "engine:event"  main → page, send: (EngineEvent)
 * - "engine:state-changed" main → page, send: (state)
 * - "config:active-profile" page → main, invoke: () → ConfigOutcome<string>
 * - "config:read-profile"   page → main, invoke: (name) → ConfigOutcome<Profile | null>
 * - "config:save-profile"   page → main, invoke: (name, profile) → ConfigOutcome<null>
 * - "config:read-settings"  page → main, invoke: () → ConfigOutcome<Settings | null>
 * - "config:list-profiles"  page → main, invoke: () → ConfigOutcome<string[]>
 * - "config:set-active-profile" page → main, invoke: (name) → ConfigOutcome<null>
 * - "config:create-profile" page → main, invoke: (name, copyOf | null) → ConfigOutcome<null>
 * - "config:rename-profile" page → main, invoke: (from, to) → ConfigOutcome<null>
 * - "config:delete-profile" page → main, invoke: (name) → ConfigOutcome<null>
 * - "config:export-profile" page → main, invoke: (name) → ConfigOutcome<path | null>; asks where
 * - "config:import-profile" page → main, invoke: () → ConfigOutcome<ProfileEntry | null>; asks which
 * - "config:set-device-remapped" page → main, invoke: (device, probablyMouse, remap)
 *                                  → ConfigOutcome<null>
 * - "config:update-settings" page → main, invoke: (SettingsChanges) → ConfigOutcome<null>; also
 *                                  applies the theme
 * - "system:dark"          page → main, invoke: () → boolean
 * - "system:dark-changed"  main → every page, send: (dark)
 * - "system:autostart"     page → main, invoke: () → SystemOutcome<Autostart>
 * - "system:set-autostart" page → main, invoke: (enabled) → SystemOutcome<Autostart>
 * - "setup:checks"     page → main, invoke: () → SetupCheck[]
 * - "setup:fix"        page → main, invoke: (SetupFix) → SystemOutcome<null>
 * - "setup:first-run"  page → main, invoke: () → boolean
 * - "setup:mark-done"  page → main, invoke: () → void
 * - "logs:start"   page → main, invoke: () → void; follows the journal for that page
 * - "logs:stop"    page → main, invoke: () → void
 * - "logs:entries" main → page, send: (LogEntry[])
 * - "logs:error"   main → page, send: (message)
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { BrowserWindow, dialog, ipcMain, type WebContents } from "electron";

import type { CallOutcome } from "../shared/api.ts";
import { isMethod, type ParamsOf } from "../shared/protocol.ts";
import type { ConfigFiles } from "./config/config-files.ts";
import type { EngineConnection } from "./engine/connection.ts";
import { JournalFollower } from "./logs/journal.ts";
import type { AutostartControl } from "./system/autostart.ts";
import type { SetupControl } from "./setup/setup.ts";
import type { ThemeControl } from "./system/theme.ts";

/** Sends a message to the page in every open window. */
export function sendToAllWindows(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, ...args);
  }
}

export function registerEngineIpc(connection: EngineConnection): void {
  // The page is untrusted input as far as main is concerned: check what it sends. Params are
  // passed through; the engine validates them and answers invalid_params.
  ipcMain.handle(
    "engine:call",
    async (_event, method: unknown, params: unknown): Promise<CallOutcome<unknown>> => {
      if (typeof method !== "string" || !isMethod(method) || method === "hello") {
        return {
          ok: false,
          error: { code: "unknown_method", message: `not an engine method: ${String(method)}` },
        };
      }
      return connection.call(method, params as ParamsOf<typeof method>);
    },
  );
  ipcMain.handle("engine:state", () => connection.state);

  connection.onEvent((event) => sendToAllWindows("engine:event", event));
  connection.onStateChange((state) => sendToAllWindows("engine:state-changed", state));
}

/** `onSettingsSaved`: called after the Settings screen changed settings.json (e.g. the theme). */
export function registerConfigIpc(files: ConfigFiles, onSettingsSaved: () => void): void {
  // Everything from the page is `unknown` here; ConfigFiles checks it.
  ipcMain.handle("config:active-profile", () => files.activeProfile());
  ipcMain.handle("config:read-profile", (_event, name: unknown) => files.readProfile(name));
  ipcMain.handle("config:save-profile", (_event, name: unknown, profile: unknown) =>
    files.saveProfile(name, profile),
  );
  ipcMain.handle("config:read-settings", () => files.readSettings());
  ipcMain.handle("config:list-profiles", () => files.listProfiles());
  ipcMain.handle("config:set-active-profile", (_event, name: unknown) =>
    files.setActiveProfile(name),
  );
  ipcMain.handle(
    "config:create-profile",
    (_event, name: unknown, displayName: unknown, copyOf: unknown) =>
      files.createProfile(name, displayName, copyOf),
  );
  ipcMain.handle(
    "config:rename-profile",
    (_event, from: unknown, to: unknown, displayName: unknown) =>
      files.renameProfile(from, to, displayName),
  );
  ipcMain.handle("config:delete-profile", (_event, name: unknown) => files.deleteProfile(name));
  // The dialogs belong to the window that asked, so they open over it.
  ipcMain.handle("config:export-profile", async (event, name: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Export profile",
      defaultPath: join(homedir(), `${typeof name === "string" ? name : "profile"}.json`),
      filters: [{ name: "Keyrift profile", extensions: ["json"] }],
    };
    const chosen = await (window === null
      ? dialog.showSaveDialog(options)
      : dialog.showSaveDialog(window, options));
    if (chosen.canceled || chosen.filePath === undefined) return { ok: true, value: null };
    const written = await files.exportProfile(name, chosen.filePath);
    return written.ok ? { ok: true, value: chosen.filePath } : written;
  });
  ipcMain.handle("config:import-profile", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Import profile",
      defaultPath: homedir(),
      filters: [{ name: "Keyrift profile", extensions: ["json"] }],
      properties: ["openFile" as const],
    };
    const chosen = await (window === null
      ? dialog.showOpenDialog(options)
      : dialog.showOpenDialog(window, options));
    const path = chosen.filePaths[0];
    if (chosen.canceled || path === undefined) return { ok: true, value: null };
    return files.importProfile(path);
  });
  ipcMain.handle(
    "config:set-device-remapped",
    (_event, device: unknown, probablyMouse: unknown, remap: unknown) =>
      files.setDeviceRemapped(device, probablyMouse, remap),
  );
  ipcMain.handle("config:update-settings", async (_event, changes: unknown) => {
    const outcome = await files.updateSettings(changes);
    if (outcome.ok) onSettingsSaved();
    return outcome;
  });
}

/** Autostart of the engine's unit and the light/dark theme (Settings screen). */
export function registerSystemIpc(autostart: AutostartControl, theme: ThemeControl): void {
  ipcMain.handle("system:dark", () => theme.dark);
  ipcMain.handle("system:autostart", () => autostart.state());
  ipcMain.handle("system:set-autostart", (_event, enabled: unknown) => autostart.set(enabled));
}

/**
 * Follows the journal for each page that asks: one journalctl per page, stopped when the page asks,
 * starts again, or goes away. `journalctl` is the command to run (a fake one in tests).
 */
export function registerLogsIpc(journalctl: string): void {
  const followers = new Map<WebContents, JournalFollower>();
  const stop = (page: WebContents) => {
    followers.get(page)?.stop();
    followers.delete(page);
  };
  ipcMain.handle("logs:start", (event) => {
    const page = event.sender;
    if (!followers.has(page)) page.once("destroyed", () => stop(page));
    stop(page);
    followers.set(
      page,
      new JournalFollower(journalctl, {
        entries: (entries) => {
          if (!page.isDestroyed()) page.send("logs:entries", entries);
        },
        error: (message) => {
          if (!page.isDestroyed()) page.send("logs:error", message);
        },
      }),
    );
  });
  ipcMain.handle("logs:stop", (event) => stop(event.sender));
}

/** The setup wizard's checks and fixes. */
export function registerSetupIpc(setup: SetupControl): void {
  ipcMain.handle("setup:checks", () => setup.checks());
  ipcMain.handle("setup:fix", (_event, kind: unknown) => setup.fix(kind));
  ipcMain.handle("setup:first-run", () => setup.firstRun());
  ipcMain.handle("setup:mark-done", () => setup.markDone());
}
