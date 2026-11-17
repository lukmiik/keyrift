/**
 * The Tester screen (spec §7.3, F-UI-4): press keys and see what the engine does with them. Held
 * keys light up on the keyboard, which shows the layer that is on top right now; below it, a table
 * with one row per key press: what the apps received, the active layers and how long the key was
 * held. The engine's own detail (its action text, every output event) is the result's tooltip.
 */
import { isKeyName } from "@keyrift/config-types/keys";
import type { LayerConfig } from "@keyrift/config-types";
import { Eraser, Pause, Play } from "lucide-react";

import type { ConfigApi, EngineApi } from "../../shared/api.ts";
import { usePhysicalLayout } from "../config/usePhysicalLayout.ts";
import type { ProfileEditor } from "../config/useProfileEditor.ts";
import { type TesterRow, useTester } from "../engine/useTester.ts";
import { keyLabel, keyName } from "../keyboard/key-labels.ts";
import { layoutKeys } from "../keyboard/layouts.ts";
import { Keyboard } from "./Keyboard.tsx";
import { ScreenTitle } from "./ScreenTitle.tsx";
import { Button } from "./ui/button.tsx";

type TesterScreenProps = {
  profile: ProfileEditor;
  config: ConfigApi;
  engine: EngineApi;
};

export function TesterScreen({ profile, config, engine }: TesterScreenProps) {
  const tester = useTester(engine);
  const layout = usePhysicalLayout(config);
  // Labels come from the open profile; without one the keys show only their names.
  const layers: LayerConfig[] =
    profile.status === "ready" ? (profile.editor.present.layers ?? []) : [];
  const top = tester.layers?.at(-1);
  const layerIndex = Math.max(
    0,
    layers.findIndex((layer) => layer.id === top),
  );

  // With one keyboard the device column would repeat one name on every row.
  const showDevice = new Set(tester.rows.map((row) => row.device)).size > 1;

  return (
    <section className="flex flex-col gap-4">
      <ScreenTitle title="Tester" />
      <div className="flex items-start gap-6">
        <p className="flex-1 text-sm text-muted-foreground">
          Press keys to see what the engine does with them. The keyboard shows the layer that is on
          top right now.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => tester.setPaused(!tester.paused)}>
            {tester.paused ? <Play /> : <Pause />}
            {tester.paused ? "Resume" : "Pause"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={tester.rows.length === 0}
            onClick={tester.clear}
          >
            <Eraser /> Clear
          </Button>
        </div>
      </div>

      <Keyboard
        keys={layoutKeys(layout)}
        layers={layers}
        layerIndex={layerIndex}
        lit={tester.held}
      />

      {tester.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tester.paused
            ? "Paused: new key events aren't added."
            : tester.listening
              ? "No key events yet."
              : "Connecting to the engine…"}
        </p>
      ) : (
        <table aria-label="Key events" className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-4 font-normal">Time</th>
              <th className="py-2 pr-4 font-normal">Key</th>
              <th className="py-2 pr-4 font-normal">Result</th>
              <th className="py-2 pr-4 font-normal">Layers</th>
              <th className="py-2 pr-4 text-right font-normal">Held</th>
              {showDevice && <th className="py-2 font-normal">Device</th>}
            </tr>
          </thead>
          <tbody>
            {tester.rows.map((row) => (
              <EventRow key={row.id} row={row} layers={layers} showDevice={showDevice} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function EventRow({
  row,
  layers,
  showDevice,
}: {
  row: TesterRow;
  layers: LayerConfig[];
  showDevice: boolean;
}) {
  const result = resultOf(row, layers);
  const outputs = [...row.pressOutputs, ...(row.releaseOutputs ?? [])];
  return (
    <tr className="border-b">
      <td className="py-1.5 pr-4 whitespace-nowrap text-muted-foreground tabular-nums">
        {timeLabel(row.receivedAt)}
      </td>
      <td className="py-1.5 pr-4 font-medium whitespace-nowrap">{keyText(row.key)}</td>
      {/* The engine's own detail, for debugging a mapping: hover the result. */}
      <td
        className="py-1.5 pr-4"
        title={`Engine: ${row.action ?? "–"}\nOutput: ${outputsText(outputs) || "–"}`}
      >
        {result.text}
        {result.note !== null && <span className="text-muted-foreground"> · {result.note}</span>}
      </td>
      <td className="py-1.5 pr-4 whitespace-nowrap text-muted-foreground">
        {layersText(row.layers, layers)}
      </td>
      <td className="py-1.5 pr-4 text-right whitespace-nowrap text-muted-foreground tabular-nums">
        {row.heldMs === null ? "held…" : `${row.heldMs} ms`}
      </td>
      {showDevice && (
        // Device names are long ("HyperX Alloy Origins Core"); the full name is the tooltip.
        <td className="max-w-40 truncate py-1.5 text-muted-foreground" title={row.device}>
          {row.device}
        </td>
      )}
    </tr>
  );
}

/** Modifier keys: shown short ("Ctrl") and first in a combo. */
const MODIFIERS = new Set(
  "LEFTCTRL RIGHTCTRL LEFTSHIFT RIGHTSHIFT LEFTALT RIGHTALT LEFTMETA RIGHTMETA"
    .split(" ")
    .map((name) => `KEY_${name}`),
);

/** A key in a result: modifiers short ("Alt"), other keys by name ("Down", not the "↓" cap label). */
function resultKey(key: string): string {
  return MODIFIERS.has(key) && isKeyName(key) ? keyLabel(key) : keyText(key);
}

/**
 * What a press did, in a few words: the keys the apps received ("Ctrl+C", "Down"), the layer it
 * switched to, or "Nothing", plus a note when Keyrift let go of a modifier the user was holding
 * (an action that releases held modifiers: Alt+J → plain Down). Worked out from the output events:
 * a key released before it was pressed was held already; pressing it again later restores it.
 * Modifiers already held on the output (`heldBefore`) and not let go are part of the combo.
 */
export function resultOf(
  row: Pick<TesterRow, "action" | "pressOutputs" | "releaseOutputs"> &
    Partial<Pick<TesterRow, "heldBefore">>,
  layers: LayerConfig[],
): { text: string; note: string | null } {
  const pressed: string[] = [];
  const letGo: string[] = [];
  for (const output of [...row.pressOutputs, ...(row.releaseOutputs ?? [])]) {
    const key = output.slice(1);
    if (output.startsWith("+")) {
      if (!letGo.includes(key) && !pressed.includes(key)) pressed.push(key);
    } else if (!pressed.includes(key) && !letGo.includes(key)) {
      letGo.push(key);
    }
  }
  const note = letGo.length > 0 ? `${letGo.map(resultKey).join("+")} let go` : null;
  const action = row.action ?? "";

  if (/^layer (Hold|Toggle)/.test(action)) {
    // A hold layer can hold modifiers too (Alt nav holds Alt for Alt+Tab).
    const mods = pressed.filter((key) => MODIFIERS.has(key));
    return {
      text: actionText(action, layers),
      note: mods.length > 0 ? `${mods.map(resultKey).join("+")} held` : note,
    };
  }
  if (action === "none") return { text: "Nothing", note: null };
  if (pressed.length === 0) {
    // A tap-hold still deciding, or an action with no output yet: the engine's description.
    return { text: action === "" ? "–" : actionText(action, layers), note };
  }
  const stillHeld = (row.heldBefore ?? []).filter(
    (key) => MODIFIERS.has(key) && !letGo.includes(key) && !pressed.includes(key),
  );
  const mods = [...stillHeld, ...pressed.filter((key) => MODIFIERS.has(key))];
  const others = pressed.filter((key) => !MODIFIERS.has(key));
  // One key with its modifiers is a combo; more keys (a macro) are listed in order.
  const text =
    others.length <= 1
      ? [...mods, ...others].map(resultKey).join("+")
      : pressed.map(resultKey).join(" ");
  return { text, note };
}

/** "14:03:27.512": the time of day with milliseconds, since key events come fast. */
export function timeLabel(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** A key's readable name ("KEY_LEFTCTRL" → "Left Ctrl"); unknown names as they are. */
function keyText(key: string): string {
  return isKeyName(key) ? keyName(key) : key;
}

/**
 * The engine's description of an action, readable: key names spelled out and layer ids replaced by
 * names, e.g. "LeftCtrl+KEY_C" → "LeftCtrl+C", "layer Hold alt-nav" → "Alt nav layer (hold)".
 */
export function actionText(action: string, layers: LayerConfig[]): string {
  return action
    .replace(/\bKEY_[A-Z0-9_]+\b/g, keyText)
    .replace(/\blayer (Hold|Toggle) ([\w-]+)/g, (_match, mode: string, id: string) => {
      const name = layers.find((layer) => layer.id === id)?.name ?? id;
      return `${name} layer (${mode.toLowerCase()})`;
    });
}

/** Output events as arrows: ["+KEY_LEFTCTRL", "+KEY_C"] → "↓Left Ctrl ↓C". */
export function outputsText(outputs: string[]): string {
  return outputs
    .map((output) => `${output.startsWith("-") ? "↑" : "↓"}${keyText(output.slice(1))}`)
    .join(" ");
}

/** The active layers by name, base first: "Base → Alt nav". */
function layersText(ids: string[], layers: LayerConfig[]): string {
  return ids.map((id) => layers.find((layer) => layer.id === id)?.name ?? id).join(" → ");
}
