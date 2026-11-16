/**
 * Preload script: runs in the page's process before the page, with a little Node/Electron access.
 * It decides exactly what the page may use and exposes that as `window.keyrift`: the engine API
 * forwards each call to main over IPC (src/main/ipc.ts has the other end and the channel list).
 * Built to `dist-electron/preload.cjs`.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { ConnectionState, KeyriftApi } from "../shared/api.ts";
import type { EngineEvent } from "../shared/protocol.ts";

/**
 * Listens on an IPC channel and returns a function that stops listening. Electron's listener also
 * gets an `IpcRendererEvent` first; it is dropped here so the page never sees Electron objects.
 */
function listen<Args extends unknown[]>(
  channel: string,
  listener: (...args: Args) => void,
): () => void {
  // Main sends exactly the arguments the listener expects (see src/main/ipc.ts).
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as Args));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api: KeyriftApi = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
  },
  engine: {
    call: (method, params) => ipcRenderer.invoke("engine:call", method, params),
    state: () => ipcRenderer.invoke("engine:state"),
    onEvent: (listener: (event: EngineEvent) => void) => listen("engine:event", listener),
    onStateChange: (listener: (state: ConnectionState) => void) =>
      listen("engine:state-changed", listener),
  },
};

contextBridge.exposeInMainWorld("keyrift", api);
