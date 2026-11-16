import { describe, expect, it } from "vite-plus/test";

import { isKeyName, KEY_NAMES } from "./keys.ts";

describe("KEY_NAMES", () => {
  it("lists every key once, starting with Esc", () => {
    expect(KEY_NAMES[0]).toBe("KEY_ESC");
    expect(new Set(KEY_NAMES).size).toBe(KEY_NAMES.length);
    expect(KEY_NAMES.length).toBeGreaterThan(400);
  });

  it("recognises key names", () => {
    expect(isKeyName("KEY_CAPSLOCK")).toBe(true);
    expect(isKeyName("KEY_NOPE")).toBe(false);
    expect(isKeyName(30)).toBe(false);
  });
});
