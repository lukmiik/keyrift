/**
 * A stand-in for `window.keyrift.system` in component tests: the unit's autostart state lives in
 * memory, and every change is recorded.
 */
import type { Autostart, SystemApi, SystemOutcome } from "../../shared/api.ts";

export class FakeSystem implements SystemApi {
  isDark = true;
  readonly #darkListeners = new Set<(dark: boolean) => void>();
  autostartState: Autostart = "disabled";
  /** Every `setAutostart`, in order. */
  readonly autostartChanges: boolean[] = [];
  /** Set to make `setAutostart` fail with this message. */
  failWith: string | null = null;

  dark(): Promise<boolean> {
    return Promise.resolve(this.isDark);
  }

  onDarkChange(listener: (dark: boolean) => void): () => void {
    this.#darkListeners.add(listener);
    return () => this.#darkListeners.delete(listener);
  }

  /** Changes light/dark and tells the page, like main after a theme or desktop change. */
  setDark(dark: boolean): void {
    this.isDark = dark;
    for (const listener of this.#darkListeners) listener(dark);
  }

  autostart(): Promise<SystemOutcome<Autostart>> {
    return Promise.resolve({ ok: true, value: this.autostartState });
  }

  setAutostart(enabled: boolean): Promise<SystemOutcome<Autostart>> {
    if (this.failWith !== null) return Promise.resolve({ ok: false, message: this.failWith });
    this.autostartChanges.push(enabled);
    this.autostartState = enabled ? "enabled" : "disabled";
    return Promise.resolve({ ok: true, value: this.autostartState });
  }
}
