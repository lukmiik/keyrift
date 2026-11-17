/**
 * Electron main process: the app's entry point (architecture §3). Runs in Node, owns the window and
 * the tray icon, and talks to the engine. Built to `dist-electron/main.js`.
 *
 * Closing the window hides it; the app keeps running in the tray until "Quit Keyrift" there.
 */
import { join } from "node:path";

import { app, BrowserWindow, Menu } from "electron";
// electron-updater is CommonJS: its default export holds `autoUpdater`.
import electronUpdater from "electron-updater";

import type { Theme } from "../shared/api.ts";
import { ConfigFiles, defaultConfigDir } from "./config/config-files.ts";
import { defaultSocketPath, EngineConnection } from "./engine/connection.ts";
import {
  registerConfigIpc,
  registerEngineIpc,
  registerLogsIpc,
  registerSetupIpc,
  registerSystemIpc,
  registerUpdatesIpc,
  sendToAllWindows,
} from "./ipc.ts";
import { runServiceFix, runSystemFix } from "./setup/fixes.ts";
import { fakeProbe, realProbe } from "./setup/probe.ts";
import { SetupControl } from "./setup/setup.ts";
import { AutostartControl } from "./system/autostart.ts";
import {
  appImageEnginePath,
  installEngine,
  restartEngineUsing,
  restartIfOutdated,
} from "./system/engine-binary.ts";
import { ThemeControl } from "./system/theme.ts";
import { fakeUpdater, UpdateControl } from "./system/updates.ts";
import { KeyriftTray } from "./tray/tray.ts";

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

// KEYRIFT_GSETTINGS: a stand-in in GUI tests, so the user's desktop theme doesn't affect them.
const theme = new ThemeControl(process.env.KEYRIFT_GSETTINGS ?? "gsettings", (dark) =>
  sendToAllWindows("system:dark-changed", dark),
);

/** The theme setting from settings.json; Dark when it can't be read. */
async function themeSetting(): Promise<Theme> {
  const read = await configFiles.readSettings();
  return (read.ok ? read.value?.ui?.theme : undefined) ?? "dark";
}

/**
 * The `keyrift` command the wizard runs to install the engine service; the unit it writes points at
 * this binary (system/engine-binary.ts explains each case).
 */
async function engineCli(): Promise<string> {
  // KEYRIFT_CLI: another `keyrift`, e.g. a test build.
  if (process.env.KEYRIFT_CLI !== undefined) return process.env.KEYRIFT_CLI;
  if (!app.isPackaged) return "keyrift";
  // Shipped next to app.asar (electron-builder.yml, extraResources).
  const bundled = join(process.resourcesPath, "keyrift");
  // APPIMAGE: set by the AppImage's launcher. Not set: a .deb or pacman install.
  if (process.env.APPIMAGE === undefined) return bundled;
  const target = appImageEnginePath();
  try {
    // A new AppImage version brings a new engine: copy it, and restart the service onto it.
    if (await installEngine(bundled, target)) {
      await restartEngineUsing(target, process.env.KEYRIFT_SYSTEMCTL ?? "systemctl");
    }
  } catch (error) {
    // The wizard then reports that it can't run the engine, with this path.
    console.error(`cannot copy the engine to ${target}:`, error);
  }
  return target;
}

/**
 * The setup wizard's checks and fixes. KEYRIFT_SETUP_FAKE: a JSON file describing a made-up
 * system, for GUI tests, so they neither read nor change the real one.
 */
function createSetup(autostart: AutostartControl, cli: string): SetupControl {
  const fakeFile = process.env.KEYRIFT_SETUP_FAKE;
  if (fakeFile !== undefined) {
    const fake = fakeProbe(fakeFile);
    return new SetupControl(
      fake.probe,
      async (kind) => {
        await fake.fix(kind);
        return { ok: true, value: null };
      },
      app.getPath("userData"),
    );
  }
  const probe = realProbe(autostart);
  return new SetupControl(
    probe,
    (kind) => (kind === "system" ? runSystemFix("pkexec", probe.username) : runServiceFix(cli)),
    app.getPath("userData"),
  );
}

/**
 * Updating the app (Settings → Updates). KEYRIFT_UPDATE_FAKE: a JSON file saying what is "on
 * GitHub", for GUI tests, so they neither download nor install anything.
 */
function createUpdates(): UpdateControl {
  const current = app.getVersion();
  const changed = (info: ReturnType<UpdateControl["info"]>) =>
    sendToAllWindows("updates:changed", info);
  const fakeFile = process.env.KEYRIFT_UPDATE_FAKE;
  if (fakeFile !== undefined) {
    return new UpdateControl(current, fakeUpdater(fakeFile, current), "", changed);
  }
  if (!app.isPackaged) {
    return new UpdateControl(
      current,
      null,
      "Development builds don't update themselves: pull and build again.",
      changed,
    );
  }
  const { autoUpdater } = electronUpdater;
  // Only when the user asks (Settings), never on quit behind their back.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  return new UpdateControl(current, autoUpdater, "", changed);
}

/** The main window; null before it opens. Hidden, not closed, when the user closes it. */
let mainWindow: BrowserWindow | null = null;
/** Set when the app is really quitting, so closing the window doesn't just hide it. */
let quitting = false;

const tray = new KeyriftTray({
  connection,
  files: configFiles,
  open: showWindow,
  quit: () => app.quit(),
  // GUI tests: no tray icon or notifications on the user's screen.
  headless: hideWindow,
});

// GUI tests read the tray's state through Playwright's `app.evaluate` (test/test-app.ts).
if (hideWindow) {
  (globalThis as { keyriftTray?: KeyriftTray }).keyriftTray = tray;
}

/** Shows the window (opening it if needed) and brings it to the front. */
function showWindow(): void {
  if (mainWindow === null) {
    createWindow();
    return;
  }
  if (!hideWindow) mainWindow.show();
  mainWindow.focus();
}

/** Opens the main window and loads the renderer (the web page) into it. */
function createWindow(): void {
  const window = new BrowserWindow({
    // Wide enough for a TKL keyboard (about 950 px) next to the sidebar without scrolling.
    width: 1280,
    height: 800,
    title: "Keyrift",
    // The window's icon (title bar, Alt+Tab). Rendered from resources/icon.svg.
    icon: join(import.meta.dirname, "../resources/icon.png"),
    show: !hideWindow,
    // The page's background (--background in index.css) in the current theme, shown before the
    // page has loaded so the window doesn't flash the other colour.
    backgroundColor: theme.dark ? "#0a0a0a" : "#ffffff",
    webPreferences: {
      // A hidden window would otherwise run its timers slowly, which makes tests flaky.
      backgroundThrottling: !hideWindow,
      // A hidden normal window draws no frames, so CSS animations stop and Playwright's
      // "is the element stable?" check (it compares positions across frames) waits seconds.
      // Offscreen rendering keeps drawing frames without ever showing a window.
      offscreen: hideWindow,
      // The bridge script that runs before the page (src/preload). Electron's secure defaults stay
      // on: the page has no Node access (nodeIntegration off), runs sandboxed, and sees the preload
      // only through contextBridge (contextIsolation on).
      preload: join(import.meta.dirname, "preload.cjs"),
    },
  });

  mainWindow = window;
  // Closing the window hides it to the tray; the page keeps running, so reopening is instant and
  // keeps its state (open screen, undo history).
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => {
    mainWindow = null;
  });

  // `vp dev` serves the renderer from a local dev server (with live reload) and passes its URL in
  // this variable. A built app loads the files from disk instead.
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl !== undefined) {
    // Without the menu there is no Ctrl+Shift+I, so F12 opens the developer tools in dev builds.
    window.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "F12") window.webContents.toggleDevTools();
    });
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(import.meta.dirname, "../dist/index.html"));
  }
}

// One Keyrift at a time (per data folder): starting it again shows the running one's window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
}

// No File/Edit/View menu bar: the app has its own navigation. Copy and paste in text fields still
// work, Chromium handles those keys itself on Linux.
Menu.setApplicationMenu(null);

void app.whenReady().then(async () => {
  registerEngineIpc(connection);
  registerConfigIpc(configFiles, () => void themeSetting().then((next) => theme.setTheme(next)));
  // KEYRIFT_JOURNALCTL: another program that prints journal lines, e.g. a fake one in GUI tests.
  registerLogsIpc(process.env.KEYRIFT_JOURNALCTL ?? "journalctl");
  // KEYRIFT_SYSTEMCTL: a fake systemctl in GUI tests, so they never enable or disable the real unit.
  const autostart = new AutostartControl(process.env.KEYRIFT_SYSTEMCTL ?? "systemctl");
  registerSystemIpc(autostart, theme);
  registerSetupIpc(createSetup(autostart, await engineCli()));
  const updates = createUpdates();
  registerUpdatesIpc(updates);
  // A packaged app looks for an update once, shortly after starting (not in GUI tests, whose app
  // isn't packaged); Settings then offers it, and its sidebar item shows a dot.
  if (app.isPackaged) setTimeout(() => void updates.check(), 10_000);
  // A .deb or pacman update replaced the engine's file but not the running engine: restart it
  // once the app sees an older engine answer. (The AppImage restarts it when copying, above.)
  if (app.isPackaged && process.env.APPIMAGE === undefined) {
    let checked = false;
    connection.onStateChange((state) => {
      if (!state.connected || checked) return;
      checked = true;
      void restartIfOutdated(
        join(process.resourcesPath, "keyrift"),
        state.hello.engineVersion,
        process.env.KEYRIFT_SYSTEMCTL ?? "systemctl",
      );
    });
  }
  connection.start();
  // The theme before the window opens, so it doesn't open in the wrong one.
  await theme.start(await themeSetting());
  createWindow();
  tray.start();
});

app.on("before-quit", () => {
  quitting = true;
  void connection.stop();
  theme.stop();
  tray.destroy();
});
