/**
 * The profile being edited plus its undo/redo history (spec §7.2: "an undo/redo stack is kept for
 * the session"). `editorReducer` is the one function every change goes through; React's
 * `useReducer` calls it (step 8c).
 */
import type { Profile } from "@keyrift/config-types";

import { applyEdit, type ProfileEdit } from "./profile-edits.ts";

/** How many steps undo can go back; older versions are dropped. */
export const HISTORY_LIMIT = 100;

export type EditorState = {
  /** Earlier versions, oldest first. Undo goes back to the last one. */
  past: Profile[];
  /** The version shown and saved. */
  present: Profile;
  /** Versions that were undone, the next one to redo first. A new edit clears them. */
  future: Profile[];
};

/** Everything that can happen to the editor. */
export type EditorAction =
  | { type: "edit"; edit: ProfileEdit }
  | { type: "undo" }
  | { type: "redo" }
  /** A profile was (re)loaded from disk: start over with no history. */
  | { type: "load"; profile: Profile };

/** The editor right after loading `profile`. */
export function initialEditorState(profile: Profile): EditorState {
  return { past: [], present: profile, future: [] };
}

/**
 * Returns the editor state after `action`. Like `applyEdit`, it never changes `state`, and it
 * returns the same object when nothing changed (React then skips the redraw).
 */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "edit": {
      const next = applyEdit(state.present, action.edit);
      if (next === state.present) {
        return state; // Nothing changed: no new undo step.
      }
      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
      };
    }

    case "undo": {
      const previous = state.past.at(-1);
      if (previous === undefined) {
        return state;
      }
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
      };
    }

    case "redo": {
      const [next, ...rest] = state.future;
      if (next === undefined) {
        return state;
      }
      return { past: [...state.past, state.present], present: next, future: rest };
    }

    case "load":
      return initialEditorState(action.profile);
  }
}
