//! M2: the udev rule, modules-load file and unit template (spec §9).
#![allow(clippy::unwrap_used, clippy::panic)]

use std::{fs, path::PathBuf, process::Command};

fn packaging() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../packaging"))
}

#[test]
fn udev_rule_passes_udevadm_verify() {
    let rule = packaging().join("udev/70-keyrift.rules");
    let text = fs::read_to_string(&rule).unwrap();
    assert!(text.contains(r#"KERNEL=="uinput""#) && text.contains(r#"GROUP="uinput""#));
    assert!(text.contains(r#"KERNEL=="event*""#) && text.contains(r#"GROUP="input""#));
    // `udevadm verify` exists since systemd 253. `--resolve-names=never`: check the rule, not
    // whether this machine has the groups yet (they are created when the package is installed).
    let Ok(o) = Command::new("udevadm")
        .args(["verify", "--resolve-names=never"])
        .arg(&rule)
        .output()
    else {
        return;
    };
    let out = format!(
        "{}{}",
        String::from_utf8_lossy(&o.stdout),
        String::from_utf8_lossy(&o.stderr)
    );
    if out.contains("Unknown command") {
        return;
    }
    assert!(o.status.success(), "{out}");
}

#[test]
fn modules_load_file_loads_uinput() {
    let text = fs::read_to_string(packaging().join("modules-load.d/keyrift.conf")).unwrap();
    let lines: Vec<&str> = text
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .collect();
    assert_eq!(lines, ["uinput"]);
}

#[test]
fn unit_template_matches_spec() {
    let text = fs::read_to_string(packaging().join("systemd/keyrift.service")).unwrap();
    for line in [
        "Restart=on-failure",
        "RestartSec=1",
        "WantedBy=default.target",
        "ExecStart=/usr/bin/keyrift daemon",
    ] {
        assert!(text.contains(line), "missing {line}");
    }
    if let Ok(o) = Command::new("systemd-analyze")
        .args(["--user", "verify"])
        .arg(packaging().join("systemd/keyrift.service"))
        .output()
    {
        let err = String::from_utf8_lossy(&o.stderr);
        // No user service manager to verify against (CI runners, containers): skip that part.
        if err.contains("Failed to initialize manager") {
            return;
        }
        // The binary path need not exist on the build machine.
        let real: Vec<&str> = err
            .lines()
            .filter(|l| !l.contains("/usr/bin/keyrift") && !l.trim().is_empty())
            .collect();
        assert!(real.is_empty(), "{err}");
    }
}
