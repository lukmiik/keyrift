//! JSON Schema generation (architecture decision A9).

use std::{fs, io, path::Path};

use serde_json::Value;

use crate::model::{Profile, Settings};

pub const SETTINGS_SCHEMA_FILE: &str = "settings.v1.json";
pub const PROFILE_SCHEMA_FILE: &str = "profile.v1.json";

pub fn settings_schema() -> Value {
    serde_json::to_value(schemars::schema_for!(Settings)).unwrap_or(Value::Null)
}

pub fn profile_schema() -> Value {
    serde_json::to_value(schemars::schema_for!(Profile)).unwrap_or(Value::Null)
}

/// Write both schema files into `dir`, only touching files whose content changed.
/// Returns whether anything was written.
pub fn write_schemas(dir: &Path) -> io::Result<bool> {
    fs::create_dir_all(dir)?;
    let mut changed = false;
    for (name, schema) in [
        (SETTINGS_SCHEMA_FILE, settings_schema()),
        (PROFILE_SCHEMA_FILE, profile_schema()),
    ] {
        let path = dir.join(name);
        let mut text = serde_json::to_string_pretty(&schema).map_err(io::Error::other)?;
        text.push('\n');
        if fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
            crate::write_atomic(&path, text.as_bytes())?;
            changed = true;
        }
    }
    Ok(changed)
}
