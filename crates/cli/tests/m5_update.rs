//! M5: updating the engine binary while it runs (spec M5 exit criteria, open question 4).
//!
//! An `AppImage` update copies its engine over `~/.local/share/keyrift/bin/keyrift` (written next to
//! it, then renamed, as `apps/desktop/src/main/system/engine-binary.ts` does) and restarts the
//! unit. This test does the same with a key held down: the old engine must release it before it
//! exits, and the new one must start from the new file with nothing stuck.
//!
//! Ignored by default because it installs (and removes) a unit in `~/.config/systemd/user`.
//! Run with `cargo test -p keyrift --test m5_update -- --ignored`.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::{fs, os::unix::fs::PermissionsExt, path::Path, process::Command, time::Duration};

use common::{Source, bin, uinput_available, unique, wait_until};
use keyrift_engine::client::Client;

fn systemctl(args: &[&str]) -> String {
    let o = Command::new("systemctl")
        .arg("--user")
        .args(args)
        .output()
        .unwrap();
    String::from_utf8_lossy(&o.stdout).trim().to_owned()
}

fn main_pid(unit: &str) -> u32 {
    systemctl(&["show", "-p", "MainPID", "--value", unit])
        .parse()
        .unwrap_or(0)
}

/// Writes `bytes` next to `target` and renames it over, like an update does.
fn replace(target: &Path, bytes: &[u8]) {
    let next = target.with_extension("new");
    fs::write(&next, bytes).unwrap();
    fs::set_permissions(&next, fs::Permissions::from_mode(0o755)).unwrap();
    fs::rename(&next, target).unwrap();
}

/// Removes the test unit even when the test fails.
struct Uninstall(String);

impl Drop for Uninstall {
    fn drop(&mut self) {
        let _ = Command::new(bin())
            .args(["service", "uninstall", "--unit", &self.0])
            .output();
    }
}

#[test]
#[ignore = "installs a systemd user unit; run with --ignored"]
fn replacing_the_binary_and_restarting_leaves_no_key_stuck() {
    if !uinput_available() {
        return;
    }
    let id = unique("update");
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config");
    fs::create_dir_all(config.join("profiles")).unwrap();
    fs::write(
        config.join("settings.json"),
        r#"{"version":1,"activeProfile":"test"}"#,
    )
    .unwrap();
    fs::write(
        config.join("profiles/test.json"),
        r#"{"version":1,"name":"t","layers":[{"id":"base","keys":{"KEY_A":{"type":"key","key":"KEY_B"}}}]}"#,
    )
    .unwrap();
    let socket = dir.path().join("keyrift.sock");
    let output_name = format!("Keyrift virtual keyboard {id}");

    // The "installed" engine: a copy, so the update below doesn't replace cargo's build.
    let installed = dir.path().join("bin/keyrift");
    fs::create_dir_all(installed.parent().unwrap()).unwrap();
    let original = fs::read(bin()).unwrap();
    replace(&installed, &original);

    let _cleanup = Uninstall(id.clone());
    let o = Command::new(&installed)
        .args(["service", "install", "--unit", &id, "--"])
        .args(["--only-device", &id, "--output-name", &output_name])
        .arg("--config-dir")
        .arg(&config)
        .arg("--socket")
        .arg(&socket)
        .output()
        .unwrap();
    assert!(o.status.success(), "{o:?}");

    let connect = || {
        wait_until(Duration::from_secs(5), || {
            Client::connect(&socket, "t").ok()
        })
        .expect("socket")
        .0
    };
    let mut c = connect();
    let mut src = Source::new(&format!("{id}-kbd"));
    let grabbed = |c: &mut Client| {
        wait_until(Duration::from_secs(5), || {
            (c.call("status.get", serde_json::Value::Null).ok()?["devices"]["grabbed"] == 1)
                .then_some(())
        })
        .expect("grabbed");
    };
    grabbed(&mut c);
    let st = c.call("status.get", serde_json::Value::Null).unwrap();
    let mut out = common::Output::open(Path::new(st["outputDevice"].as_str().unwrap()));

    // Held through the update.
    src.down("KEY_A");
    out.expect(&["+KEY_B"]);

    // A newer build: different bytes (trailing data after an ELF file doesn't change how it runs).
    let mut newer = original.clone();
    newer.extend_from_slice(b"keyrift-update-test");
    let pid1 = main_pid(&id);
    replace(&installed, &newer);
    // The running engine is unaffected: it still answers.
    assert_eq!(
        c.call("status.get", serde_json::Value::Null).unwrap()["pid"],
        pid1
    );

    drop(c);
    // --no-block: read the old device while it stops (events left unread vanish with the device).
    systemctl(&["restart", "--no-block", &format!("{id}.service")]);
    // The old engine releases the held key before its device goes away.
    assert_eq!(out.read(1, Duration::from_secs(3)), ["-KEY_B"]);

    wait_until(Duration::from_secs(5), || {
        let p = main_pid(&id);
        (p != 0 && p != pid1 && systemctl(&["is-active", &id]) == "active").then_some(())
    })
    .expect("restarted");
    // The new engine runs from the new file.
    let pid2 = main_pid(&id);
    let exe = fs::read_link(format!("/proc/{pid2}/exe")).unwrap();
    assert_eq!(exe, installed.canonicalize().unwrap());

    // The new engine doesn't grab a keyboard while a key is down on it (X saw nothing of the
    // press, but would miss the release): released now, it grabs within 50 ms.
    let mut c = connect();
    let st = c.call("status.get", serde_json::Value::Null).unwrap();
    assert_eq!(st["devices"]["grabbed"], 0, "grabbed with a key held");
    let mut out = common::Output::open(Path::new(st["outputDevice"].as_str().unwrap()));
    src.up("KEY_A");
    grabbed(&mut c);
    out.expect_nothing(Duration::from_millis(100));
    out.assert_no_keys_held();
    src.tap("KEY_A");
    out.expect(&["+KEY_B", "-KEY_B"]);
    out.assert_no_keys_held();
}
