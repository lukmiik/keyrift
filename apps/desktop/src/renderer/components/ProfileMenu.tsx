/**
 * The profile selector at the bottom of the sidebar (spec §7.1), like the account switcher in
 * Slack or Linear: switch the active profile, and create, rename,
 * duplicate or delete one. Every change saves the open profile first, so no edit is lost or
 * written under the wrong name.
 */
import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import type { ConfigApi, ConfigOutcome, ProfileEntry } from "../../shared/api.ts";
import { displayName, type Profiles } from "../config/useProfiles.ts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog.tsx";
import { slugify } from "../../shared/slug.ts";
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
  const { list, active } = profiles;
  if (active === null) {
    return null;
  }
  // What the user called the active profile; `active` is its file name.
  const activeName = displayName(list, active);
  // The profile to switch to before deleting the active one.
  const other = list.find((entry) => entry.file !== active);

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

  /** Asks for a profile file and adds it; it becomes active, like a new profile. */
  async function importProfile(): Promise<void> {
    // The imported profile, or null if the dialog was cancelled (set by the first step).
    const imported: { entry: ProfileEntry | null } = { entry: null };
    setError(
      await apply(
        async () => {
          const outcome = await config.importProfile();
          if (!outcome.ok) return outcome;
          imported.entry = outcome.value;
          return { ok: true, value: null };
        },
        () => (imported.entry === null ? done() : config.setActiveProfile(imported.entry.file)),
      ),
    );
  }

  /** Asks where to save the active profile and writes it there (after saving pending edits). */
  async function exportProfile(file: string): Promise<void> {
    setError(
      await apply(async () => {
        const outcome = await config.exportProfile(file);
        return outcome.ok ? done() : outcome;
      }),
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          // The visible text is split in two lines; this names the button as one phrase.
          aria-label={`Profile: ${activeName}`}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted"
        >
          {/* The name's first letter, like an account's avatar. */}
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold uppercase"
          >
            {activeName.slice(0, 1)}
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium">{activeName}</span>
            <span className="text-xs text-muted-foreground">Profile</span>
          </span>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        {/* Opens upwards: the button is at the bottom of the window. */}
        <DropdownMenuContent side="top" className="w-56">
          <DropdownMenuRadioGroup value={active} onValueChange={(name) => void switchTo(name)}>
            {list.map((entry) => (
              <DropdownMenuRadioItem key={entry.file} value={entry.file}>
                {entry.name}
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
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void importProfile()}>Import…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void exportProfile(active)}>Export…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error !== null && (
        <span role="alert" className="block px-2 pt-1 text-xs text-destructive">
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
          title={`Duplicate "${activeName}"`}
          description="A copy of this profile under a new name. The copy becomes active."
          submitLabel="Duplicate"
          initialName={`${activeName} copy`}
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
          title={`Rename "${activeName}"`}
          description={`The profile's name and its file (now profiles/${active}.json) change.`}
          submitLabel="Rename"
          initialName={activeName}
          hint={fileHint}
          onSubmit={(name) => apply(() => config.renameProfile(active, fileName(name), name))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && other !== undefined && (
        <AlertDialog open onOpenChange={(open) => !open && setDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete profile "{activeName}"?</AlertDialogTitle>
              <AlertDialogDescription>
                profiles/{active}.json is deleted and "{other.name}" becomes active. This can't be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={() =>
                  void apply(
                    () => config.setActiveProfile(other.file),
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

/** A step that changes nothing, for `apply`. */
function done(): Promise<ConfigOutcome<null>> {
  return Promise.resolve({ ok: true, value: null });
}
