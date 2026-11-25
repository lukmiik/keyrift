//! The compiled keymap the engine executes. Built from the JSON config by `keyrift-config`.

use std::{collections::HashMap, sync::Arc};

use crate::{Key, Micros, ModSet};

/// A complete keymap: layers (index 0 is the base layer) and shortcut rules.
#[derive(Clone, Debug, Default)]
pub struct Keymap {
    pub layers: Vec<Layer>,
    pub shortcuts: Vec<Shortcut>,
}

impl Keymap {
    /// A keymap with an empty base layer: every key passes through.
    pub fn passthrough() -> Keymap {
        Keymap {
            layers: vec![Layer::new("base")],
            shortcuts: Vec::new(),
        }
    }

    /// Index of the layer with the given id.
    pub fn layer_index(&self, id: &str) -> Option<usize> {
        self.layers.iter().position(|l| l.id == id)
    }
}

#[derive(Clone, Debug, Default)]
pub struct Layer {
    pub id: String,
    pub keys: HashMap<Key, Action>,
}

impl Layer {
    pub fn new(id: impl Into<String>) -> Layer {
        Layer {
            id: id.into(),
            keys: HashMap::new(),
        }
    }

    #[must_use]
    pub fn with(mut self, key: Key, action: Action) -> Layer {
        self.keys.insert(key, action);
        self
    }
}

/// What a key does.
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// Output `key` (if any) together with `mods`. Before pressing, the modifiers in
    /// `release_held` are released on the output side and restored afterwards.
    Key {
        key: Option<Key>,
        mods: ModSet,
        release_held: ModSet,
    },
    /// Do nothing.
    None,
    /// Activate a layer (while held, or toggled), holding `mods` while a hold layer is active.
    Layer {
        layer: usize,
        mode: LayerMode,
        mods: ModSet,
    },
    /// Different actions for tap and hold.
    TapHold(Box<TapHold>),
    /// Tap a sequence of keys.
    Macro(Arc<[MacroStep]>),
}

impl Action {
    /// A plain key with no modifiers.
    pub const fn key(key: Key) -> Action {
        Action::Key {
            key: Some(key),
            mods: ModSet::EMPTY,
            release_held: ModSet::EMPTY,
        }
    }

    /// A key together with modifiers.
    pub const fn combo(key: Key, mods: ModSet) -> Action {
        Action::Key {
            key: Some(key),
            mods,
            release_held: ModSet::EMPTY,
        }
    }

    /// Short human-readable description, used by the tester.
    pub fn describe(&self, keymap: &Keymap) -> String {
        match self {
            Action::Key {
                key,
                mods,
                release_held,
            } => {
                let mut parts: Vec<String> = mods.iter().map(|m| format!("{m:?}")).collect();
                if let Some(k) = key {
                    parts.push(k.to_string());
                }
                let mut s = parts.join("+");
                if !release_held.is_empty() {
                    s.push_str(" (release held mods)");
                }
                s
            }
            Action::None => "none".to_owned(),
            Action::Layer { layer, mode, .. } => {
                let id = keymap.layers.get(*layer).map_or("?", |l| l.id.as_str());
                format!("layer {mode:?} {id}")
            }
            Action::TapHold(th) => {
                format!(
                    "tap-hold({}, {})",
                    th.tap.describe(keymap),
                    th.hold.describe(keymap)
                )
            }
            Action::Macro(steps) => format!("macro ({} steps)", steps.len()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LayerMode {
    Hold,
    Toggle,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TapHold {
    pub tap: Action,
    pub hold: Action,
    pub timeout: Micros,
    pub strategy: Strategy,
    /// Typing-streak window: pressed within this long after the previous typing key press,
    /// the key is a tap at once and is never pending (spec §5.4). `0` turns it off.
    pub prior_idle: Micros,
    /// Opposite-hand rule: while pending, a key on the same hand makes this a tap; only keys on
    /// the other hand (or on neither) can make it a hold (spec §5.4).
    pub opposite_hand: bool,
}

/// How a pending tap-hold key is resolved (spec §5.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Strategy {
    /// Hold when another key is pressed and released while pending, or on timeout.
    #[default]
    PermissiveHold,
    /// Hold as soon as another key is pressed while pending, or on timeout.
    HoldOnOtherPress,
    /// Only the timeout decides.
    TimeoutOnly,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MacroStep {
    /// Press and release `key` with `mods` held.
    Tap { key: Key, mods: ModSet },
    /// Wait.
    Delay(Micros),
}

/// A shortcut rule: when `trigger` matches, `action` replaces the key.
#[derive(Clone, Debug, PartialEq)]
pub struct Shortcut {
    pub trigger: Trigger,
    pub action: Action,
}

/// Modifiers + key. `specific` modifiers must be held as given; each group in `generic`
/// (both bits of a left/right pair) needs at least one side held. Held modifiers must be
/// covered exactly by the trigger.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Trigger {
    pub key: Key,
    pub specific: ModSet,
    pub generic: ModSet,
}

impl Trigger {
    /// Whether the currently held modifiers match this trigger exactly.
    pub fn matches(&self, held: ModSet) -> bool {
        if !self.specific.is_subset(held) {
            return false;
        }
        if !held.is_subset(self.specific.union(self.generic)) {
            return false;
        }
        ModSet::GROUPS
            .iter()
            .all(|&g| self.generic.intersection(g).is_empty() || !held.intersection(g).is_empty())
    }
}
