//! M2 end-to-end: hot-plug, simulated resume, live reload, emergency release, pause, logging,
//! busy devices and exclusions (spec §4.1, §4.8, §5.7, §12 M2).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::{
    process::Command,
    time::{Duration, Instant},
};

use common::{Engine, Source, bin, uinput_available, wait_until};
use serde_json::Value;

const PASSTHROUGH: &str = r#"{"version":1,"name":"t","layers":[{"id":"base","keys":{}}]}"#;
const A_TO_B: &str = r#"{"version":1,"name":"t","layers":[{"id":"base","keys":{"KEY_A":{"type":"key","key":"KEY_B"}}}]}"#;
const A_TO_C: &str = r#"{"version":1,"name":"t","layers":[{"id":"base","keys":{"KEY_A":{"type":"key","key":"KEY_C"}}}]}"#;

/// Run the CLI against the test engine's socket.
fn cli(e: &Engine, args: &[&str]) -> (bool, String) {
    let o = Command::new(bin())
        .arg("--socket")
        .arg(&e.socket)
        .args(args)
        .output()
        .unwrap();
    let mut text = String::from_utf8_lossy(&o.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&o.stderr));
    (o.status.success(), text)
}

fn state(e: &Engine) -> String {
    e.status()["state"].as_str().unwrap_or_default().to_owned()
}

fn wait_state(e: &Engine, s: &str) {
    wait_until(Duration::from_secs(3), || (state(e) == s).then_some(()))
        .unwrap_or_else(|| panic!("state never became {s}: {}", e.status()));
}

/// Grab the source from the test; succeeds only once the engine has let go of it.
fn wait_ungrabbed(src: &Source) -> evdev::Device {
    wait_until(Duration::from_secs(3), || src.grab_self())
        .expect("engine still holds the source device")
}

#[test]
fn hot_plugged_keyboard_is_grabbed_within_one_second() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(PASSTHROUGH, None);
    let mut out = e.output();
    let t = Instant::now();
    let mut src = Source::new(&format!("{}-hotplug", e.id));
    wait_until(Duration::from_secs(1), || (e.grabbed() == 1).then_some(()))
        .unwrap_or_else(|| panic!("not grabbed within 1 s: {}", e.status()));
    let took = t.elapsed();
    assert!(took < Duration::from_secs(1), "{took:?}");
    src.tap("KEY_Q");
    out.expect(&["+KEY_Q", "-KEY_Q"]);
}

#[test]
fn unplugging_a_keyboard_with_keys_held_releases_them() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(PASSTHROUGH, None);
    let mut out = e.output();
    let mut src = e.source("unplug");
    src.down("KEY_LEFTSHIFT").down("KEY_W");
    out.expect(&["+KEY_LEFTSHIFT", "+KEY_W"]);
    drop(src); // destroys the device: the engine's read fails with ENODEV
    let tail = out.read(2, Duration::from_secs(2));
    assert_eq!(tail.len(), 2, "{tail:?}");
    assert!(tail.contains(&"-KEY_W".to_owned()) && tail.contains(&"-KEY_LEFTSHIFT".to_owned()));
    out.assert_no_keys_held();
    e.wait_grabbed(0);
    assert_eq!(state(&e), "running");
}

/// Resume is simulated by removing every keyboard and adding them again (spec §12 M2).
#[test]
fn simulated_resume_regrabs_all_keyboards() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(A_TO_B, None);
    let mut out = e.output();
    let mut a = e.source("one");
    let mut b = e.source("two");
    a.down("KEY_A");
    out.expect(&["+KEY_B"]);
    drop(a);
    drop(b);
    out.expect(&["-KEY_B"]);
    e.wait_grabbed(0);
    a = Source::new(&format!("{}-one", e.id));
    b = Source::new(&format!("{}-two", e.id));
    e.wait_grabbed(2);
    a.tap("KEY_A");
    b.tap("KEY_A");
    out.expect(&["+KEY_B", "-KEY_B", "+KEY_B", "-KEY_B"]);
    out.assert_no_keys_held();
    assert_eq!(state(&e), "running", "no restart");
}

#[test]
fn live_reload_applies_valid_changes() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(A_TO_B, None);
    let mut out = e.output();
    let mut src = e.source("kbd");
    src.tap("KEY_A");
    out.expect(&["+KEY_B", "-KEY_B"]);
    let pid = e.status()["pid"].clone();
    e.write_profile(A_TO_C);
    wait_until(Duration::from_secs(3), || {
        src.tap("KEY_A");
        let got = out.read(2, Duration::from_millis(100));
        (got == ["+KEY_C", "-KEY_C"]).then_some(())
    })
    .expect("new config never applied");
    assert_eq!(e.status()["pid"], pid, "applied without restart");
    out.assert_no_keys_held();
}

#[test]
fn reload_while_a_key_is_held_waits_for_release() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(A_TO_B, None);
    let mut out = e.output();
    let mut src = e.source("kbd");
    src.down("KEY_A");
    out.expect(&["+KEY_B"]);
    e.write_profile(A_TO_C);
    wait_until(Duration::from_secs(3), || {
        e.status()["configPending"].as_bool().filter(|p| *p)
    })
    .expect("config should be pending while a key is held");
    // The held key is released through its original action.
    src.up("KEY_A");
    out.expect(&["-KEY_B"]);
    wait_until(Duration::from_secs(2), || {
        (e.status()["configPending"] == false).then_some(())
    })
    .unwrap();
    src.tap("KEY_A");
    out.expect(&["+KEY_C", "-KEY_C"]);
    out.assert_no_keys_held();
}

#[test]
fn invalid_config_is_rejected_and_the_old_one_keeps_working() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(A_TO_B, None);
    let mut out = e.output();
    let mut src = e.source("kbd");
    // Unknown layer reference: valid JSON, semantically invalid.
    e.write_profile(
        r#"{"version":1,"name":"t","layers":[{"id":"base","keys":{"KEY_A":{"type":"layer","mode":"hold","layer":"nope"}}}]}"#,
    );
    wait_until(Duration::from_secs(3), || {
        e.status()["configIssues"]
            .as_array()
            .filter(|a| !a.is_empty())
            .map(|_| ())
    })
    .expect("issues reported");
    src.tap("KEY_A");
    out.expect(&["+KEY_B", "-KEY_B"]);
    let (ok, text) = cli(&e, &["status"]);
    assert!(ok, "{text}");
    assert!(
        text.contains("config issues") && text.contains("nope"),
        "{text}"
    );
    // Broken JSON reports a position.
    e.write_profile("{\"version\": 1,\n  \"name\": ");
    wait_until(Duration::from_secs(3), || {
        e.status()["configIssues"]
            .to_string()
            .contains("line 2")
            .then_some(())
    })
    .unwrap_or_else(|| panic!("{}", e.status()));
    src.tap("KEY_A");
    out.expect(&["+KEY_B", "-KEY_B"]);
    assert_eq!(state(&e), "running");
    // `keyrift reload` reports the same errors with a failing exit code.
    let (ok, text) = cli(&e, &["reload"]);
    assert!(!ok && text.contains("line 2"), "{text}");
}

#[test]
fn emergency_combo_releases_everything_until_resumed() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(PASSTHROUGH, None);
    let mut out = e.output();
    let mut src = e.source("kbd");
    src.down("KEY_LEFTCTRL").down("KEY_SPACE");
    out.expect(&["+KEY_LEFTCTRL", "+KEY_SPACE"]);
    src.down("KEY_ESC");
    let tail = out.read(2, Duration::from_secs(2));
    assert!(
        tail.contains(&"-KEY_SPACE".to_owned()) && tail.contains(&"-KEY_LEFTCTRL".to_owned()),
        "{tail:?}"
    );
    out.expect_nothing(Duration::from_millis(50));
    out.assert_no_keys_held();
    wait_state(&e, "released");
    // The engine let go of the device: the test can grab it (so these releases do not reach X).
    let guard = wait_ungrabbed(&src);
    src.up("KEY_ESC").up("KEY_SPACE").up("KEY_LEFTCTRL");
    out.expect_nothing(Duration::from_millis(50));
    drop(guard);
    assert_eq!(e.grabbed(), 0);
    let (ok, text) = cli(&e, &["resume"]);
    assert!(ok, "{text}");
    wait_state(&e, "running");
    e.wait_grabbed(1);
    src.tap("KEY_A");
    out.expect(&["+KEY_A", "-KEY_A"]);
    out.assert_no_keys_held();
    assert!(e.log().contains("emergency release"), "{}", e.log());
}

#[test]
fn emergency_combo_can_be_reconfigured() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(
        PASSTHROUGH,
        Some(
            r#"{"version":1,"activeProfile":"test","emergencyRelease":{"enabled":true,"keys":["KEY_F23","KEY_F24"]}}"#,
        ),
    );
    let mut out = e.output();
    let mut src = e.source("kbd");
    src.down("KEY_LEFTCTRL").down("KEY_SPACE").down("KEY_ESC");
    out.expect(&["+KEY_LEFTCTRL", "+KEY_SPACE", "+KEY_ESC"]);
    src.up("KEY_ESC").up("KEY_SPACE").up("KEY_LEFTCTRL");
    out.expect(&["-KEY_ESC", "-KEY_SPACE", "-KEY_LEFTCTRL"]);
    assert_eq!(state(&e), "running");
    src.down("KEY_F23").down("KEY_F24");
    out.expect(&["+KEY_F23", "-KEY_F23"]);
    wait_state(&e, "released");
    let _guard = wait_ungrabbed(&src);
    src.up("KEY_F24").up("KEY_F23");
}

#[test]
fn pause_ungrabs_and_resume_regrabs() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(A_TO_B, None);
    let mut out = e.output();
    let mut src = e.source("kbd");
    src.down("KEY_LEFTSHIFT");
    out.expect(&["+KEY_LEFTSHIFT"]);
    let (ok, text) = cli(&e, &["pause"]);
    assert!(ok, "{text}");
    out.expect(&["-KEY_LEFTSHIFT"]);
    out.assert_no_keys_held();
    assert_eq!(state(&e), "paused");
    let guard = wait_ungrabbed(&src);
    src.up("KEY_LEFTSHIFT");
    src.tap("KEY_A");
    out.expect_nothing(Duration::from_millis(50));
    drop(guard);
    let (ok, text) = cli(&e, &["resume"]);
    assert!(ok, "{text}");
    e.wait_grabbed(1);
    src.tap("KEY_A");
    out.expect(&["+KEY_B", "-KEY_B"]);
    // Pausing twice and resuming twice is harmless.
    assert!(cli(&e, &["pause"]).0 && cli(&e, &["pause"]).0);
    assert!(cli(&e, &["resume"]).0 && cli(&e, &["resume"]).0);
    e.wait_grabbed(1);
    out.assert_no_keys_held();
}

#[test]
fn log_level_changes_at_runtime() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(PASSTHROUGH, None);
    let mut out = e.output();
    let mut src = e.source("kbd");
    assert_eq!(e.status()["logLevel"], "info");
    src.tap("KEY_F1");
    out.expect(&["+KEY_F1", "-KEY_F1"]);
    let (ok, text) = cli(&e, &["log-level", "debug"]);
    assert!(ok, "{text}");
    assert_eq!(e.status()["logLevel"], "debug");
    src.tap("KEY_F2");
    out.expect(&["+KEY_F2", "-KEY_F2"]);
    assert!(cli(&e, &["log-level", "info"]).0);
    src.tap("KEY_F3");
    out.expect(&["+KEY_F3", "-KEY_F3"]);
    let log = e.log();
    assert!(!log.contains("+KEY_F1 ->"), "{log}");
    assert!(log.contains("+KEY_F2 ->"), "{log}");
    assert!(!log.contains("+KEY_F3 ->"), "{log}");
    assert!(log.contains("log level set to debug"));
    let (ok, text) = cli(&e, &["log-level", "loud"]);
    assert!(!ok, "{text}");
}

#[test]
fn keyboard_held_by_another_program_is_reported_then_grabbed() {
    if !uinput_available() {
        return;
    }
    let id_probe = Engine::start(PASSTHROUGH, None);
    // Re-create the scenario: a device that is already grabbed when the engine looks at it.
    let src = Source::new(&format!("{}-busy", id_probe.id));
    let other = wait_until(Duration::from_secs(2), || {
        // The engine may have grabbed it first; pause it to take the device, then resume.
        let _ = id_probe.call("engine.pause", Value::Null);
        src.grab_self()
    })
    .expect("take the device");
    let _ = id_probe.call("engine.resume", Value::Null);
    let blocked = wait_until(Duration::from_secs(3), || {
        let st = id_probe.status();
        let b = st["devices"]["blocked"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        b.iter()
            .find(|x| x["reason"].as_str().is_some_and(|r| r.starts_with("busy")))
            .cloned()
    })
    .unwrap_or_else(|| panic!("not reported as busy: {}", id_probe.status()));
    assert_eq!(
        blocked["path"].as_str().map(std::path::PathBuf::from),
        Some(src.node.clone())
    );
    assert!(
        id_probe.log().contains("another program has grabbed"),
        "{}",
        id_probe.log()
    );
    drop(other);
    // Retried every 5 s.
    wait_until(Duration::from_secs(7), || {
        (id_probe.grabbed() == 1).then_some(())
    })
    .unwrap_or_else(|| panic!("never grabbed after release: {}", id_probe.status()));
    assert_eq!(
        id_probe.status()["devices"]["blocked"],
        serde_json::json!([])
    );
}

#[test]
fn excluded_keyboards_are_not_grabbed_and_exclusion_reloads_live() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(PASSTHROUGH, None);
    let mut out = e.output();
    let name = format!("{}-excluded", e.id);
    let settings = format!(
        r#"{{"version":1,"activeProfile":"test","devices":{{"excluded":[{{"vendorId":"0x1234","productId":"0x5678","name":"{name}"}}]}}}}"#
    );
    e.write_settings(&settings);
    wait_until(Duration::from_secs(3), || {
        (e.log().matches("config loaded").count() >= 2).then_some(())
    })
    .expect("settings reloaded");
    let src = Source::new(&name);
    let decision = wait_until(Duration::from_secs(3), || {
        let d = e.call("devices.list", Value::Null);
        d["devices"]
            .as_array()
            .unwrap()
            .iter()
            .find(|g| g["name"] == name.as_str())
            .map(|g| g["decision"].clone())
    })
    .expect("listed");
    assert_eq!(decision, "excluded");
    assert_eq!(e.grabbed(), 0);
    // The test can hold it, so the engine really did not grab it.
    let guard = src.grab_self().expect("not grabbed by the engine");
    drop(guard);
    e.write_settings(r#"{"version":1,"activeProfile":"test"}"#);
    e.wait_grabbed(1);
    out.expect_nothing(Duration::from_millis(20));
}

/// F-DEV-2 + F-SYS-8: when another program holds one interface of a keyboard, the engine holds
/// none of them (seen with kanata, which grabs only one of the two key interfaces of the author's keyboard).
#[test]
fn keyboard_held_partly_by_another_program_is_not_split() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(PASSTHROUGH, None);
    let mut out = e.output();
    e.call("engine.pause", Value::Null);
    let phys = format!("{}/usb-1", e.id);
    let mut a = common::raw::RawSource::new(&format!("{}-g", e.id), &format!("{phys}/input0"));
    let mut b = common::raw::RawSource::new(&format!("{}-g", e.id), &format!("{phys}/input1"));
    // udev applies the node permissions shortly after creation.
    let held = wait_until(Duration::from_secs(3), || b.grab_self()).expect("take one interface");
    e.call("engine.resume", Value::Null);
    let blocked = wait_until(Duration::from_secs(3), || {
        let b = e.status()["devices"]["blocked"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        (b.len() == 2).then_some(b)
    })
    .unwrap_or_else(|| panic!("{}", e.status()));
    assert!(
        blocked
            .iter()
            .all(|x| x["reason"].as_str().unwrap().starts_with("busy:")),
        "{blocked:?}"
    );
    assert_eq!(e.grabbed(), 0);
    // The engine really let go of the other interface.
    drop(
        a.grab_self()
            .expect("engine must not hold the other interface"),
    );
    let d = e.call("devices.list", Value::Null);
    let groups: Vec<&Value> = d["devices"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|g| g["key"].as_str() == Some(phys.as_str()))
        .collect();
    assert_eq!(groups.len(), 1, "one group: {d}");
    assert_eq!(groups[0]["members"].as_array().unwrap().len(), 2);
    drop(held);
    wait_until(Duration::from_secs(7), || (e.grabbed() == 2).then_some(()))
        .unwrap_or_else(|| panic!("whole keyboard grabbed after release: {}", e.status()));
    a.tap("KEY_1");
    b.tap("KEY_2");
    out.expect(&["+KEY_1", "-KEY_1", "+KEY_2", "-KEY_2"]);
    out.assert_no_keys_held();
}
