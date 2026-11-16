/**
 * The profile selector in the header (spec §7.1): switch the active profile, and create, rename,
 * duplicate or delete one. Every change saves the open profile first, so no edit is lost or
 * written under the wrong name.
 */
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import type { ConfigApi, ConfigOutcome } from "../../shared/api.ts";
import type { Profiles } from "../config/useProfiles.ts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog.tsx";
import { slugify } from "../config/slug.ts";
import { NameDialog } from "./NameDialog.tsx";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";

type ProfileMenuProps = {
  config: ConfigApi;
  profiles: Profiles;
  /** Saves the open profile's pending edits now. Resolves to false if that failed. */
  saveFirst: () => Promise<boolean>;
};

/** Which dialog is open. */
type OpenDialog = "create" | "duplicate" | "rename" | "delete" | null;

/** One change to the config folder, run by `apply`. */
type Step = () => Promise<ConfigOutcome<null>>;

export function ProfileMenu({ config, profiles, saveFirst }: ProfileMenuProps) {
  const [dialog, setDialog] = useState<OpenDialog>(null);
  // Why switching failed (the dialogs show their own errors).
  const [error, setError] = useState<string | null>(null);
  const { names, active } = profiles;
  if (active === null) {
    return null;
  }
  // The profile to switch to before deleting the active one.
  const other = names.find((name) => name !== active);

  /**
   * Saves the open profile, then runs `steps` in order and stops at the first problem. Reloads
   * the profile list either way. Resolves to the problem as text, or null if all went well.
   */
  async function apply(...steps: Step[]): Promise<string | null> {
    if (!(await saveFirst())) {
      return "The open profile couldn't be saved, so nothing was changed.";
    }
    let failed: string | null = null;
    for (const step of steps) {
      const outcome = await step();
      if (!outcome.ok) {
        failed = `${outcome.problem.file}: ${outcome.problem.message}`;
        break;
      }
    }
    await profiles.refresh();
    return failed;
  }

  async function switchTo(name: string): Promise<void> {
    setError(await apply(() => config.setActiveProfile(name)));
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          Profile: {active} <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuRadioGroup value={active} onValueChange={(name) => void switchTo(name)}>
            {names.map((name) => (
              <DropdownMenuRadioItem key={name} value={name}>
                {name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDialog("create")}>New profile…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("duplicate")}>Duplicate…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("rename")}>Rename…</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            // The active profile is deleted after switching to another, so one must exist.
            disabled={other === undefined}
            onClick={() => setDialog("delete")}
          >
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error !== null && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}

      {/* Each dialog is only on the page while open, so it starts with fresh state each time. */}
      {dialog === "create" && (
        <NameDialog
          title="New profile"
          description="A profile with an empty base layer: every key does its normal thing."
          submitLabel="Create"
          initialName=""
          hint={fileHint}
          onSubmit={(name) =>
            apply(
              () => config.createProfile(fileName(name), name, null),
              () => config.setActiveProfile(fileName(name)),
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "duplicate" && (
        <NameDialog
          title={`Duplicate "${active}"`}
          description="A copy of this profile under a new name. The copy becomes active."
          submitLabel="Duplicate"
          initialName={`${active} copy`}
          hint={fileHint}
          onSubmit={(name) =>
            apply(
              () => config.createProfile(fileName(name), name, active),
              () => config.setActiveProfile(fileName(name)),
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "rename" && (
        <NameDialog
          title={`Rename "${active}"`}
          description={`The profile's name and its file (now profiles/${active}.json) change.`}
          submitLabel="Rename"
          initialName={active}
          hint={fileHint}
          onSubmit={(name) => apply(() => config.renameProfile(active, fileName(name), name))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && other !== undefined && (
        <AlertDialog open onOpenChange={(open) => !open && setDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete profile "{active}"?</AlertDialogTitle>
              <AlertDialogDescription>
                profiles/{active}.json is deleted and "{other}" becomes active. This can't be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={() =>
                  void apply(
                    () => config.setActiveProfile(other),
                    () => config.deleteProfile(active),
                  ).then((failed) => {
                    setError(failed);
                    setDialog(null);
                  })
                }
              >
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

/**
 * The file a profile named `name` is saved as (without `.json`), like layer ids: "Daily" → "daily",
 * "Work & play" → "work-play". The name itself is kept in the file's `name` field.
 */
export function fileName(name: string): string {
  return slugify(name, "profile");
}

function fileHint(name: string): string {
  return name === "" ? "" : `Saved as profiles/${fileName(name)}.json`;
}
