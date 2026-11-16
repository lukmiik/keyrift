import { KEY_NAMES } from "@keyrift/config-types/keys";
import { describe, expect, it } from "vite-plus/test";

import { KEY_GROUPS, matchesKey } from "./key-groups.ts";

const group = (label: string) => KEY_GROUPS.find((g) => g.label === label)?.items ?? [];

describe("KEY_GROUPS", () => {
  it("puts every key in exactly one group", () => {
    const all = KEY_GROUPS.flatMap((g) => g.items);
    expect(all.length).toBe(KEY_NAMES.length);
    expect(new Set(all).size).toBe(KEY_NAMES.length);
  });

  it("groups keys like the spec", () => {
    expect(group("Letters")).toHaveLength(26);
    expect(group("Digits")).toHaveLength(10);
    expect(group("Modifiers")).toContain("KEY_RIGHTALT");
    expect(group("Function")).toContain("KEY_F24");
    expect(group("Numpad")).toEqual(expect.arrayContaining(["KEY_KP5", "KEY_NUMLOCK"]));
    expect(group("International")).toContain("KEY_KPJPCOMMA");
    expect(group("Media/System")).toContain("KEY_VOLUMEUP");
    expect(group("Typing")).toEqual(expect.arrayContaining(["KEY_ESC", "KEY_102ND"]));
  });
});

describe("matchesKey", () => {
  it("matches the label, the name and the evdev name, ignoring case", () => {
    expect(matchesKey("KEY_ESC", "esc")).toBe(true);
    expect(matchesKey("KEY_LEFTSHIFT", "left sh")).toBe(true);
    expect(matchesKey("KEY_LEFTSHIFT", "KEY_LEFTSH")).toBe(true);
    expect(matchesKey("KEY_VOLUMEUP", "volume")).toBe(true);
    expect(matchesKey("KEY_A", "esc")).toBe(false);
    expect(matchesKey("KEY_A", "  ")).toBe(true);
  });
});
