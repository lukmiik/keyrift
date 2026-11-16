// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { FakeConfig } from "../testing/fake-config.ts";
import type { ProfileEdit } from "./profile-edits.ts";
import { testProfile } from "./test-profile.ts";
import { AUTOSAVE_MS, type ProfileEditor, useProfileEditor } from "./useProfileEditor.ts";

// Fake timers: the test moves the clock itself, so "500 ms later" takes no real time.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const addNum: ProfileEdit = { type: "addLayer", id: "num", name: "Num" };

/** Renders the hook for profile `name` and waits until it is loaded. */
async function renderEditor(config: FakeConfig, name = "daily") {
  // `initialProps` and `rerender` let a test change the hook's argument, like a parent would.
  const hook = renderHook((props: { name: string }) => useProfileEditor(config, props.name), {
    initialProps: { name },
  });
  // Not `waitFor`: it polls with timers, which are fake here. Loading needs no timer, only the
  // fake config's promises, so running the queued promise callbacks is enough.
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(hook.result.current.status).toBe("ready");
  return hook;
}

/** The hook's current value, which must be "ready". */
function ready(editor: ProfileEditor) {
  if (editor.status !== "ready") throw new Error(`editor is ${editor.status}`);
  return editor;
}

describe("useProfileEditor", () => {
  it("loads the active profile", async () => {
    const config = new FakeConfig({ daily: testProfile() });
    const { result } = await renderEditor(config);

    const editor = ready(result.current);
    expect(editor.name).toBe("daily");
    expect(editor.editor.present).toEqual(testProfile());
    expect(editor.save).toBe("saved");
  });

  it("saves once, a pause after the last edit", async () => {
    const config = new FakeConfig({ daily: testProfile() });
    const { result } = await renderEditor(config);

    act(() => ready(result.current).dispatch({ type: "edit", edit: addNum }));
    expect(ready(result.current).save).toBe("unsaved");
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS / 2));
    act(() => ready(result.current).dispatch({ type: "undo" }));
    act(() => ready(result.current).dispatch({ type: "redo" }));
    expect(config.saves).toEqual([]); // still editing: each change restarted the timer

    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS));
    expect(config.saves).toHaveLength(1);
    expect(config.saves[0]?.profile.layers?.map((layer) => layer.id)).toEqual([
      "base",
      "nav",
      "num",
    ]);
    expect(ready(result.current).save).toBe("saved");
  });

  it("creates a profile file that doesn't exist yet", async () => {
    const config = new FakeConfig();
    const { result } = await renderEditor(config);
    expect(ready(result.current).save).toBe("unsaved");

    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS));
    expect(config.saves.map((save) => save.name)).toEqual(["daily"]);
  });

  it("reports a failed save", async () => {
    const config = new FakeConfig({ daily: testProfile() });
    config.saveProblem = { file: "profiles/daily.json", message: "disk full", issues: [] };
    const { result } = await renderEditor(config);

    act(() => ready(result.current).dispatch({ type: "edit", edit: addNum }));
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS));
    expect(ready(result.current).save).toEqual({ problem: config.saveProblem });
  });

  it("doesn't save a profile that wasn't changed", async () => {
    const config = new FakeConfig({ daily: testProfile() });
    await renderEditor(config);
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 100));
    expect(config.saves).toEqual([]);
  });

  it("loads another profile when the name changes, and never saves the old one under it", async () => {
    const config = new FakeConfig({ daily: testProfile(), work: { version: 1, name: "work" } });
    const { result, rerender } = await renderEditor(config);
    act(() => ready(result.current).dispatch({ type: "edit", edit: addNum }));

    rerender({ name: "work" });
    expect(result.current.status).toBe("loading");
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2));

    expect(ready(result.current).name).toBe("work");
    expect(ready(result.current).editor.present).toEqual({ version: 1, name: "work" });
    expect(config.saves).toEqual([]);
  });

  it("saves at once on flush", async () => {
    const config = new FakeConfig({ daily: testProfile() });
    const { result } = await renderEditor(config);
    act(() => ready(result.current).dispatch({ type: "edit", edit: addNum }));

    let flushed = false;
    await act(async () => {
      flushed = await ready(result.current).flush();
    });
    expect(flushed).toBe(true);
    expect(config.saves).toHaveLength(1);
    expect(ready(result.current).save).toBe("saved");

    // Nothing left for the timer to save.
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2));
    expect(config.saves).toHaveLength(1);
  });
});
