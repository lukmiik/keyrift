//! Serde types for `settings.json` and `profiles/*.json` (spec §6).

use std::{borrow::Cow, collections::BTreeMap, fmt};

use keyrift_core::Key;
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de};

/// Current config format version.
pub const VERSION: u32 = 1;

/// Relative `$schema` value written into `settings.json`.
pub const SETTINGS_SCHEMA_REF: &str = "./schema/settings.v1.json";
/// Relative `$schema` value written into profile files.
pub const PROFILE_SCHEMA_REF: &str = "../schema/profile.v1.json";

const fn version() -> u32 {
    VERSION
}

/// An evdev key name such as `"KEY_CAPSLOCK"`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct KeyName(pub Key);

impl KeyName {
    pub fn parse(s: &str) -> Option<KeyName> {
        Key::from_name(s).map(KeyName)
    }
}

impl fmt::Display for KeyName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl Serialize for KeyName {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for KeyName {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = Cow::<str>::deserialize(d)?;
        KeyName::parse(&s).ok_or_else(|| de::Error::custom(format!("unknown key `{s}`")))
    }
}

impl JsonSchema for KeyName {
    fn schema_name() -> Cow<'static, str> {
        "KeyName".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        let names: Vec<&str> = Key::all().map(|(n, _)| n).collect();
        json_schema!({
            "description": "Linux evdev key name, e.g. KEY_CAPSLOCK",
            "type": "string",
            "enum": names,
        })
    }
}

/// A side-specific modifier.
#[derive(Serialize, Deserialize, JsonSchema, Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Modifier {
    LeftCtrl,
    LeftShift,
    LeftAlt,
    LeftSuper,
    RightCtrl,
    RightShift,
    RightAlt,
    RightSuper,
}

impl From<Modifier> for keyrift_core::Modifier {
    fn from(m: Modifier) -> Self {
        use keyrift_core::Modifier as M;
        match m {
            Modifier::LeftCtrl => M::LeftCtrl,
            Modifier::LeftShift => M::LeftShift,
            Modifier::LeftAlt => M::LeftAlt,
            Modifier::LeftSuper => M::LeftSuper,
            Modifier::RightCtrl => M::RightCtrl,
            Modifier::RightShift => M::RightShift,
            Modifier::RightAlt => M::RightAlt,
            Modifier::RightSuper => M::RightSuper,
        }
    }
}

/// A modifier in a shortcut trigger: side-specific or generic (either side).
#[derive(Serialize, Deserialize, JsonSchema, Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum TriggerModifier {
    LeftCtrl,
    LeftShift,
    LeftAlt,
    LeftSuper,
    RightCtrl,
    RightShift,
    RightAlt,
    RightSuper,
    Ctrl,
    Shift,
    Alt,
    Super,
}

// ---------------------------------------------------------------- settings.json

/// `settings.json`.
#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    /// Optional editor hint pointing at the JSON Schema; ignored by Keyrift.
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(default = "version")]
    pub version: u32,
    /// File name (without `.json`) of the active profile in `profiles/`.
    #[serde(default = "default_profile")]
    pub active_profile: String,
    #[serde(default)]
    pub devices: DeviceSettings,
    #[serde(default)]
    pub tap_hold: TapHoldDefaults,
    #[serde(default)]
    pub emergency_release: EmergencyRelease,
    #[serde(default)]
    pub log_level: LogLevel,
    #[serde(default)]
    pub ui: UiSettings,
}

fn default_profile() -> String {
    "default".to_owned()
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            schema: Some(SETTINGS_SCHEMA_REF.to_owned()),
            version: VERSION,
            active_profile: default_profile(),
            devices: DeviceSettings::default(),
            tap_hold: TapHoldDefaults::default(),
            emergency_release: EmergencyRelease::default(),
            log_level: LogLevel::default(),
            ui: UiSettings::default(),
        }
    }
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceSettings {
    /// Keyboards that are never grabbed.
    #[serde(default)]
    pub excluded: Vec<DeviceMatch>,
    /// Hidden devices (e.g. mice with a keyboard interface) that should be grabbed anyway.
    #[serde(default)]
    pub included: Vec<DeviceMatch>,
}

/// Identifies a keyboard by vendor ID, product ID and name (never by port).
#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceMatch {
    /// Hex, e.g. "0x0951".
    pub vendor_id: String,
    /// Hex, e.g. "0x16d2".
    pub product_id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TapHoldDefaults {
    #[serde(default = "default_timeout")]
    pub timeout_ms: u32,
    #[serde(default)]
    pub strategy: Strategy,
}

const fn default_timeout() -> u32 {
    200
}

impl Default for TapHoldDefaults {
    fn default() -> Self {
        TapHoldDefaults {
            timeout_ms: default_timeout(),
            strategy: Strategy::default(),
        }
    }
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Strategy {
    #[default]
    PermissiveHold,
    HoldOnOtherPress,
    TimeoutOnly,
}

impl From<Strategy> for keyrift_core::Strategy {
    fn from(s: Strategy) -> Self {
        match s {
            Strategy::PermissiveHold => keyrift_core::Strategy::PermissiveHold,
            Strategy::HoldOnOtherPress => keyrift_core::Strategy::HoldOnOtherPress,
            Strategy::TimeoutOnly => keyrift_core::Strategy::TimeoutOnly,
        }
    }
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmergencyRelease {
    #[serde(default = "yes")]
    pub enabled: bool,
    /// Physical keys that, held together, release all keyboards.
    #[serde(default = "default_emergency_keys")]
    pub keys: Vec<KeyName>,
}

const fn yes() -> bool {
    true
}

fn default_emergency_keys() -> Vec<KeyName> {
    vec![
        KeyName(Key::LEFTCTRL),
        KeyName(Key::SPACE),
        KeyName(Key::ESC),
    ]
}

impl Default for EmergencyRelease {
    fn default() -> Self {
        EmergencyRelease {
            enabled: true,
            keys: default_emergency_keys(),
        }
    }
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    #[default]
    Info,
    Debug,
}

impl LogLevel {
    pub const fn as_str(self) -> &'static str {
        match self {
            LogLevel::Error => "error",
            LogLevel::Warn => "warn",
            LogLevel::Info => "info",
            LogLevel::Debug => "debug",
        }
    }
}

/// Settings used only by the GUI.
#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiSettings {
    #[serde(default = "default_layout")]
    pub physical_layout: String,
    #[serde(default)]
    pub theme: Theme,
    #[serde(default = "yes")]
    pub notify_layer_toggle: bool,
}

fn default_layout() -> String {
    "iso-tkl".to_owned()
}

impl Default for UiSettings {
    fn default() -> Self {
        UiSettings {
            physical_layout: default_layout(),
            theme: Theme::System,
            notify_layer_toggle: true,
        }
    }
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

// ---------------------------------------------------------------- profiles

/// A profile file in `profiles/`.
#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    /// Optional editor hint pointing at the JSON Schema; ignored by Keyrift.
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(default = "version")]
    pub version: u32,
    #[serde(default)]
    pub name: String,
    /// The first layer is the base layer; at least one layer is required.
    #[serde(default)]
    #[schemars(length(min = 1))]
    pub layers: Vec<LayerConfig>,
    #[serde(default)]
    pub shortcuts: Vec<ShortcutConfig>,
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerConfig {
    /// Stable id referenced by layer actions.
    pub id: String,
    /// Display name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Physical key → action. Keys not listed are transparent.
    #[serde(default)]
    pub keys: BTreeMap<KeyName, ActionConfig>,
}

/// What a key does (tagged by `type`).
#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ActionConfig {
    /// Output a key, optionally with modifiers.
    Key {
        key: KeyName,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        mods: Vec<Modifier>,
        /// Held modifiers released while this key is output ("all" or a list).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        release_held: Option<ReleaseHeld>,
    },
    /// Hold a set of modifiers.
    Mods { mods: Vec<Modifier> },
    /// Do nothing.
    None,
    /// Activate a layer.
    Layer {
        mode: LayerMode,
        layer: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        mods: Vec<Modifier>,
    },
    /// Different actions for tap and hold.
    TapHold {
        tap: Box<ActionConfig>,
        hold: Box<ActionConfig>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        timeout_ms: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        strategy: Option<Strategy>,
    },
    /// Tap a sequence of keys.
    Macro { steps: Vec<MacroStepConfig> },
}

impl ActionConfig {
    pub(crate) const fn kind(&self) -> &'static str {
        match self {
            ActionConfig::Key { .. } => "key",
            ActionConfig::Mods { .. } => "mods",
            ActionConfig::None => "none",
            ActionConfig::Layer { .. } => "layer",
            ActionConfig::TapHold { .. } => "tapHold",
            ActionConfig::Macro { .. } => "macro",
        }
    }
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum ReleaseHeld {
    All(AllModifiers),
    Mods(Vec<Modifier>),
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AllModifiers {
    All,
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LayerMode {
    Hold,
    Toggle,
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum MacroStepConfig {
    Key {
        key: KeyName,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        mods: Vec<Modifier>,
    },
    Delay {
        ms: u32,
    },
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShortcutConfig {
    pub trigger: TriggerConfig,
    pub action: ActionConfig,
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TriggerConfig {
    #[serde(default)]
    pub mods: Vec<TriggerModifier>,
    pub key: KeyName,
}
