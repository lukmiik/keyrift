//! inotify watchers for `/dev/input` (hot-plug, F-DEV-6) and the config directory (F-CFG-2).
//!
//! inotify is used instead of libudev so the engine has no native dependencies. Device nodes
//! are created by the kernel and get their group/permissions from udev shortly after, so
//! both CREATE and ATTRIB trigger a rescan.

use std::{ffi::OsStr, io, path::Path};

use futures_util::StreamExt;
use inotify::{Inotify, WatchMask};
use tokio::sync::mpsc;
use tracing::warn;

use crate::daemon::Msg;

pub fn spawn_input_watch(dir: &Path, tx: mpsc::UnboundedSender<Msg>) -> io::Result<()> {
    let ino = Inotify::init()?;
    ino.watches().add(
        dir,
        WatchMask::CREATE | WatchMask::ATTRIB | WatchMask::DELETE,
    )?;
    let mut stream = ino.into_event_stream([0u8; 4096])?;
    tokio::spawn(async move {
        while let Some(ev) = stream.next().await {
            match ev {
                Ok(ev)
                    if ev
                        .name
                        .as_deref()
                        .is_some_and(|n| n.to_string_lossy().starts_with("event")) =>
                {
                    if tx.send(Msg::InputDirChanged).is_err() {
                        break;
                    }
                }
                Ok(_) => {}
                Err(e) => {
                    warn!("input watch failed: {e}");
                    break;
                }
            }
        }
    });
    Ok(())
}

fn is_config_file(name: &OsStr) -> bool {
    let n = name.to_string_lossy();
    !n.starts_with('.') && n.ends_with(".json")
}

pub fn spawn_config_watch(root: &Path, tx: mpsc::UnboundedSender<Msg>) -> io::Result<()> {
    std::fs::create_dir_all(root)?;
    let mask = WatchMask::CLOSE_WRITE
        | WatchMask::MOVED_TO
        | WatchMask::MOVED_FROM
        | WatchMask::DELETE
        | WatchMask::CREATE;
    let ino = Inotify::init()?;
    let root_wd = ino.watches().add(root, mask)?;
    let profiles = root.join("profiles");
    if profiles.is_dir() {
        ino.watches().add(&profiles, mask)?;
    }
    let mut stream = ino.into_event_stream([0u8; 4096])?;
    tokio::spawn(async move {
        while let Some(ev) = stream.next().await {
            let ev = match ev {
                Ok(ev) => ev,
                Err(e) => {
                    warn!("config watch failed: {e}");
                    break;
                }
            };
            let Some(name) = ev.name.as_deref() else {
                continue;
            };
            if ev.wd == root_wd && name == "profiles" {
                // The profiles directory appeared (or was replaced): watch it and reload.
                if let Err(e) = stream.watches().add(&profiles, mask) {
                    warn!("cannot watch {}: {e}", profiles.display());
                }
                if tx.send(Msg::ConfigChanged).is_err() {
                    break;
                }
                continue;
            }
            if is_config_file(name) && tx.send(Msg::ConfigChanged).is_err() {
                break;
            }
        }
    });
    Ok(())
}
