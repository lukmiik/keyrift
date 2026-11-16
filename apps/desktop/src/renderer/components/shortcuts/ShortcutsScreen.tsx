/**
 * The Shortcuts screen (spec §7.3, F-SC-1): the open profile's rules, trigger → output. Rules are
 * added and edited in a dialog; rules with the same trigger are flagged, because the engine
 * rejects such a profile.
 */
import type { LayerConfig, ShortcutConfig } from "@keyrift/config-types";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";

import type { EngineApi } from "../../../shared/api.ts";
import { duplicateOf, triggerLabel } from "../../config/shortcuts.ts";
import type { ProfileEditor } from "../../config/useProfileEditor.ts";
import { useRecorder } from "../../engine/useRecorder.ts";
import { actionLabel } from "../../keyboard/actions.ts";
import { ProfileToolbar, ProfileUnavailable } from "../ProfileToolbar.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { ShortcutDialog } from "./ShortcutDialog.tsx";

type ShortcutsScreenProps = {
  profile: ProfileEditor;
  engine: EngineApi;
};

/** The rule a new one starts as: the spec's example trigger, sending the key itself. */
const NEW_SHORTCUT: ShortcutConfig = {
  trigger: { mods: ["Super"], key: "KEY_C" },
  action: { type: "key", key: "KEY_C" },
};

/** Which dialog is open: adding, or editing rule `index`. */
type OpenDialog = { adding: true } | { adding: false; index: number } | null;

export function ShortcutsScreen({ profile, engine }: ShortcutsScreenProps) {
  const recorder = useRecorder(engine);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  if (profile.status !== "ready") {
    return <ProfileUnavailable title="Shortcuts" profile={profile} />;
  }
  const { editor, dispatch } = profile;
  const shortcuts = editor.present.shortcuts ?? [];
  const layers: LayerConfig[] = editor.present.layers ?? [];
  const duplicates = duplicateOf(shortcuts);

  return (
    <section className="flex flex-col gap-4">
      <ProfileToolbar title="Shortcuts" profile={profile} />
      <p className="text-sm text-muted-foreground">
        A rule replaces a key pressed with exactly the trigger's modifiers held. It applies to keys
        that send a plain key after the keymap (including unchanged keys); the first matching rule
        wins.
      </p>
      <div>
        <Button variant="outline" size="sm" onClick={() => setDialog({ adding: true })}>
          <Plus /> Add shortcut
        </Button>
      </div>

      {shortcuts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No shortcuts in this profile yet.</p>
      ) : (
        <table aria-label="Shortcuts" className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="w-10 py-2 font-normal">#</th>
              <th className="py-2 font-normal">Trigger</th>
              <th className="py-2 font-normal">Output</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {shortcuts.map((shortcut, index) => {
              const duplicate = duplicates[index] ?? null;
              return (
                // Rules have no id; the index is the rule's number on screen.
                <tr
                  key={index}
                  className={cn("border-b", duplicate !== null ? "bg-destructive/10" : "")}
                >
                  <td className="py-2 text-muted-foreground">{index + 1}</td>
                  <td className="py-2">
                    <span className="font-medium">{triggerLabel(shortcut.trigger)}</span>
                    {duplicate !== null && (
                      <Badge variant="destructive" className="ml-2">
                        Same trigger as rule {duplicate + 1}
                      </Badge>
                    )}
                  </td>
                  <td className="py-2">{actionLabel(shortcut.action, layers)}</td>
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit rule ${index + 1}`}
                      onClick={() => setDialog({ adding: false, index })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete rule ${index + 1}`}
                      onClick={() =>
                        dispatch({ type: "edit", edit: { type: "removeShortcut", index } })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {duplicates.some((d) => d !== null) && (
        <p className="text-sm text-destructive">
          The engine rejects a profile with two rules for the same trigger, and keeps using the last
          valid one. Change or delete one of them.
        </p>
      )}

      {dialog !== null && (
        <ShortcutDialog
          title={dialog.adding ? "Add shortcut" : `Edit rule ${dialog.index + 1}`}
          initial={dialog.adding ? NEW_SHORTCUT : (shortcuts[dialog.index] ?? NEW_SHORTCUT)}
          shortcuts={shortcuts}
          editing={dialog.adding ? null : dialog.index}
          layers={layers}
          recorder={recorder}
          onSave={(shortcut) =>
            dispatch({
              type: "edit",
              edit: dialog.adding
                ? { type: "addShortcut", shortcut }
                : { type: "setShortcut", index: dialog.index, shortcut },
            })
          }
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
