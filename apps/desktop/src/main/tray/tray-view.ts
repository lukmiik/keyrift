/**
 * What the tray shows (spec F-UI-5, F-UI-8), worked out from the engine's state without Electron,
 * so it can be tested on its own: the icon, the tooltip and the Pause/Resume item. Also which layer
 * changes are worth a notification. main/tray/tray.ts puts it on screen.
 */
import type { Profile } from "@keyrift/config-types";

import type { ConnectionState } from "../../shared/api.ts";
import type { PageMethod } from "../../shared/api.ts";
import type { Status } from "../../shared/protocol.ts";

/** Which tray icon (resources/tray-<icon>.png). Grey "paused" also stands for "no engine". */
export type TrayIcon = "running" | "paused" | "released" | "error";

export type TrayView = {
  icon: TrayIcon;
  tooltip: string;
  /** The Pause/Resume menu item, or null when there is nothing to pause or resume. */
  toggle: { label: string; method: Extract<PageMethod, "engine.pause" | "engine.resume"> } | null;
};

/** Layer names by id, from the active profile; ids without a name are shown as they are. */
export type LayerNames = ReadonlyMap<string, string>;

export function trayView(
  connection: ConnectionState,
  status: Status | null,
  names: LayerNames,
): TrayView {
  if (!connection.connected || status === null) {
    return { icon: "paused", tooltip: "Keyrift: engine not running", toggle: null };
  }
  const pause = { label: "Pause remapping", method: "engine.pause" } as const;
  const resume = { label: "Resume remapping", method: "engine.resume" } as const;
  switch (status.state) {
    case "running": {
      const layers = status.activeLayers.map((id) => names.get(id) ?? id).join(" → ");
      return {
        icon: "running",
        tooltip: `Keyrift: Active · ${status.profile} · ${layers}`,
        toggle: pause,
      };
    }
    case "paused":
      return { icon: "paused", tooltip: "Keyrift: Paused", toggle: resume };
    case "released":
      return {
        icon: "released",
        tooltip: "Keyrift: Released by the emergency keys",
        toggle: resume,
      };
    case "error":
      return { icon: "error", tooltip: "Keyrift: Error (see the app)", toggle: null };
  }
}

/** Every `{ type: "layer" }` action in `value` (a profile or part of one), however deep. */
function layerActions(value: unknown, found: { layer: string; mode: string }[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) layerActions(item, found);
  } else if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (record.type === "layer" && typeof record.layer === "string") {
      found.push({ layer: record.layer, mode: String(record.mode) });
    }
    for (const child of Object.values(record)) layerActions(child, found);
  }
  return found;
}

/**
 * Layers that only toggle keys switch (no hold key): a notification for them tells the user a
 * layer stays on. Layers that are also held would notify on every hold, so they are left out.
 */
export function toggledLayers(profile: Profile): Set<string> {
  const actions = layerActions(profile);
  const held = new Set(actions.filter((a) => a.mode !== "toggle").map((a) => a.layer));
  return new Set(
    actions.filter((a) => a.mode === "toggle" && !held.has(a.layer)).map((a) => a.layer),
  );
}

/** Which of `watched` turned on and off between two lists of active layers. */
export function layerChanges(
  before: readonly string[],
  after: readonly string[],
  watched: ReadonlySet<string>,
): { on: string[]; off: string[] } {
  return {
    on: after.filter((id) => watched.has(id) && !before.includes(id)),
    off: before.filter((id) => watched.has(id) && !after.includes(id)),
  };
}

/** A profile's layer names by id. */
export function layerNames(profile: Profile): Map<string, string> {
  return new Map((profile.layers ?? []).map((layer) => [layer.id, layer.name ?? layer.id]));
}
