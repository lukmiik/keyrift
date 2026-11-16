/**
 * Keyrift's config file types, generated from the engine's JSON Schemas (spec §6, architecture A9).
 * Regenerate with `vpx packages/config-types/scripts/generate.ts` after changing `crates/config`.
 */
export type {
  ActionConfig,
  DeviceMatch,
  DeviceSettings,
  EmergencyRelease,
  KeyName,
  LayerConfig,
  LayerMode,
  MacroStepConfig,
  Modifier,
  Profile,
  ReleaseHeld,
  Settings,
  ShortcutConfig,
  Strategy,
  TapHoldDefaults,
  TriggerConfig,
  TriggerModifier,
  UiSettings,
} from "./generated/types.ts";
export { toIssue, validateProfile, validateSettings } from "./validate.ts";
export type { SchemaIssue, SchemaResult } from "./validate.ts";
