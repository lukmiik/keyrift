// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { StatusTone } from "./StatusDot.tsx";
import { type PillState, StatusPill } from "./StatusPill.tsx";

afterEach(cleanup);

describe("StatusPill", () => {
  it.each<[PillState, string]>([
    ["connecting", "Connecting…"],
    ["offline", "Not connected"],
    ["running", "Active"],
    ["paused", "Paused"],
    ["released", "Released (emergency)"],
    ["error", "Error"],
  ])("shows %s as %s", (state, label) => {
    render(<StatusPill state={state} />);
    expect(screen.getByRole("status").textContent).toBe(label);
  });

  it("renders a reason", () => {
    render(<StatusPill state={"offline"} reason={"test reason"} />);
    expect(screen.getByRole("status").textContent).toBe("Not connected (test reason)");
  });

  it.each<[PillState, StatusTone]>([
    ["connecting", "waiting"],
    ["offline", "problem"],
    ["running", "good"],
    ["paused", "waiting"],
    ["released", "problem"],
    ["error", "problem"],
  ])("renders for %s state the %s dot", (state, tone) => {
    render(<StatusPill state={state} />);
    expect(screen.getByRole("status").getAttribute("data-tone")).toBe(tone);
  });
});
