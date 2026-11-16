import { describe, expect, it } from "vite-plus/test";

import { editorReducer, HISTORY_LIMIT, initialEditorState, type EditorAction } from "./editor.ts";
import { testProfile } from "./test-profile.ts";

/** Runs `actions` through the reducer one after another, like React would. */
function run(actions: EditorAction[]) {
  return actions.reduce(editorReducer, initialEditorState(testProfile()));
}

const addNum: EditorAction = { type: "edit", edit: { type: "addLayer", id: "num", name: "Num" } };
const removeNav: EditorAction = { type: "edit", edit: { type: "removeLayer", layerId: "nav" } };

/** The layer ids of the profile the editor shows. */
function layerIds(state: ReturnType<typeof run>): string[] | undefined {
  return state.present.layers?.map((layer) => layer.id);
}

describe("editorReducer", () => {
  it("applies an edit and remembers the previous version", () => {
    const state = run([addNum]);

    expect(layerIds(state)).toEqual(["base", "nav", "num"]);
    expect(state.past).toHaveLength(1);
    expect(state.future).toEqual([]);
  });

  it("adds no undo step for an edit that changes nothing", () => {
    const before = run([addNum]);
    const after = editorReducer(before, addNum); // "num" exists now

    expect(after).toBe(before);
  });

  it("undoes and redoes", () => {
    const undone = run([addNum, removeNav, { type: "undo" }]);
    expect(layerIds(undone)).toEqual(["base", "nav", "num"]);

    const twiceUndone = editorReducer(undone, { type: "undo" });
    expect(layerIds(twiceUndone)).toEqual(["base", "nav"]);

    const redone = editorReducer(twiceUndone, { type: "redo" });
    expect(layerIds(redone)).toEqual(["base", "nav", "num"]);
  });

  it("forgets the undone versions after a new edit", () => {
    const state = run([addNum, { type: "undo" }, removeNav]);

    expect(layerIds(state)).toEqual(["base"]);
    expect(state.future).toEqual([]);
    expect(editorReducer(state, { type: "redo" })).toBe(state);
  });

  it("does nothing when there is nothing to undo or redo", () => {
    const start = run([]);
    expect(editorReducer(start, { type: "undo" })).toBe(start);
    expect(editorReducer(start, { type: "redo" })).toBe(start);
  });

  it(`keeps at most ${HISTORY_LIMIT} undo steps`, () => {
    // Map a key on and off again many times: every edit changes the profile.
    const actions: EditorAction[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      actions.push({
        type: "edit",
        edit: {
          type: "setKey",
          layerId: "nav",
          key: "KEY_H",
          action: i % 2 === 0 ? { type: "none" } : { type: "key", key: "KEY_LEFT" },
        },
      });
    }

    expect(run(actions).past).toHaveLength(HISTORY_LIMIT);
  });

  it("starts over when a profile is loaded", () => {
    const loaded = testProfile();
    const state = editorReducer(run([addNum, removeNav]), { type: "load", profile: loaded });

    expect(state).toEqual({ past: [], present: loaded, future: [] });
  });
});
