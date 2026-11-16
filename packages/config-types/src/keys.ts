/**
 * Every key name the engine accepts, at runtime (the generated `KeyName` type only exists at
 * compile time). A separate entry point (`@keyrift/config-types/keys`) so the page can import it
 * without also loading ajv, which the page's CSP doesn't allow.
 */
import profileSchema from "../schema/profile.v1.json" with { type: "json" };

import type { KeyName } from "./generated/types.ts";

/** All key names, in the engine's order (by evdev code). */
export const KEY_NAMES: readonly KeyName[] = profileSchema.$defs.KeyName.enum as KeyName[];

const KNOWN = new Set<string>(KEY_NAMES);

/** Whether `value` is a key name the engine accepts, e.g. one the engine sent while recording. */
export function isKeyName(value: unknown): value is KeyName {
  return typeof value === "string" && KNOWN.has(value);
}
