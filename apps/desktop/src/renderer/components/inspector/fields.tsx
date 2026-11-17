/**
 * Small labelled form fields the action editors are built from: a dropdown, a number box and the
 * modifier toggles. Each one shows a value and reports changes; the editor decides what they mean.
 */
import type { Modifier } from "@keyrift/config-types";
import { useId, useState } from "react";

import { MODIFIERS, sortModifiers } from "../../config/action-types.ts";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";

export type Option<T extends string> = { value: T; label: string; disabled?: boolean };

/** A labelled dropdown. `T` is the union of the values, e.g. `"hold" | "toggle"`. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  // `items` tells the trigger which label to show for the chosen value.
  const items = Object.fromEntries(options.map((option) => [option.value, option.label]));
  return (
    <div className="flex flex-col gap-2">
      <Label id={id}>{label}</Label>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
      >
        <SelectTrigger aria-labelledby={id} className="min-w-48">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        {/* Open below the box, like the key picker. By default Base UI lays the list over the box
            with the chosen item on top of it (macOS style), which hid the box and, with nothing
            chosen yet, put the first option where the box was. */}
        <SelectContent alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * A labelled whole-number box. Empty means "not set" (`undefined`) when `optional`. What the user
 * types is kept as text, so a half-typed or wrong number stays visible with a message instead of
 * being replaced; only valid numbers are reported.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  unit,
  optional = false,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min: number;
  max: number;
  unit: string;
  optional?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const shown = value === undefined ? "" : String(value);
  const [text, setText] = useState(shown);
  // When the value changes from outside (undo, another field), show it. Comparing with the last
  // value seen during render, not in an effect, avoids showing the old text for one frame.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(shown);
  }

  const problem = numberProblem(text, min, max, optional);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {label} ({unit})
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        className="w-32"
        value={text}
        placeholder={placeholder}
        aria-invalid={problem !== null}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (numberProblem(next, min, max, optional) === null) {
            const parsed = next.trim() === "" ? undefined : Number(next);
            setLastValue(parsed);
            onChange(parsed);
          }
        }}
      />
      {problem !== null && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}

/** Why `text` isn't an allowed number, or null. */
export function numberProblem(
  text: string,
  min: number,
  max: number,
  optional: boolean,
): string | null {
  if (text.trim() === "") return optional ? null : "Enter a number";
  if (!/^\d+$/.test(text.trim())) return "Whole numbers only";
  const n = Number(text);
  if (n < min || n > max) return `From ${min} to ${max}`;
  return null;
}

const MODIFIER_LABELS: Record<Modifier, [short: string, name: string]> = {
  LeftCtrl: ["Ctrl", "Left Ctrl"],
  LeftShift: ["Shift", "Left Shift"],
  LeftAlt: ["Alt", "Left Alt"],
  LeftSuper: ["Super", "Left Super"],
  RightCtrl: ["RCtrl", "Right Ctrl"],
  RightShift: ["RShift", "Right Shift"],
  RightAlt: ["AltGr", "AltGr (Right Alt)"],
  RightSuper: ["RSuper", "Right Super"],
};

/** Eight on/off buttons, one per modifier. `required`: the last one can't be turned off. */
export function ModifierToggles({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: readonly Modifier[];
  onChange: (mods: Modifier[]) => void;
  required?: boolean;
}) {
  return (
    <ToggleButtons
      label={label}
      value={value}
      options={MODIFIERS.map((mod) => ({
        value: mod,
        short: MODIFIER_LABELS[mod][0],
        name: MODIFIER_LABELS[mod][1],
      }))}
      onChange={(mods) => onChange(sortModifiers(mods))}
      required={required}
    />
  );
}

/**
 * A labelled row of on/off buttons (Base UI ToggleGroup with `multiple`). `short` is shown,
 * `name` is the button's accessible name. `required`: the last one can't be turned off.
 */
export function ToggleButtons<M extends string>({
  label,
  value,
  options,
  onChange,
  required = false,
}: {
  label: string;
  value: readonly M[];
  options: { value: M; short: string; name: string }[];
  onChange: (value: M[]) => void;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label id={id}>{label}</Label>
      <ToggleGroup
        multiple
        aria-labelledby={id}
        variant="outline"
        size="sm"
        spacing={0}
        value={value}
        onValueChange={(next) => {
          if (required && next.length === 0) return;
          // The group only holds the values given in `options`.
          onChange(next as M[]);
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value} aria-label={option.name}>
            {option.short}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
