/**
 * React hook that keeps the engine's connection state and status up to date (spec §7.1 header).
 */
import { useEffect, useState } from "react";

import type { ConnectionState, EngineApi } from "../../shared/api.ts";
import type { Status } from "../../shared/protocol.ts";

export type EngineStatus = {
  /** null until the first answer from main. */
  connection: ConnectionState | null;
  /** null while not connected or before the engine answered. */
  status: Status | null;
};

/**
 * Returns the engine's connection and status; the component using it redraws when either changes.
 * On every (re)connect it subscribes to the status, layer and devices topics and asks for the
 * current status; events keep it up to date after that.
 */
export function useEngineStatus(engine: EngineApi): EngineStatus {
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    // Set to false by the cleanup below. Answers that arrive after it are dropped, because the
    // component may be gone (or StrictMode restarted the effect).
    let active = true;

    /** Asks the engine for its full status and shows it. */
    async function refreshStatus(): Promise<void> {
      const outcome = await engine.call("status.get", {});
      if (active && outcome.ok) {
        setStatus(outcome.result);
      }
    }

    async function onState(state: ConnectionState): Promise<void> {
      if (!active) return;
      setConnection(state);
      if (!state.connected) {
        setStatus(null);
        return;
      }
      // A new connection has no subscriptions yet, so subscribe again. Parts of the status
      // change on their own topics: active layers on `layer`, grabbed devices on `devices`.
      await engine.call("subscribe", { topics: ["status", "layer", "devices"] });
      await refreshStatus();
    }

    const stopEvents = engine.onEvent((event) => {
      if (!active) return;
      // Checking `event.event` narrows the type: in each case TypeScript knows what `data` is.
      switch (event.event) {
        case "status":
          // Status events carry the full status (spec §8.2), e.g. after pause/resume.
          setStatus(event.data);
          break;
        case "layer": {
          // Comes on every layer key press and release, so update just the layers instead of
          // asking for the whole status. The function form gets the latest status from React.
          const layers = event.data.layers;
          setStatus((previous) =>
            previous === null ? null : { ...previous, activeLayers: layers },
          );
          break;
        }
        case "devices":
          // Rare (plugging a device in or out). The event lists devices, not the status's
          // summary, so ask the engine for the status instead of counting here.
          void refreshStatus();
          break;
      }
    });
    const stopStateChanges = engine.onStateChange((state) => void onState(state));
    void engine.state().then(onState);

    // Cleanup: React calls this when the component goes away. Stop listening, or the old
    // listeners would keep running (and keep calling setStatus) forever.
    return () => {
      active = false;
      stopEvents();
      stopStateChanges();
    };
  }, [engine]);

  return { connection, status };
}
