import { describe, expect, it } from "vite-plus/test";

import { isCompatible } from "./protocol.ts";

describe("isCompatible", () => {
  it("accepts the same major version", () => {
    expect(isCompatible("1.0")).toBe(true);
    expect(isCompatible("1.7")).toBe(true);
  });

  it("rejects a different major version", () => {
    expect(isCompatible("2.0")).toBe(false);
    expect(isCompatible("10.0")).toBe(false);
  });

  it("rejects an empty version", () => {
    expect(isCompatible("")).toBe(false);
  });
});
