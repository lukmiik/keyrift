//! M3 end-to-end: every advanced action type from hand-edited JSON, plus `record.*`, the `tester`
//! topic and `keyrift monitor` (spec §4.3–§4.6, §5.4–§5.6, §12 M3).
//!
//! Timing-dependent scenarios use generous margins around the configured timeouts so they stay
//! reliable on a loaded machine.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::{
    io::{BufRead, BufReader},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use common::{Engine, Output, Source, bin, uinput_available};
use keyrift_engine::client::Client;
use serde_json::json;

const PROFILE: &str = r#"{
  "version": 1,
  "name": "advanced",
  "layers": [
    { "id": "base", "keys": {
      "KEY_CAPSLOCK": { "type": "tapHold", "tap": { "type": "key", "key": "KEY_ESC" },
                        "hold": { "type": "mods", "mods": ["LeftCtrl"] } },
      "KEY_A": { "type": "tapHold", "tap": { "type": "key", "key": "KEY_A" },
                 "hold": { "type": "key", "key": "KEY_LEFTSHIFT" },
                 "strategy": "hold-on-other-press", "timeoutMs": 300 },
      "KEY_S": { "type": "tapHold", "tap": { "type": "key", "key": "KEY_S" },
                 "hold": { "type": "key", "key": "KEY_LEFTALT" },
                 "strategy": "timeout-only", "timeoutMs": 150 },
      "KEY_SPACE": { "type": "tapHold", "tap": { "type": "key", "key": "KEY_SPACE" },
                     "hold": { "type": "layer", "mode": "hold", "layer": "nav", "mods": ["LeftShift"] } },
      "KEY_F1": { "type": "layer", "mode": "toggle", "layer": "num" },
      "KEY_F2": { "type": "macro", "steps": [
        { "type": "key", "key": "KEY_H" },
        { "type": "key", "key": "KEY_I", "mods": ["LeftShift"] },
        { "type": "delay", "ms": 300 },
        { "type": "key", "key": "KEY_DOT" } ] },
      "KEY_INSERT": { "type": "none" },
      "KEY_F3": { "type": "mods", "mods": ["LeftCtrl", "LeftShift", "LeftAlt", "LeftSuper"] }
    } },
    { "id": "nav", "keys": { "KEY_H": { "type": "key", "key": "KEY_LEFT" } } },
    { "id": "num", "keys": { "KEY_J": { "type": "key", "key": "KEY_1" }, "KEY_K": { "type": "none" } } }
  ],
  "shortcuts": [
    { "trigger": { "mods": ["Super"], "key": "KEY_C" },
      "action": { "type": "key", "key": "KEY_C", "mods": ["LeftCtrl", "LeftShift"] } },
    { "trigger": { "mods": ["LeftCtrl"], "key": "KEY_Q" }, "action": { "type": "none" } },
    { "trigger": { "mods": ["Alt"], "key": "KEY_F4" },
      "action": { "type": "macro", "steps": [ { "type": "key", "key": "KEY_N" }, { "type": "key", "key": "KEY_O" } ] } }
  ]
}"#;

fn setup() -> Option<(Engine, Output, Source)> {
    if !uinput_available() {
        return None;
    }
    let e = Engine::start(PROFILE, None);
    let out = e.output();
    let src = e.source("kbd");
    Some((e, out, src))
}

fn sleep(ms: u64) {
    thread::sleep(Duration::from_millis(ms));
}

#[test]
fn profile_validates_cleanly() {
    let issues =
        keyrift_config::validate_text(keyrift_config::FileKind::Profile, "advanced.json", PROFILE);
    assert!(issues.is_empty(), "{issues:#?}");
}

#[test]
fn tap_hold_permissive_hold() {
    let Some((_e, mut out, mut src)) = setup() else {
        return;
    };
    // Quick tap → tap action.
    src.tap("KEY_CAPSLOCK");
    out.expect(&["+KEY_ESC", "-KEY_ESC"]);
    // Caps↓ c↓ c↑ Caps↑ within the timeout → Ctrl+C (spec §5.4 example).
    src.down("KEY_CAPSLOCK").down("KEY_C");
    out.expect(&[]);
    src.up("KEY_C");
    out.expect(&["+KEY_LEFTCTRL", "+KEY_C", "-KEY_C"]);
    src.up("KEY_CAPSLOCK");
    out.expect(&["-KEY_LEFTCTRL"]);
    // Rolling Caps↓ c↓ Caps↑ c↑ → Esc, c.
    src.down("KEY_CAPSLOCK")
        .down("KEY_C")
        .up("KEY_CAPSLOCK")
        .up("KEY_C");
    out.expect(&["+KEY_ESC", "-KEY_ESC", "+KEY_C", "-KEY_C"]);
    // Held past the 200 ms default timeout → hold.
    src.down("KEY_CAPSLOCK");
    sleep(320);
    out.expect(&["+KEY_LEFTCTRL"]);
    src.tap("KEY_X");
    src.up("KEY_CAPSLOCK");
    out.expect(&["+KEY_X", "-KEY_X", "-KEY_LEFTCTRL"]);
    out.assert_no_keys_held();
}

#[test]
fn tap_hold_hold_on_other_press() {
    let Some((_e, mut out, mut src)) = setup() else {
        return;
    };
    src.tap("KEY_A");
    out.expect(&["+KEY_A", "-KEY_A"]);
    // Another key pressed while pending → hold immediately.
    src.down("KEY_A").down("KEY_B");
    out.expect(&["+KEY_LEFTSHIFT", "+KEY_B"]);
    src.up("KEY_B").up("KEY_A");
    out.expect(&["-KEY_B", "-KEY_LEFTSHIFT"]);
    // Per-key timeout of 300 ms: still pending at 150 ms, hold after it.
    src.down("KEY_A");
    sleep(150);
    out.expect_nothing(Duration::from_millis(1));
    sleep(300);
    out.expect(&["+KEY_LEFTSHIFT"]);
    src.up("KEY_A");
    out.expect(&["-KEY_LEFTSHIFT"]);
    out.assert_no_keys_held();
}

#[test]
fn tap_hold_timeout_only() {
    let Some((_e, mut out, mut src)) = setup() else {
        return;
    };
    // Other keys do not decide: a full press+release inside the timeout is still a tap.
    src.down("KEY_S").down("KEY_D").up("KEY_D").up("KEY_S");
    out.expect(&["+KEY_S", "-KEY_S", "+KEY_D", "-KEY_D"]);
    // Held past 150 ms → hold, then the buffered key is replayed under it.
    src.down("KEY_S").down("KEY_TAB");
    sleep(300);
    out.expect(&["+KEY_LEFTALT", "+KEY_TAB"]);
    src.up("KEY_TAB").up("KEY_S");
    out.expect(&["-KEY_TAB", "-KEY_LEFTALT"]);
    out.assert_no_keys_held();
}

#[test]
fn layer_tap_with_modifier() {
    let Some((e, mut out, mut src)) = setup() else {
        return;
    };
    src.tap("KEY_SPACE");
    out.expect(&["+KEY_SPACE", "-KEY_SPACE"]);
    // Space↓ h↓ h↑ → hold: layer `nav` + LeftShift, so h → Shift+Left (select left).
    src.down("KEY_SPACE").tap("KEY_H");
    out.expect(&["+KEY_LEFTSHIFT", "+KEY_LEFT", "-KEY_LEFT"]);
    assert_eq!(e.status()["activeLayers"], json!(["base", "nav"]));
    src.up("KEY_SPACE");
    out.expect(&["-KEY_LEFTSHIFT"]);
    assert_eq!(e.status()["activeLayers"], json!(["base"]));
    src.tap("KEY_H");
    out.expect(&["+KEY_H", "-KEY_H"]);
    out.assert_no_keys_held();
}

#[test]
fn toggle_layer() {
    let Some((e, mut out, mut src)) = setup() else {
        return;
    };
    let (mut c, _) = Client::connect(&e.socket, "t").unwrap();
    c.call("subscribe", json!({ "topics": ["layer"] })).unwrap();
    src.tap("KEY_F1");
    out.expect(&[]);
    let ev = c.next_event(Some(Duration::from_secs(2))).unwrap();
    assert_eq!(ev.data["layers"], json!(["base", "num"]));
    src.tap("KEY_J").tap("KEY_K").tap("KEY_L");
    out.expect(&["+KEY_1", "-KEY_1", "+KEY_L", "-KEY_L"]);
    src.tap("KEY_F1");
    let ev = c.next_event(Some(Duration::from_secs(2))).unwrap();
    assert_eq!(ev.data["layers"], json!(["base"]));
    src.tap("KEY_J");
    out.expect(&["+KEY_J", "-KEY_J"]);
    out.assert_no_keys_held();
}

#[test]
fn macro_with_delay_ignores_repress_and_restores_modifiers() {
    let Some((_e, mut out, mut src)) = setup() else {
        return;
    };
    let t = Instant::now();
    src.tap("KEY_F2");
    out.expect(&[
        "+KEY_H",
        "-KEY_H",
        "+KEY_LEFTSHIFT",
        "+KEY_I",
        "-KEY_I",
        "-KEY_LEFTSHIFT",
    ]);
    // Pressing the key again during the delay does not start a second run.
    src.tap("KEY_F2");
    let rest = out.read(2, Duration::from_secs(2));
    assert_eq!(rest, ["+KEY_DOT", "-KEY_DOT"]);
    let took = t.elapsed();
    assert!(
        took >= Duration::from_millis(290),
        "delay not honoured: {took:?}"
    );
    out.expect_nothing(Duration::from_millis(100));
    // A held modifier is released for the macro and restored afterwards.
    src.down("KEY_LEFTCTRL");
    out.expect(&["+KEY_LEFTCTRL"]);
    src.tap("KEY_F2");
    out.expect(&[
        "-KEY_LEFTCTRL",
        "+KEY_H",
        "-KEY_H",
        "+KEY_LEFTSHIFT",
        "+KEY_I",
        "-KEY_I",
        "-KEY_LEFTSHIFT",
    ]);
    let rest = out.read(3, Duration::from_secs(2));
    assert_eq!(rest, ["+KEY_DOT", "-KEY_DOT", "+KEY_LEFTCTRL"]);
    src.up("KEY_LEFTCTRL");
    out.expect(&["-KEY_LEFTCTRL"]);
    out.assert_no_keys_held();
}

#[test]
fn shortcuts_replace_keys_and_restore_trigger_modifiers() {
    let Some((_e, mut out, mut src)) = setup() else {
        return;
    };
    src.down("KEY_LEFTMETA");
    out.expect(&["+KEY_LEFTMETA"]);
    src.down("KEY_C");
    out.expect(&["-KEY_LEFTMETA", "+KEY_LEFTCTRL", "+KEY_LEFTSHIFT", "+KEY_C"]);
    src.up("KEY_C");
    out.expect(&["-KEY_C", "-KEY_LEFTSHIFT", "-KEY_LEFTCTRL", "+KEY_LEFTMETA"]);
    src.up("KEY_LEFTMETA");
    out.expect(&["-KEY_LEFTMETA"]);
    // Generic `Super` matches the right side too; exact modifiers are required.
    src.down("KEY_RIGHTMETA")
        .down("KEY_LEFTSHIFT")
        .tap("KEY_C")
        .up("KEY_LEFTSHIFT")
        .up("KEY_RIGHTMETA");
    out.expect(&[
        "+KEY_RIGHTMETA",
        "+KEY_LEFTSHIFT",
        "+KEY_C",
        "-KEY_C",
        "-KEY_LEFTSHIFT",
        "-KEY_RIGHTMETA",
    ]);
    // Shortcut → None blocks Ctrl+Q.
    src.down("KEY_LEFTCTRL").tap("KEY_Q").up("KEY_LEFTCTRL");
    out.expect(&["+KEY_LEFTCTRL", "-KEY_LEFTCTRL"]);
    // Shortcut → macro: Alt+F4 types "no" without Alt, then Alt comes back.
    src.down("KEY_LEFTALT").down("KEY_F4");
    out.expect(&[
        "+KEY_LEFTALT",
        "-KEY_LEFTALT",
        "+KEY_N",
        "-KEY_N",
        "+KEY_O",
        "-KEY_O",
        "+KEY_LEFTALT",
    ]);
    src.up("KEY_F4").up("KEY_LEFTALT");
    out.expect(&["-KEY_LEFTALT"]);
    out.assert_no_keys_held();
}

#[test]
fn none_and_modifier_only_actions() {
    let Some((_e, mut out, mut src)) = setup() else {
        return;
    };
    src.tap("KEY_INSERT");
    out.expect(&[]);
    // Hyper by hand (F-ACT-3).
    src.down("KEY_F3");
    out.expect(&[
        "+KEY_LEFTCTRL",
        "+KEY_LEFTSHIFT",
        "+KEY_LEFTALT",
        "+KEY_LEFTMETA",
    ]);
    src.tap("KEY_T");
    out.expect(&["+KEY_T", "-KEY_T"]);
    src.up("KEY_F3");
    out.expect(&[
        "-KEY_LEFTMETA",
        "-KEY_LEFTALT",
        "-KEY_LEFTSHIFT",
        "-KEY_LEFTCTRL",
    ]);
    out.assert_no_keys_held();
}

#[test]
fn record_returns_physical_keys_and_passes_them_through_unmapped() {
    let Some((e, mut out, mut src)) = setup() else {
        return;
    };
    let (mut c, _) = Client::connect(&e.socket, "recorder").unwrap();
    c.call("record.start", json!({})).unwrap();
    assert_eq!(e.status()["recording"], true);
    // A second client cannot record at the same time.
    let mut other = e.client();
    assert!(other.call("record.start", json!({})).is_err());
    // While recording, keys pass through unmapped (CapsLock is a tap-hold normally).
    src.tap("KEY_CAPSLOCK").tap("KEY_F2").tap("KEY_INSERT");
    out.expect(&[
        "+KEY_CAPSLOCK",
        "-KEY_CAPSLOCK",
        "+KEY_F2",
        "-KEY_F2",
        "+KEY_INSERT",
        "-KEY_INSERT",
    ]);
    // Live `record` events go to the recording client only.
    let ev = c.next_event(Some(Duration::from_secs(2))).unwrap();
    assert_eq!(ev.event, "record");
    assert_eq!(ev.data["key"], "KEY_CAPSLOCK");
    assert!(ev.data["device"].as_str().unwrap().ends_with("-kbd"));
    let r = c.call("record.stop", json!({})).unwrap();
    assert_eq!(r["keys"], json!(["KEY_CAPSLOCK", "KEY_F2", "KEY_INSERT"]));
    assert_eq!(e.status()["recording"], false);
    // Back to the profile.
    src.tap("KEY_INSERT");
    out.expect(&[]);
    // A recording is dropped when its client disconnects.
    c.call("record.start", json!({})).unwrap();
    drop(c);
    common::wait_until(Duration::from_secs(2), || {
        (e.status()["recording"] == false).then_some(())
    })
    .expect("recording ends with its client");
    out.assert_no_keys_held();
}

#[test]
fn tester_topic_and_monitor_show_events() {
    let Some((e, mut out, mut src)) = setup() else {
        return;
    };
    let mut mon = Command::new(bin())
        .arg("--socket")
        .arg(&e.socket)
        .arg("monitor")
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let (tx, rx) = mpsc::channel();
    let stdout = mon.stdout.take().unwrap();
    thread::spawn(move || {
        for l in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(l).is_err() {
                break;
            }
        }
    });
    let first = rx.recv_timeout(Duration::from_secs(3)).unwrap();
    assert!(first.starts_with("monitoring"), "{first}");
    sleep(100); // the subscription is active once the banner is printed
    src.tap("KEY_INSERT");
    src.down("KEY_SPACE").tap("KEY_H").up("KEY_SPACE");
    out.expect(&["+KEY_LEFTSHIFT", "+KEY_LEFT", "-KEY_LEFT", "-KEY_LEFTSHIFT"]);
    let mut lines = Vec::new();
    while let Ok(l) = rx.recv_timeout(Duration::from_millis(500)) {
        lines.push(l);
    }
    let _ = mon.kill();
    let _ = mon.wait();
    let text = lines.join("\n");
    assert!(text.contains("+KEY_INSERT -> none []"), "{text}");
    assert!(
        text.lines()
            .any(|l| l.contains("-KEY_H") && l.contains("base,nav")),
        "{text}"
    );
    assert!(text.contains("layers: [\"base\",\"nav\"]"), "{text}");
    assert!(
        text.lines()
            .any(|l| l.contains("+KEY_SPACE") && l.ends_with("(base)")),
        "{text}"
    );
}
