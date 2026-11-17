/**
 * Adds or edits one shortcut rule: the trigger (picked or recorded) and the output action. Works
 * on a draft; the profile only changes on Save, so Cancel leaves no undo step behind.
 */
import type {
  LayerConfig,
  ShortcutConfig,
  TriggerConfig,
  TriggerModifier,
} from "@keyrift/config-types";
import { Circle } from "lucide-react";
import { type FormEvent, useState } from "react";

import {
  GENERIC_MODIFIERS,
  recordedTrigger,
  SIDE_MODIFIERS,
  sortTriggerModifiers,
  TRIGGER_MODIFIER_LABELS,
  triggerLabel,
  triggerTaken,
} from "../../config/shortcuts.ts";
import type { Recorder } from "../../engine/useRecorder.ts";
import { keyName } from "../../keyboard/key-labels.ts";
import { ActionEditor } from "../inspector/ActionEditor.tsx";
import { ToggleButtons } from "../inspector/fields.tsx";
import { KeyPicker } from "../inspector/KeyPicker.tsx";
import { Button } from "../ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";

type ShortcutDialogProps = {
  title: string;
  initial: ShortcutConfig;
  /** All rules, to check the trigger isn't taken. */
  shortcuts: readonly ShortcutConfig[];
  /** The rule being edited (its own trigger isn't "taken"), or null when adding. */
  editing: number | null;
  layers: LayerConfig[];
  recorder: Recorder;
  onSave: (shortcut: ShortcutConfig) => void;
  onClose: () => void;
};

const RECORD_ID = "shortcut.trigger";

export function ShortcutDialog({
  title,
  initial,
  shortcuts,
  editing,
  layers,
  recorder,
  onSave,
  onClose,
}: ShortcutDialogProps) {
  const [draft, setDraft] = useState(initial);
  const recording = recorder.target === RECORD_ID;
  const taken = triggerTaken(shortcuts, draft.trigger, editing);
  const mods = draft.trigger.mods ?? [];

  const setTrigger = (trigger: TriggerConfig) => setDraft((d) => ({ ...d, trigger }));
  /** Replaces the modifiers of one group (`group`) and keeps the other group's. */
  const setMods = (group: TriggerModifier[], chosen: TriggerModifier[]) => {
    const next = sortTriggerModifiers([...mods.filter((m) => !group.includes(m)), ...chosen]);
    setTrigger(next.length > 0 ? { ...draft.trigger, mods: next } : { key: draft.trigger.key });
  };
  const close = () => {
    void recorder.stop();
    onClose();
  };

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (taken !== null) return;
    void recorder.stop();
    onSave(draft);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              When the trigger is pressed (with exactly these modifiers held), the output is sent
              instead.
            </DialogDescription>
          </DialogHeader>

          {/* gap-4: the same space between fields as the Output fieldset's ActionEditor. */}
          <fieldset aria-label="Trigger" className="flex flex-col gap-4 rounded-md border p-3">
            {/* -ml-1 undoes the px-1 (room in the border line), so the title lines up with the
                fields below it. */}
            <legend className="-ml-1 px-1 text-sm font-medium">
              Trigger: {triggerLabel(draft.trigger)}
            </legend>
            <div className="flex flex-wrap items-end gap-2">
              <KeyPicker
                label="Trigger key"
                value={draft.trigger.key}
                onChange={(key) => setTrigger({ ...draft.trigger, key })}
              />
              <Button
                type="button"
                variant={recording ? "destructive" : "outline"}
                size="sm"
                onClick={() => {
                  if (recording) {
                    void recorder.stop();
                    return;
                  }
                  void recorder.start(RECORD_ID, {
                    // Modifiers are collected until a normal key ends the trigger.
                    onKeys: (keys) => {
                      const trigger = recordedTrigger(keys);
                      if (trigger !== null) setTrigger(trigger);
                      return trigger !== null;
                    },
                  });
                }}
              >
                <Circle className={recording ? "fill-current" : ""} />
                {recording ? "Stop recording" : "Record trigger"}
              </Button>
              {recording && (
                <span aria-live="polite" className="pb-1.5 text-sm text-muted-foreground">
                  {recorder.keys.length === 0
                    ? "Press the shortcut…"
                    : recorder.keys.map((key) => keyName(key)).join(" + ")}
                </span>
              )}
            </div>
            <ToggleButtons
              label="Modifiers, either side"
              value={mods.filter((m) => GENERIC_MODIFIERS.includes(m))}
              options={GENERIC_MODIFIERS.map((mod) => ({
                value: mod,
                short: TRIGGER_MODIFIER_LABELS[mod],
                name: `${mod} (either side)`,
              }))}
              onChange={(chosen) => setMods(GENERIC_MODIFIERS, chosen)}
            />
            <ToggleButtons
              label="Modifiers, one side only"
              value={mods.filter((m) => SIDE_MODIFIERS.includes(m))}
              options={SIDE_MODIFIERS.map((mod) => ({
                value: mod,
                short: TRIGGER_MODIFIER_LABELS[mod],
                name: mod.replace(/^(Left|Right)/, "$1 "),
              }))}
              onChange={(chosen) => setMods(SIDE_MODIFIERS, chosen)}
            />
            {taken !== null && (
              <p role="alert" className="text-sm text-destructive">
                Rule {taken + 1} already uses {triggerLabel(draft.trigger)}.
              </p>
            )}
          </fieldset>

          <fieldset aria-label="Output" className="flex flex-col gap-3 rounded-md border p-3">
            <legend className="-ml-1 px-1 text-sm font-medium">Output</legend>
            <ActionEditor
              action={draft.action}
              onChange={(action) => setDraft((d) => ({ ...d, action }))}
              slot="shortcut"
              physicalKey={draft.trigger.key}
              layers={layers}
              recorder={recorder}
              path="shortcut.action"
            />
          </fieldset>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={taken !== null}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
