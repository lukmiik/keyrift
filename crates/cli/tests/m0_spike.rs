//! M0: pass-through fidelity and X auto-repeat through the engine (spec §5.8, §12 M0).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::{
    io::Read,
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

use common::{Engine, uinput_available};

const PASSTHROUGH: &str = r#"{"version":1,"name":"t","layers":[{"id":"base","keys":{}}]}"#;

/// Held by each test for its whole run, so the tests in this file run one at a time. X stops a
/// key's auto-repeat when other input devices come and go, which the other test's engine and
/// keyboards do; run in parallel, the repeat test saw too few repeats about once in seven runs.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// Every key code the engine can emit arrives unchanged and in order, and nothing stays held.
#[test]
fn every_key_passes_through_unchanged_and_in_order() {
    let _turn = ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !uinput_available() {
        return;
    }
    // Disable the emergency combo: pressing every key would otherwise trigger it.
    let e = Engine::start(
        PASSTHROUGH,
        Some(r#"{"version":1,"activeProfile":"test","emergencyRelease":{"enabled":false}}"#),
    );
    let mut out = e.output();
    let mut src = e.source("all");
    let names: Vec<&str> = keyrift_core::Key::all()
        .filter(|(_, k)| k.is_emittable())
        .map(|(n, _)| n)
        .collect();
    assert!(names.len() > 300, "{}", names.len());
    // Small chunks: the test reads after each chunk and the evdev client buffer is small.
    for chunk in names.chunks(8) {
        let mut expected = Vec::new();
        for n in chunk {
            src.down(n);
            expected.push(format!("+{n}"));
        }
        for n in chunk.iter().rev() {
            src.up(n);
            expected.push(format!("-{n}"));
        }
        let got = out.read(expected.len(), Duration::from_secs(3));
        assert_eq!(got, expected);
        out.assert_no_keys_held();
    }
}

fn xset_repeat() -> Option<String> {
    let o = Command::new("xset").arg("q").output().ok()?;
    String::from_utf8_lossy(&o.stdout)
        .lines()
        .find(|l| l.contains("auto repeat delay"))
        .map(|l| l.trim().to_owned())
}

/// Holding a key produces X auto-repeat, and the X repeat settings survive the virtual keyboard
/// appearing. Uses `KEY_F24` (X keycode 202), which has no keysym in the author's layout, so the
/// key presses have no effect on the desktop. Skipped without an X display.
#[test]
fn x_auto_repeat_works_through_the_engine() {
    let _turn = ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !uinput_available() || std::env::var_os("DISPLAY").is_none() {
        return;
    }
    let Some(before) = xset_repeat() else { return };
    let e = Engine::start(PASSTHROUGH, None);
    // The test does not grab the output here: X must see it.
    let mut src = e.source("x");
    thread::sleep(Duration::from_millis(1500)); // X adds the new output device
    let after = xset_repeat().unwrap();
    assert_eq!(before, after, "X repeat settings changed");

    let mut xi = Command::new("xinput")
        .args(["test-xi2", "--root"])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    thread::sleep(Duration::from_millis(500));
    src.down("KEY_F24");
    thread::sleep(Duration::from_millis(1200));
    src.up("KEY_F24");
    thread::sleep(Duration::from_millis(300));
    let _ = xi.kill();
    let _ = xi.wait();
    let mut text = String::new();
    xi.stdout.take().unwrap().read_to_string(&mut text).unwrap();

    // Parse "EVENT type 2 (KeyPress)" blocks for detail 202.
    let mut presses = 0;
    let mut repeats = 0;
    let mut releases = 0;
    for block in text.split("EVENT type").skip(1) {
        if !block.lines().any(|l| l.trim() == "detail: 202") {
            continue;
        }
        if block.contains("(KeyPress)") {
            if block
                .lines()
                .any(|l| l.trim().starts_with("flags:") && l.contains("repeat"))
            {
                repeats += 1;
            } else {
                presses += 1;
            }
        } else if block.contains("(KeyRelease)") {
            releases += 1;
        }
    }
    // xinput reports each event for the master and the slave device.
    assert!(
        presses >= 1 && releases >= 1,
        "presses {presses}, releases {releases}\n{text}"
    );
    // 1200 ms hold, 660 ms delay at 25/s gives ~13 repeats per device; accept anything clearly > 0.
    assert!(
        repeats >= 5,
        "expected X auto-repeat, got {repeats}\n{text}"
    );
}
