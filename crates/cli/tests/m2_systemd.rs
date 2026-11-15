//! M2: the systemd user unit (spec §9.1, F-SYS-1, N-4) and journald logging (F-SYS-6).
//!
//! Ignored by default because it installs (and removes) a unit in `~/.config/systemd/user`.
//! Run with `cargo test -p keyrift --test m2_systemd -- --ignored`.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::too_many_lines
)]

mod common;

use std::{
    fs,
    process::Command,
    time::{Duration, Instant},
};

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
fn user_unit_runs_restarts_after_crash_and_logs_to_journald() {
    if !uinput_available()
        || Command::new("systemctl")
            .args(["--user", "is-system-running"])
            .output()
            .is_err()
    {
        return;
    }
    let id = unique("svc");
    let unit = id.clone();
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

    let _cleanup = Uninstall(unit.clone());
    let o = Command::new(bin())
        .args(["service", "install", "--unit", &unit, "--"])
        .args([
            "--only-device",
            &id,
            "--output-name",
            &output_name,
            "--config-dir",
        ])
        .arg(&config)
        .arg("--socket")
        .arg(&socket)
        .output()
        .unwrap();
    assert!(o.status.success(), "{o:?}");
    let unit_file = fs::read_to_string(
        std::path::PathBuf::from(std::env::var("HOME").unwrap())
            .join(format!(".config/systemd/user/{unit}.service")),
    )
    .unwrap();
    assert!(
        unit_file.contains("Restart=on-failure")
            && unit_file.contains(&format!(
                "{} daemon",
                fs::canonicalize(bin()).unwrap().display()
            ))
    );

    wait_until(Duration::from_secs(3), || {
        (systemctl(&["is-active", &unit]) == "active").then_some(())
    })
    .expect("unit active");
    assert_eq!(systemctl(&["is-enabled", &unit]), "enabled");
    let (mut c, _) = wait_until(Duration::from_secs(3), || {
        Client::connect(&socket, "t").ok()
    })
    .expect("socket");
    let pid1 = main_pid(&unit);
    assert_eq!(
        c.call("status.get", serde_json::Value::Null).unwrap()["pid"],
        pid1
    );

    // Runs as the user, not root (F-SYS-2).
    let uid = fs::read_to_string(format!("/proc/{pid1}/status")).unwrap();
    let uid_line = uid
        .lines()
        .find(|l| l.starts_with("Uid:"))
        .unwrap()
        .to_owned();
    assert!(
        uid_line.split_whitespace().nth(1).is_none_or(|u| u != "0"),
        "{uid_line}"
    );

    // The unit grabs a keyboard and remaps it.
    let st = c.call("status.get", serde_json::Value::Null).unwrap();
    let mut out = common::Output::open(std::path::Path::new(st["outputDevice"].as_str().unwrap()));
    let mut src = Source::new(&format!("{id}-kbd"));
    wait_until(Duration::from_secs(3), || {
        (c.call("status.get", serde_json::Value::Null).ok()?["devices"]["grabbed"] == 1)
            .then_some(())
    })
    .expect("grabbed");
    src.tap("KEY_A");
    out.expect(&["+KEY_B", "-KEY_B"]);
    drop(out);

    // kill -9: the kernel drops the grab and systemd restarts the engine within 2 s.
    let killed = Instant::now();
    assert!(
        Command::new("kill")
            .args(["-9", &pid1.to_string()])
            .status()
            .unwrap()
            .success()
    );
    wait_until(Duration::from_secs(3), || {
        let p = main_pid(&unit);
        (p != 0 && p != pid1 && systemctl(&["is-active", &unit]) == "active").then_some(())
    })
    .expect("restarted");
    let took = killed.elapsed();
    assert!(took < Duration::from_secs(2), "restart took {took:?}");
    let (mut c, _) = wait_until(Duration::from_secs(3), || {
        Client::connect(&socket, "t").ok()
    })
    .expect("socket");
    let st = c.call("status.get", serde_json::Value::Null).unwrap();
    let mut out = common::Output::open(std::path::Path::new(st["outputDevice"].as_str().unwrap()));
    wait_until(Duration::from_secs(3), || {
        (c.call("status.get", serde_json::Value::Null).ok()?["devices"]["grabbed"] == 1)
            .then_some(())
    })
    .expect("re-grabbed after restart");
    src.tap("KEY_A");
    out.expect(&["+KEY_B", "-KEY_B"]);
    out.assert_no_keys_held();

    // Logs reach journald, at the level set at runtime.
    c.call("log.setLevel", serde_json::json!({"level": "debug"}))
        .unwrap();
    src.tap("KEY_F7");
    out.expect(&["+KEY_F7", "-KEY_F7"]);
    let journal = wait_until(Duration::from_secs(5), || {
        let o = Command::new("journalctl")
            .args(["--user", "-u", &unit, "--no-pager", "-o", "cat"])
            .output()
            .ok()?;
        let j = String::from_utf8_lossy(&o.stdout).into_owned();
        j.contains("+KEY_F7 ->").then_some(j)
    })
    .unwrap_or_else(|| panic!("journal lacks entries for {unit}"));
    assert!(journal.contains("listening on"), "{journal}");
    assert!(journal.contains("grabbed"), "{journal}");
    assert!(journal.contains("log level set to debug"), "{journal}");
    // Priorities are mapped (the `<N>` prefix is not printed literally).
    assert!(!journal.contains("<6>"), "{journal}");
    let o = Command::new("journalctl")
        .args([
            "--user",
            "-u",
            &unit,
            "--no-pager",
            "-o",
            "json",
            "-p",
            "7..7",
        ])
        .output()
        .unwrap();
    assert!(
        String::from_utf8_lossy(&o.stdout).contains("+KEY_F7"),
        "debug lines have priority 7"
    );

    drop(c);
    let o = Command::new(bin())
        .args(["service", "uninstall", "--unit", &unit])
        .output()
        .unwrap();
    assert!(o.status.success(), "{o:?}");
    assert_ne!(systemctl(&["is-active", &unit]), "active");
    assert!(
        !std::path::PathBuf::from(std::env::var("HOME").unwrap())
            .join(format!(".config/systemd/user/{unit}.service"))
            .exists()
    );
}
