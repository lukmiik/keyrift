//! Scenario tests for the remapping engine: timestamped input → expected output.
#![allow(clippy::panic)]

use std::sync::Arc;

use keyrift_core::{
    Action, Engine, Key, KeyEvent, Keymap, Layer, LayerMode, MacroStep, ModSet, Modifier, Output,
    Shortcut, Strategy, TapHold, Trigger, ms,
};

fn k(name: &str) -> Key {
    Key::from_name(name).unwrap_or_else(|| panic!("unknown key {name}"))
}

/// Small driver: keeps a clock and collects key outputs as `"+KEY_A"` / `"-KEY_A"` strings.
struct Sim {
    e: Engine,
    now: u64,
    out: Vec<Output>,
}

impl Sim {
    fn new(keymap: Keymap) -> Sim {
        Sim {
            e: Engine::new(keymap),
            now: 0,
            out: Vec::new(),
        }
    }
    fn at(&mut self, t_ms: u64) -> &mut Self {
        self.now = ms(t_ms);
        self.e.tick(self.now, &mut self.out);
        self
    }
    fn ev(&mut self, dev: u32, name: &str, pressed: bool) -> &mut Self {
        let ev = KeyEvent {
            device: dev,
            key: k(name),
            pressed,
            time: self.now,
        };
        self.e.handle(ev, self.now, &mut self.out);
        self
    }
    fn down(&mut self, name: &str) -> &mut Self {
        self.ev(0, name, true)
    }
    fn up(&mut self, name: &str) -> &mut Self {
        self.ev(0, name, false)
    }
    fn tap(&mut self, name: &str) -> &mut Self {
        self.down(name).up(name)
    }
    /// Take the key outputs produced so far.
    fn take(&mut self) -> Vec<String> {
        std::mem::take(&mut self.out)
            .into_iter()
            .filter_map(|o| match o {
                Output::Key { key, pressed } => {
                    Some(format!("{}{}", if pressed { "+" } else { "-" }, key))
                }
                _ => None,
            })
            .collect()
    }
}

fn exp(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_owned()).collect()
}

fn mods(m: &[Modifier]) -> ModSet {
    ModSet::from_mods(m.iter().copied())
}

/// The author's baseline profile (spec §6.6) built directly as a core keymap.
fn baseline() -> Keymap {
    use Modifier::{LeftAlt, LeftSuper, RightAlt};
    let mut base = Layer::new("base")
        .with(k("KEY_ESC"), Action::key(k("KEY_CAPSLOCK")))
        .with(k("KEY_CAPSLOCK"), Action::key(k("KEY_ESC")))
        .with(
            k("KEY_LEFTALT"),
            Action::Layer {
                layer: 1,
                mode: LayerMode::Hold,
                mods: mods(&[LeftAlt]),
            },
        )
        .with(
            k("KEY_RIGHTALT"),
            Action::Layer {
                layer: 2,
                mode: LayerMode::Hold,
                mods: ModSet::EMPTY,
            },
        );
    base.id = "base".into();
    let mut nav = Layer::new("alt-nav");
    for (from, to) in [
        ("KEY_H", "KEY_LEFT"),
        ("KEY_J", "KEY_DOWN"),
        ("KEY_K", "KEY_UP"),
        ("KEY_L", "KEY_RIGHT"),
    ] {
        nav = nav.with(
            k(from),
            Action::Key {
                key: Some(k(to)),
                mods: ModSet::EMPTY,
                release_held: mods(&[LeftAlt]),
            },
        );
    }
    let mut ws = Layer::new("workspaces");
    for l in ["A", "E", "O", "S", "L", "Z", "X", "C", "N"] {
        let key = k(&format!("KEY_{l}"));
        ws = ws.with(key, Action::combo(key, mods(&[RightAlt])));
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
        ws = ws.with(k(from), Action::combo(k(to), mods(&[LeftSuper])));
    }
    Keymap {
        layers: vec![base, nav, ws],
        shortcuts: vec![],
    }
}

#[test]
fn unmapped_keys_pass_through() {
    let mut s = Sim::new(Keymap::passthrough());
    s.tap("KEY_A")
        .down("KEY_LEFTSHIFT")
        .tap("KEY_B")
        .up("KEY_LEFTSHIFT");
    assert_eq!(
        s.take(),
        exp(&[
            "+KEY_A",
            "-KEY_A",
            "+KEY_LEFTSHIFT",
            "+KEY_B",
            "-KEY_B",
            "-KEY_LEFTSHIFT"
        ])
    );
}

#[test]
fn esc_and_capslock_are_swapped() {
    let mut s = Sim::new(baseline());
    s.tap("KEY_ESC").tap("KEY_CAPSLOCK");
    assert_eq!(
        s.take(),
        exp(&["+KEY_CAPSLOCK", "-KEY_CAPSLOCK", "+KEY_ESC", "-KEY_ESC"])
    );
}

#[test]
fn left_alt_holds_alt_and_hjkl_are_arrows_without_alt() {
    let mut s = Sim::new(baseline());
    s.down("KEY_LEFTALT");
    assert_eq!(s.take(), exp(&["+KEY_LEFTALT"]));
    assert_eq!(s.e.active_layer_ids(), vec!["base", "alt-nav"]);
    s.down("KEY_H");
    assert_eq!(s.take(), exp(&["-KEY_LEFTALT", "+KEY_LEFT"]));
    s.up("KEY_H");
    assert_eq!(s.take(), exp(&["-KEY_LEFT", "+KEY_LEFTALT"]));
    for (key, arrow) in [
        ("KEY_J", "KEY_DOWN"),
        ("KEY_K", "KEY_UP"),
        ("KEY_L", "KEY_RIGHT"),
    ] {
        s.tap(key);
        assert_eq!(
            s.take(),
            exp(&[
                "-KEY_LEFTALT",
                &format!("+{arrow}"),
                &format!("-{arrow}"),
                "+KEY_LEFTALT"
            ])
        );
    }
    s.up("KEY_LEFTALT");
    assert_eq!(s.take(), exp(&["-KEY_LEFTALT"]));
    assert_eq!(s.e.active_layer_ids(), vec!["base"]);
    assert!(s.e.output_idle());
}

#[test]
fn alt_tab_keeps_alt_held_across_repeated_tabs() {
    let mut s = Sim::new(baseline());
    s.down("KEY_LEFTALT")
        .tap("KEY_TAB")
        .tap("KEY_TAB")
        .tap("KEY_ENTER")
        .up("KEY_LEFTALT");
    assert_eq!(
        s.take(),
        exp(&[
            "+KEY_LEFTALT",
            "+KEY_TAB",
            "-KEY_TAB",
            "+KEY_TAB",
            "-KEY_TAB",
            "+KEY_ENTER",
            "-KEY_ENTER",
            "-KEY_LEFTALT"
        ])
    );
}

#[test]
fn alt_tab_after_arrow_restores_alt() {
    let mut s = Sim::new(baseline());
    s.down("KEY_LEFTALT")
        .tap("KEY_J")
        .tap("KEY_TAB")
        .up("KEY_LEFTALT");
    assert_eq!(
        s.take(),
        exp(&[
            "+KEY_LEFTALT",
            "-KEY_LEFTALT",
            "+KEY_DOWN",
            "-KEY_DOWN",
            "+KEY_LEFTALT",
            "+KEY_TAB",
            "-KEY_TAB",
            "-KEY_LEFTALT"
        ])
    );
}

#[test]
fn overlapping_arrows_release_alt_once() {
    let mut s = Sim::new(baseline());
    s.down("KEY_LEFTALT")
        .down("KEY_H")
        .down("KEY_J")
        .up("KEY_H")
        .up("KEY_J");
    assert_eq!(
        s.take(),
        exp(&[
            "+KEY_LEFTALT",
            "-KEY_LEFTALT",
            "+KEY_LEFT",
            "+KEY_DOWN",
            "-KEY_LEFT",
            "-KEY_DOWN",
            "+KEY_LEFTALT"
        ])
    );
}

#[test]
fn right_alt_layer_outputs_polish_letters_and_workspaces() {
    let mut s = Sim::new(baseline());
    s.down("KEY_RIGHTALT");
    assert_eq!(
        s.take(),
        Vec::<String>::new(),
        "RightAlt itself is not output"
    );
    for l in ["A", "E", "O", "S", "L", "Z", "X", "C", "N"] {
        s.tap(&format!("KEY_{l}"));
        assert_eq!(
            s.take(),
            exp(&[
                "+KEY_RIGHTALT",
                &format!("+KEY_{l}"),
                &format!("-KEY_{l}"),
                "-KEY_RIGHTALT"
            ])
        );
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
        s.tap(from);
        assert_eq!(
            s.take(),
            exp(&[
                "+KEY_LEFTMETA",
                &format!("+{to}"),
                &format!("-{to}"),
                "-KEY_LEFTMETA"
            ]),
            "{from}"
        );
    }
    s.tap("KEY_B");
    assert_eq!(
        s.take(),
        exp(&["+KEY_B", "-KEY_B"]),
        "unset keys are transparent"
    );
    s.up("KEY_RIGHTALT");
    assert_eq!(s.take(), Vec::<String>::new());
}

#[test]
fn shift_with_right_alt_layer_gives_capital_polish_letter() {
    let mut s = Sim::new(baseline());
    s.down("KEY_LEFTSHIFT")
        .down("KEY_RIGHTALT")
        .tap("KEY_A")
        .up("KEY_RIGHTALT")
        .up("KEY_LEFTSHIFT");
    assert_eq!(
        s.take(),
        exp(&[
            "+KEY_LEFTSHIFT",
            "+KEY_RIGHTALT",
            "+KEY_A",
            "-KEY_A",
            "-KEY_RIGHTALT",
            "-KEY_LEFTSHIFT"
        ])
    );
}

#[test]
fn key_release_uses_action_resolved_at_press() {
    let mut s = Sim::new(baseline());
    s.down("KEY_RIGHTALT")
        .down("KEY_F")
        .up("KEY_RIGHTALT")
        .up("KEY_F");
    assert_eq!(
        s.take(),
        exp(&["+KEY_LEFTMETA", "+KEY_1", "-KEY_1", "-KEY_LEFTMETA"])
    );
    // Layer is gone now: F is F again.
    s.tap("KEY_F");
    assert_eq!(s.take(), exp(&["+KEY_F", "-KEY_F"]));
}

#[test]
fn combo_does_not_repress_already_held_modifier() {
    let mut s = Sim::new(baseline());
    s.down("KEY_LEFTMETA")
        .down("KEY_RIGHTALT")
        .tap("KEY_F")
        .up("KEY_RIGHTALT");
    assert_eq!(s.take(), exp(&["+KEY_LEFTMETA", "+KEY_1", "-KEY_1"]));
    s.up("KEY_LEFTMETA");
    assert_eq!(s.take(), exp(&["-KEY_LEFTMETA"]));
}

#[test]
fn physical_alt_press_while_suppressed_is_not_output() {
    // LeftAlt layer active, arrow held (Alt suppressed); pressing Right Alt as plain key works,
    // but another source of Left Alt stays suppressed until the arrow is released.
    let km = Keymap {
        layers: vec![Layer::new("base").with(
            k("KEY_CAPSLOCK"),
            Action::Key {
                key: Some(k("KEY_LEFT")),
                mods: ModSet::EMPTY,
                release_held: mods(&[Modifier::LeftAlt]),
            },
        )],
        shortcuts: vec![],
    };
    let mut s = Sim::new(km);
    s.down("KEY_CAPSLOCK").down("KEY_LEFTALT");
    assert_eq!(s.take(), exp(&["+KEY_LEFT"]));
    s.up("KEY_CAPSLOCK");
    assert_eq!(s.take(), exp(&["-KEY_LEFT", "+KEY_LEFTALT"]));
    s.up("KEY_LEFTALT");
    assert_eq!(s.take(), exp(&["-KEY_LEFTALT"]));
}

fn shortcut_map() -> Keymap {
    Keymap {
        layers: vec![Layer::new("base")],
        shortcuts: vec![
            Shortcut {
                trigger: Trigger {
                    key: k("KEY_C"),
                    specific: ModSet::EMPTY,
                    generic: ModSet::SUPER,
                },
                action: Action::combo(k("KEY_C"), mods(&[Modifier::LeftCtrl, Modifier::LeftShift])),
            },
            Shortcut {
                trigger: Trigger {
                    key: k("KEY_Q"),
                    specific: mods(&[Modifier::LeftCtrl]),
                    generic: ModSet::EMPTY,
                },
                action: Action::None,
            },
        ],
    }
}

#[test]
fn shortcut_replaces_key_and_restores_trigger_modifiers() {
    let mut s = Sim::new(shortcut_map());
    s.down("KEY_LEFTMETA").down("KEY_C");
    assert_eq!(
        s.take(),
        exp(&[
            "+KEY_LEFTMETA",
            "-KEY_LEFTMETA",
            "+KEY_LEFTCTRL",
            "+KEY_LEFTSHIFT",
            "+KEY_C"
        ])
    );
    s.up("KEY_C");
    assert_eq!(
        s.take(),
        exp(&["-KEY_C", "-KEY_LEFTSHIFT", "-KEY_LEFTCTRL", "+KEY_LEFTMETA"])
    );
    s.up("KEY_LEFTMETA");
    assert_eq!(s.take(), exp(&["-KEY_LEFTMETA"]));
}

#[test]
fn generic_shortcut_matches_either_side_but_requires_exact_modifiers() {
    let mut s = Sim::new(shortcut_map());
    s.down("KEY_RIGHTMETA")
        .down("KEY_C")
        .up("KEY_C")
        .up("KEY_RIGHTMETA");
    let out = s.take();
    assert!(out.contains(&"+KEY_LEFTCTRL".to_owned()), "{out:?}");
    // Super+Shift+C is not Super+C.
    s.down("KEY_LEFTMETA")
        .down("KEY_LEFTSHIFT")
        .tap("KEY_C")
        .up("KEY_LEFTSHIFT")
        .up("KEY_LEFTMETA");
    assert_eq!(
        s.take(),
        exp(&[
            "+KEY_LEFTMETA",
            "+KEY_LEFTSHIFT",
            "+KEY_C",
            "-KEY_C",
            "-KEY_LEFTSHIFT",
            "-KEY_LEFTMETA"
        ])
    );
    // Plain C is untouched.
    s.tap("KEY_C");
    assert_eq!(s.take(), exp(&["+KEY_C", "-KEY_C"]));
}

#[test]
fn shortcut_with_none_blocks_the_combination() {
    let mut s = Sim::new(shortcut_map());
    s.down("KEY_LEFTCTRL").tap("KEY_Q").up("KEY_LEFTCTRL");
    assert_eq!(s.take(), exp(&["+KEY_LEFTCTRL", "-KEY_LEFTCTRL"]));
}

#[test]
fn none_action_disables_a_key() {
    let km = Keymap {
        layers: vec![Layer::new("base").with(k("KEY_INSERT"), Action::None)],
        shortcuts: vec![],
    };
    let mut s = Sim::new(km);
    s.tap("KEY_INSERT");
    assert_eq!(s.take(), Vec::<String>::new());
}

#[test]
fn toggle_layer_switches_on_and_off() {
    let km = Keymap {
        layers: vec![
            Layer::new("base").with(
                k("KEY_SCROLLLOCK"),
                Action::Layer {
                    layer: 1,
                    mode: LayerMode::Toggle,
                    mods: ModSet::EMPTY,
                },
            ),
            Layer::new("numpad").with(k("KEY_J"), Action::key(k("KEY_KP1"))),
        ],
        shortcuts: vec![],
    };
    let mut s = Sim::new(km);
    s.tap("KEY_SCROLLLOCK");
    assert_eq!(s.e.active_layer_ids(), vec!["base", "numpad"]);
    s.tap("KEY_J");
    assert_eq!(s.take(), exp(&["+KEY_KP1", "-KEY_KP1"]));
    s.tap("KEY_SCROLLLOCK").tap("KEY_J");
    assert_eq!(s.take(), exp(&["+KEY_J", "-KEY_J"]));
    assert_eq!(s.e.active_layer_ids(), vec!["base"]);
}

fn caps_tap_hold(strategy: Strategy) -> Keymap {
    Keymap {
        layers: vec![Layer::new("base").with(
            k("KEY_CAPSLOCK"),
            Action::TapHold(Box::new(TapHold {
                tap: Action::key(k("KEY_ESC")),
                hold: Action::key(k("KEY_LEFTCTRL")),
                timeout: ms(200),
                strategy,
            })),
        )],
        shortcuts: vec![],
    }
}

#[test]
fn tap_hold_quick_tap_is_tap_for_all_strategies() {
    for st in [
        Strategy::PermissiveHold,
        Strategy::HoldOnOtherPress,
        Strategy::TimeoutOnly,
    ] {
        let mut s = Sim::new(caps_tap_hold(st));
        s.at(0).down("KEY_CAPSLOCK").at(100).up("KEY_CAPSLOCK");
        assert_eq!(s.take(), exp(&["+KEY_ESC", "-KEY_ESC"]), "{st:?}");
        assert!(s.e.is_idle());
    }
}

#[test]
fn tap_hold_timeout_is_hold_for_all_strategies() {
    for st in [
        Strategy::PermissiveHold,
        Strategy::HoldOnOtherPress,
        Strategy::TimeoutOnly,
    ] {
        let mut s = Sim::new(caps_tap_hold(st));
        s.at(0).down("KEY_CAPSLOCK");
        assert_eq!(s.e.next_deadline(), Some(ms(200)));
        s.at(199);
        assert_eq!(s.take(), Vec::<String>::new());
        s.at(200);
        assert_eq!(s.take(), exp(&["+KEY_LEFTCTRL"]), "{st:?}");
        s.at(300).tap("KEY_C").up("KEY_CAPSLOCK");
        assert_eq!(s.take(), exp(&["+KEY_C", "-KEY_C", "-KEY_LEFTCTRL"]));
    }
}

#[test]
fn permissive_hold_press_and_release_inside_is_hold() {
    // Spec §5.4 example: Caps↓ c↓ c↑ Caps↑ within 200 ms → Ctrl+C.
    let mut s = Sim::new(caps_tap_hold(Strategy::PermissiveHold));
    s.at(0).down("KEY_CAPSLOCK").at(50).down("KEY_C");
    assert!(s.take().is_empty(), "undecided while c is only pressed");
    s.at(80).up("KEY_C");
    assert_eq!(s.take(), exp(&["+KEY_LEFTCTRL", "+KEY_C", "-KEY_C"]));
    s.at(120).up("KEY_CAPSLOCK");
    assert_eq!(s.take(), exp(&["-KEY_LEFTCTRL"]));
}

#[test]
fn permissive_hold_rolling_is_tap_then_key() {
    // Spec §5.4 example: Caps↓ c↓ Caps↑ c↑ → Esc, c.
    let mut s = Sim::new(caps_tap_hold(Strategy::PermissiveHold));
    s.at(0)
        .down("KEY_CAPSLOCK")
        .at(50)
        .down("KEY_C")
        .at(80)
        .up("KEY_CAPSLOCK");
    assert_eq!(s.take(), exp(&["+KEY_ESC", "-KEY_ESC", "+KEY_C"]));
    s.at(100).up("KEY_C");
    assert_eq!(s.take(), exp(&["-KEY_C"]));
}

#[test]
fn hold_on_other_press_decides_on_press() {
    let mut s = Sim::new(caps_tap_hold(Strategy::HoldOnOtherPress));
    s.at(0).down("KEY_CAPSLOCK").at(50).down("KEY_C");
    assert_eq!(s.take(), exp(&["+KEY_LEFTCTRL", "+KEY_C"]));
    s.at(80).up("KEY_CAPSLOCK").at(90).up("KEY_C");
    assert_eq!(s.take(), exp(&["-KEY_LEFTCTRL", "-KEY_C"]));
}

#[test]
fn timeout_only_ignores_other_keys_before_timeout() {
    let mut s = Sim::new(caps_tap_hold(Strategy::TimeoutOnly));
    s.at(0)
        .down("KEY_CAPSLOCK")
        .at(50)
        .tap("KEY_C")
        .at(100)
        .up("KEY_CAPSLOCK");
    assert_eq!(s.take(), exp(&["+KEY_ESC", "-KEY_ESC", "+KEY_C", "-KEY_C"]));
    let mut s = Sim::new(caps_tap_hold(Strategy::TimeoutOnly));
    s.at(0).down("KEY_CAPSLOCK").at(50).down("KEY_C");
    assert_eq!(s.take(), Vec::<String>::new());
    s.at(200);
    assert_eq!(s.take(), exp(&["+KEY_LEFTCTRL", "+KEY_C"]));
    s.up("KEY_C").up("KEY_CAPSLOCK");
    assert_eq!(s.take(), exp(&["-KEY_C", "-KEY_LEFTCTRL"]));
}

#[test]
fn buffered_event_after_deadline_resolves_hold_first() {
    // An event stamped after the deadline arrives before tick() runs: hold must apply first.
    let mut s = Sim::new(caps_tap_hold(Strategy::TimeoutOnly));
    s.down("KEY_CAPSLOCK");
    let ev = KeyEvent {
        device: 0,
        key: k("KEY_C"),
        pressed: true,
        time: ms(250),
    };
    s.e.handle(ev, ms(250), &mut s.out);
    assert_eq!(s.take(), exp(&["+KEY_LEFTCTRL", "+KEY_C"]));
}

#[test]
fn layer_tap_hold_activates_layer_for_buffered_keys() {
    let km = Keymap {
        layers: vec![
            Layer::new("base").with(
                k("KEY_SPACE"),
                Action::TapHold(Box::new(TapHold {
                    tap: Action::key(k("KEY_SPACE")),
                    hold: Action::Layer {
                        layer: 1,
                        mode: LayerMode::Hold,
                        mods: ModSet::EMPTY,
                    },
                    timeout: ms(200),
                    strategy: Strategy::PermissiveHold,
                })),
            ),
            Layer::new("nav").with(k("KEY_J"), Action::key(k("KEY_DOWN"))),
        ],
        shortcuts: vec![],
    };
    let mut s = Sim::new(km);
    s.at(0)
        .down("KEY_SPACE")
        .at(30)
        .tap("KEY_J")
        .at(60)
        .up("KEY_SPACE");
    assert_eq!(s.take(), exp(&["+KEY_DOWN", "-KEY_DOWN"]));
    s.at(100).down("KEY_SPACE").at(150).up("KEY_SPACE");
    assert_eq!(s.take(), exp(&["+KEY_SPACE", "-KEY_SPACE"]));
    assert_eq!(s.e.active_layer_ids(), vec!["base"]);
}

#[test]
fn two_pending_tap_holds_resolve_in_press_order() {
    let th = |tap: &str, hold: Modifier| {
        Action::TapHold(Box::new(TapHold {
            tap: Action::key(k(tap)),
            hold: Action::Key {
                key: None,
                mods: mods(&[hold]),
                release_held: ModSet::EMPTY,
            },
            timeout: ms(200),
            strategy: Strategy::PermissiveHold,
        }))
    };
    let km = Keymap {
        layers: vec![
            Layer::new("base")
                .with(k("KEY_A"), th("KEY_A", Modifier::LeftSuper))
                .with(k("KEY_S"), th("KEY_S", Modifier::LeftAlt)),
        ],
        shortcuts: vec![],
    };
    // Both held, then X tapped: both become holds.
    let mut s = Sim::new(km.clone());
    s.at(0)
        .down("KEY_A")
        .at(10)
        .down("KEY_S")
        .at(20)
        .tap("KEY_X")
        .at(30)
        .up("KEY_S")
        .up("KEY_A");
    assert_eq!(
        s.take(),
        exp(&[
            "+KEY_LEFTMETA",
            "+KEY_LEFTALT",
            "+KEY_X",
            "-KEY_X",
            "-KEY_LEFTALT",
            "-KEY_LEFTMETA"
        ])
    );
    // Rolling a→s quickly types "as".
    let mut s = Sim::new(km);
    s.at(0)
        .down("KEY_A")
        .at(10)
        .down("KEY_S")
        .at(20)
        .up("KEY_A")
        .at(30)
        .up("KEY_S");
    assert_eq!(s.take(), exp(&["+KEY_A", "-KEY_A", "+KEY_S", "-KEY_S"]));
}

fn macro_map() -> Keymap {
    Keymap {
        layers: vec![Layer::new("base").with(
            k("KEY_F13"),
            Action::Macro(Arc::from(vec![
                MacroStep::Tap {
                    key: k("KEY_A"),
                    mods: ModSet::EMPTY,
                },
                MacroStep::Tap {
                    key: k("KEY_B"),
                    mods: mods(&[Modifier::LeftShift]),
                },
                MacroStep::Delay(ms(100)),
                MacroStep::Tap {
                    key: k("KEY_ENTER"),
                    mods: ModSet::EMPTY,
                },
            ])),
        )],
        shortcuts: vec![],
    }
}

#[test]
fn macro_types_steps_and_waits_for_delays() {
    let mut s = Sim::new(macro_map());
    s.at(0).down("KEY_F13");
    assert_eq!(
        s.take(),
        exp(&[
            "+KEY_A",
            "-KEY_A",
            "+KEY_LEFTSHIFT",
            "+KEY_B",
            "-KEY_B",
            "-KEY_LEFTSHIFT"
        ])
    );
    assert_eq!(s.e.next_deadline(), Some(ms(100)));
    s.up("KEY_F13").at(50);
    assert_eq!(s.take(), Vec::<String>::new());
    s.at(100);
    assert_eq!(s.take(), exp(&["+KEY_ENTER", "-KEY_ENTER"]));
    assert_eq!(s.e.next_deadline(), None);
}

#[test]
fn macro_key_pressed_again_during_run_is_ignored() {
    let mut s = Sim::new(macro_map());
    s.at(0).tap("KEY_F13").take();
    s.at(50).tap("KEY_F13");
    assert_eq!(s.take(), Vec::<String>::new());
    s.at(100);
    assert_eq!(s.take(), exp(&["+KEY_ENTER", "-KEY_ENTER"]));
    s.at(200).down("KEY_F13");
    assert_eq!(
        s.take().len(),
        6,
        "a new run starts after the previous one finished"
    );
}

#[test]
fn macro_releases_held_modifiers_and_restores_them() {
    let mut s = Sim::new(macro_map());
    s.at(0).down("KEY_LEFTCTRL").down("KEY_F13");
    assert_eq!(
        s.take(),
        exp(&[
            "+KEY_LEFTCTRL",
            "-KEY_LEFTCTRL",
            "+KEY_A",
            "-KEY_A",
            "+KEY_LEFTSHIFT",
            "+KEY_B",
            "-KEY_B",
            "-KEY_LEFTSHIFT"
        ])
    );
    s.at(100);
    assert_eq!(
        s.take(),
        exp(&["+KEY_ENTER", "-KEY_ENTER", "+KEY_LEFTCTRL"])
    );
}

#[test]
fn release_all_releases_every_output_key_and_resets_layers() {
    let mut s = Sim::new(baseline());
    s.down("KEY_LEFTALT").down("KEY_X").take();
    let mut out = Vec::new();
    s.e.release_all(&mut out);
    let keys = out
        .iter()
        .filter(|o| matches!(o, Output::Key { .. }))
        .count();
    assert_eq!(keys, 2);
    assert!(out.contains(&Output::LayersChanged));
    assert!(s.e.output_idle() && s.e.is_idle());
    assert_eq!(s.e.active_layer_ids(), vec!["base"]);
    // Releases of keys pressed before release_all are ignored.
    s.up("KEY_X").up("KEY_LEFTALT");
    assert_eq!(s.take(), Vec::<String>::new());
}

#[test]
fn device_removed_releases_its_keys_only() {
    let mut s = Sim::new(baseline());
    s.ev(1, "KEY_A", true).ev(2, "KEY_B", true).take();
    let mut out = Vec::new();
    s.e.device_removed(1, 0, &mut out);
    assert_eq!(
        out,
        vec![Output::Key {
            key: k("KEY_A"),
            pressed: false
        }]
    );
    s.ev(2, "KEY_B", false);
    assert_eq!(s.take(), exp(&["-KEY_B"]));
}

#[test]
fn device_removed_cancels_its_pending_tap_hold() {
    let mut s = Sim::new(caps_tap_hold(Strategy::PermissiveHold));
    s.ev(1, "KEY_CAPSLOCK", true).ev(2, "KEY_X", true);
    let mut out = Vec::new();
    s.e.device_removed(1, 0, &mut out);
    s.out.extend(out);
    assert_eq!(s.take(), exp(&["+KEY_X"]));
    s.ev(2, "KEY_X", false);
    assert_eq!(s.take(), exp(&["-KEY_X"]));
    assert!(s.e.is_idle() && s.e.output_idle());
}

#[test]
fn set_keymap_releases_held_keys() {
    let mut s = Sim::new(baseline());
    s.down("KEY_LEFTALT").take();
    let mut out = Vec::new();
    s.e.set_keymap(Keymap::passthrough(), &mut out);
    assert!(out.contains(&Output::Key {
        key: k("KEY_LEFTALT"),
        pressed: false
    }));
    s.tap("KEY_ESC");
    assert_eq!(s.take(), exp(&["+KEY_ESC", "-KEY_ESC"]));
}

#[test]
fn unmapped_handling_bypasses_keymap() {
    let mut s = Sim::new(baseline());
    let mut out = Vec::new();
    s.e.handle_unmapped(
        KeyEvent {
            device: 0,
            key: k("KEY_ESC"),
            pressed: true,
            time: 0,
        },
        &mut out,
    );
    s.e.handle_unmapped(
        KeyEvent {
            device: 0,
            key: k("KEY_ESC"),
            pressed: false,
            time: 0,
        },
        &mut out,
    );
    assert_eq!(
        out,
        vec![
            Output::Key {
                key: k("KEY_ESC"),
                pressed: true
            },
            Output::Key {
                key: k("KEY_ESC"),
                pressed: false
            }
        ]
    );
}

#[test]
fn trace_reports_resolved_actions() {
    let mut s = Sim::new(baseline());
    s.e.set_trace(true);
    s.down("KEY_ESC");
    assert!(
        s.out
            .iter()
            .any(|o| matches!(o, Output::Resolved { action, .. } if action == "KEY_CAPSLOCK"))
    );
}

#[test]
fn key_names_round_trip() {
    for (name, key) in Key::all() {
        assert_eq!(Key::from_name(name), Some(key));
        assert_eq!(key.name(), Some(name));
    }
    assert_eq!(Key::from_name("KEY_CAPSLOCK"), Some(Key::CAPSLOCK));
    assert!(Key::from_name("KEY_NOPE").is_none());
}
