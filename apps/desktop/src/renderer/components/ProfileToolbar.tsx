/**
 * The open profile's undo/redo and save status, shown in the header next to the profile selector:
 * they belong to the profile, not to one screen (Keymap and Shortcuts edit the same profile). Also
 * the message a screen shows while the profile can't be edited.
 */
import { Check, LoaderCircle, Redo2, TriangleAlert, Undo2 } from "lucide-react";
import type { ReactNode } from "react";

import type { ProfileEditor } from "../config/useProfileEditor.ts";
import { ScreenTitle } from "./ScreenTitle.tsx";
import { Button } from "./ui/button.tsx";

export type ReadyProfile = Extract<ProfileEditor, { status: "ready" }>;

/** Undo, Redo and the save status; nothing while the profile isn't loaded. */
export function ProfileToolbar({ profile }: { profile: ProfileEditor }) {
  if (profile.status !== "ready") return null;
  const { editor, dispatch, save } = profile;
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Undo"
        title="Undo"
        disabled={editor.past.length === 0}
        onClick={() => dispatch({ type: "undo" })}
      >
        <Undo2 />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Redo"
        title="Redo"
        disabled={editor.future.length === 0}
        onClick={() => dispatch({ type: "redo" })}
      >
        <Redo2 />
      </Button>
      <SaveStatus save={save} />
    </div>
  );
}

/** The screen while the profile is loading or failed to load; null once it is ready. */
export function ProfileUnavailable({
  title,
  profile,
}: {
  title: string;
  profile: ProfileEditor;
}): ReactNode {
  if (profile.status === "ready") return null;
  return (
    <section className="flex flex-col gap-4">
      <ScreenTitle title={title} />
      <p className="text-sm text-muted-foreground">
        {profile.status === "loading" ? (
          "Loading the profile…"
        ) : (
          <span className="text-destructive">
            Cannot open {profile.problem.file}: {profile.problem.message}
          </span>
        )}
      </p>
    </section>
  );
}

/**
 * "Saved", "Saving…" or why saving failed. `aria-live` makes screen readers announce changes (not
 * `role="status"`: that is the engine pill's role in the header).
 */
function SaveStatus({ save }: { save: ReadyProfile["save"] }) {
  if (save === "saved" || save === "unsaved") {
    const saving = save === "unsaved";
    return (
      <span
        aria-live="polite"
        className="ml-1 flex items-center gap-1 text-sm text-muted-foreground"
      >
        {saving ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
        {saving ? "Saving…" : "Saved"}
      </span>
    );
  }
  return (
    <span
      aria-live="polite"
      // The whole message as a tooltip: the header has little room.
      title={save.problem.message}
      className="ml-1 flex max-w-64 items-center gap-1 truncate text-sm text-destructive"
    >
      <TriangleAlert className="size-3.5 shrink-0" />
      <span className="truncate">Not saved: {save.problem.message}</span>
    </span>
  );
}
