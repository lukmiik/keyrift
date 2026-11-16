// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { FakeEngine, fakeStatus } from "../testing/fake-engine.ts";
import { StatusHeader } from "./StatusHeader.tsx";

afterEach(cleanup);

describe("StatusHeader", () => {
  it("shows the engine's state, layers and devices, and its children", async () => {
    const engine = new FakeEngine({ status: fakeStatus({ activeLayers: ["base", "nav"] }) });
    render(
      <StatusHeader engine={engine}>
        <span>profile selector</span>
      </StatusHeader>,
    );

    // findBy… waits until the element appears: the hook asks the (fake) engine first.
    expect((await screen.findByText("Running")).getAttribute("role")).toBe("status");
    expect(screen.getByText("profile selector")).toBeDefined();
    expect(screen.getByText("Layers: base, nav")).toBeDefined();
    expect(screen.getByText("3 input devices grabbed")).toBeDefined();
    expect(engine.calls).toEqual(["subscribe", "status.get"]);
    expect(engine.subscribedTopics).toEqual(["status", "layer", "devices"]);
  });

  it("follows layer changes", async () => {
    const engine = new FakeEngine();
    render(<StatusHeader engine={engine} />);
    await screen.findByText("Layers: base");

    act(() => engine.setLayers(["base", "alt-nav"]));
    expect(screen.getByText("Layers: base, alt-nav")).toBeDefined();
    // Updated from the event alone, without asking the engine again.
    expect(engine.calls).toEqual(["subscribe", "status.get"]);
  });

  it("follows devices being plugged in", async () => {
    const engine = new FakeEngine();
    render(<StatusHeader engine={engine} />);
    await screen.findByText("3 input devices grabbed");

    act(() => engine.setGrabbed(6));
    // findBy… waits: after the event the page asks the engine for the new status.
    expect(await screen.findByText("6 input devices grabbed")).toBeDefined();
  });

  it("pauses and resumes the engine", async () => {
    const engine = new FakeEngine();
    render(<StatusHeader engine={engine} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Pause" }));
    expect(engine.calls).toContain("engine.pause");
    expect(screen.getByRole("status").textContent).toBe("Paused");

    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByRole("status").textContent).toBe("Running");
  });

  it("follows status events from the engine", async () => {
    const engine = new FakeEngine();
    render(<StatusHeader engine={engine} />);
    await screen.findByText("Running");

    // act(): a change from outside React; wait for React to redraw before checking.
    act(() => engine.setStatus({ state: "released" }));
    expect(screen.getByRole("status").textContent).toBe("Released (emergency)");
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  });

  it("shows a failed pause", async () => {
    const engine = new FakeEngine();
    engine.failNextToggle = "uinput is gone";
    render(<StatusHeader engine={engine} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Pause" }));
    expect(screen.getByRole("alert").textContent).toBe("uinput is gone");
    expect(screen.getByRole("status").textContent).toBe("Running");
  });

  it("disables the toggle without an engine", async () => {
    const engine = new FakeEngine();
    render(<StatusHeader engine={engine} />);
    await screen.findByText("Running");

    act(() => engine.disconnect());
    expect(screen.getByRole("status").textContent).toBe("Not connected (the engine stopped)");
    expect(screen.getByRole("button", { name: "Pause" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/Profile:/)).toBeNull();
  });

  it("stops listening when it goes away", async () => {
    const engine = new FakeEngine();
    const { unmount } = render(<StatusHeader engine={engine} />);
    await screen.findByText("Running");

    unmount();
    expect(engine.listenerCount).toBe(0);
  });
});
