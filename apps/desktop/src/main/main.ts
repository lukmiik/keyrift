/**
 * Electron main process: the app's entry point (architecture §3). Runs in Node, owns the windows,
 * and later talks to the engine (step 5). Built to `dist-electron/main.js`.
 */
import { join } from "node:path";

import { app, BrowserWindow, nativeTheme } from "electron";

import { ConfigFiles, defaultConfigDir } from "./config/config-files.ts";
import { defaultSocketPath, EngineConnection } from "./engine/connection.ts";
import { registerConfigIpc, registerEngineIpc } from "./ipc.ts";

// KEYRIFT_SOCKET points the GUI at another engine, e.g. a private test engine.
const connection = new EngineConnection(process.env.KEYRIFT_SOCKET ?? defaultSocketPath());
// KEYRIFT_CONFIG_DIR: another config folder, e.g. a test engine's (like the engine's --config-dir).
const configFiles = new ConfigFiles(process.env.KEYRIFT_CONFIG_DIR ?? defaultConfigDir());

// For automated GUI tests (test/test-app.ts): keep Electron's own data (cache, local storage) in
// a temporary folder instead of ~/.config, and don't show the window on the user's screen.
if (process.env.KEYRIFT_USER_DATA_DIR !== undefined) {
  app.setPath("userData", process.env.KEYRIFT_USER_DATA_DIR);
}
const hideWindow = process.env.KEYRIFT_HIDE_WINDOW === "1";

// The app is always dark (the page sets class="dark" in index.html). This makes Chromium's own
// parts match: scrollbars, form controls, and `prefers-color-scheme` in the page.
nativeTheme.themeSource = "dark";

/** Opens the main window and loads the renderer (the web page) into it. */
function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 720,
    title: "Keyrift",
    show: !hideWindow,
    // The page's dark background (--background in index.css), shown before the page has loaded
    // so the window doesn't flash white.
    backgroundColor: "#0a0a0a",
    webPreferences: {
      // A hidden window would otherwise run its timers slowly, which makes tests flaky.
      backgroundThrottling: !hideWindow,
      // The bridge script that runs before the page (src/preload). Electron's secure defaults stay
      // on: the page has no Node access (nodeIntegration off), runs sandboxed, and sees the preload
      // only through contextBridge (contextIsolation on).
      preload: join(import.meta.dirname, "preload.cjs"),
    },
  });

  // `vp dev` serves the renderer from a local dev server (with live reload) and passes its URL in
  // this variable. A built app loads the files from disk instead.
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(import.meta.dirname, "../dist/index.html"));
  }
}

void app.whenReady().then(() => {
  registerEngineIpc(connection);
  registerConfigIpc(configFiles);
  connection.start();
  createWindow();
});

app.on("before-quit", () => void connection.stop());

// Linux convention: closing the last window quits the app.
app.on("window-all-closed", () => app.quit());
