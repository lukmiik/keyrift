/**
 * The visual keyboard (spec §7.2, F-UI-1): every key of the chosen layout, labelled with what it
 * does on the shown layer and coloured by kind. Transparent keys on upper layers are dimmed and
 * show what they fall through to. Click a key (or Enter) to select it; arrow keys move between keys.
 */
import type { KeyName, LayerConfig } from "@keyrift/config-types";
import { cn } from "cn";
import { type KeyboardEvent, useRef, useState } from "react";

import {
  actionKind,
  capLabel,
  actionLabel,
  KIND_COLORS,
  type KeyMeaning,
  keyMeaning,
} from "../keyboard/actions.ts";
import { keyLabel, keyName } from "../keyboard/key-labels.ts";
import type { KeySpec } from "../keyboard/layouts.ts";
import { ARROW_DIRECTIONS, nearestKey } from "../keyboard/navigation.ts";

/** Size of one key unit in pixels. */
const UNIT = 52;
/** Gap between keys in pixels. */
const GAP = 4;

type KeyboardProps = {
  keys: KeySpec[];
  /** The profile's layers; the keyboard shows layer number `layerIndex`. */
  layers: LayerConfig[];
  layerIndex: number;
  selected: KeyName | null;
  onSelect: (key: KeyName) => void;
};

export function Keyboard({ keys, layers, layerIndex, selected, onSelect }: KeyboardProps) {
  // The key that is the Tab stop. Not state you see; it only decides where Tab lands.
  const [focusKey, setFocusKey] = useState<KeyName | null>(null);
  // The DOM buttons by key, so the arrow keys can move the focus. A ref keeps a value between
  // renders without causing one, like an instance field.
  const buttons = useRef(new Map<KeyName, HTMLButtonElement>());
  const tabStop = focusKey ?? selected ?? keys[0]?.key ?? null;

  const width = Math.max(...keys.map((spec) => spec.x + (spec.w ?? 1)));
  const height = Math.max(...keys.map((spec) => spec.y + (spec.h ?? 1)));

  function onKeyDown(event: KeyboardEvent, key: KeyName) {
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction === undefined) return;
    event.preventDefault(); // Don't scroll the page.
    const next = nearestKey(keys, key, direction);
    if (next !== null) {
      setFocusKey(next);
      buttons.current.get(next)?.focus();
    }
  }

  return (
    <div
      role="group"
      aria-label="Keyboard"
      className="relative shrink-0"
      // Set through the DOM (style property), which the page's CSP allows; a style="" attribute
      // in HTML would be blocked.
      style={{ width: width * UNIT, height: height * UNIT }}
    >
      {keys.map((spec) => {
        const meaning = keyMeaning(layers, layerIndex, spec.key);
        const label = meaningLabel(meaning, spec.key, layers);
        const kind = meaning.source === "passthrough" ? null : actionKind(meaning.action);
        return (
          <button
            key={spec.key}
            ref={(element) => {
              if (element === null) buttons.current.delete(spec.key);
              else buttons.current.set(spec.key, element);
            }}
            type="button"
            tabIndex={spec.key === tabStop ? 0 : -1}
            aria-pressed={spec.key === selected}
            aria-label={`${keyName(spec.key)}: ${label}`}
            title={`${keyName(spec.key)}: ${label}`}
            data-kind={kind ?? "passthrough"}
            data-source={meaning.source}
            onClick={() => {
              setFocusKey(spec.key);
              onSelect(spec.key);
            }}
            onKeyDown={(event) => onKeyDown(event, spec.key)}
            className={cn(
              "absolute flex flex-col items-start justify-between overflow-hidden rounded-md border p-1 text-left outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring",
              kind !== null ? KIND_COLORS[kind] : "bg-card text-card-foreground",
              // Keys that fall through to a lower layer are dimmed (spec §7.2).
              meaning.source !== "own" && layerIndex > 0 && "opacity-40",
              spec.key === selected && "ring-2 ring-primary",
            )}
            style={{
              left: spec.x * UNIT,
              top: spec.y * UNIT,
              width: (spec.w ?? 1) * UNIT - GAP,
              height: (spec.h ?? 1) * UNIT - GAP,
            }}
          >
            <span className="text-[10px] leading-none opacity-70">{keyLabel(spec.key)}</span>
            {meaning.source !== "passthrough" && <CapLabel {...capLabel(meaning.action, layers)} />}
          </button>
        );
      })}
    </div>
  );
}

/** The action part of a keycap: an optional small line of modifiers, then the main label. */
function CapLabel({ mods, main }: { mods: string | null; main: string }) {
  return (
    <span className="flex w-full flex-col leading-tight">
      {mods !== null && <span className="truncate text-[10px]">{mods}</span>}
      <span className="truncate text-xs font-medium">{main}</span>
    </span>
  );
}

/** What the key's label says: the action, or "unchanged" for a key no layer sets. */
export function meaningLabel(meaning: KeyMeaning, key: KeyName, layers: LayerConfig[]): string {
  return meaning.source === "passthrough"
    ? `${keyLabel(key)} (unchanged)`
    : actionLabel(meaning.action, layers);
}
