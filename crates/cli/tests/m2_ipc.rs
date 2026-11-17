//! M2: the socket protocol (spec §8): every method and topic, the handshake and its errors.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::too_many_lines,
    clippy::many_single_char_names
)]

mod common;

use std::{
    io::{BufRead, BufReader, Write},
    os::unix::{fs::PermissionsExt, net::UnixStream},
    time::Duration,
};

use common::{Engine, uinput_available, wait_until};
use keyrift_engine::client::{Client, ClientError};
use serde_json::{Value, json};

const PROFILE: &str = r#"{"version":1,"name":"t","layers":[
  {"id":"base","keys":{"KEY_RIGHTALT":{"type":"layer","mode":"hold","layer":"nav"}}},
  {"id":"nav","keys":{"KEY_H":{"type":"key","key":"KEY_LEFT"}}}]}"#;

/// A raw connection for protocol-level checks.
struct Raw {
    r: BufReader<UnixStream>,
    w: UnixStream,
}

impl Raw {
    fn new(e: &Engine) -> Raw {
        let s = UnixStream::connect(&e.socket).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        Raw {
            w: s.try_clone().unwrap(),
            r: BufReader::new(s),
        }
    }
    fn send(&mut self, line: &str) -> Value {
        self.w.write_all(format!("{line}\n").as_bytes()).unwrap();
        let mut l = String::new();
        self.r.read_line(&mut l).unwrap();
        serde_json::from_str(&l).unwrap()
    }
}

fn rpc_code(r: Result<Value, ClientError>) -> String {
    match r {
        Err(ClientError::Rpc(e)) => e.code,
        other => panic!("expected an rpc error, got {other:?}"),
    }
}

#[test]
fn handshake_is_required_and_versions_are_checked() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(PROFILE, None);
    let mode = std::fs::metadata(&e.socket).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600, "socket must be user-only");

    let mut raw = Raw::new(&e);
    let r = raw.send(r#"{"id":1,"method":"status.get","params":{}}"#);
    assert_eq!(r["error"]["code"], "hello_required", "{r}");
    let r = raw.send("this is not json");
    assert_eq!(r["error"]["code"], "parse_error", "{r}");
    let r =
        raw.send(r#"{"id":2,"method":"hello","params":{"protocolVersion":"2.0","client":"t"}}"#);
    assert_eq!(r["error"]["code"], "incompatible_version", "{r}");
    let r = raw.send(r#"{"id":3,"method":"hello","params":{}}"#);
    assert_eq!(r["error"]["code"], "incompatible_version", "{r}");
    let r = raw.send(r#"{"id":4,"method":"status.get","params":{}}"#);
    assert_eq!(
        r["error"]["code"], "hello_required",
        "still not accepted: {r}"
    );
    // Minor versions are compatible.
    let r =
        raw.send(r#"{"id":5,"method":"hello","params":{"protocolVersion":"1.7","client":"t"}}"#);
    assert_eq!(r["id"], 5);
    assert_eq!(r["result"]["protocolVersion"], "1.0");
    assert_eq!(r["result"]["state"], "running");
    assert!(r["result"]["engineVersion"].is_string());
    let r = raw.send(r#"{"id":6,"method":"status.get"}"#);
    assert_eq!(r["result"]["state"], "running", "params are optional: {r}");
    let r = raw.send(r#"{"id":7,"method":"no.such.method","params":{}}"#);
    assert_eq!(r["error"]["code"], "unknown_method", "{r}");
}

#[test]
fn every_method_works() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(PROFILE, None);
    let _out = e.output();
    let src = e.source("kbd");
    let (mut c, hello) = Client::connect(&e.socket, "test").unwrap();
    assert_eq!(hello["protocolVersion"], "1.0");

    let st = c.call("status.get", json!({})).unwrap();
    for k in [
        "state",
        "engineVersion",
        "pid",
        "profile",
        "activeLayers",
        "configIssues",
        "devices",
        "outputDevice",
    ] {
        assert!(!st[k].is_null(), "status lacks {k}: {st}");
    }
    assert_eq!(st["profile"], "test");
    assert_eq!(st["activeLayers"], json!(["base"]));
    assert_eq!(st["devices"]["grabbed"], 1);
    assert_eq!(st["devices"]["keyboards"], 1);

    let d = c.call("devices.list", json!({})).unwrap();
    let g = d["devices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["name"] == src.name.as_str());
    let g = g.unwrap_or_else(|| panic!("{d}"));
    assert_eq!(g["vendorId"], "0x1234");
    assert_eq!(g["productId"], "0x5678");
    assert_eq!(g["kind"], "keyboard");
    assert_eq!(g["decision"], "grab");
    assert_eq!(g["members"][0]["grabbed"], true);

    assert_eq!(
        c.call("engine.pause", json!({})).unwrap()["state"],
        "paused"
    );
    assert_eq!(
        c.call("engine.resume", json!({})).unwrap()["state"],
        "running"
    );
    e.wait_grabbed(1);

    let r = c.call("config.reload", json!({})).unwrap();
    assert_eq!(r["ok"], true, "{r}");

    let r = c
        .call(
            "config.validate",
            json!({ "text": PROFILE, "kind": "profile" }),
        )
        .unwrap();
    assert_eq!(r["ok"], true, "{r}");
    let r = c.call("config.validate", json!({ "text": r#"{"version":1,"name":"x","layers":[]}"#, "kind": "profile", "file": "x.json" })).unwrap();
    assert_eq!(r["ok"], false, "{r}");
    assert_eq!(r["issues"][0]["file"], "x.json");
    let r = c
        .call(
            "config.validate",
            json!({ "text": r#"{"version":1,"tapHold":{"timeoutMs":5}}"#, "kind": "settings" }),
        )
        .unwrap();
    assert_eq!(r["ok"], true, "{r}");
    let r = c
        .call(
            "config.validate",
            json!({ "text": r#"{"version":1,"bogus":1}"#, "kind": "settings" }),
        )
        .unwrap();
    assert_eq!(r["ok"], false, "{r}");
    assert_eq!(
        rpc_code(c.call("config.validate", json!({}))),
        "invalid_params"
    );
    assert_eq!(
        rpc_code(c.call("config.validate", json!({"text": "{}", "kind": "nope"}))),
        "invalid_params"
    );
    // Validation never applies anything.
    assert_eq!(
        c.call("status.get", json!({})).unwrap()["configIssues"],
        json!([])
    );

    assert_eq!(
        c.call("log.setLevel", json!({ "level": "warn" })).unwrap()["level"],
        "warn"
    );
    assert_eq!(
        rpc_code(c.call("log.setLevel", json!({ "level": "verbose" }))),
        "invalid_params"
    );

    assert_eq!(c.call("record.start", json!({})).unwrap(), json!({}));
    assert_eq!(
        c.call("record.stop", json!({})).unwrap(),
        json!({ "keys": [] })
    );

    let r = c
        .call("subscribe", json!({ "topics": ["status", "layer"] }))
        .unwrap();
    assert_eq!(r["topics"], json!(["layer", "status"]));
    let r = c
        .call("unsubscribe", json!({ "topics": ["layer"] }))
        .unwrap();
    assert_eq!(r["topics"], json!(["status"]));
    assert_eq!(
        rpc_code(c.call("subscribe", json!({ "topics": ["weather"] }))),
        "invalid_params"
    );
    assert_eq!(rpc_code(c.call("subscribe", json!({}))), "invalid_params");
}

/// Wait for an event of `topic` that satisfies `pred`, skipping others.
fn event(c: &mut Client, topic: &str, pred: impl Fn(&Value) -> bool) -> Value {
    for _ in 0..50 {
        match c.next_event(Some(Duration::from_secs(3))) {
            Ok(ev) if ev.event == topic && pred(&ev.data) => return ev.data,
            Ok(_) => {}
            Err(err) => panic!("no `{topic}` event: {err}"),
        }
    }
    panic!("no matching `{topic}` event");
}

#[test]
fn every_topic_pushes_events_to_subscribers_only() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(PROFILE, None);
    let mut out = e.output();
    let mut src = e.source("kbd");
    let (mut c, _) = Client::connect(&e.socket, "sub").unwrap();
    let (mut quiet, _) = Client::connect(&e.socket, "quiet").unwrap();
    c.call(
        "subscribe",
        json!({ "topics": ["status", "layer", "devices", "config", "tester"] }),
    )
    .unwrap();

    // layer
    src.down("KEY_RIGHTALT");
    let l = event(&mut c, "layer", |_| true);
    assert_eq!(l["layers"], json!(["base", "nav"]));
    // tester: physical key, resolved action, outputs and layers
    src.down("KEY_H");
    let t = event(&mut c, "tester", |d| d["key"] == "KEY_H");
    assert_eq!(t["pressed"], true);
    assert_eq!(t["outputs"], json!(["+KEY_LEFT"]));
    assert_eq!(t["layers"], json!(["base", "nav"]));
    assert!(
        t["action"].as_str().is_some_and(|a| a.contains("KEY_LEFT")),
        "{t}"
    );
    assert!(
        t["device"].as_str().is_some_and(|d| d.ends_with("-kbd")),
        "{t}"
    );
    assert!(t["timeUs"].is_u64());
    src.up("KEY_H").up("KEY_RIGHTALT");
    out.expect(&["+KEY_LEFT", "-KEY_LEFT"]);
    event(&mut c, "layer", |d| d["layers"] == json!(["base"]));

    // status
    c.call("engine.pause", json!({})).unwrap();
    event(&mut c, "status", |d| d["state"] == "paused");
    event(&mut c, "devices", |d| {
        !d.to_string().contains(r#""grabbed":true"#)
    });
    c.call("engine.resume", json!({})).unwrap();
    // Subscribers learn that the keyboard is grabbed again, not only that the state changed: the
    // device list first (from the rescan), then a status that counts the keyboard.
    event(&mut c, "devices", |d| {
        d.to_string().contains(r#""grabbed":true"#)
    });
    event(&mut c, "status", |d| {
        d["state"] == "running" && d["devices"]["keyboards"] == 1
    });

    // The log level is part of the status: changing it sends one.
    c.call("log.setLevel", json!({ "level": "debug" })).unwrap();
    event(&mut c, "status", |d| d["logLevel"] == "debug");

    // devices
    let _second = common::Source::new(&format!("{}-second", e.id));
    event(&mut c, "devices", |d| d.to_string().contains("-second"));

    // config
    e.write_profile(r#"{"version":1,"name":"t","layers":[{"id":"base","keys":{}}]}"#);
    let cfg = event(&mut c, "config", |_| true);
    assert_eq!(cfg["ok"], true);
    // A reload puts back the saved level (info), undoing log.setLevel, and says so.
    event(&mut c, "status", |d| d["logLevel"] == "info");
    e.write_profile("{");
    let cfg = event(&mut c, "config", |d| d["ok"] == false);
    assert_ne!(cfg["issues"], json!([]));

    // The client that did not subscribe got nothing.
    let r = quiet.next_event(Some(Duration::from_millis(200)));
    assert!(r.is_err(), "unsubscribed client received {r:?}");

    // After unsubscribing, tester events stop.
    c.call(
        "unsubscribe",
        json!({ "topics": ["status", "layer", "devices", "config", "tester"] }),
    )
    .unwrap();
    while c.next_event(Some(Duration::from_millis(100))).is_ok() {}
    src.tap("KEY_Z");
    out.expect(&["+KEY_Z", "-KEY_Z"]);
    let r = c.next_event(Some(Duration::from_millis(200)));
    assert!(r.is_err(), "received after unsubscribe: {r:?}");
}

#[test]
fn a_second_engine_on_the_same_socket_is_refused() {
    if !uinput_available() {
        return;
    }
    let e = Engine::start(PROFILE, None);
    let o = std::process::Command::new(common::bin())
        .arg("--socket")
        .arg(&e.socket)
        .args(["daemon", "--config-dir"])
        .arg(&e.config)
        .args([
            "--only-device",
            "nothing-matches-this",
            "--output-name",
            "Keyrift virtual keyboard dup",
        ])
        .output()
        .unwrap();
    assert!(!o.status.success());
    assert!(
        String::from_utf8_lossy(&o.stderr).contains("already listening"),
        "{o:?}"
    );
    // The first engine is unaffected.
    assert_eq!(e.status()["state"], "running");
}

#[test]
fn a_stale_socket_file_is_replaced() {
    if !uinput_available() {
        return;
    }
    let mut e = Engine::start(PROFILE, None);
    e.signal("KILL");
    wait_until(Duration::from_secs(2), || {
        UnixStream::connect(&e.socket).is_err().then_some(())
    })
    .unwrap();
    assert!(e.socket.exists(), "SIGKILL leaves the socket file behind");
    e.spawn();
    assert_eq!(e.status()["state"], "running");
}
