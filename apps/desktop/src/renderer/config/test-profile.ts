/**
 * A small profile for tests, deeply frozen: if code under test changes it instead of copying,
 * the change throws a TypeError ("Cannot assign to read only property").
 */
import type { Profile } from "@keyrift/config-types";

/** Freezes `value` and everything inside it. Returns it for convenience. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}

/** Base layer with Caps Lock → Esc, plus an empty "nav" layer. A fresh frozen copy each call. */
export function testProfile(): Profile {
  return deepFreeze({
    version: 1,
    name: "Test",
    layers: [
      { id: "base", name: "Base", keys: { KEY_CAPSLOCK: { type: "key", key: "KEY_ESC" } } },
      { id: "nav", name: "Nav", keys: {} },
    ],
  });
}
