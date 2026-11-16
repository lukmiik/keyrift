/**
 * React hook that loads a profile into the editor reducer and saves every change automatically, a
 * short pause after the last edit (spec §7.2: "saved automatically (debounced)").
 */
import type { Profile } from "@keyrift/config-types";
import { useEffect, useReducer, useState } from "react";

import type { ConfigApi, ConfigProblem } from "../../shared/api.ts";
import {
  type EditorAction,
  editorReducer,
  type EditorState,
  initialEditorState,
} from "./editor.ts";

/** How long after the last edit the profile is saved. */
export const AUTOSAVE_MS = 500;

export type ProfileEditor =
  | { status: "loading" }
  | { status: "failed"; problem: ConfigProblem }
  | {
      status: "ready";
      /** File name of the profile, e.g. "daily" for `profiles/daily.json`. */
      name: string;
      editor: EditorState;
      /** Sends an edit, undo or redo to the reducer. */
      dispatch: (action: EditorAction) => void;
      /** "saved", "unsaved" (waiting for the pause or the disk), or why the last save failed. */
      save: "saved" | "unsaved" | { problem: ConfigProblem };
      /**
       * Saves now instead of after the pause, e.g. before switching or renaming the profile.
       * Resolves to false if saving failed.
       */
      flush: () => Promise<boolean>;
    };

/** Used when the profile file doesn't exist yet: just a base layer, every key unchanged. */
const NEW_PROFILE: Profile = { version: 1, layers: [{ id: "base", name: "Base", keys: {} }] };

/** What loading found, tagged with the profile it belongs to. */
type Loaded = { name: string; problem: ConfigProblem | null };

/** Edits profile `name` (null: not known yet, shows "loading"). Loads again when `name` changes. */
export function useProfileEditor(config: ConfigApi, name: string | null): ProfileEditor {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [editor, dispatch] = useReducer(editorReducer, NEW_PROFILE, initialEditorState);
  // The version that is on disk. Compared by identity: the reducer makes a new object per change.
  const [saved, setSaved] = useState<Profile | null>(null);
  const [saveProblem, setSaveProblem] = useState<ConfigProblem | null>(null);

  // Load the profile; again whenever `name` changes.
  useEffect(() => {
    if (name === null) return;
    let active = true; // Same pattern as useEngineStatus: ignore answers after cleanup.
    void config.readProfile(name).then((read) => {
      if (!active) return;
      if (!read.ok) {
        setLoaded({ name, problem: read.problem });
        return;
      }
      const profile = read.value ?? NEW_PROFILE;
      dispatch({ type: "load", profile });
      // A missing file counts as unsaved, so the new profile gets written after the pause.
      setSaved(read.value === null ? null : profile);
      setSaveProblem(null);
      setLoaded({ name, problem: null });
    });
    return () => {
      active = false;
    };
  }, [config, name]);

  // Until the new profile has loaded, the reducer still holds the old one: treat it as loading,
  // and never save it under the new name.
  const ready = loaded !== null && loaded.name === name && loaded.problem === null;
  const present = editor.present;

  // Autosave: every change of `present` restarts the timer, because React runs the cleanup
  // (clearTimeout) before running the effect again. So it only fires after a pause in editing.
  useEffect(() => {
    if (!ready || name === null || present === saved) {
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void config.saveProfile(name, present).then((outcome) => {
        if (!active) return;
        if (outcome.ok) {
          setSaved(present);
          setSaveProblem(null);
        } else {
          setSaveProblem(outcome.problem);
        }
      });
    }, AUTOSAVE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [config, name, present, ready, saved]);

  if (loaded === null || loaded.name !== name || name === null) {
    return { status: "loading" };
  }
  if (loaded.problem !== null) {
    return { status: "failed", problem: loaded.problem };
  }

  async function flush(): Promise<boolean> {
    if (name === null || present === saved) return true;
    const outcome = await config.saveProfile(name, present);
    if (!outcome.ok) {
      setSaveProblem(outcome.problem);
      return false;
    }
    setSaved(present);
    setSaveProblem(null);
    return true;
  }

  return {
    status: "ready",
    name,
    editor,
    dispatch,
    save: saveProblem !== null ? { problem: saveProblem } : present === saved ? "saved" : "unsaved",
    flush,
  };
}
