import { describe, expect, it } from "vite-plus/test";

import { LAYOUT_IDS, layoutId, layoutKeys, type KeySpec } from "./layouts.ts";

/** Whether two keys cover some of the same area. */
function overlap(a: KeySpec, b: KeySpec): boolean {
  const eps = 0.001;
  return (
    a.x < b.x + (b.w ?? 1) - eps &&
    b.x < a.x + (a.w ?? 1) - eps &&
    a.y < b.y + (b.h ?? 1) - eps &&
    b.y < a.y + (a.h ?? 1) - eps
  );
}

describe("layoutKeys", () => {
  it.each(LAYOUT_IDS)("%s has each key once and no keys on top of each other", (id) => {
    const keys = layoutKeys(id);
    expect(new Set(keys.map((spec) => spec.key)).size).toBe(keys.length);
    const overlapping = keys.flatMap((a, i) =>
      keys
        .slice(i + 1)
        .filter((b) => overlap(a, b))
        .map((b) => `${a.key}/${b.key}`),
    );
    expect(overlapping).toEqual([]);
  });

  it.each([
    ["ansi-full", 104],
    ["iso-full", 105],
    ["ansi-tkl", 87],
    ["iso-tkl", 88],
    ["ansi-60", 61],
    ["iso-60", 62],
  ] as const)("%s has the usual %d keys", (id, count) => {
    expect(layoutKeys(id)).toHaveLength(count);
  });

  it("puts the ISO extra key next to the left Shift", () => {
    const keys = layoutKeys("iso-tkl");
    expect(keys.find((spec) => spec.key === "KEY_102ND")).toMatchObject({ x: 1.25 });
    expect(layoutKeys("ansi-tkl").some((spec) => spec.key === "KEY_102ND")).toBe(false);
  });
});

describe("layoutId", () => {
  it("falls back to ISO TKL", () => {
    expect(layoutId(undefined)).toBe("iso-tkl");
    expect(layoutId("dvorak-split")).toBe("iso-tkl");
    expect(layoutId("ansi-60")).toBe("ansi-60");
  });
});
