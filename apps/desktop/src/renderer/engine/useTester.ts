/**
 * React hook behind the Tester screen (spec F-UI-4): subscribes to the engine's `tester` topic while
 * the screen is open and keeps the recent key events, the keys held right now and the active layers.
 */
import { useEffect, useRef, useState } from "react";

import type { EngineApi } from "../../shared/api.ts";
import type { TesterEventData } from "../../shared/protocol.ts";

/** Most rows kept; older ones drop off, so a long session doesn't fill the memory. */
export const MAX_ROWS = 500;

/**
 * One row of the event table: one key press, filled in further when the key is released. One row
 * per press rather than per event, since a release mostly repeats its press.
 */
export type TesterRow = {
  /** Unique within the session, for React's `key` (two presses can share every field). */
  id: number;
  /** When the GUI got the press (wall clock, ms since 1970). The engine's own clock has no date. */
  receivedAt: number;
  device: string;
  key: string;
  /** What the key resolved to (the engine's description, e.g. "LeftCtrl+KEY_C"). */
  action: string | null;
  /** Output key events on the press, e.g. `["+KEY_ESC"]` (`+` press, `-` release). */
  pressOutputs: string[];
  /** Output key events on the release; null while the key is held. */
  releaseOutputs: string[] | null;
  /**
   * Output keys already held when the key was pressed, e.g. Alt held by the Alt nav layer: the
   * press's keys are combined with them (Tab there reaches the apps as Alt+Tab).
   */
  heldBefore: string[];
  /** Active layers right after the press. */
  layers: string[];
  /** How long the key was held, in ms; null while it is held. */
  heldMs: number | null;
};

export type Tester = {
  /** Newest press first, at most MAX_ROWS. */
  rows: TesterRow[];
  /** Physical keys held right now, e.g. "KEY_H" (on any device). */
  held: ReadonlySet<string>;
  /** Active layers after the last event, base first; null before the first event. */
  layers: string[] | null;
  /** Whether the engine has confirmed the subscription, so pressed keys will show up. */
  listening: boolean;
  /** While paused, new presses don't add rows (held keys and open rows still update). */
  paused: boolean;
  setPaused: (paused: boolean) => void;
  clear: () => void;
};

export function useTester(engine: EngineApi): Tester {
  const [rows, setRows] = useState<TesterRow[]>([]);
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const [layers, setLayers] = useState<string[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [listening, setListening] = useState(false);
  // Refs, not state: the event listener is set up once and must see the current values.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  // Each held key, by "device|key": when it went down (engine µs) and its row (null if it has none,
  // e.g. pressed while paused).
  const pressedAt = useRef(new Map<string, { timeUs: number; row: number | null }>());
  const nextId = useRef(0);
  // Keys held on the engine's output (virtual keyboard) right now, from the output events.
  const outputHeld = useRef(new Set<string>());

  useEffect(() => {
    // Aborted by the cleanup below; answers and events after it are dropped. (A plain `let active`
    // flag, as in useEngineStatus, trips the React Compiler here because of the nested function.)
    const alive = new AbortController();
    const active = () => !alive.signal.aborted;
    // Subscribed again after a reconnect: a new connection starts with no subscriptions.
    // Listening only once the engine answers: keys pressed before that never reach the screen.
    const subscribe = () =>
      void engine.call("subscribe", { topics: ["tester"] }).then((outcome) => {
        if (active() && outcome.ok) setListening(true);
      });

    function onTester(data: TesterEventData): void {
      const id = `${data.device}|${data.key}`;
      const heldBefore = [...outputHeld.current];
      for (const output of data.outputs) {
        if (output.startsWith("+")) outputHeld.current.add(output.slice(1));
        else outputHeld.current.delete(output.slice(1));
      }
      if (data.pressed) {
        const row = pausedRef.current ? null : nextId.current++;
        pressedAt.current.set(id, { timeUs: data.timeUs, row });
        if (row !== null) {
          const added: TesterRow = {
            id: row,
            receivedAt: Date.now(),
            device: data.device,
            key: data.key,
            action: data.action,
            pressOutputs: data.outputs,
            releaseOutputs: null,
            heldBefore,
            layers: data.layers,
            heldMs: null,
          };
          setRows((current) => [added, ...current].slice(0, MAX_ROWS));
        }
      } else {
        const press = pressedAt.current.get(id);
        pressedAt.current.delete(id);
        // Fill in the press's row (if it has one and it wasn't cleared or dropped meanwhile).
        if (press?.row != null) {
          const heldMs = Math.round((data.timeUs - press.timeUs) / 1000);
          setRows((current) =>
            current.map((row) =>
              row.id === press.row ? { ...row, releaseOutputs: data.outputs, heldMs } : row,
            ),
          );
        }
      }
      setHeld((current) => {
        const next = new Set(current);
        if (data.pressed) next.add(data.key);
        // Released only when no device still holds it (two keyboards, same key).
        else if (![...pressedAt.current.keys()].some((k) => k.endsWith(`|${data.key}`))) {
          next.delete(data.key);
        }
        return next;
      });
      setLayers(data.layers);
    }

    const stopEvents = engine.onEvent((event) => {
      if (active() && event.event === "tester") onTester(event.data);
    });
    const stopStateChanges = engine.onStateChange((state) => {
      if (!active()) return;
      if (state.connected) {
        subscribe();
      } else {
        setListening(false);
        // Keys held when the engine went away will never send their release.
        pressedAt.current.clear();
        outputHeld.current.clear();
        setHeld(new Set());
      }
    });
    void engine.state().then((state) => {
      if (active() && state.connected) subscribe();
    });

    return () => {
      alive.abort();
      stopEvents();
      stopStateChanges();
      // The engine only sends tester events while someone listens; stop when the screen closes.
      void engine.call("unsubscribe", { topics: ["tester"] });
    };
  }, [engine]);

  return {
    rows,
    held,
    layers,
    listening,
    paused,
    setPaused,
    clear: () => setRows([]),
  };
}
