import { describe, expect, it } from "vite-plus/test";

import { gsettingsSaysDark } from "./theme.ts";

describe("gsettingsSaysDark", () => {
  it("reads `gsettings get` and `gsettings monitor` output", () => {
    expect(gsettingsSaysDark("'prefer-dark'\n")).toBe(true);
    expect(gsettingsSaysDark("color-scheme: 'prefer-dark'")).toBe(true);
    expect(gsettingsSaysDark("'default'")).toBe(false);
    expect(gsettingsSaysDark("color-scheme: 'prefer-light'")).toBe(false);
  });
});
