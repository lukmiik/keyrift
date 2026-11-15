//! Keyrift configuration types.
//!
//! The Rust types here are the single source of truth for the JSON config format; the
//! JSON Schema (and later the GUI's TypeScript types) are generated from them.
#![forbid(unsafe_code)]

mod compile;
mod load;
mod model;
mod schema;
mod validate;

use std::{fs, io, path::Path};

pub use compile::compile;
pub use load::{ConfigDir, FileKind, Loaded, detect_kind, parse_json, validate_text};
pub use model::*;
pub use schema::{
    PROFILE_SCHEMA_FILE, SETTINGS_SCHEMA_FILE, profile_schema, settings_schema, write_schemas,
};
pub use validate::{
    Issue, MAX_DELAY_MS, MAX_TIMEOUT_MS, Severity, validate_profile, validate_settings,
};

/// Write a file atomically: temp file in the same directory, then rename (spec F-CFG-5).
pub fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(dir)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = dir.join(format!(".{name}.tmp-{}", std::process::id()));
    fs::write(&tmp, data)?;
    fs::rename(&tmp, path)
}
