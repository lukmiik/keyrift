/**
 * Runtime checks for config files against the engine's JSON Schemas (spec §6: every file the GUI
 * saves must validate). TS types vanish at runtime, so data read from disk or built by the GUI is
 * checked here before it is trusted or written.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import profileSchema from "../schema/profile.v1.json" with { type: "json" };
import settingsSchema from "../schema/settings.v1.json" with { type: "json" };
import type { Profile, Settings } from "./generated/types.ts";

/** One problem found in a file: where it is (a JSON Pointer such as `/layers/0/id`) and what. */
export type SchemaIssue = { path: string; message: string };

/** Either the checked data, now typed, or the list of problems. */
export type SchemaResult<T> = { ok: true; value: T } | { ok: false; issues: SchemaIssue[] };

// allErrors: report every problem in the file, not only the first one.
// discriminator: lets a `oneOf` pick its branch by a tag field (see withDiscriminators).
const ajv = new Ajv2020({ allErrors: true, discriminator: true });

// The Rust schema generator marks u32 fields with `"format": "uint32"`. ajv does not know that
// format and refuses unknown ones, so teach it: a whole number that fits in 32 bits.
ajv.addFormat("uint32", {
  type: "number",
  validate: (n) => Number.isInteger(n) && n >= 0 && n <= 0xffff_ffff,
});

/** A JSON Schema as plain data: an object whose keys we read but do not type in detail. */
type SchemaObject = Record<string, unknown>;

/**
 * Returns a copy of a schema where each tagged union (`oneOf` whose branches all fix `"type"`,
 * like ActionConfig) is marked with `discriminator: { propertyName: "type" }`.
 *
 * Without it, ajv tries every branch of a `oneOf` and reports why each one failed: one broken
 * action gives a dozen errors. With it, ajv reads `type` first and checks only that branch.
 * The engine's schema stays untouched; this only changes how ajv reports errors.
 */
function withDiscriminators(schema: object): SchemaObject {
  const copy = structuredClone(schema) as SchemaObject & { $defs?: Record<string, SchemaObject> };
  const defs = [copy, ...Object.values(copy.$defs ?? {})];
  for (const def of defs) {
    const branches = def.oneOf;
    const tagged =
      Array.isArray(branches) &&
      branches.every((branch: { properties?: { type?: { const?: unknown } } }) => {
        return typeof branch.properties?.type?.const === "string";
      });
    if (tagged) {
      def.discriminator = { propertyName: "type" };
      // ajv's strict mode wants a discriminated schema to say it is an object.
      def.type = "object";
    }
  }
  return copy;
}

// compile() turns a schema into a fast check function, once, when this module loads.
const profileValidator = ajv.compile<Profile>(withDiscriminators(profileSchema));
const settingsValidator = ajv.compile<Settings>(withDiscriminators(settingsSchema));

/** Turns one ajv error into a short, readable issue. */
export function toIssue(error: ErrorObject): SchemaIssue {
  let msg = "";
  if (error.keyword === "additionalProperties")
    msg = 'unknown key "' + error.params.additionalProperty + '"';
  else if (error.message) msg = error.message;
  return { path: error.instancePath || "/", message: msg };
}

/** Runs a compiled check and packs its outcome into a `SchemaResult`. */
function check<T>(validator: ValidateFunction<T>, data: unknown): SchemaResult<T> {
  // validator is a type guard (`data is T`), so inside the if, data is typed as T.
  if (validator(data)) {
    return { ok: true, value: data };
  }
  return { ok: false, issues: (validator.errors ?? []).map(toIssue) };
}

/** Checks parsed JSON against the profile schema (`profiles/<name>.json`). */
export function validateProfile(data: unknown): SchemaResult<Profile> {
  return check(profileValidator, data);
}

/** Checks parsed JSON against the settings schema (`settings.json`). */
export function validateSettings(data: unknown): SchemaResult<Settings> {
  return check(settingsValidator, data);
}
