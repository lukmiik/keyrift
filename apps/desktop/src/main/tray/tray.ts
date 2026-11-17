/**
 * The tray icon (spec F-UI-5) and layer notifications (F-UI-8). The icon shows the engine's state,
 * its tooltip the profile and active layers; its menu opens the window, pauses or resumes the
 * engine, or quits the GUI. When a toggled layer turns on or off, a desktop notification says so
 * (Settings: "Layer notifications").
 *
 * The icon is there only with "Show in the tray" on (system/tray-setting.ts); the notifications
 * come whenever the app runs. Main follows the engine itself (status and layer topics), so both stay
 * right while the window is hidden. In GUI tests (`headless`) nothing appears on the user's screen: no tray icon,
 * no notifications; tests read the view and the notifications through `TrayState` instead.
 */
import { join } from "node:path";

import type { Profile } from "@keyrift/config-types";
import { Menu, Notification, Tray, nativeImage } from "electron";

import type { ConnectionState } from "../../shared/api.ts";
import type { Status } from "../../shared/protocol.ts";
import type { ConfigFiles } from "../config/config-files.ts";
import type { EngineConnection } from "../engine/connection.ts";
import {
  type LayerNames,
  layerChanges,
  layerNames,
  toggledLayers,
  type TrayView,
  trayView,
} from "./tray-view.ts";

const RESOURCES = join(import.meta.dirname, "../resources");

/** What the tray shows and what it notified, for GUI tests. */
export type TrayState = {
  view: TrayView;
  notifications: string[];
  /** Whether the icon is shown (in GUI tests no icon appears, but this says if it would). */
  icon: boolean;
};

export class KeyriftTray {
  readonly #connection: EngineConnection;
  readonly #files: ConfigFiles;
  readonly #open: () => void;
  readonly #quit: () => void;
  readonly #headless: boolean;
  #iconShown: boolean;
  #tray: Tray | null = null;
  #status: Status | null = null;
  #names: LayerNames = new Map();
  /** The loaded profile's `name` field, if it has one. */
  #profileName: string | null = null;
  #toggled = new Set<string>();
  /** The profile whose names and toggled layers are loaded. */
  #profile: string | null = null;
  readonly notifications: string[] = [];
  view: TrayView;

  constructor(options: {
    connection: EngineConnection;
    files: ConfigFiles;
    /** Shows the window. */
    open: () => void;
    /** Quits the GUI (the engine keeps running). */
    quit: () => void;
    headless: boolean;
    /** Whether the icon is shown at the start ("Show in the tray"). */
    icon: boolean;
  }) {
    this.#connection = options.connection;
    this.#files = options.files;
    this.#open = options.open;
    this.#quit = options.quit;
    this.#headless = options.headless;
    this.#iconShown = options.icon;
    this.view = trayView(this.#connection.state, null, this.#names);
  }

  start(): void {
    this.#createIcon();
    this.#connection.onStateChange((state) => void this.#onState(state));
    this.#connection.onEvent((event) => {
      if (event.event === "status") this.#setStatus(event.data);
      else if (event.event === "layer" && this.#status !== null) {
        this.#setStatus({ ...this.#status, activeLayers: event.data.layers });
      } else if (event.event === "config") {
        // The profile may have changed: names and toggle keys are read again.
        this.#profile = null;
        void this.#refresh();
      }
    });
    void this.#onState(this.#connection.state);
  }

  /** Shows or removes the icon, when "Show in the tray" changes. */
  showIcon(shown: boolean): void {
    this.#iconShown = shown;
    if (shown) this.#createIcon();
    else {
      this.#tray?.destroy();
      this.#tray = null;
    }
  }

  #createIcon(): void {
    if (this.#headless || !this.#iconShown || this.#tray !== null) return;
    this.#tray = new Tray(this.#image());
    // A left click opens the window (where the tray supports clicks; the menu always works).
    this.#tray.on("click", this.#open);
    this.#render();
  }

  async #onState(state: ConnectionState): Promise<void> {
    if (!state.connected) {
      this.#status = null;
      this.#render();
      return;
    }
    await this.#connection.call("subscribe", { topics: ["status", "layer", "config"] });
    await this.#refresh();
  }

  async #refresh(): Promise<void> {
    const outcome = await this.#connection.call("status.get", {});
    if (outcome.ok) this.#setStatus(outcome.result);
  }

  #setStatus(status: Status): void {
    const before = this.#status;
    this.#status = status;
    if (status.profile !== this.#profile) void this.#loadProfile(status.profile);
    // Only changes while running: the first status, or a resume, isn't a layer being toggled.
    if (before !== null && before.state === "running" && status.state === "running") {
      void this.#notify(layerChanges(before.activeLayers, status.activeLayers, this.#toggled));
    }
    this.#render();
  }

  async #loadProfile(name: string): Promise<void> {
    this.#profile = name;
    const read = await this.#files.readProfile(name);
    const profile: Profile | null = read.ok ? read.value : null;
    this.#names = profile === null ? new Map() : layerNames(profile);
    this.#profileName = profile?.name?.trim() ? profile.name : null;
    this.#toggled = profile === null ? new Set() : toggledLayers(profile);
    this.#render();
  }

  async #notify(changes: { on: string[]; off: string[] }): Promise<void> {
    const lines = [
      ...changes.on.map((id) => `${this.#names.get(id) ?? id} layer on`),
      ...changes.off.map((id) => `${this.#names.get(id) ?? id} layer off`),
    ];
    if (lines.length === 0) return;
    const settings = await this.#files.readSettings();
    if (settings.ok && settings.value?.ui?.notifyLayerToggle === false) return;
    for (const line of lines) {
      this.notifications.push(line);
      if (!this.#headless && Notification.isSupported()) {
        new Notification({ title: "Keyrift", body: line, silent: true }).show();
      }
    }
  }

  #render(): void {
    this.view = trayView(this.#connection.state, this.#status, this.#names, this.#profileName);
    if (this.#tray === null) return;
    this.#tray.setImage(this.#image());
    this.#tray.setToolTip(this.view.tooltip);
    const toggle = this.view.toggle;
    this.#tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Keyrift", click: this.#open },
        toggle === null
          ? { label: "Pause remapping", enabled: false }
          : {
              label: toggle.label,
              click: () => void this.#connection.call(toggle.method, {}),
            },
        { type: "separator" },
        { label: "Quit Keyrift", click: this.#quit },
      ]),
    );
  }

  #image() {
    return nativeImage.createFromPath(join(RESOURCES, `tray-${this.view.icon}.png`));
  }

  /** What the tray shows and notified, for GUI tests. */
  state(): TrayState {
    return { view: this.view, notifications: [...this.notifications], icon: this.#iconShown };
  }

  destroy(): void {
    this.#tray?.destroy();
  }
}
