//! M1 end-to-end: the author's baseline profile (spec §3, §6.6) through the real daemon.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::{process::Command, time::Duration};

use common::{Engine, baseline_profile, uinput_available};

fn baseline() -> Option<(Engine, common::Output, common::Source)> {
    if !uinput_available() {
        return None;
    }
    let e = Engine::start(&baseline_profile(), None);
    let out = e.output();
    let src = e.source("kbd");
    Some((e, out, src))
}

#[test]
fn esc_and_capslock_are_swapped() {
    let Some((_e, mut out, mut src)) = baseline() else {
        return;
    };
    src.tap("KEY_ESC");
    out.expect(&["+KEY_CAPSLOCK", "-KEY_CAPSLOCK"]);
    src.tap("KEY_CAPSLOCK");
    out.expect(&["+KEY_ESC", "-KEY_ESC"]);
    out.assert_no_keys_held();
}

#[test]
fn unmapped_keys_pass_through_with_modifiers() {
    let Some((_e, mut out, mut src)) = baseline() else {
        return;
    };
    src.tap("KEY_A");
    out.expect(&["+KEY_A", "-KEY_A"]);
    src.down("KEY_LEFTCTRL").tap("KEY_C").up("KEY_LEFTCTRL");
    out.expect(&["+KEY_LEFTCTRL", "+KEY_C", "-KEY_C", "-KEY_LEFTCTRL"]);
    src.tap("KEY_F12").tap("KEY_KP5");
    out.expect(&["+KEY_F12", "-KEY_F12", "+KEY_KP5", "-KEY_KP5"]);
    out.assert_no_keys_held();
}

#[test]
fn alt_tab_keeps_alt_held() {
    let Some((_e, mut out, mut src)) = baseline() else {
        return;
    };
    src.down("KEY_LEFTALT")
        .tap("KEY_TAB")
        .tap("KEY_TAB")
        .up("KEY_LEFTALT");
    out.expect(&[
        "+KEY_LEFTALT",
        "+KEY_TAB",
        "-KEY_TAB",
        "+KEY_TAB",
        "-KEY_TAB",
        "-KEY_LEFTALT",
    ]);
    out.assert_no_keys_held();
}

#[test]
fn left_alt_hjkl_are_arrows_without_alt() {
    let Some((_e, mut out, mut src)) = baseline() else {
        return;
    };
    src.down("KEY_LEFTALT");
    out.expect(&["+KEY_LEFTALT"]);
    for (key, arrow) in [
        ("KEY_H", "KEY_LEFT"),
        ("KEY_J", "KEY_DOWN"),
        ("KEY_K", "KEY_UP"),
        ("KEY_L", "KEY_RIGHT"),
    ] {
        src.tap(key);
        out.expect(&[
            "-KEY_LEFTALT",
            &format!("+{arrow}"),
            &format!("-{arrow}"),
            "+KEY_LEFTALT",
        ]);
    }
    src.up("KEY_LEFTALT");
    out.expect(&["-KEY_LEFTALT"]);
    out.assert_no_keys_held();
}

#[test]
fn right_alt_layer_polish_letters_and_workspaces() {
    let Some((_e, mut out, mut src)) = baseline() else {
        return;
    };
    src.down("KEY_RIGHTALT");
    out.expect(&[]);
    for l in ["A", "E", "O", "S", "L", "Z", "X", "C", "N"] {
        src.tap(&format!("KEY_{l}"));
        out.expect(&[
            "+KEY_RIGHTALT",
            &format!("+KEY_{l}"),
            &format!("-KEY_{l}"),
            "-KEY_RIGHTALT",
        ]);
    }
    for (from, to) in [
        ("KEY_F", "KEY_1"),
        ("KEY_CAPSLOCK", "KEY_2"),
        ("KEY_SPACE", "KEY_3"),
        ("KEY_J", "KEY_4"),
        ("KEY_K", "KEY_5"),
        ("KEY_R", "KEY_6"),
        ("KEY_M", "KEY_7"),
        ("KEY_G", "KEY_8"),
        ("KEY_I", "KEY_9"),
        ("KEY_T", "KEY_0"),
        ("KEY_Q", "KEY_Q"),
        ("KEY_D", "KEY_D"),
    ] {
        src.tap(from);
        out.expect(&[
            "+KEY_LEFTMETA",
            &format!("+{to}"),
            &format!("-{to}"),
            "-KEY_LEFTMETA",
        ]);
    }
    src.tap("KEY_B");
    out.expect(&["+KEY_B", "-KEY_B"]);
    src.up("KEY_RIGHTALT");
    out.expect(&[]);
    out.assert_no_keys_held();
}

/// Shift + RightAlt-layer + A must produce Shift+AltGr+A, which the Polish layout maps to `Ą`.
#[test]
fn shift_right_alt_a_types_capital_a_ogonek() {
    let Some((_e, mut out, mut src)) = baseline() else {
        return;
    };
    src.down("KEY_LEFTSHIFT")
        .down("KEY_RIGHTALT")
        .tap("KEY_A")
        .up("KEY_RIGHTALT")
        .up("KEY_LEFTSHIFT");
    out.expect(&[
        "+KEY_LEFTSHIFT",
        "+KEY_RIGHTALT",
        "+KEY_A",
        "-KEY_A",
        "-KEY_RIGHTALT",
        "-KEY_LEFTSHIFT",
    ]);
    out.assert_no_keys_held();

    // Cross-check with xkbcommon: in `pl`, Ą (U+0104) is X keycode 38 (= evdev KEY_A 30 + 8) at
    // level 4 with Shift + Mod5, and Mod5 is ISO_Level3_Shift (= RightAlt). Skipped without xkbcli.
    let Ok(o) = Command::new("xkbcli")
        .args(["how-to-type", "--layout", "pl", "0x104"])
        .output()
    else {
        return;
    };
    let text = String::from_utf8_lossy(&o.stdout);
    assert!(
        text.lines()
            .any(|l| l.split_whitespace().next() == Some("38") && l.contains("[ Shift Mod5 ]")),
        "xkbcli output: {text}"
    );
    let o = Command::new("xkbcli")
        .args(["how-to-type", "--layout", "pl", "0x105"])
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&o.stdout);
    assert!(
        text.lines()
            .any(|l| l.split_whitespace().next() == Some("38") && l.contains("[ Mod5 ]")),
        "xkbcli output: {text}"
    );
}

#[test]
fn kernel_repeat_is_dropped() {
    let Some((_e, mut out, mut src)) = baseline() else {
        return;
    };
    src.down("KEY_A");
    src.repeat("KEY_A");
    src.repeat("KEY_A");
    src.up("KEY_A");
    out.expect(&["+KEY_A", "-KEY_A"]);
}

#[test]
fn two_keyboards_share_one_layer_state() {
    let Some((e, mut out, mut a)) = baseline() else {
        return;
    };
    let mut b = e.source("kbd2");
    // Hold RightAlt on one keyboard, type on the other (F-DEV-3: one shared state).
    a.down("KEY_RIGHTALT");
    b.tap("KEY_F");
    a.up("KEY_RIGHTALT");
    out.expect(&["+KEY_LEFTMETA", "+KEY_1", "-KEY_1", "-KEY_LEFTMETA"]);
    let devices = e.call("devices.list", serde_json::Value::Null);
    let grabbed: usize = devices["devices"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|d| d["members"].as_array().unwrap())
        .filter(|m| m["grabbed"] == true)
        .count();
    assert_eq!(grabbed, 2, "{devices}");
    out.assert_no_keys_held();
}

#[test]
fn sigterm_releases_held_keys() {
    let Some((e, mut out, mut src)) = baseline() else {
        return;
    };
    src.down("KEY_LEFTSHIFT").down("KEY_X");
    out.expect(&["+KEY_LEFTSHIFT", "+KEY_X"]);
    e.signal("TERM");
    // The virtual device is destroyed on exit; before that all keys must be released.
    let tail = out.read(2, Duration::from_secs(2));
    assert_eq!(tail.len(), 2, "{tail:?}");
    assert!(
        tail.contains(&"-KEY_X".to_owned()) && tail.contains(&"-KEY_LEFTSHIFT".to_owned()),
        "{tail:?}"
    );
}

/// N-1: added latency for non-tap-hold keys stays under 1 ms at p99, measured by the engine from
/// the kernel timestamp of each input event to the end of the uinput write.
#[test]
fn added_latency_is_under_one_millisecond_at_p99() {
    let Some((e, mut out, mut src)) = baseline() else {
        return;
    };
    for _ in 0..250 {
        src.tap("KEY_J");
        assert_eq!(out.read(2, Duration::from_secs(1)).len(), 2);
    }
    let lat = e.status()["latency"].clone();
    assert!(lat["samples"].as_u64().unwrap() >= 500, "{lat}");
    let p99 = lat["p99Us"].as_u64().unwrap();
    eprintln!("latency: {lat}");
    assert!(p99 < 1000, "p99 latency {p99} µs: {lat}");
}
