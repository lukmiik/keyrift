/**
 * Starts the real Keyrift app for GUI tests (spec §11.1), driven by Playwright.
 *
 * The app is the production build (`vp build`), pointed at a private engine through
 * KEYRIFT_SOCKET, with its Electron data in a temp folder and its window hidden. Together with
 * TestEngine this never touches the user's engine, config or screen.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";

const APP_DIR = join(import.meta.dirname, "..");

let built = false;

/** Builds the app once per test run, so tests always run the current source. */
function buildApp(): void {
  if (!built) {
    execFileSync("vp", ["build"], { cwd: APP_DIR, stdio: ["ignore", "ignore", "inherit"] });
    built = true;
  }
}

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

  /** Builds (once) and starts the app, talking to the engine at `socketPath`. */
  static async start(options: { socketPath: string }): Promise<TestApp> {
    buildApp();
    const dataDir = mkdtempSync(join(tmpdir(), "keyrift-app-"));
    const app = await electron.launch({
      // "." = the app folder: Electron reads package.json "main" (dist-electron/main.js).
      // --no-sandbox: see vite.config.ts (Ubuntu blocks Chromium's sandbox).
      args: [APP_DIR, "--no-sandbox"],
      env: {
        ...process.env,
        KEYRIFT_SOCKET: options.socketPath,
        KEYRIFT_USER_DATA_DIR: dataDir,
        KEYRIFT_HIDE_WINDOW: "1",
      },
    });
    const window = await app.firstWindow();
    return new TestApp(app, window, dataDir);
  }

  /** Closes the app and deletes its data folder. */
  async close(): Promise<void> {
    await this.#app.close();
    rmSync(this.#dataDir, { recursive: true, force: true });
  }
}
