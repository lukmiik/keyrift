/**
 * The header at the top of the window (spec §7.1): engine state, Pause toggle, profile, active
 * layers and grabbed devices. The profile selector comes with the config store (step 8).
 */
import { useState } from "react";

import type { EngineApi } from "../../shared/api.ts";
import { useEngineStatus } from "../engine/useEngineStatus.ts";
import { PauseToggle } from "./PauseToggle.tsx";
import { type PillState, StatusPill } from "./StatusPill.tsx";

type StatusHeaderProps = {
  engine: EngineApi;
};

export function StatusHeader({ engine }: StatusHeaderProps) {
  const { connection, status } = useEngineStatus(engine);
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
    // Tailwind: each class is one small piece of CSS, e.g. `flex` = display: flex,
    // `gap-3` = 0.75rem between children, `border-b` = a bottom border.
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <StatusPill state={pill} reason={reason} />
      <PauseToggle
        paused={paused}
        disabled={status === null || status.state === "error"}
        onToggle={() => void togglePause()}
      />
      {error !== null && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
      {status !== null && (
        // ml-auto pushes this group to the right end of the header.
        <div className="ml-auto flex items-center gap-4 text-sm text-muted-foreground">
          <span>Profile: {status.profile}</span>
          <span>Layers: {status.activeLayers.join(", ")}</span>
          <span>{status.devices.grabbed} input devices grabbed</span>
        </div>
      )}
    </header>
  );
}
