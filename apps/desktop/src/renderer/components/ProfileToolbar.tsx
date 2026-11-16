/**
 * The parts the Keymap and Shortcuts screens share: the screen's heading with the open profile's
 * file, save status and undo/redo, and the message shown while the profile can't be edited.
 */
import { Redo2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";

import type { ProfileEditor } from "../config/useProfileEditor.ts";
import { Button } from "./ui/button.tsx";

export type ReadyProfile = Extract<ProfileEditor, { status: "ready" }>;

/** Heading plus "Profile daily · profiles/daily.json", save status, Undo and Redo. */
export function ProfileToolbar({ title, profile }: { title: string; profile: ReadyProfile }) {
  const { name, editor, dispatch, save } = profile;
  return (
    <>
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="flex items-center gap-2">
        <p className="mr-auto text-sm">
          Profile <span className="font-medium">{name}</span>
          <span className="text-muted-foreground"> · profiles/{name}.json</span>
        </p>
        <SaveStatus save={save} />
        <Button
          variant="outline"
          size="sm"
          disabled={editor.past.length === 0}
          onClick={() => dispatch({ type: "undo" })}
        >
          <Undo2 /> Undo
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={editor.future.length === 0}
          onClick={() => dispatch({ type: "redo" })}
        >
          <Redo2 /> Redo
        </Button>
      </div>
    </>
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
      <h1 className="text-xl font-semibold">{title}</h1>
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
  if (save === "saved") {
    return (
      <span aria-live="polite" className="text-sm text-muted-foreground">
        Saved
      </span>
    );
  }
  if (save === "unsaved") {
    return (
      <span aria-live="polite" className="text-sm text-muted-foreground">
        Saving…
      </span>
    );
  }
  return (
    <span aria-live="polite" className="text-sm text-destructive">
      Not saved: {save.problem.message}
    </span>
  );
}
