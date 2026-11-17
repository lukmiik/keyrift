/**
 * The Shortcuts screen (spec §7.3, F-SC-1): the open profile's rules, trigger → output. Rules are
 * added and edited in a dialog. Rules with the same trigger are flagged red, because the engine
 * rejects such a profile; rules that earlier rules always take first are flagged as never used.
 */
import type { LayerConfig, ShortcutConfig } from "@keyrift/config-types";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";

import type { EngineApi } from "../../../shared/api.ts";
import { duplicateOf, neverUsed, triggerLabel } from "../../config/shortcuts.ts";
import type { ProfileEditor } from "../../config/useProfileEditor.ts";
import { useRecorder } from "../../engine/useRecorder.ts";
import { actionLabel } from "../../keyboard/actions.ts";
import { ProfileUnavailable } from "../ProfileToolbar.tsx";
import { ScreenTitle } from "../ScreenTitle.tsx";
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
  const unused = neverUsed(shortcuts);

  return (
    <section className="flex flex-col gap-4">
      <ScreenTitle title="Shortcuts" />
      <div className="flex items-start gap-6">
        <p className="flex-1 text-sm text-muted-foreground">
          Turn a key combination into another, e.g. Super+C into Ctrl+C. If two rules match, the
          higher one wins.
        </p>
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
              const takenBy = unused[index] ?? null;
              return (
                // Rules have no id; the index is the rule's number on screen.
                <tr
                  key={index}
                  className={cn(
                    "border-b",
                    duplicate !== null && "bg-destructive/10",
                    takenBy !== null && "bg-amber-500/10",
                  )}
                >
                  <td className="py-2 text-muted-foreground">{index + 1}</td>
                  <td className="py-2">
                    <span className="font-medium">{triggerLabel(shortcut.trigger)}</span>
                    {duplicate !== null && (
                      <Badge variant="destructive" className="ml-2">
                        Same trigger as rule {duplicate + 1}
                      </Badge>
                    )}
                    {takenBy !== null && (
                      <Badge
                        variant="outline"
                        className="ml-2 border-amber-500/50 text-amber-700 dark:text-amber-300"
                        title="The first matching rule wins, and these rules match every key press this one matches."
                      >
                        Never used: {rulesLabel(takenBy)} first
                      </Badge>
                    )}
                  </td>
                  <td className="py-2">{actionLabel(shortcut.action, layers)}</td>
                  <td className="py-2 text-right">
                    {/* The order decides which of two matching rules wins. */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move rule ${index + 1} up`}
                      title="Move up"
                      disabled={index === 0}
                      onClick={() =>
                        dispatch({
                          type: "edit",
                          edit: { type: "moveShortcut", index, to: index - 1 },
                        })
                      }
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move rule ${index + 1} down`}
                      title="Move down"
                      disabled={index === shortcuts.length - 1}
                      onClick={() =>
                        dispatch({
                          type: "edit",
                          edit: { type: "moveShortcut", index, to: index + 1 },
                        })
                      }
                    >
                      <ArrowDown />
                    </Button>
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

/** "rule 1 matches", "rules 1 and 2 match", "rules 1, 2 and 4 match" (0-based indexes in). */
function rulesLabel(indexes: readonly number[]): string {
  const numbers = indexes.map((i) => String(i + 1));
  if (numbers.length === 1) return `rule ${numbers[0]} matches`;
  return `rules ${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)} match`;
}
