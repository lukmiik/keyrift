/**
 * The Keymap screen (spec §7.2). For now it shows what the profile editor holds: the profile, its
 * layers with how many keys each remaps, undo/redo and whether the changes are on disk. The
 * keyboard drawing and the key editor come in step 11.
 */
import { Redo2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";

import type { ProfileEditor } from "../config/useProfileEditor.ts";
import { Button } from "./ui/button.tsx";

type KeymapScreenProps = {
  profile: ProfileEditor;
};

export function KeymapScreen({ profile }: KeymapScreenProps) {
  if (profile.status === "loading") {
    return <Heading>Loading the profile…</Heading>;
  }
  if (profile.status === "failed") {
    return (
      <Heading>
        <span className="text-destructive">
          Cannot open {profile.problem.file}: {profile.problem.message}
        </span>
      </Heading>
    );
  }

  const { name, editor, dispatch, save } = profile;
  const layers = editor.present.layers ?? [];
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Keymap</h1>
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
      <ul aria-label="Layers" className="flex flex-col gap-1">
        {layers.map((layer) => (
          <li key={layer.id} className="rounded-md border px-3 py-2 text-sm">
            <span className="font-medium">{layer.name ?? layer.id}</span>
            <span className="text-muted-foreground">
              {" "}
              · {countLabel(Object.keys(layer.keys ?? {}).length)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The screen title with a line below it, for the loading and failed states. */
function Heading({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Keymap</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </section>
  );
}

/**
 * "Saved", "Saving…" or why saving failed. `aria-live` makes screen readers announce changes (not
 * `role="status"`: that is the engine pill's role in the header).
 */
function SaveStatus({ save }: { save: Extract<ProfileEditor, { status: "ready" }>["save"] }) {
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

function countLabel(count: number): string {
  return count === 1 ? "1 key" : `${count} keys`;
}
