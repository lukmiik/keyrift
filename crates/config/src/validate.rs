//! Semantic validation beyond what serde/JSON Schema check (spec F-CFG-4).

use std::{collections::HashSet, fmt};

use serde::Serialize;

use crate::model::{
    ActionConfig, DeviceMatch, LayerMode, MacroStepConfig, Profile, Settings, TriggerModifier,
    VERSION,
};

/// Maximum accepted tap-hold timeout and macro delay, in milliseconds.
pub const MAX_TIMEOUT_MS: u32 = 10_000;
pub const MAX_DELAY_MS: u32 = 60_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

/// A problem found in a config file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Issue {
    pub severity: Severity,
    /// File the issue is in, relative to the config directory.
    pub file: String,
    /// JSON-ish path inside the file, e.g. `layers[1].keys.KEY_H`.
    pub path: String,
    pub message: String,
}

impl Issue {
    pub fn error(file: &str, path: impl Into<String>, message: impl Into<String>) -> Issue {
        Issue {
            severity: Severity::Error,
            file: file.to_owned(),
            path: path.into(),
            message: message.into(),
        }
    }

    pub fn warning(file: &str, path: impl Into<String>, message: impl Into<String>) -> Issue {
        Issue {
            severity: Severity::Warning,
            file: file.to_owned(),
            path: path.into(),
            message: message.into(),
        }
    }

    pub fn is_error(&self) -> bool {
        self.severity == Severity::Error
    }
}

impl fmt::Display for Issue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let sev = match self.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        if self.path.is_empty() {
            write!(f, "{sev}: {}: {}", self.file, self.message)
        } else {
            write!(f, "{sev}: {}: {}: {}", self.file, self.path, self.message)
        }
    }
}

fn check_version(file: &str, v: u32, issues: &mut Vec<Issue>) {
    if v != VERSION {
        issues.push(Issue::error(
            file,
            "version",
            format!("unsupported version {v} (expected {VERSION})"),
        ));
    }
}

fn check_hex(file: &str, path: &str, s: &str, issues: &mut Vec<Issue>) {
    let ok = s
        .strip_prefix("0x")
        .is_some_and(|h| !h.is_empty() && h.len() <= 4 && h.chars().all(|c| c.is_ascii_hexdigit()));
    if !ok {
        issues.push(Issue::error(
            file,
            path,
            format!("`{s}` is not a hex id like \"0x0951\""),
        ));
    }
}

fn check_devices(file: &str, list: &[DeviceMatch], field: &str, issues: &mut Vec<Issue>) {
    for (i, d) in list.iter().enumerate() {
        check_hex(
            file,
            &format!("devices.{field}[{i}].vendorId"),
            &d.vendor_id,
            issues,
        );
        check_hex(
            file,
            &format!("devices.{field}[{i}].productId"),
            &d.product_id,
            issues,
        );
    }
}

/// Validate `settings.json`.
pub fn validate_settings(file: &str, s: &Settings) -> Vec<Issue> {
    let mut issues = Vec::new();
    check_version(file, s.version, &mut issues);
    if s.active_profile.is_empty()
        || s.active_profile.contains(['/', '\\'])
        || s.active_profile.starts_with('.')
    {
        issues.push(Issue::error(
            file,
            "activeProfile",
            "must be a plain file name without `.json`",
        ));
    }
    check_devices(file, &s.devices.excluded, "excluded", &mut issues);
    check_devices(file, &s.devices.included, "included", &mut issues);
    if !(1..=MAX_TIMEOUT_MS).contains(&s.tap_hold.timeout_ms) {
        issues.push(Issue::error(
            file,
            "tapHold.timeoutMs",
            format!("must be 1..={MAX_TIMEOUT_MS}"),
        ));
    }
    let keys = &s.emergency_release.keys;
    if s.emergency_release.enabled && keys.len() < 2 {
        issues.push(Issue::error(
            file,
            "emergencyRelease.keys",
            "needs at least two keys",
        ));
    }
    if keys.iter().collect::<HashSet<_>>().len() != keys.len() {
        issues.push(Issue::error(
            file,
            "emergencyRelease.keys",
            "contains duplicate keys",
        ));
    }
    issues
}

/// Where an action appears, which restricts the allowed action types.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Slot {
    Key,
    Tap,
    Hold,
    Shortcut,
}

struct ProfileCheck<'a> {
    file: &'a str,
    layer_ids: Vec<&'a str>,
    referenced: HashSet<String>,
    issues: Vec<Issue>,
}

impl ProfileCheck<'_> {
    /// An optional tap-hold duration must be `1..=MAX_TIMEOUT_MS`.
    fn check_ms(&mut self, path: &str, field: &str, value: Option<u32>) {
        if let Some(t) = value
            && !(1..=MAX_TIMEOUT_MS).contains(&t)
        {
            self.issues.push(Issue::error(
                self.file,
                format!("{path}.{field}"),
                format!("must be 1..={MAX_TIMEOUT_MS}"),
            ));
        }
    }

    fn action(&mut self, path: &str, a: &ActionConfig, slot: Slot) {
        let allowed = match slot {
            Slot::Key => true,
            Slot::Tap => matches!(
                a,
                ActionConfig::Key { .. } | ActionConfig::Mods { .. } | ActionConfig::None
            ),
            Slot::Hold => matches!(
                a,
                ActionConfig::Key { .. }
                    | ActionConfig::Mods { .. }
                    | ActionConfig::None
                    | ActionConfig::Layer {
                        mode: LayerMode::Hold,
                        ..
                    }
            ),
            Slot::Shortcut => matches!(
                a,
                ActionConfig::Key { .. }
                    | ActionConfig::Mods { .. }
                    | ActionConfig::None
                    | ActionConfig::Macro { .. }
            ),
        };
        if !allowed {
            let where_ = match slot {
                Slot::Tap => "a tap action",
                Slot::Hold => "a hold action (toggle layers are not allowed)",
                Slot::Shortcut => "a shortcut action",
                Slot::Key => "a key action",
            };
            self.issues.push(Issue::error(
                self.file,
                path,
                format!("action type `{}` is not allowed as {where_}", a.kind()),
            ));
            return;
        }
        match a {
            ActionConfig::Key { .. } | ActionConfig::None => {}
            ActionConfig::Mods { mods } => {
                if mods.is_empty() {
                    self.issues
                        .push(Issue::error(self.file, path, "`mods` must not be empty"));
                }
            }
            ActionConfig::Layer { mode, layer, mods } => {
                if self.layer_ids.contains(&layer.as_str()) {
                    self.referenced.insert(layer.clone());
                } else {
                    self.issues.push(Issue::error(
                        self.file,
                        path,
                        format!("unknown layer `{layer}`"),
                    ));
                }
                if *mode == LayerMode::Toggle && !mods.is_empty() {
                    self.issues.push(Issue::warning(
                        self.file,
                        path,
                        "`mods` are ignored for toggle layers",
                    ));
                }
            }
            ActionConfig::TapHold {
                tap,
                hold,
                timeout_ms,
                require_prior_idle_ms,
                ..
            } => {
                self.check_ms(path, "timeoutMs", *timeout_ms);
                self.check_ms(path, "requirePriorIdleMs", *require_prior_idle_ms);
                self.action(&format!("{path}.tap"), tap, Slot::Tap);
                self.action(&format!("{path}.hold"), hold, Slot::Hold);
            }
            ActionConfig::Macro { steps } => {
                if steps.is_empty() {
                    self.issues
                        .push(Issue::warning(self.file, path, "macro has no steps"));
                }
                for (i, st) in steps.iter().enumerate() {
                    if let MacroStepConfig::Delay { ms } = st
                        && *ms > MAX_DELAY_MS
                    {
                        self.issues.push(Issue::error(
                            self.file,
                            format!("{path}.steps[{i}].ms"),
                            format!("delay must be at most {MAX_DELAY_MS} ms"),
                        ));
                    }
                }
            }
        }
    }
}

/// Canonical form of a trigger for duplicate detection.
fn trigger_signature(
    mods: &[TriggerModifier],
    key: crate::KeyName,
) -> (Vec<String>, crate::KeyName) {
    let mut m: Vec<String> = mods.iter().map(|m| format!("{m:?}")).collect();
    m.sort();
    m.dedup();
    (m, key)
}

/// Validate a profile file.
pub fn validate_profile(file: &str, p: &Profile) -> Vec<Issue> {
    let mut c = ProfileCheck {
        file,
        layer_ids: p.layers.iter().map(|l| l.id.as_str()).collect(),
        referenced: HashSet::new(),
        issues: Vec::new(),
    };
    check_version(file, p.version, &mut c.issues);
    if p.layers.is_empty() {
        c.issues.push(Issue::error(
            file,
            "layers",
            "a profile needs at least one layer (the base layer)",
        ));
    }
    let mut seen = HashSet::new();
    for (i, l) in p.layers.iter().enumerate() {
        if l.id.trim().is_empty() {
            c.issues.push(Issue::error(
                file,
                format!("layers[{i}].id"),
                "layer id must not be empty",
            ));
        } else if !seen.insert(l.id.as_str()) {
            c.issues.push(Issue::error(
                file,
                format!("layers[{i}].id"),
                format!("duplicate layer id `{}`", l.id),
            ));
        }
    }
    for (i, l) in p.layers.iter().enumerate() {
        for (key, action) in &l.keys {
            c.action(&format!("layers[{i}].keys.{key}"), action, Slot::Key);
        }
    }
    let mut triggers = HashSet::new();
    for (i, s) in p.shortcuts.iter().enumerate() {
        c.action(&format!("shortcuts[{i}].action"), &s.action, Slot::Shortcut);
        if !triggers.insert(trigger_signature(&s.trigger.mods, s.trigger.key)) {
            c.issues.push(Issue::error(
                file,
                format!("shortcuts[{i}].trigger"),
                "duplicate shortcut trigger",
            ));
        }
    }
    for (i, l) in p.layers.iter().enumerate().skip(1) {
        if !c.referenced.contains(&l.id) {
            c.issues.push(Issue::warning(
                file,
                format!("layers[{i}]"),
                format!("layer `{}` is not activated by any key", l.id),
            ));
        }
    }
    c.issues
}
