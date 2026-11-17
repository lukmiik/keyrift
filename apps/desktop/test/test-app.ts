/**
 * Starts the real Keyrift app for GUI tests (spec §11.1), driven by Playwright.
 *
 * The app is the production build (`vp build`, run once by test/global-setup.ts), pointed at a private engine through
 * KEYRIFT_SOCKET and at that engine's config folder through KEYRIFT_CONFIG_DIR, with its Electron
 * data in a temp folder and its window hidden. Together with TestEngine this never touches the
 * user's engine, config or screen.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";

import type { FakeSystemState } from "../src/main/setup/probe.ts";
import type { TrayState } from "../src/main/tray/tray.ts";

const APP_DIR = join(import.meta.dirname, "..");

export class TestApp {
  /** The app's window, as a Playwright page: find elements, click, read text. */
  readonly window: Page;
  #app: ElectronApplication;
  #dataDir: string;

  private constructor(app: ElectronApplication, window: Page, dataDir: string) {
    this.#app = app;
    this.window = window;
    this.#dataDir = dataDir;
  }

  /**
   * Starts the app, talking to the engine at `socketPath` and editing the config
   * in `configDir`. Both are required: without them the app would use the user's real ones.
   */
  static async start(options: {
    socketPath: string;
    configDir: string;
    /** More environment variables for the app, e.g. KEYRIFT_JOURNALCTL. */
    env?: Record<string, string>;
    /**
     * The made-up system the setup wizard checks (fields left out: all checks pass). Never the
     * real one: the wizard's fixes would change it.
     */
    system?: Partial<FakeSystemState>;
    /** Start as on the first run, with the setup wizard. Default: it was finished before. */
    firstRun?: boolean;
  }): Promise<TestApp> {
    const dataDir = mkdtempSync(join(tmpdir(), "keyrift-app-"));
    const systemFile = join(dataDir, "fake-system.json");
    writeFileSync(systemFile, JSON.stringify(options.system ?? {}));
    if (options.firstRun !== true) writeFileSync(join(dataDir, "setup-done"), "");
    const app = await electron.launch({
      // "." = the app folder: Electron reads package.json "main" (dist-electron/main.js).
      // --no-sandbox: see vite.config.ts (Ubuntu blocks Chromium's sandbox).
      args: [APP_DIR, "--no-sandbox"],
      env: {
        ...process.env,
        KEYRIFT_SOCKET: options.socketPath,
        KEYRIFT_CONFIG_DIR: options.configDir,
        KEYRIFT_USER_DATA_DIR: dataDir,
        KEYRIFT_HIDE_WINDOW: "1",
        // Never the user's journal: a fake journalctl that prints nothing, unless a test sets one.
        KEYRIFT_JOURNALCTL: join(APP_DIR, "test/fake-journalctl.mjs"),
        // Nor the user's keyrift.service: autostart goes to a fake systemctl with its own state.
        KEYRIFT_SYSTEMCTL: join(APP_DIR, "test/fake-systemctl.mjs"),
        FAKE_SYSTEMCTL_STATE: join(dataDir, "systemctl-state"),
        // Nor the user's desktop theme: a fake gsettings, light unless FAKE_COLOR_SCHEME says dark.
        KEYRIFT_GSETTINGS: join(APP_DIR, "test/fake-gsettings.mjs"),
        KEYRIFT_SETUP_FAKE: systemFile,
        ...options.env,
      },
    });
    const window = await app.firstWindow();
    return new TestApp(app, window, dataDir);
  }

  /**
   * What the tray shows (icon, tooltip, Pause/Resume) and the layer notifications so far. In tests
   * the tray has no icon on screen, so it is read from the main process (main.ts sets
   * `globalThis.keyriftTray` for tests).
   */
  trayState(): Promise<TrayState> {
    return this.#app.evaluate(() =>
      (globalThis as unknown as { keyriftTray: { state(): TrayState } }).keyriftTray.state(),
    );
  }

  /** The made-up system after the wizard's fixes: `fixes` lists what was run. */
  fakeSystem(): Partial<FakeSystemState> {
    return JSON.parse(
      readFileSync(join(this.#dataDir, "fake-system.json"), "utf8"),
    ) as Partial<FakeSystemState>;
  }

  /** Closes the app and deletes its data folder. */
  async close(): Promise<void> {
    await this.#app.close();
    rmSync(this.#dataDir, { recursive: true, force: true });
  }
}
