// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { TopBar } from "./TopBar.tsx";

afterEach(cleanup);

describe("TopBar", () => {
  it("shows its children", () => {
    render(
      <TopBar>
        <span>undo and redo</span>
      </TopBar>,
    );
    expect(screen.getByText("undo and redo")).toBeDefined();
  });
});
