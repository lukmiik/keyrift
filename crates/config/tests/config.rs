//! Config parsing, validation, schema and compilation tests.
#![allow(clippy::unwrap_used)]

use std::{fs, path::PathBuf};

use keyrift_config::{
    ConfigDir, FileKind, Profile, Settings, Severity, compile, detect_kind, parse_json,
    profile_schema, settings_schema, validate_profile, validate_text, write_schemas,
};
use keyrift_core::{Engine, Key, KeyEvent, Output};

fn examples() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/config")
}

fn daily_text() -> String {
    fs::read_to_string(examples().join("profiles/daily.json")).unwrap()
}

fn errors(file_kind: FileKind, text: &str) -> Vec<String> {
    validate_text(file_kind, "test.json", text)
        .into_iter()
        .filter(|i| i.severity == Severity::Error)
        .map(|i| i.to_string())
        .collect()
}

#[test]
fn baseline_profile_is_valid_without_warnings() {
    let issues = validate_text(FileKind::Profile, "daily.json", &daily_text());
    assert!(issues.is_empty(), "{issues:#?}");
}

#[test]
fn example_files_validate_against_generated_schemas() {
    for (file, schema) in [
        ("profiles/daily.json", profile_schema()),
        ("settings.json", settings_schema()),
    ] {
        let validator = jsonschema::validator_for(&schema).unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(examples().join(file)).unwrap()).unwrap();
        let errs: Vec<String> = validator
            .iter_errors(&value)
            .map(|e| e.to_string())
            .collect();
        assert!(errs.is_empty(), "{file}: {errs:#?}");
    }
}

#[test]
fn schema_rejects_unknown_key_names_and_fields() {
    let validator = jsonschema::validator_for(&profile_schema()).unwrap();
    let bad_key: serde_json::Value = serde_json::json!({
        "version": 1, "layers": [{ "id": "base", "keys": { "KEY_A": { "type": "key", "key": "KEY_NOPE" } } }]
    });
    assert!(!validator.is_valid(&bad_key));
    let bad_field: serde_json::Value = serde_json::json!({ "version": 1, "colour": "red" });
    assert!(!validator.is_valid(&bad_field));
}

#[test]
fn baseline_compiles_to_working_keymap() {
    let p: Profile = parse_json("daily.json", &daily_text()).unwrap();
    let km = compile(&p, &Settings::default().tap_hold);
    assert_eq!(km.layers.len(), 3);
    let mut e = Engine::new(km);
    let mut out = Vec::new();
    let k = |n| Key::from_name(n).unwrap();
    for (key, pressed) in [
        ("KEY_LEFTALT", true),
        ("KEY_H", true),
        ("KEY_H", false),
        ("KEY_LEFTALT", false),
    ] {
        e.handle(
            KeyEvent {
                device: 0,
                key: k(key),
                pressed,
                time: 0,
            },
            0,
            &mut out,
        );
    }
    let keys: Vec<(Key, bool)> = out
        .into_iter()
        .filter_map(|o| {
            if let Output::Key { key, pressed } = o {
                Some((key, pressed))
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        keys,
        vec![
            (Key::LEFTALT, true),
            (Key::LEFTALT, false),
            (k("KEY_LEFT"), true),
            (k("KEY_LEFT"), false),
            (Key::LEFTALT, true),
            (Key::LEFTALT, false)
        ]
    );
}

#[test]
fn round_trip_serialization_preserves_profile() {
    let p: Profile = parse_json("daily.json", &daily_text()).unwrap();
    let text = serde_json::to_string_pretty(&p).unwrap();
    let back: Profile = parse_json("daily.json", &text).unwrap();
    assert_eq!(p, back);
}

#[test]
fn readable_errors_for_bad_json_and_unknown_keys() {
    let e = errors(FileKind::Profile, "{ \"version\": 1, ");
    assert_eq!(e.len(), 1);
    assert!(e[0].contains("line 1"), "{e:?}");
    let e = errors(
        FileKind::Profile,
        r#"{"layers":[{"id":"base","keys":{"KEY_A":{"type":"key","key":"KEY_NOPE"}}}]}"#,
    );
    assert!(e[0].contains("unknown key `KEY_NOPE`"), "{e:?}");
    let e = errors(
        FileKind::Profile,
        r#"{"layers":[{"id":"base","keys":{"KEY_NOPE":{"type":"none"}}}]}"#,
    );
    assert!(e[0].contains("unknown key `KEY_NOPE`"), "{e:?}");
    let e = errors(
        FileKind::Settings,
        r#"{"activeProfile":"x","colour":"red"}"#,
    );
    assert!(e[0].contains("unknown field `colour`"), "{e:?}");
}

#[test]
fn semantic_errors_are_reported() {
    let cases = [
        (r#"{"version":2}"#, "unsupported version 2"),
        (
            r#"{"layers":[{"id":"base","keys":{"KEY_A":{"type":"layer","mode":"hold","layer":"nav"}}}]}"#,
            "unknown layer `nav`",
        ),
        (
            r#"{"layers":[{"id":"a"},{"id":"a"}]}"#,
            "duplicate layer id `a`",
        ),
        (
            r#"{"layers":[{"id":"base","keys":{"KEY_A":{"type":"tapHold","tap":{"type":"macro","steps":[]},"hold":{"type":"none"}}}}]}"#,
            "not allowed as a tap action",
        ),
        (
            r#"{"layers":[{"id":"base","keys":{"KEY_A":{"type":"layer","mode":"toggle","layer":"n"}}},{"id":"n","keys":{"KEY_B":{"type":"tapHold","tap":{"type":"none"},"hold":{"type":"layer","mode":"toggle","layer":"n"}}}}]}"#,
            "not allowed as a hold action",
        ),
        (
            r#"{"layers":[{"id":"base","keys":{"KEY_A":{"type":"tapHold","tap":{"type":"none"},"hold":{"type":"none"},"timeoutMs":0}}}]}"#,
            "must be 1..=",
        ),
        (
            r#"{"shortcuts":[{"trigger":{"mods":["Ctrl","Shift"],"key":"KEY_C"},"action":{"type":"none"}},{"trigger":{"mods":["Shift","Ctrl"],"key":"KEY_C"},"action":{"type":"none"}}]}"#,
            "duplicate shortcut trigger",
        ),
        (
            r#"{"shortcuts":[{"trigger":{"key":"KEY_C"},"action":{"type":"layer","mode":"hold","layer":"x"}}]}"#,
            "not allowed as a shortcut action",
        ),
        (
            r#"{"layers":[{"id":"base","keys":{"KEY_A":{"type":"mods","mods":[]}}}]}"#,
            "must not be empty",
        ),
        (
            r#"{"layers":[{"id":"base","keys":{"KEY_A":{"type":"macro","steps":[{"type":"delay","ms":70000}]}}}]}"#,
            "delay must be at most",
        ),
    ];
    for (text, expected) in cases {
        let e = errors(FileKind::Profile, text);
        assert!(
            e.iter().any(|m| m.contains(expected)),
            "{text}\nexpected `{expected}` in {e:#?}"
        );
    }
    let cases = [
        (r#"{"activeProfile":"../x"}"#, "plain file name"),
        (r#"{"tapHold":{"timeoutMs":0}}"#, "must be 1..="),
        (
            r#"{"emergencyRelease":{"keys":["KEY_ESC"]}}"#,
            "at least two keys",
        ),
        (
            r#"{"devices":{"excluded":[{"vendorId":"12","productId":"0x1","name":"x"}]}}"#,
            "hex id",
        ),
    ];
    for (text, expected) in cases {
        let e = errors(FileKind::Settings, text);
        assert!(
            e.iter().any(|m| m.contains(expected)),
            "{text}\nexpected `{expected}` in {e:#?}"
        );
    }
}

#[test]
fn unreachable_layer_is_a_warning_only() {
    let p: Profile = parse_json("p", r#"{"layers":[{"id":"base"},{"id":"orphan"}]}"#).unwrap();
    let issues = validate_profile("p", &p);
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].severity, Severity::Warning);
}

#[test]
fn release_held_accepts_all_or_list() {
    let p: Profile = parse_json(
        "p",
        r#"{"layers":[{"id":"base","keys":{
            "KEY_A":{"type":"key","key":"KEY_LEFT","releaseHeld":"all"},
            "KEY_B":{"type":"key","key":"KEY_LEFT","releaseHeld":["LeftAlt"]}}}]}"#,
    )
    .unwrap();
    assert_eq!(validate_profile("p", &p), Vec::new());
    assert!(parse_json::<Profile>("p", r#"{"layers":[{"id":"b","keys":{"KEY_A":{"type":"key","key":"KEY_A","releaseHeld":"some"}}}]}"#).is_err());
}

#[test]
fn load_missing_dir_gives_passthrough_with_warning() {
    let dir = tempfile::tempdir().unwrap();
    let loaded = ConfigDir::new(dir.path()).load();
    assert!(!loaded.has_errors());
    assert_eq!(loaded.issues.len(), 1);
    assert_eq!(loaded.keymap.layers.len(), 1);
    assert_eq!(loaded.profile_name, "default");
}

#[test]
fn load_example_dir() {
    let loaded = ConfigDir::new(examples()).load();
    assert!(loaded.issues.is_empty(), "{:#?}", loaded.issues);
    assert_eq!(loaded.profile_name, "daily");
    assert_eq!(loaded.keymap.layers.len(), 3);
}

#[test]
fn load_reports_invalid_profile_and_falls_back() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = ConfigDir::new(dir.path());
    fs::create_dir_all(cfg.profiles_dir()).unwrap();
    fs::write(
        cfg.profile_path("default"),
        r#"{"layers":[{"id":"base","keys":{"KEY_A":{"type":"layer","mode":"hold","layer":"x"}}}]}"#,
    )
    .unwrap();
    let loaded = cfg.load();
    assert!(loaded.has_errors());
    assert_eq!(loaded.issues[0].file, "profiles/default.json");
}

#[test]
fn detect_kind_by_name_and_content() {
    let p = std::path::Path::new;
    assert_eq!(detect_kind(p("/x/settings.json"), "{}"), FileKind::Settings);
    assert_eq!(
        detect_kind(p("/x/profiles/a.json"), "{}"),
        FileKind::Profile
    );
    assert_eq!(
        detect_kind(p("/x/a.json"), r#"{"activeProfile":"a"}"#),
        FileKind::Settings
    );
    assert_eq!(
        detect_kind(p("/x/a.json"), r#"{"layers":[]}"#),
        FileKind::Profile
    );
}

#[test]
fn write_schemas_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    assert!(write_schemas(dir.path()).unwrap());
    assert!(!write_schemas(dir.path()).unwrap());
    assert!(dir.path().join("profile.v1.json").exists());
}

#[test]
fn unknown_fields_inside_actions_are_rejected() {
    let e = errors(
        FileKind::Profile,
        r#"{"layers":[{"id":"base","keys":{"KEY_A":{"type":"key","key":"KEY_B","mod":["LeftAlt"]}}}]}"#,
    );
    assert!(e.iter().any(|m| m.contains("unknown field `mod`")), "{e:?}");
    let e = errors(
        FileKind::Profile,
        r#"{"layers":[{"id":"base","keys":{"KEY_A":{"type":"macro","steps":[{"type":"delay","ms":1,"x":1}]}}}]}"#,
    );
    assert!(e.iter().any(|m| m.contains("unknown field `x`")), "{e:?}");
}

#[test]
fn profile_needs_a_base_layer() {
    let e = errors(FileKind::Profile, r#"{"version":1,"name":"x","layers":[]}"#);
    assert!(e.iter().any(|m| m.contains("at least one layer")), "{e:?}");
    let e = errors(FileKind::Profile, r#"{"version":1,"name":"x"}"#);
    assert!(e.iter().any(|m| m.contains("at least one layer")), "{e:?}");
    let schema = serde_json::to_value(profile_schema()).unwrap();
    let v = jsonschema::validator_for(&schema).unwrap();
    assert!(!v.is_valid(&serde_json::json!({"version":1,"name":"x","layers":[]})));
}
