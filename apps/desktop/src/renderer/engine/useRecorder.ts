/**
 * React hook behind the Record buttons (spec F-UI-3, F-MAC-2): asks the engine to report the
 * physical keys pressed next (`record.start`, then `record` events), and stops (`record.stop`).
 *
 * While recording, the engine passes keys through unmapped, so they also reach this window; the
 * hook swallows them there, so e.g. a recorded Enter doesn't also press the focused button.
 */
import { isKeyName } from "@keyrift/config-types/keys";
import type { KeyName } from "@keyrift/config-types";
import { useEffect, useRef, useState } from "react";

import type { EngineApi } from "../../shared/api.ts";

export type RecordOptions = {
  /**
   * Called after each key with every key so far; returns true when it has what it needs, which
   * stops the recording (a key field: after one key; a trigger: after a key that isn't a
   * modifier). Without it, the recording runs until `stop` (macro steps).
   */
  onKeys?: (keys: KeyName[]) => boolean;
};

export type Recorder = {
  /** Which field is recording (the id passed to `start`), or null. */
  target: string | null;
  /** Keys recorded so far, to show while recording. */
  keys: KeyName[];
  /** Why the last recording failed, e.g. the engine isn't running. */
  error: string | null;
  start: (target: string, options?: RecordOptions) => Promise<void>;
  /** Ends the recording; resolves to the keys pressed since `start`. */
  stop: () => Promise<KeyName[]>;
};

export function useRecorder(engine: EngineApi): Recorder {
  const [target, setTarget] = useState<string | null>(null);
  const [keys, setKeys] = useState<KeyName[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The options of the running recording, or null. A ref, not state: the event listener below is
  // set up once and must always see the current one.
  const current = useRef<RecordOptions | null>(null);
  // The keys so far, for `onKeys` (the `keys` state only updates on the next render).
  const sofar = useRef<KeyName[]>([]);

  async function stop(): Promise<KeyName[]> {
    if (current.current === null) return [];
    current.current = null;
    setTarget(null);
    const outcome = await engine.call("record.stop", {});
    // Keys the GUI doesn't know (none so far) are skipped rather than saved into a profile.
    return outcome.ok ? outcome.result.keys.filter(isKeyName) : [];
  }

  async function start(id: string, options: RecordOptions = {}): Promise<void> {
    await stop();
    setError(null);
    setKeys([]);
    sofar.current = [];
    const outcome = await engine.call("record.start", {});
    if (!outcome.ok) {
      setError(outcome.error.message);
      return;
    }
    current.current = options;
    setTarget(id);
  }

  useEffect(() => {
    const stopEvents = engine.onEvent((event) => {
      const options = current.current;
      if (event.event !== "record" || options === null || !isKeyName(event.data.key)) return;
      const keys = [...sofar.current, event.data.key];
      sofar.current = keys;
      setKeys(keys);
      if (options.onKeys?.(keys) === true) {
        current.current = null;
        setTarget(null);
        void engine.call("record.stop", {});
      }
    });
    const stopStateChanges = engine.onStateChange((state) => {
      // The engine ends a recording when its client disconnects.
      if (!state.connected && current.current !== null) {
        current.current = null;
        setTarget(null);
      }
    });
    return () => {
      stopEvents();
      stopStateChanges();
      // Leaving the screen while recording: tell the engine to stop.
      if (current.current !== null) {
        current.current = null;
        void engine.call("record.stop", {});
      }
    };
  }, [engine]);
  // Swallow key presses in this window while recording (capture phase: before any element).
  useEffect(() => {
    if (target === null) return;
    const swallow = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", swallow, true);
    window.addEventListener("keyup", swallow, true);
    return () => {
      window.removeEventListener("keydown", swallow, true);
      window.removeEventListener("keyup", swallow, true);
    };
  }, [target]);

  return { target, keys, error, start, stop };
}
