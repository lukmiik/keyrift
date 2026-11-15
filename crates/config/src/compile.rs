//! Convert a validated [`Profile`] into the core [`Keymap`].

use std::sync::Arc;

use keyrift_core::{
    self as core, Action, Keymap, Layer, MacroStep, ModSet, Shortcut, TapHold, Trigger, ms,
};

use crate::model::{
    ActionConfig, LayerMode, MacroStepConfig, Modifier, Profile, ReleaseHeld, TapHoldDefaults,
    TriggerModifier,
};

fn mods(m: &[Modifier]) -> ModSet {
    m.iter().map(|&m| core::Modifier::from(m)).collect()
}

fn action(a: &ActionConfig, p: &Profile, d: &TapHoldDefaults) -> Action {
    match a {
        ActionConfig::Key {
            key,
            mods: m,
            release_held,
        } => Action::Key {
            key: Some(key.0),
            mods: mods(m),
            release_held: match release_held {
                None => ModSet::EMPTY,
                Some(ReleaseHeld::All(_)) => ModSet::ALL,
                Some(ReleaseHeld::Mods(m)) => mods(m),
            },
        },
        ActionConfig::Mods { mods: m } => Action::Key {
            key: None,
            mods: mods(m),
            release_held: ModSet::EMPTY,
        },
        ActionConfig::None => Action::None,
        ActionConfig::Layer {
            mode,
            layer,
            mods: m,
        } => {
            match p.layers.iter().position(|l| &l.id == layer) {
                Some(idx) => Action::Layer {
                    layer: idx,
                    mode: match mode {
                        LayerMode::Hold => core::LayerMode::Hold,
                        LayerMode::Toggle => core::LayerMode::Toggle,
                    },
                    mods: mods(m),
                },
                // Unreachable after validation; degrade to doing nothing.
                None => Action::None,
            }
        }
        ActionConfig::TapHold {
            tap,
            hold,
            timeout_ms,
            strategy,
        } => Action::TapHold(Box::new(TapHold {
            tap: action(tap, p, d),
            hold: action(hold, p, d),
            timeout: ms(u64::from(timeout_ms.unwrap_or(d.timeout_ms))),
            strategy: strategy.unwrap_or(d.strategy).into(),
        })),
        ActionConfig::Macro { steps } => Action::Macro(Arc::from(
            steps
                .iter()
                .map(|s| match s {
                    MacroStepConfig::Key { key, mods: m } => MacroStep::Tap {
                        key: key.0,
                        mods: mods(m),
                    },
                    MacroStepConfig::Delay { ms: d } => MacroStep::Delay(ms(u64::from(*d))),
                })
                .collect::<Vec<_>>(),
        )),
    }
}

fn trigger(mods_in: &[TriggerModifier], key: keyrift_core::Key) -> Trigger {
    use TriggerModifier as T;
    use core::Modifier as M;
    let mut specific = ModSet::EMPTY;
    let mut generic = ModSet::EMPTY;
    for m in mods_in {
        match m {
            T::LeftCtrl => specific = specific.with(M::LeftCtrl),
            T::LeftShift => specific = specific.with(M::LeftShift),
            T::LeftAlt => specific = specific.with(M::LeftAlt),
            T::LeftSuper => specific = specific.with(M::LeftSuper),
            T::RightCtrl => specific = specific.with(M::RightCtrl),
            T::RightShift => specific = specific.with(M::RightShift),
            T::RightAlt => specific = specific.with(M::RightAlt),
            T::RightSuper => specific = specific.with(M::RightSuper),
            T::Ctrl => generic = generic.union(ModSet::CTRL),
            T::Shift => generic = generic.union(ModSet::SHIFT),
            T::Alt => generic = generic.union(ModSet::ALT),
            T::Super => generic = generic.union(ModSet::SUPER),
        }
    }
    Trigger {
        key,
        specific,
        generic,
    }
}

/// Build the core keymap. Call only after [`crate::validate_profile`] reported no errors.
pub fn compile(p: &Profile, defaults: &TapHoldDefaults) -> Keymap {
    if p.layers.is_empty() {
        return Keymap::passthrough();
    }
    let layers = p
        .layers
        .iter()
        .map(|l| Layer {
            id: l.id.clone(),
            keys: l
                .keys
                .iter()
                .map(|(k, a)| (k.0, action(a, p, defaults)))
                .collect(),
        })
        .collect();
    let shortcuts = p
        .shortcuts
        .iter()
        .map(|s| Shortcut {
            trigger: trigger(&s.trigger.mods, s.trigger.key.0),
            action: action(&s.action, p, defaults),
        })
        .collect();
    Keymap { layers, shortcuts }
}
