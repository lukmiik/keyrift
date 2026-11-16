import { describe, expect, it } from "vite-plus/test";

import { layoutKeys } from "./layouts.ts";
import { nearestKey } from "./navigation.ts";

const TKL = layoutKeys("iso-tkl");

describe("nearestKey", () => {
  it.each([
    ["KEY_T", "down", "KEY_G"],
    ["KEY_G", "up", "KEY_T"],
    ["KEY_G", "right", "KEY_H"],
    ["KEY_A", "left", "KEY_CAPSLOCK"],
    ["KEY_BACKSPACE", "right", "KEY_INSERT"],
    ["KEY_SPACE", "up", "KEY_B"],
  ] as const)("from %s %s is %s", (from, direction, to) => {
    expect(nearestKey(TKL, from, direction)).toBe(to);
  });

  it("stops at the edge", () => {
    expect(nearestKey(TKL, "KEY_ESC", "left")).toBeNull();
    expect(nearestKey(TKL, "KEY_ESC", "up")).toBeNull();
  });
});
