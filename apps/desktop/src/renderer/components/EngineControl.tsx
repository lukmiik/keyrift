/**
 * The engine's live state at the right end of the top bar (spec §7.1): the active layer, how many
 * keyboards it remaps, its state (Active / Paused / not connected) and a switch that pauses and
 * resumes remapping. While paused, keys pass through unchanged.
 */
import type { LayerConfig } from "@keyrift/config-types";
import { useState } from "react";

import type { EngineApi } from "../../shared/api.ts";
import type { EngineStatus } from "../engine/useEngineStatus.ts";
import { type PillState, StatusPill } from "./StatusPill.tsx";
import { Switch } from "./ui/switch.tsx";

type EngineControlProps = EngineStatus & {
  engine: EngineApi;
  /** The open profile's layers, for their names; without them the layer ids are shown. */
  layers?: LayerConfig[] | undefined;
};

export function EngineControl({ engine, connection, status, layers = [] }: EngineControlProps) {
  // Last failed pause/resume, shown until the next try.
  const [error, setError] = useState<string | null>(null);

  let pill: PillState;
  if (connection === null || (connection.connected && status === null)) {
    pill = "connecting";
  } else if (!connection.connected || status === null) {
    pill = "offline";
  } else {
    pill = status.state;
  }
  const reason = connection !== null && !connection.connected ? connection.reason : undefined;
  const paused = pill === "paused" || pill === "released";

  async function togglePause(): Promise<void> {
    setError(null);
    // No need to store the answer: the engine also sends a status event, which updates the hook.
    const outcome = await engine.call(paused ? "engine.resume" : "engine.pause", {});
    if (!outcome.ok) {
      setError(outcome.error.message);
    }
  }

  return (
    <section aria-label="Engine" className="ml-auto flex min-w-0 items-center gap-3 text-sm">
      {error !== null && (
        <span role="alert" className="truncate text-destructive">
          {error}
        </span>
      )}
      {/* What is remapped right now; only while remapping, since paused keys aren't. */}
      {pill === "running" && status !== null && (
        <span className="flex min-w-0 gap-1.5 text-muted-foreground">
          <LayerLabel active={status.activeLayers} layers={layers} />
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">{keyboardsLabel(status.devices.keyboards)}</span>
        </span>
      )}
      <StatusPill state={pill} reason={reason} />
      <Switch
        aria-label="Remapping"
        title={paused ? "Resume remapping" : "Pause remapping"}
        checked={pill === "running"}
        disabled={status === null || status.state === "error"}
        onCheckedChange={() => void togglePause()}
      />
    </section>
  );
}

/** "1 keyboard", "2 keyboards": keyboards the engine holds and remaps. */
function keyboardsLabel(count: number): string {
  return `${count} ${count === 1 ? "keyboard" : "keyboards"}`;
}

/**
 * The layer on top of the stack, by name: what most keys do right now. The base layer is always at
 * the bottom, so the whole stack ("Base → Nav") is only in the tooltip.
 */
function LayerLabel({ active, layers }: { active: string[]; layers: LayerConfig[] }) {
  const name = (id: string) => layers.find((layer) => layer.id === id)?.name ?? id;
  const names = active.map(name);
  return (
    <span className="truncate" title={`Active layers: ${names.join(" → ")}`}>
      {names.at(-1) ?? "No"} layer
    </span>
  );
}
