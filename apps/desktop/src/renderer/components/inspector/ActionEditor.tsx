/**
 * Edits one action (spec §7.2 inspector): a type selector, then the fields of that type.
 *
 * A tap-hold contains two actions, so its editor shows two more ActionEditors inside itself, each
 * limited to the types the engine allows there (`slot`).
 */
import type { ActionConfig, KeyName, LayerConfig, Strategy } from "@keyrift/config-types";

import {
  type ActionType,
  convertAction,
  SLOT_TYPES,
  type Slot,
  TYPE_LABELS,
  targetLayers,
} from "../../config/action-types.ts";
import type { Recorder } from "../../engine/useRecorder.ts";
import { ModifierToggles, NumberField, SelectField } from "./fields.tsx";
import { KeyPicker } from "./KeyPicker.tsx";
import { MacroSteps } from "./MacroSteps.tsx";

export type ActionEditorProps = {
  action: ActionConfig;
  onChange: (action: ActionConfig) => void;
  slot: Slot;
  /** The physical key being edited: the default when a type needs a key. */
  physicalKey: KeyName;
  layers: LayerConfig[];
  recorder: Recorder;
  /** Unique within the inspector ("key", "key.tap", …), for the Record buttons. */
  path: string;
};

export function ActionEditor(props: ActionEditorProps) {
  const { action, onChange, slot, physicalKey, layers } = props;
  const hasLayers = targetLayers(layers).length > 0;
  return (
    <div className="flex flex-col gap-3">
      <SelectField<ActionType>
        label="Type"
        value={action.type}
        options={SLOT_TYPES[slot].map((type) => ({
          value: type,
          label: type === "layer" && !hasLayers ? "Layer (add a layer first)" : TYPE_LABELS[type],
          disabled: type === "layer" && !hasLayers,
        }))}
        onChange={(type) => {
          if (type !== action.type) {
            onChange(convertAction(action, type, { key: physicalKey, layers }));
          }
        }}
      />
      <ActionFields {...props} />
    </div>
  );
}

/** The fields of `action`'s type. */
function ActionFields(props: ActionEditorProps) {
  const { action, onChange, slot, physicalKey, layers, recorder, path } = props;
  // `switch` on the tag: in each `case`, TypeScript knows which fields `action` has.
  switch (action.type) {
    case "key":
      return (
        <>
          <KeyPicker
            label="Output key"
            value={action.key}
            onChange={(key) => onChange({ ...action, key })}
            recorder={recorder}
            recordId={path}
          />
          <ModifierToggles
            label="With modifiers"
            value={action.mods ?? []}
            onChange={(mods) =>
              onChange(withOptional(action, "mods", mods.length > 0 ? mods : undefined))
            }
          />
          <SelectField<"keep" | "all" | "some">
            label="Modifiers already held"
            value={
              action.releaseHeld === "all"
                ? "all"
                : Array.isArray(action.releaseHeld)
                  ? "some"
                  : "keep"
            }
            options={[
              { value: "keep", label: "Keep them held" },
              { value: "all", label: "Release them while this key is sent" },
              { value: "some", label: "Release only some…" },
            ]}
            onChange={(choice) => {
              if (choice === "some") {
                // Start with Left Alt: the usual case, e.g. Alt+H → Left without Alt.
                if (!Array.isArray(action.releaseHeld)) {
                  onChange({ ...action, releaseHeld: ["LeftAlt"] });
                }
                return;
              }
              onChange(withOptional(action, "releaseHeld", choice === "all" ? "all" : undefined));
            }}
          />
          {Array.isArray(action.releaseHeld) && (
            <ModifierToggles
              label="Release these"
              value={action.releaseHeld}
              required
              onChange={(mods) => onChange({ ...action, releaseHeld: mods })}
            />
          )}
        </>
      );
    case "mods":
      return (
        <ModifierToggles
          label="Modifiers"
          value={action.mods}
          required
          onChange={(mods) => onChange({ ...action, mods })}
        />
      );
    case "layer":
      return (
        <>
          <SelectField
            label="Layer"
            value={action.layer}
            options={targetLayers(layers).map((layer) => ({
              value: layer.id,
              label: layer.name ?? layer.id,
            }))}
            onChange={(layer) => onChange({ ...action, layer })}
          />
          {/* A hold action can only hold a layer: the engine rejects toggles there. */}
          {slot === "key" && (
            <SelectField<"hold" | "toggle">
              label="Mode"
              value={action.mode}
              options={[
                { value: "hold", label: "While held" },
                { value: "toggle", label: "Toggle on / off" },
              ]}
              onChange={(mode) =>
                // The engine ignores modifiers on toggle layers (and warns), so drop them.
                onChange(
                  mode === "toggle"
                    ? withOptional({ ...action, mode }, "mods", undefined)
                    : { ...action, mode },
                )
              }
            />
          )}
          {action.mode === "hold" && (
            <ModifierToggles
              label="Also hold modifiers"
              value={action.mods ?? []}
              onChange={(mods) =>
                onChange(withOptional(action, "mods", mods.length > 0 ? mods : undefined))
              }
            />
          )}
        </>
      );
    case "tapHold":
      return (
        <>
          <fieldset aria-label="Tap" className="flex flex-col gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Tap</legend>
            <ActionEditor
              {...props}
              slot="tap"
              path={`${path}.tap`}
              action={action.tap}
              onChange={(tap) => onChange({ ...action, tap })}
            />
          </fieldset>
          <fieldset aria-label="Hold" className="flex flex-col gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Hold</legend>
            <ActionEditor
              {...props}
              slot="hold"
              path={`${path}.hold`}
              action={action.hold}
              onChange={(hold) => onChange({ ...action, hold })}
            />
          </fieldset>
          <NumberField
            label="Timeout"
            unit="ms"
            min={1}
            max={10000}
            placeholder="Default"
            optional
            value={action.timeoutMs ?? undefined}
            onChange={(ms) => onChange(withOptional(action, "timeoutMs", ms))}
          />
          <SelectField<Strategy | "default">
            label="Strategy"
            value={action.strategy ?? "default"}
            options={[
              { value: "default", label: "Default (from Settings)" },
              { value: "permissive-hold", label: "Permissive hold" },
              { value: "hold-on-other-press", label: "Hold on other press" },
              { value: "timeout-only", label: "Timeout only" },
            ]}
            onChange={(strategy) =>
              onChange(
                withOptional(action, "strategy", strategy === "default" ? undefined : strategy),
              )
            }
          />
        </>
      );
    case "macro":
      return (
        <MacroSteps
          steps={action.steps}
          onChange={(steps) => onChange({ ...action, steps })}
          physicalKey={physicalKey}
          recorder={recorder}
          path={path}
        />
      );
    case "none":
      return <p className="text-sm text-muted-foreground">The key does nothing.</p>;
    default:
      // Every type is handled above, so `action` has the type `never` here. If a new action type
      // is added to the schema, this line stops compiling until it gets a `case`.
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled action: ${JSON.stringify(value)}`);
}

/**
 * `object` with `field` set to `value`, or without `field` if `value` is undefined. Unset optional
 * fields are left out of the file instead of being saved as `null`.
 */
function withOptional<T extends object, K extends keyof T>(object: T, field: K, value: T[K]): T {
  const copy = { ...object };
  if (value === undefined) delete copy[field];
  else copy[field] = value;
  return copy;
}
