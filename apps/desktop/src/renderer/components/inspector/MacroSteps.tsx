/**
 * The steps of a macro (spec F-MAC-1, F-MAC-2): keys (with modifiers) and delays, in order. Steps
 * can be added from the key picker, as delays, or recorded from the physical keyboard.
 */
import type { KeyName, MacroStepConfig } from "@keyrift/config-types";
import { ArrowDown, ArrowUp, Circle, Plus, Trash2 } from "lucide-react";

import type { Recorder } from "../../engine/useRecorder.ts";
import { keyName } from "../../keyboard/key-labels.ts";
import { Button } from "../ui/button.tsx";
import { ModifierToggles, NumberField } from "./fields.tsx";
import { KeyPicker } from "./KeyPicker.tsx";

/** The engine's longest allowed delay (crates/config: MAX_DELAY_MS). */
const MAX_DELAY_MS = 60_000;

type MacroStepsProps = {
  steps: MacroStepConfig[];
  onChange: (steps: MacroStepConfig[]) => void;
  physicalKey: KeyName;
  recorder: Recorder;
  path: string;
};

export function MacroSteps({ steps, onChange, physicalKey, recorder, path }: MacroStepsProps) {
  const recordId = `${path}.steps`;
  const recording = recorder.target === recordId;

  const replace = (index: number, step: MacroStepConfig) =>
    onChange(steps.map((s, i) => (i === index ? step : s)));
  const move = (index: number, to: number) => {
    const next = [...steps];
    const [step] = next.splice(index, 1);
    if (step !== undefined) next.splice(to, 0, step);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <ol aria-label="Macro steps" className="flex flex-col gap-2">
        {steps.map((step, index) => (
          // Steps have no id; the index is fine because each row shows its step's current values.
          <li key={index} className="flex flex-wrap items-end gap-3 rounded-md border p-2">
            <span className="w-6 pb-2 text-sm text-muted-foreground">{index + 1}.</span>
            {step.type === "key" ? (
              <>
                <KeyPicker
                  label={`Step ${index + 1} key`}
                  value={step.key}
                  onChange={(key) => replace(index, { ...step, key })}
                  recorder={recorder}
                  recordId={`${path}.steps.${index}`}
                />
                <ModifierToggles
                  label="With modifiers"
                  value={step.mods ?? []}
                  onChange={(mods) =>
                    replace(
                      index,
                      mods.length > 0 ? { ...step, mods } : { type: "key", key: step.key },
                    )
                  }
                />
              </>
            ) : (
              <NumberField
                label={`Step ${index + 1} delay`}
                unit="ms"
                min={0}
                max={MAX_DELAY_MS}
                value={step.ms}
                onChange={(ms) => replace(index, { type: "delay", ms: ms ?? 0 })}
              />
            )}
            <div className="ml-auto flex gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move step ${index + 1} up`}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move step ${index + 1} down`}
                disabled={index === steps.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove step ${index + 1}`}
                onClick={() => onChange(steps.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      {steps.length === 0 && (
        <p className="text-sm text-muted-foreground">No steps: the macro does nothing yet.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...steps, { type: "key", key: physicalKey }])}
        >
          <Plus /> Add key
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...steps, { type: "delay", ms: 50 }])}
        >
          <Plus /> Add delay
        </Button>
        <Button
          variant={recording ? "destructive" : "outline"}
          size="sm"
          onClick={async () => {
            if (!recording) {
              await recorder.start(recordId);
              return;
            }
            // Each recorded key becomes a step (a tap), in the order pressed.
            const keys = await recorder.stop();
            onChange([...steps, ...keys.map((key): MacroStepConfig => ({ type: "key", key }))]);
          }}
        >
          <Circle className={recording ? "fill-current" : ""} />
          {recording ? "Stop recording" : "Record steps"}
        </Button>
        {recording && (
          <span aria-live="polite" className="text-sm text-muted-foreground">
            {recorder.keys.length === 0
              ? "Press keys…"
              : recorder.keys.map((key) => keyName(key)).join(" ")}
          </span>
        )}
      </div>
    </div>
  );
}
