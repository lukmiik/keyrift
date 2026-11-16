/**
 * The engine state as a short label, e.g. "Running" or "Not connected (the engine stopped)"
 * (spec §7.1).
 */
import { Badge } from "@/components/ui/badge.tsx";

import { type EngineState, stateLabel } from "../../shared/protocol.ts";

/** What the pill can show: an engine state, or that there is no engine to ask. */
export type PillState = EngineState | "connecting" | "offline";
/** Badge variants the pill uses; the Badge writes it to `data-variant`, which tests check. */
export type PillVariant = "default" | "secondary" | "destructive" | "outline";

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
    default:
      return stateLabel(state);
  }
}

/** Badge colour for each pill state: red when remapping is off because of a problem. */
function pillVariant(state: PillState): PillVariant {
  switch (state) {
    case "running":
      return "default";
    case "paused":
      return "outline";
    case "released":
    case "error":
      return "destructive";
    case "connecting":
    case "offline":
      return "secondary";
  }
}

export function StatusPill({ state, reason }: StatusPillProps) {
  // role="status": screen readers announce changes; tests and Playwright find it by this role.
  return (
    <Badge role="status" variant={pillVariant(state)} data-state={state}>
      {pillLabel(state, reason)}
    </Badge>
  );
}
