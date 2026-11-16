import type { DeviceMatch, Settings } from "@keyrift/config-types";
import { describe, expect, it } from "vite-plus/test";

import { sameDevice, setRemapped, vidPid } from "./devices.ts";

const KBD: DeviceMatch = { vendorId: "0x0951", productId: "0x16d2", name: "HyperX Alloy" };
const MOUSE: DeviceMatch = { vendorId: "0x1532", productId: "0x0084", name: "Razer DeathAdder" };
const BASE: Settings = { version: 1, activeProfile: "daily" };

describe("sameDevice", () => {
  it("compares the IDs as numbers", () => {
    expect(sameDevice(KBD, { ...KBD, vendorId: "0x951", productId: "0x16D2" })).toBe(true);
  });

  it("needs the same name", () => {
    expect(sameDevice(KBD, { ...KBD, name: "HyperX Alloy Consumer Control" })).toBe(false);
  });
});

describe("vidPid", () => {
  it("writes four hex digits each", () => {
    expect(vidPid({ ...KBD, vendorId: "0x951", productId: "0x16D2" })).toBe("0951:16d2");
  });
});

describe("setRemapped", () => {
  it("excludes a keyboard that shouldn't be remapped", () => {
    expect(setRemapped(BASE, KBD, false, false)).toEqual({
      ...BASE,
      devices: { excluded: [KBD] },
    });
  });

  it("removes the exclusion again, and the empty devices part with it", () => {
    const excluded = setRemapped(BASE, KBD, false, false);
    expect(setRemapped(excluded, KBD, false, true)).toEqual(BASE);
  });

  it("includes a probable mouse that should be remapped", () => {
    expect(setRemapped(BASE, MOUSE, true, true)).toEqual({
      ...BASE,
      devices: { included: [MOUSE] },
    });
  });

  it("keeps the other devices", () => {
    const settings: Settings = { ...BASE, devices: { excluded: [MOUSE], included: [MOUSE] } };
    expect(setRemapped(settings, KBD, false, false).devices).toEqual({
      excluded: [MOUSE, KBD],
      included: [MOUSE],
    });
  });

  it("returns the same object when nothing changes", () => {
    const excluded = setRemapped(BASE, KBD, false, false);
    expect(setRemapped(excluded, KBD, false, false)).toBe(excluded);
    expect(setRemapped(BASE, KBD, false, true)).toBe(BASE);
  });
});
