import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ErrorObject } from "ajv/dist/2020.js";
import { describe, expect, it } from "vite-plus/test";

import { toIssue, validateProfile, validateSettings } from "./validate.ts";

const EXAMPLES = join(import.meta.dirname, "../../../examples/config");

/** Reads and parses a JSON file from the example config directory. */
function readExample(file: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES, file), "utf8"));
}

describe("validateProfile", () => {
  it("accepts the example profile", () => {
    expect(validateProfile(readExample("profiles/daily.json")).ok).toBe(true);
  });

  it("accepts an empty profile, because every field has a default", () => {
    expect(validateProfile({}).ok).toBe(true);
  });

  it("reports only the chosen branch's problem for a broken action", () => {
    const profile = { layers: [{ id: "base", keys: { KEY_A: { type: "key" } } }] };
    expect(validateProfile(profile)).toEqual({
      ok: false,
      issues: [{ path: "/layers/0/keys/KEY_A", message: "must have required property 'key'" }],
    });
  });

  it("rejects an unknown key name", () => {
    const profile = { layers: [{ id: "base", keys: { KEY_NOPE: { type: "none" } } }] };
    expect(validateProfile(profile).ok).toBe(false);
  });
});

describe("validateSettings", () => {
  it("accepts the example settings", () => {
    expect(validateSettings(readExample("settings.json")).ok).toBe(true);
  });

  it("rejects a negative tap-hold timeout", () => {
    const result = validateSettings({ tapHold: { timeoutMs: -5 } });
    expect(result.ok).toBe(false);
  });
});

/** Builds an ajv error with only the fields `toIssue` reads. */
function ajvError(fields: Partial<ErrorObject>): ErrorObject {
  return { keyword: "required", instancePath: "", schemaPath: "", params: {}, ...fields };
}

// Exercise (step 2b): make these pass by editing `toIssue` in validate.ts.
describe("toIssue", () => {
  it("keeps the path and message of a plain error", () => {
    const error = ajvError({ instancePath: "/version", message: "must be integer" });
    expect(toIssue(error)).toEqual({ path: "/version", message: "must be integer" });
  });

  it("shows the root of the file as /", () => {
    const error = ajvError({ instancePath: "", message: "must be object" });
    expect(toIssue(error)).toEqual({ path: "/", message: "must be object" });
  });

  it("names the unknown key", () => {
    const error = ajvError({
      keyword: "additionalProperties",
      instancePath: "/layers/0",
      params: { additionalProperty: "nick" },
      message: "must NOT have additional properties",
    });
    expect(toIssue(error)).toEqual({ path: "/layers/0", message: 'unknown key "nick"' });
  });
});
