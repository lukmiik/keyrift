/**
 * The Keymap screen (spec §7.2): layer tabs (add, rename, delete), the visual keyboard for the
 * chosen layer, "Other keys" for mapped keys the layout doesn't have, and the inspector that edits
 * the selected key.
 */
import type { KeyName, LayerConfig } from "@keyrift/config-types";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";

import type { ConfigApi, EngineApi } from "../../shared/api.ts";
import { layerReferences, type ProfileEdit } from "../config/profile-edits.ts";
import { slugify } from "../../shared/slug.ts";
import type { ProfileEditor } from "../config/useProfileEditor.ts";
import { useRecorder } from "../engine/useRecorder.ts";
import { actionKind, KIND_COLORS, keyMeaning } from "../keyboard/actions.ts";
import { keyName } from "../keyboard/key-labels.ts";
import { layoutKeys } from "../keyboard/layouts.ts";
import { usePhysicalLayout } from "../config/usePhysicalLayout.ts";
import { Inspector } from "./inspector/Inspector.tsx";
import { ProfileUnavailable } from "./ProfileToolbar.tsx";
import { ScreenTitle } from "./ScreenTitle.tsx";
import { Keyboard, meaningLabel } from "./Keyboard.tsx";
import { NameDialog } from "./NameDialog.tsx";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog.tsx";
import { Button } from "./ui/button.tsx";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs.tsx";

type KeymapScreenProps = {
  profile: ProfileEditor;
  config: ConfigApi;
  engine: EngineApi;
};

/** Which layer dialog is open. */
type OpenDialog = "add" | "rename" | "delete" | null;

export function KeymapScreen({ profile, config, engine }: KeymapScreenProps) {
  const layout = usePhysicalLayout(config);
  const recorder = useRecorder(engine);
  // The shown layer, by id. If it disappears (deleted, undone), the base layer is shown.
  const [layerId, setLayerIdState] = useState("base");
  const [selected, setSelectedState] = useState<KeyName | null>(null);
  // A recording belongs to the key and layer it was started for.
  const setLayerId = (id: string) => {
    void recorder.stop();
    setLayerIdState(id);
  };
  const setSelected = (key: KeyName | null) => {
    if (key !== selected) void recorder.stop();
    setSelectedState(key);
  };
  const [dialog, setDialog] = useState<OpenDialog>(null);

  if (profile.status !== "ready") {
    return <ProfileUnavailable title="Keymap" profile={profile} />;
  }

  const { editor, dispatch } = profile;
  const layers: LayerConfig[] = editor.present.layers ?? [];
  const index = Math.max(
    0,
    layers.findIndex((layer) => layer.id === layerId),
  );
  const layer = layers[index];
  const keys = layoutKeys(layout);
  const edit = (change: ProfileEdit) => dispatch({ type: "edit", edit: change });
  // Mapped keys on this layer that the layout has no place for (spec §7.2 "Other keys").
  const otherKeys = Object.keys(layer?.keys ?? {}).filter(
    (key) => !keys.some((spec) => spec.key === key),
  ) as KeyName[];

  return (
    <section className="flex flex-col gap-4">
      <ScreenTitle title="Keymap" />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={layer?.id ?? "base"} onValueChange={(id) => setLayerId(String(id))}>
          <TabsList aria-label="Layers">
            {layers.map((l) => (
              <TabsTrigger key={l.id} value={l.id}>
                {l.name ?? l.id}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="sm" onClick={() => setDialog("add")}>
          <Plus /> Add layer
        </Button>
        {layer !== undefined && (
          <>
            <IconButton label="Rename layer" onClick={() => setDialog("rename")}>
              <Pencil />
            </IconButton>
            <IconButton
              label="Delete layer"
              disabled={index === 0}
              onClick={() => setDialog("delete")}
            >
              <Trash2 />
            </IconButton>
          </>
        )}
      </div>

      {/* Padding inside the scroll box: it clips everything outside it, so without room the
          selection and focus rings of keys at the top and left edges were cut off. -mx-1 pulls
          the box out by that padding, so the keys line up with the layer tabs above. */}
      <div className="-mx-1 overflow-x-auto p-1 pb-2">
        <Keyboard
          keys={keys}
          layers={layers}
          layerIndex={index}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

      {otherKeys.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Other keys</h2>
          <ul aria-label="Other keys" className="flex flex-wrap gap-2">
            {otherKeys.map((key) => {
              const meaning = keyMeaning(layers, index, key);
              const kind = meaning.source === "passthrough" ? null : actionKind(meaning.action);
              return (
                <li key={key}>
                  <button
                    type="button"
                    aria-pressed={key === selected}
                    onClick={() => setSelected(key === selected ? null : key)}
                    className={`rounded-md border px-2 py-1 text-xs ${kind !== null ? KIND_COLORS[kind] : ""} ${key === selected ? "ring-2 ring-primary" : ""}`}
                  >
                    {keyName(key)}: {meaningLabel(meaning, key, layers)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selected !== null && layer !== undefined && (
        <Inspector
          physicalKey={selected}
          layers={layers}
          layerIndex={index}
          recorder={recorder}
          onSet={(action) => edit({ type: "setKey", layerId: layer.id, key: selected, action })}
          onClear={() => edit({ type: "clearKey", layerId: layer.id, key: selected })}
          onClose={() => setSelected(null)}
        />
      )}

      {dialog === "add" && (
        <NameDialog
          title="Add layer"
          description="A layer where every key is transparent: it falls through to the layers below."
          submitLabel="Add"
          initialName=""
          onSubmit={(layerName) => {
            const id = newLayerId(layerName, layers);
            edit({ type: "addLayer", id, name: layerName });
            setLayerId(id);
            return Promise.resolve(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "rename" && layer !== undefined && (
        <NameDialog
          title={`Rename "${layer.name ?? layer.id}"`}
          description="Only the shown name changes; keys that switch to this layer keep working."
          submitLabel="Rename"
          initialName={layer.name ?? layer.id}
          onSubmit={(layerName) => {
            edit({ type: "renameLayer", layerId: layer.id, layerName });
            return Promise.resolve(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && layer !== undefined && index > 0 && (
        <DeleteLayerDialog
          layer={layer}
          references={layerReferences(editor.present, layer.id).map(
            (ref) =>
              `${layers.find((l) => l.id === ref.layerId)?.name ?? ref.layerId}: ${keyName(ref.key)}`,
          )}
          onDelete={() => {
            edit({ type: "removeLayer", layerId: layer.id });
            setLayerId("base");
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

/** Asks before deleting a layer, and lists the keys that switch to it (spec §7.2). */
function DeleteLayerDialog({
  layer,
  references,
  onDelete,
  onClose,
}: {
  layer: LayerConfig;
  /** "Layer: Key" for each key that switches to this layer. */
  references: string[];
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete layer "{layer.name ?? layer.id}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {references.length === 0
              ? "No key switches to this layer. Undo brings it back."
              : "These keys switch to this layer. They become transparent. Undo brings everything back."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {references.length > 0 && (
          <ul aria-label="References" className="list-disc pl-5 text-sm">
            {references.map((reference) => (
              <li key={reference}>{reference}</li>
            ))}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={onDelete}>
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A small button with only an icon; `label` is its name for screen readers and its tooltip. */
function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/**
 * A layer id from its name: lower case ASCII, words joined by "-" ("Alt nav" → "alt-nav"), with a
 * number added if the id is taken. Ids stay fixed when the layer is renamed.
 */
export function newLayerId(name: string, layers: LayerConfig[]): string {
  const base = slugify(name, "layer");
  let id = base;
  for (let n = 2; layers.some((layer) => layer.id === id); n++) {
    id = `${base}-${n}`;
  }
  return id;
}

/** The screen title with a line below it, for the loading and failed states. */
