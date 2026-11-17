/**
 * The engine state as a coloured dot and a short label, e.g. "● Active" or "● Not connected (the
 * engine stopped)" (spec §7.1).
 */
import { cn } from "cn";

import { type EngineState, stateLabel } from "../../shared/protocol.ts";
import { StatusDot, type StatusTone } from "./StatusDot.tsx";

/** What the pill can show: an engine state, or that there is no engine to ask. */
export type PillState = EngineState | "connecting" | "offline";

type StatusPillProps = {
  state: PillState;
  /** Why there is no engine, e.g. "the engine is not running"; shown only when offline. */
  reason?: string;
};

/** Text for each pill state. */
function pillLabel(state: PillState, reason: string | undefined): string {
  switch (state) {
    case "connecting":
      return "Connecting…";
    case "offline":
      return reason ? `Not connected (${reason})` : "Not connected";
    // "Active", like a device that is remapped on the Devices screen.
    case "running":
      return "Active";
    default:
      return stateLabel(state);
  }
}

/** Dot colour for each state: green while remapping, amber while waiting, red on a problem. */
export function pillTone(state: PillState): StatusTone {
  switch (state) {
    case "running":
      return "good";
    case "paused":
    case "connecting":
      return "waiting";
    case "released":
    case "error":
    case "offline":
      return "problem";
  }
}

export function StatusPill({ state, reason }: StatusPillProps) {
  // role="status": screen readers announce changes; tests and Playwright find it by this role.
  return (
    <StatusDot
      role="status"
      data-state={state}
      tone={pillTone(state)}
      // Brighter than the details next to it, red on a problem.
      className={cn("font-medium", pillTone(state) !== "problem" && "text-foreground")}
      label={pillLabel(state, reason)}
    />
  );
}
