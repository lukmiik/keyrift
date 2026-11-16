/**
 * The key picker (spec §7.2): a searchable, grouped list of every key, plus a Record button that
 * takes the next physical key press instead (F-UI-3).
 *
 * Built on Base UI's Combobox: a text box that filters a list as you type, with arrow keys and
 * Enter to choose (like an HTML `<datalist>`, but with groups and full keyboard support).
 */
import type { KeyName } from "@keyrift/config-types";
import { Circle } from "lucide-react";
import { useId } from "react";

import type { Recorder } from "../../engine/useRecorder.ts";
import { KEY_GROUPS, type KeyGroup, matchesKey } from "../../keyboard/key-groups.ts";
import { keyName } from "../../keyboard/key-labels.ts";
import { Button } from "../ui/button.tsx";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "../ui/combobox.tsx";
import { Label } from "../ui/label.tsx";

type KeyPickerProps = {
  label: string;
  value: KeyName;
  onChange: (key: KeyName) => void;
  /** Without a recorder, there is no Record button. */
  recorder?: Recorder;
  /** Unique per field, so only this field's Record button shows "Press a key…". */
  recordId?: string;
};

export function KeyPicker({ label, value, onChange, recorder, recordId }: KeyPickerProps) {
  const id = useId();
  const recording = recorder !== undefined && recorder.target === recordId;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Combobox
          items={KEY_GROUPS}
          value={value}
          onValueChange={(key: KeyName | null) => {
            if (key !== null) onChange(key);
          }}
          itemToStringLabel={(key: KeyName) => keyName(key)}
          filter={(key: KeyName, query: string) => matchesKey(key, query)}
        >
          <ComboboxInput id={id} className="w-56" placeholder="Search keys" />
          <ComboboxContent>
            <ComboboxEmpty>No key matches.</ComboboxEmpty>
            <ComboboxList>
              {(group: KeyGroup) => (
                <ComboboxGroup key={group.label} items={group.items}>
                  <ComboboxLabel>{group.label}</ComboboxLabel>
                  <ComboboxCollection>
                    {(key: KeyName) => (
                      <ComboboxItem key={key} value={key}>
                        {keyName(key)}
                        <span className="ml-auto text-xs text-muted-foreground">{key}</span>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        {recorder !== undefined && (
          <Button
            type="button"
            variant={recording ? "destructive" : "outline"}
            size="sm"
            aria-label={recording ? `Stop recording ${label}` : `Record ${label}`}
            onClick={() => {
              if (recording) void recorder.stop();
              else
                void recorder.start(recordId ?? label, {
                  // One key is all a key field needs.
                  onKeys: (keys) => {
                    const key = keys.at(-1);
                    if (key !== undefined) onChange(key);
                    return true;
                  },
                });
            }}
          >
            <Circle className={recording ? "fill-current" : ""} />
            {recording ? "Press a key…" : "Record"}
          </Button>
        )}
      </div>
    </div>
  );
}
