// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { type PillState, type PillVariant, StatusPill } from "./StatusPill.tsx";

afterEach(cleanup);

describe("StatusPill", () => {
  it.each<[PillState, string]>([
    ["connecting", "Connecting…"],
    ["offline", "Not connected"],
    ["running", "Running"],
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

  it.each<[PillState, PillVariant]>([
    ["connecting", "secondary"],
    ["offline", "secondary"],
    ["running", "default"],
    ["paused", "outline"],
    ["released", "destructive"],
    ["error", "destructive"],
  ])("renders for %s state variant %s", (state, variant) => {
    render(<StatusPill state={state} />);
    expect(screen.getByRole("status").getAttribute("data-variant")).toBe(variant);
  });
});
