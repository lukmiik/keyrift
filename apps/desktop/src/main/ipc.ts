/**
 * IPC between main and the page (step 5): main answers the page's engine calls and pushes engine
 * events and connection changes to every window. The preload (src/preload) is the other end.
 *
 * Channel names, shared with the preload:
 * - "engine:call"   page → main, invoke: (method, params) → CallOutcome
 * - "engine:state"  page → main, invoke: () → ConnectionState
 * - "engine:event"  main → page, send: (EngineEvent)
 * - "engine:state-changed" main → page, send: (state)
 */
import { BrowserWindow, ipcMain } from "electron";

import type { CallOutcome } from "../shared/api.ts";
import { isMethod, type ParamsOf } from "../shared/protocol.ts";
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
