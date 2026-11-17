/**
 * The inspector (spec §7.2, F-UI-2): edits what the selected key does on the shown layer. A key
 * without its own action is transparent: it does what the layers below make it do, until a type
 * is chosen here. "Clear" makes it transparent again.
 */
import type { ActionConfig, KeyName, LayerConfig } from "@keyrift/config-types";
import { Eraser, X } from "lucide-react";

import {
  type ActionType,
  convertAction,
  SLOT_TYPES,
  TYPE_LABELS,
} from "../../config/action-types.ts";
import type { Recorder } from "../../engine/useRecorder.ts";
import { actionLabel, keyMeaning } from "../../keyboard/actions.ts";
import { keyName } from "../../keyboard/key-labels.ts";
import { Button } from "../ui/button.tsx";
import { ActionEditor } from "./ActionEditor.tsx";
import { SelectField } from "./fields.tsx";

type InspectorProps = {
  physicalKey: KeyName;
  layers: LayerConfig[];
  layerIndex: number;
  recorder: Recorder;
  onSet: (action: ActionConfig) => void;
  onClear: () => void;
  /** Unselects the key, which closes the inspector. */
  onClose: () => void;
};

export function Inspector({
  physicalKey,
  layers,
  layerIndex,
  recorder,
  onSet,
  onClear,
  onClose,
}: InspectorProps) {
  const layer = layers[layerIndex];
  const meaning = keyMeaning(layers, layerIndex, physicalKey);
  const layerName = layer?.name ?? layer?.id ?? "";
  const below =
    meaning.source === "below"
      ? `what ${layers.find((l) => l.id === meaning.layerId)?.name ?? meaning.layerId} sets: ${actionLabel(meaning.action, layers)}`
      : "its normal thing";

  return (
    <section aria-label="Inspector" className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <h2 className="mr-auto font-medium">
          {keyName(physicalKey)} <span className="text-muted-foreground">on {layerName}</span>
        </h2>
        <Button variant="outline" size="sm" disabled={meaning.source !== "own"} onClick={onClear}>
          <Eraser /> Clear
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close inspector"
          title="Close (Esc on the keyboard)"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {recorder.error !== null && (
        <p className="text-sm text-destructive">Cannot record: {recorder.error}</p>
      )}
      {meaning.source === "own" ? (
        <ActionEditor
          action={meaning.action}
          onChange={onSet}
          slot="key"
          physicalKey={physicalKey}
          layers={layers}
          recorder={recorder}
          path="key"
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Not set on this layer, so it does {below}. Choose a type to change it here.
          </p>
          <SelectField<ActionType>
            label="Type"
            value={null}
            options={SLOT_TYPES.key.map((type) => ({ value: type, label: TYPE_LABELS[type] }))}
            onChange={(type) =>
              onSet(
                convertAction(meaning.source === "below" ? meaning.action : undefined, type, {
                  key: physicalKey,
                  layers,
                }),
              )
            }
          />
        </>
      )}
    </section>
  );
}
