/**
 * "Show in the tray" (Settings): when on, closing the window keeps Keyrift running in the tray, and
 * it starts there at login (hidden), so the tray icon and the layer notifications are always
 * around. When off, closing the window quits the app; the engine keeps remapping either way.
 *
 * The setting is the login entry itself: an XDG autostart file, `~/.config/autostart/keyrift.desktop`,
 * which desktops and session managers run at login. Being a file on this computer, it needs no field
 * in settings.json (which is shared through dotfiles, and which older engines reject when it has
 * fields they don't know).
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { SystemOutcome } from "../../shared/api.ts";
import { writeFileAtomic } from "../config/config-files.ts";

/** Passed by the login entry: start without showing the window, only the tray icon. */
export const HIDDEN_FLAG = "--hidden";

/** Where desktops look for login entries (XDG Autostart). */
export function defaultAutostartDir(): string {
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(config, "autostart");
}

/**
 * One argument of an `Exec=` line. The desktop entry spec wants arguments with spaces or special
 * characters in double quotes, with `"`, `` ` ``, `$` and `\` escaped inside them.
 */
function quote(arg: string): string {
  if (!/[\s"'\\`$<>~|&;*?#()]/.test(arg)) return arg;
  return `"${arg.replace(/[\\"`$]/g, (c) => `\\${c}`)}"`;
}

/** The login entry that starts `command` (the app and its arguments). */
export function desktopEntry(command: string[]): string {
  // On top of the quoting, a desktop file escapes every `\` once more, and `%` (a field code) as `%%`.
  const exec = command.map(quote).join(" ").replace(/\\/g, "\\\\").replace(/%/g, "%%");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Keyrift",
    "Comment=Keyrift's tray icon and layer notifications",
    `Exec=${exec}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export class TraySetting {
  readonly #file: string;
  readonly #entry: string;
  readonly #onChange: (enabled: boolean) => void;
  #enabled: boolean;

  /**
   * `command` starts this app hidden (ending with HIDDEN_FLAG). `onChange` is called after the
   * user changes the setting.
   */
  constructor(dir: string, command: string[], onChange: (enabled: boolean) => void) {
    this.#file = join(dir, "keyrift.desktop");
    this.#entry = desktopEntry(command);
    this.#onChange = onChange;
    this.#enabled = existsSync(this.#file);
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  state(): Promise<SystemOutcome<boolean>> {
    return Promise.resolve({ ok: true, value: this.#enabled });
  }

  /** `enabled` comes from the page, so it is checked. */
  async set(enabled: unknown): Promise<SystemOutcome<boolean>> {
    if (typeof enabled !== "boolean") return { ok: false, message: "not a valid tray value" };
    try {
      if (enabled) await this.#write();
      else await rm(this.#file, { force: true });
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
    this.#enabled = enabled;
    this.#onChange(enabled);
    return { ok: true, value: enabled };
  }

  /**
   * Points an existing entry at this app again when it moved, e.g. an AppImage that an update
   * saved under a new file name.
   */
  async refresh(): Promise<void> {
    if (!this.#enabled) return;
    try {
      if (readFileSync(this.#file, "utf8") !== this.#entry) await this.#write();
    } catch (error) {
      console.error(`cannot update ${this.#file}:`, error);
    }
  }

  async #write(): Promise<void> {
    await mkdir(join(this.#file, ".."), { recursive: true });
    await writeFileAtomic(this.#file, this.#entry);
  }
}
