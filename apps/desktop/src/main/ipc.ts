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
 * - "config:set-device-remapped" page → main, invoke: (device, probablyMouse, remap)
 *                                  → ConfigOutcome<null>
 */
import { BrowserWindow, ipcMain } from "electron";

import type { CallOutcome } from "../shared/api.ts";
import { isMethod, type ParamsOf } from "../shared/protocol.ts";
import type { ConfigFiles } from "./config/config-files.ts";
import type { EngineConnection } from "./engine/connection.ts";

/** Sends a message to the page in every open window. */
function sendToAllWindows(channel: string, ...args: unknown[]): void {
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

export function registerConfigIpc(files: ConfigFiles): void {
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
  ipcMain.handle(
    "config:set-device-remapped",
    (_event, device: unknown, probablyMouse: unknown, remap: unknown) =>
      files.setDeviceRemapped(device, probablyMouse, remap),
  );
}
