/**
 * A stand-in for `window.keyrift.updates` in component tests: `latest` is the newest version "on
 * GitHub"; check, download and install move through the states at once and are recorded.
 */
import type { UpdateInfo, UpdatesApi, UpdateState } from "../../shared/api.ts";

export class FakeUpdates implements UpdatesApi {
  current = "0.1.0";
  /** The newest release; the current version means up to date. */
  latest = "0.1.0";
  state: UpdateState = { status: "idle" };
  /** Set when the app installed the update. */
  installed = false;
  readonly #listeners = new Set<(info: UpdateInfo) => void>();

  info(): Promise<UpdateInfo> {
    return Promise.resolve(this.#info());
  }

  check(): Promise<void> {
    this.set(
      this.latest === this.current
        ? { status: "up-to-date" }
        : { status: "available", version: this.latest },
    );
    return Promise.resolve();
  }

  download(): Promise<void> {
    this.set({ status: "ready", version: this.latest });
    return Promise.resolve();
  }

  install(): Promise<void> {
    this.installed = true;
    return Promise.resolve();
  }

  onChange(listener: (info: UpdateInfo) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Changes the state and tells the page, like main's "updates:changed". */
  set(state: UpdateState): void {
    this.state = state;
    for (const listener of this.#listeners) listener(this.#info());
  }

  #info(): UpdateInfo {
    return { current: this.current, state: this.state };
  }
}
