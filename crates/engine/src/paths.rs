//! Default locations (XDG).

use std::{env, path::PathBuf};

fn home() -> PathBuf {
    env::var_os("HOME").map_or_else(|| PathBuf::from("/"), PathBuf::from)
}

/// `$XDG_CONFIG_HOME/keyrift` or `~/.config/keyrift`.
pub fn default_config_dir() -> PathBuf {
    env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map_or_else(|| home().join(".config"), PathBuf::from)
        .join("keyrift")
}

/// `$XDG_RUNTIME_DIR/keyrift.sock`, falling back to `/tmp/keyrift-$USER.sock`.
pub fn default_socket_path() -> PathBuf {
    if let Some(dir) = env::var_os("XDG_RUNTIME_DIR").filter(|v| !v.is_empty()) {
        PathBuf::from(dir).join("keyrift.sock")
    } else {
        let user = env::var("USER").unwrap_or_else(|_| "user".to_owned());
        PathBuf::from(format!("/tmp/keyrift-{user}.sock"))
    }
}
