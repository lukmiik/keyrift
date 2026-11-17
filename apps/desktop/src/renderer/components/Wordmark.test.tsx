// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Wordmark } from "./Wordmark.tsx";

afterEach(cleanup);

describe("Wordmark", () => {
  it("is read as the app's name once, not as its two drawn halves", () => {
    render(<Wordmark />);
    expect(screen.getByRole("img", { name: "Keyrift" })).toBeDefined();
    const halves = screen.getAllByText("Keyrift");
    expect(halves.map((half) => half.getAttribute("aria-hidden"))).toEqual(["true", "true"]);
  });
});
