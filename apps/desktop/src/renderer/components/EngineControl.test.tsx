// @vitest-environment happy-dom
import type { LayerConfig } from "@keyrift/config-types";
import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { EngineApi } from "../../shared/api.ts";
import { useEngineStatus } from "../engine/useEngineStatus.ts";
import { FakeEngine, fakeStatus } from "../testing/fake-engine.ts";
import { EngineControl } from "./EngineControl.tsx";

afterEach(cleanup);

/** The control with the engine status read by the hook, as App does. */
function Panel({ engine, layers }: { engine: EngineApi; layers?: LayerConfig[] }) {
  return <EngineControl engine={engine} {...useEngineStatus(engine)} layers={layers} />;
}

describe("EngineControl", () => {
  it("shows the engine's state and the keyboards it remaps", async () => {
    const engine = new FakeEngine();
    render(<Panel engine={engine} />);

    // findBy… waits until the element appears: the hook asks the (fake) engine first.
    expect((await screen.findByText("Active")).getAttribute("role")).toBe("status");
    expect(screen.getByText("1 keyboard")).toBeDefined();
    expect(engine.calls).toEqual(["subscribe", "status.get"]);
    expect(engine.subscribedTopics).toEqual(["status", "layer", "devices"]);
  });

  it("shows the top active layer by name, with the whole stack as tooltip", async () => {
    const engine = new FakeEngine({ status: fakeStatus({ activeLayers: ["base", "alt-nav"] }) });
    render(
      <Panel
        engine={engine}
        layers={[
          { id: "base", name: "Base" },
          { id: "alt-nav", name: "Alt nav" },
        ]}
      />,
    );

    const label = await screen.findByText("Alt nav layer");
    expect(label.getAttribute("title")).toBe("Active layers: Base → Alt nav");
  });

  it("shows layer ids when the profile has no names for them", async () => {
    render(<Panel engine={new FakeEngine()} />);
    expect(await screen.findByText("base layer")).toBeDefined();
  });

  it("follows devices being plugged in", async () => {
    const engine = new FakeEngine();
    render(<Panel engine={engine} />);
    await screen.findByText("1 keyboard");

    act(() => engine.setKeyboards(2));
    // findBy… waits: after the event the page asks the engine for the new status.
    expect(await screen.findByText("2 keyboards")).toBeDefined();
  });

  it("follows layer changes from the layer event alone", async () => {
    const engine = new FakeEngine();
    function Layers() {
      return <span>{useEngineStatus(engine).status?.activeLayers.join(", ")}</span>;
    }
    render(<Layers />);
    await screen.findByText("base");

    act(() => engine.setLayers(["base", "alt-nav"]));
    expect(screen.getByText("base, alt-nav")).toBeDefined();
    // Updated from the event, without asking the engine again.
    expect(engine.calls).toEqual(["subscribe", "status.get"]);
  });

  it("pauses and resumes the engine", async () => {
    const engine = new FakeEngine();
    render(<Panel engine={engine} />);
    const user = userEvent.setup();

    const remapping = await screen.findByRole("switch", { name: "Remapping" });
    expect(remapping.getAttribute("aria-checked")).toBe("true");
    await user.click(remapping);
    expect(engine.calls).toContain("engine.pause");
    expect(screen.getByRole("status").textContent).toBe("Paused");
    expect(remapping.getAttribute("aria-checked")).toBe("false");
    expect(remapping.getAttribute("title")).toBe("Resume remapping");

    await user.click(remapping);
    expect(screen.getByRole("status").textContent).toBe("Active");
  });

  it("follows status events from the engine", async () => {
    const engine = new FakeEngine();
    render(<Panel engine={engine} />);
    await screen.findByText("Active");

    // act(): a change from outside React; wait for React to redraw before checking.
    act(() => engine.setStatus({ state: "released" }));
    expect(screen.getByRole("status").textContent).toBe("Released (emergency)");
    const remapping = screen.getByRole("switch", { name: "Remapping" });
    expect(remapping.getAttribute("title")).toBe("Resume remapping");
    expect(remapping.hasAttribute("data-disabled")).toBe(false);
  });

  it("shows a failed pause", async () => {
    const engine = new FakeEngine();
    engine.failNextToggle = "uinput is gone";
    render(<Panel engine={engine} />);

    await userEvent.setup().click(await screen.findByRole("switch", { name: "Remapping" }));
    expect(screen.getByRole("alert").textContent).toBe("uinput is gone");
    expect(screen.getByRole("status").textContent).toBe("Active");
  });

  it("disables the switch without an engine", async () => {
    const engine = new FakeEngine();
    render(<Panel engine={engine} />);
    await screen.findByText("Active");

    act(() => engine.disconnect());
    expect(screen.getByRole("status").textContent).toBe("Not connected (the engine stopped)");
    const remapping = screen.getByRole("switch", { name: "Remapping" });
    expect(remapping.hasAttribute("data-disabled")).toBe(true);
  });

  it("stops listening when it goes away", async () => {
    const engine = new FakeEngine();
    const { unmount } = render(<Panel engine={engine} />);
    await screen.findByText("Active");

    unmount();
    expect(engine.listenerCount).toBe(0);
  });
});
