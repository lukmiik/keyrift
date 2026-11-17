/**
 * Light or dark (spec §7.3 Settings): from `settings.ui.theme`, where "system" follows the desktop.
 * Main works it out and tells the page, which switches its colours (useTheme.ts).
 *
 * The desktop's preference has two sources, either one saying "dark" counts:
 * - Chromium's own (`nativeTheme`): the desktop portal's Settings interface, or a GTK theme whose
 *   name says dark (e.g. Adwaita-dark).
 * - GNOME's `color-scheme` setting (`gsettings`), read directly: on i3 and other window managers
 *   the portal often has no Settings interface, so Chromium never sees `prefer-dark`.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";

import { nativeTheme } from "electron";

import type { Theme } from "../../shared/api.ts";
import { LineSplitter } from "../engine/line-splitter.ts";

const SCHEMA = ["org.gnome.desktop.interface", "color-scheme"];

/** Whether gsettings' `color-scheme` output (e.g. `'prefer-dark'`) asks for dark. */
export function gsettingsSaysDark(output: string): boolean {
  return output.includes("prefer-dark");
}

export class ThemeControl {
  readonly #gsettings: string;
  readonly #onChange: (dark: boolean) => void;
  #theme: Theme = "dark";
  #gnomeDark = false;
  #monitor: ChildProcess | null = null;
  #dark: boolean | null = null;

  /**
   * `gsettings`: the command to run (a stand-in in tests). `onChange` gets the new answer whenever
   * it changes.
   */
  constructor(gsettings: string, onChange: (dark: boolean) => void) {
    this.#gsettings = gsettings;
    this.#onChange = onChange;
  }

  /** Reads the desktop's preference once and starts watching it. */
  async start(theme: Theme): Promise<void> {
    this.#theme = theme;
    nativeTheme.themeSource = theme;
    nativeTheme.on("updated", () => this.#update());
    this.#gnomeDark = await new Promise((resolve) => {
      execFile(this.#gsettings, ["get", ...SCHEMA], (error, stdout) =>
        resolve(error === null && gsettingsSaysDark(stdout)),
      );
    });
    // `gsettings monitor` prints a line on every change, e.g. "color-scheme: 'prefer-dark'".
    const monitor = spawn(this.#gsettings, ["monitor", ...SCHEMA], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    // A missing gsettings (not GNOME-based) only means one source fewer.
    monitor.on("error", () => {});
    const lines = new LineSplitter();
    monitor.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      for (const line of lines.push(chunk)) this.#gnomeDark = gsettingsSaysDark(line);
      this.#update();
    });
    this.#monitor = monitor;
    this.#update();
  }

  /** The theme setting changed (Settings screen). */
  setTheme(theme: Theme): void {
    this.#theme = theme;
    // Chromium's own parts of the window (title bar, native dialogs) follow this.
    nativeTheme.themeSource = theme;
    this.#update();
  }

  /** Whether the window is dark right now. */
  get dark(): boolean {
    return this.#dark ?? this.#theme !== "light";
  }

  stop(): void {
    this.#monitor?.kill();
  }

  #update(): void {
    // With themeSource "system", shouldUseDarkColors is Chromium's view of the desktop.
    const desktopDark = nativeTheme.shouldUseDarkColors || this.#gnomeDark;
    const dark = this.#theme === "dark" || (this.#theme === "system" && desktopDark);
    if (dark === this.#dark) return;
    this.#dark = dark;
    this.#onChange(dark);
  }
}
