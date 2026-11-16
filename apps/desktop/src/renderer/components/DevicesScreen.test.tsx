// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { DeviceGroup, DeviceMember } from "../../shared/protocol.ts";
import { FakeConfig } from "../testing/fake-config.ts";
import { FakeEngine } from "../testing/fake-engine.ts";
import { DevicesScreen } from "./DevicesScreen.tsx";

afterEach(cleanup);

function member(name: string, fields: Partial<DeviceMember> = {}): DeviceMember {
  return {
    path: `/dev/input/event-${name}`,
    name,
    isPointer: false,
    hasLetters: true,
    grabbed: true,
    blocked: null,
    ...fields,
  };
}

/** The HyperX keyboard from the spec: a keyboard node plus its media-key node. */
function hyperx(fields: Partial<DeviceGroup> = {}): DeviceGroup {
  return {
    key: "usb-0000:00:14.0-3",
    name: "HyperX Alloy",
    vendorId: "0x0951",
    productId: "0x16d2",
    kind: "keyboard",
    decision: "grab",
    members: [
      member("HyperX Alloy"),
      member("HyperX Alloy Consumer Control", { hasLetters: false }),
    ],
    ...fields,
  };
}

function mouse(): DeviceGroup {
  return {
    key: "usb-0000:00:14.0-4",
    name: "Razer DeathAdder",
    vendorId: "0x1532",
    productId: "0x0084",
    kind: "probablyMouse",
    decision: "hidden",
    members: [member("Razer DeathAdder", { grabbed: false, isPointer: true })],
  };
}

function renderScreen(engine: FakeEngine, config = new FakeConfig()) {
  render(<DevicesScreen engine={engine} config={config} />);
  return { engine, config };
}

/** The row of the device called `name`. */
async function row(name: string): Promise<HTMLElement> {
  const list = await screen.findByRole("list", { name: "Devices" });
  const item = within(list)
    .getAllByRole("listitem")
    .find((li) => li.textContent?.startsWith(name));
  if (item === undefined) throw new Error(`no row for ${name}`);
  return item;
}

describe("DevicesScreen", () => {
  it("shows a keyboard with its VID:PID, sub-devices and grab status", async () => {
    renderScreen(new FakeEngine({ devices: [hyperx()] }));

    const item = await row("HyperX Alloy");
    expect(item.textContent).toContain("0951:16d2");
    expect(item.textContent).toContain(
      "HyperX Alloy Consumer Control · event-HyperX Alloy Consumer Control",
    );
    expect(item.textContent).toContain("Grabbed");
    expect(
      screen.getByRole("switch", { name: "Remap HyperX Alloy" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("shows a busy keyboard", async () => {
    const busy = hyperx({
      members: [member("HyperX Alloy", { grabbed: false, blocked: "busy: held by kanata" })],
    });
    renderScreen(new FakeEngine({ devices: [busy] }));

    expect((await row("HyperX Alloy")).textContent).toContain("Busy: busy: held by kanata");
  });

  it("excludes a keyboard with its toggle", async () => {
    const engine = new FakeEngine({ devices: [hyperx()] });
    const { config } = renderScreen(engine);
    await row("HyperX Alloy");
    const toggle = screen.getByRole("switch", { name: "Remap HyperX Alloy" });

    await userEvent.setup().click(toggle);
    expect(config.deviceChanges).toEqual([
      {
        device: { vendorId: "0x0951", productId: "0x16d2", name: "HyperX Alloy" },
        probablyMouse: false,
        remap: false,
      },
    ]);
    // The switch moves at once, before the engine has reacted; the badge waits for the engine.
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect((await row("HyperX Alloy")).textContent).toContain("Grabbed");

    engine.setDevices([hyperx({ decision: "excluded" })]);
    expect((await row("HyperX Alloy")).textContent).toContain("Excluded");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("moves the switch back when saving fails", async () => {
    const config = new FakeConfig();
    config.saveProblem = { file: "settings.json", message: "disk full", issues: [] };
    renderScreen(new FakeEngine({ devices: [hyperx()] }), config);
    await row("HyperX Alloy");
    const toggle = screen.getByRole("switch", { name: "Remap HyperX Alloy" });

    await userEvent.setup().click(toggle);
    expect(await screen.findByText("Not saved: settings.json: disk full")).toBeDefined();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("follows the engine's devices events", async () => {
    const engine = new FakeEngine({ devices: [hyperx()] });
    renderScreen(engine);
    await row("HyperX Alloy");

    engine.setDevices([hyperx({ decision: "excluded" })]);
    expect((await row("HyperX Alloy")).textContent).toContain("Excluded");
  });

  it('shows a probable mouse only with "Show hidden devices"', async () => {
    renderScreen(new FakeEngine({ devices: [hyperx(), mouse()] }));
    await row("HyperX Alloy");
    expect(screen.queryByText("Razer DeathAdder")).toBeNull();

    await userEvent.setup().click(screen.getByRole("switch", { name: "Show hidden devices" }));
    expect((await row("Razer DeathAdder")).textContent).toContain("Hidden: probably a mouse");
  });

  it("lists excluded keyboards that aren't connected", async () => {
    const config = new FakeConfig();
    config.settings = {
      version: 1,
      devices: { excluded: [{ vendorId: "0x046d", productId: "0xc31c", name: "Logitech K120" }] },
    };
    renderScreen(new FakeEngine({ devices: [] }), config);

    const item = await row("Logitech K120");
    expect(item.textContent).toContain("046d:c31c");
    expect(item.textContent).toContain("Not connected");
  });

  it("says so when the engine isn't connected", async () => {
    renderScreen(new FakeEngine({ connected: false }));

    expect(await screen.findByText(/engine isn't connected/)).toBeDefined();
  });
});
