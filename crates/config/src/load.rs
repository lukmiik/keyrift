//! Reading the config directory (spec §6.1).

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use keyrift_core::Keymap;
use serde::de::DeserializeOwned;

use crate::{
    compile::compile,
    model::{Profile, Settings},
    validate::{Issue, validate_profile, validate_settings},
};

/// Layout of `~/.config/keyrift/`.
#[derive(Clone, Debug)]
pub struct ConfigDir {
    root: PathBuf,
}

/// Result of loading the config directory.
#[derive(Clone, Debug)]
pub struct Loaded {
    pub settings: Settings,
    pub profile_name: String,
    pub profile: Option<Profile>,
    /// Compiled keymap; pass-through when the profile is missing.
    pub keymap: Keymap,
    pub issues: Vec<Issue>,
}

impl Loaded {
    pub fn has_errors(&self) -> bool {
        self.issues.iter().any(Issue::is_error)
    }
}

/// Parse JSON, turning serde errors into an [`Issue`] with line/column.
pub fn parse_json<T: DeserializeOwned>(file: &str, text: &str) -> Result<T, Issue> {
    serde_json::from_str(text).map_err(|e| {
        Issue::error(
            file,
            format!("line {} column {}", e.line(), e.column()),
            e.to_string(),
        )
    })
}

impl ConfigDir {
    pub fn new(root: impl Into<PathBuf>) -> ConfigDir {
        ConfigDir { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn settings_path(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    pub fn profiles_dir(&self) -> PathBuf {
        self.root.join("profiles")
    }

    pub fn profile_path(&self, name: &str) -> PathBuf {
        self.profiles_dir().join(format!("{name}.json"))
    }

    pub fn schema_dir(&self) -> PathBuf {
        self.root.join("schema")
    }

    /// Read settings and the active profile, validate and compile them.
    pub fn load(&self) -> Loaded {
        let mut issues = Vec::new();
        let settings = match fs::read_to_string(self.settings_path()) {
            Ok(text) => match parse_json::<Settings>("settings.json", &text) {
                Ok(s) => s,
                Err(issue) => {
                    issues.push(issue);
                    Settings::default()
                }
            },
            Err(e) if e.kind() == io::ErrorKind::NotFound => Settings::default(),
            Err(e) => {
                issues.push(Issue::error(
                    "settings.json",
                    "",
                    format!("cannot read: {e}"),
                ));
                Settings::default()
            }
        };
        issues.extend(validate_settings("settings.json", &settings));

        let profile_name = settings.active_profile.clone();
        let file = format!("profiles/{profile_name}.json");
        let profile = if issues.iter().any(Issue::is_error) {
            None
        } else {
            match fs::read_to_string(self.profile_path(&profile_name)) {
                Ok(text) => match parse_json::<Profile>(&file, &text) {
                    Ok(p) => Some(p),
                    Err(issue) => {
                        issues.push(issue);
                        None
                    }
                },
                Err(e) if e.kind() == io::ErrorKind::NotFound => {
                    issues.push(Issue::warning(
                        &file,
                        "",
                        format!("profile `{profile_name}` not found; all keys pass through"),
                    ));
                    None
                }
                Err(e) => {
                    issues.push(Issue::error(&file, "", format!("cannot read: {e}")));
                    None
                }
            }
        };
        let mut keymap = Keymap::passthrough();
        if let Some(p) = &profile {
            let found = validate_profile(&file, p);
            let ok = !found.iter().any(Issue::is_error);
            issues.extend(found);
            if ok && !issues.iter().any(Issue::is_error) {
                keymap = compile(p, &settings.tap_hold);
            }
        }
        Loaded {
            settings,
            profile_name,
            profile,
            keymap,
            issues,
        }
    }
}

/// What kind of config file a path holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileKind {
    Settings,
    Profile,
}

/// Guess the kind of a config file from its name and content.
pub fn detect_kind(path: &Path, text: &str) -> FileKind {
    if path.file_name().is_some_and(|n| n == "settings.json") {
        return FileKind::Settings;
    }
    if path
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|n| n == "profiles")
    {
        return FileKind::Profile;
    }
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(v) if v.get("activeProfile").is_some() || v.get("devices").is_some() => {
            FileKind::Settings
        }
        _ => FileKind::Profile,
    }
}

/// Validate one file (used by `keyrift validate` and the `config.validate` IPC method).
pub fn validate_text(kind: FileKind, file: &str, text: &str) -> Vec<Issue> {
    match kind {
        FileKind::Settings => match parse_json::<Settings>(file, text) {
            Ok(s) => validate_settings(file, &s),
            Err(i) => vec![i],
        },
        FileKind::Profile => match parse_json::<Profile>(file, text) {
            Ok(p) => validate_profile(file, &p),
            Err(i) => vec![i],
        },
    }
}
