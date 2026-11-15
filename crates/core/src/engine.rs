//! The remapping state machine (spec §5).

use std::{collections::VecDeque, sync::Arc};

use crate::{
    Action, Key, Keymap, LayerMode, MacroStep, Micros, ModSet, Modifier, Strategy, TapHold,
    output::OutputState,
};

/// Identifies the physical device an event came from.
pub type DeviceId = u32;

/// A physical key press or release. Repeat events are not passed to the engine.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeyEvent {
    pub device: DeviceId,
    pub key: Key,
    pub pressed: bool,
    /// Time the event was read, in microseconds on the engine's monotonic clock.
    pub time: Micros,
}

/// Something the engine wants the caller to do or know.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Output {
    /// Emit a key event on the virtual keyboard.
    Key { key: Key, pressed: bool },
    /// The set of active layers changed; query [`Engine::active_layers`].
    LayersChanged,
    /// A physical key press was resolved to an action (only when tracing is enabled).
    Resolved {
        device: DeviceId,
        key: Key,
        action: String,
    },
}

/// What a held physical key is currently doing, recorded at press time (spec F-LAY-7).
#[derive(Clone, Debug)]
enum Active {
    Key {
        key: Option<Key>,
        mods: ModSet,
        suppressed: ModSet,
    },
    HoldLayer {
        layer: usize,
        mods: ModSet,
    },
    Nothing,
}

#[derive(Clone, Debug)]
struct Pending {
    device: DeviceId,
    key: Key,
    th: TapHold,
    press_time: Micros,
}

impl Pending {
    fn deadline(&self) -> Micros {
        self.press_time.saturating_add(self.th.timeout)
    }
}

#[derive(Debug)]
struct RunningMacro {
    trigger: Key,
    steps: Arc<[MacroStep]>,
    next_step: usize,
    resume_at: Micros,
}

#[derive(Debug, Default)]
struct LayerState {
    /// Active non-base layers, oldest activation first.
    order: Vec<usize>,
    holds: Vec<u32>,
    toggled: Vec<bool>,
}

impl LayerState {
    fn new(count: usize) -> LayerState {
        LayerState {
            order: Vec::new(),
            holds: vec![0; count],
            toggled: vec![false; count],
        }
    }

    fn is_active(&self, l: usize) -> bool {
        self.holds[l] > 0 || self.toggled[l]
    }

    /// Updates `order` after a change to layer `l`; returns whether the active set changed.
    fn refresh(&mut self, l: usize, was_active: bool) -> bool {
        let now = self.is_active(l);
        if now && !was_active {
            self.order.push(l);
        } else if !now && was_active {
            self.order.retain(|&x| x != l);
        }
        now != was_active
    }
}

/// The remapping engine. Feed it key events and timer ticks; it returns output events.
#[derive(Debug)]
pub struct Engine {
    keymap: Keymap,
    out: OutputState,
    layers: LayerState,
    /// Held physical keys in press order with what they are doing.
    pressed: Vec<(DeviceId, Key, Active)>,
    pending: Option<Pending>,
    buffer: VecDeque<KeyEvent>,
    macros: Vec<RunningMacro>,
    trace: bool,
}

impl Engine {
    pub fn new(keymap: Keymap) -> Engine {
        let keymap = if keymap.layers.is_empty() {
            Keymap::passthrough()
        } else {
            keymap
        };
        Engine {
            layers: LayerState::new(keymap.layers.len()),
            keymap,
            out: OutputState::default(),
            pressed: Vec::new(),
            pending: None,
            buffer: VecDeque::new(),
            macros: Vec::new(),
            trace: false,
        }
    }

    pub fn keymap(&self) -> &Keymap {
        &self.keymap
    }

    /// Enable [`Output::Resolved`] events.
    pub fn set_trace(&mut self, on: bool) {
        self.trace = on;
    }

    /// Replace the keymap. Releases everything and resets layers (spec §5.7).
    pub fn set_keymap(&mut self, keymap: Keymap, out: &mut Vec<Output>) {
        self.release_all(out);
        let keymap = if keymap.layers.is_empty() {
            Keymap::passthrough()
        } else {
            keymap
        };
        self.layers = LayerState::new(keymap.layers.len());
        self.keymap = keymap;
    }

    /// Active layers, base layer first, most recently activated last.
    pub fn active_layers(&self) -> Vec<usize> {
        let mut v = vec![0];
        v.extend(self.layers.order.iter().copied().filter(|&l| l != 0));
        v
    }

    /// Ids of the active layers (same order as [`Engine::active_layers`]).
    pub fn active_layer_ids(&self) -> Vec<String> {
        self.active_layers()
            .into_iter()
            .map(|l| self.keymap.layers[l].id.clone())
            .collect()
    }

    /// True when no physical key is held and nothing is pending.
    pub fn is_idle(&self) -> bool {
        self.pressed.is_empty() && self.pending.is_none() && self.buffer.is_empty()
    }

    /// True when the output has no key down.
    pub fn output_idle(&self) -> bool {
        !self.out.any_down()
    }

    /// The next time [`Engine::tick`] must be called, if any.
    pub fn next_deadline(&self) -> Option<Micros> {
        let p = self.pending.as_ref().map(Pending::deadline);
        let m = self.macros.iter().map(|m| m.resume_at).min();
        match (p, m) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }

    /// Handle a physical key event.
    pub fn handle(&mut self, ev: KeyEvent, now: Micros, out: &mut Vec<Output>) {
        if self.pending.is_some() {
            self.buffer.push_back(ev);
        } else {
            self.process(ev, now, out);
        }
        self.evaluate(now, out);
    }

    /// Handle a physical key event without any remapping (used while recording keys).
    pub fn handle_unmapped(&mut self, ev: KeyEvent, out: &mut Vec<Output>) {
        if ev.pressed {
            if self.is_pressed(ev.device, ev.key) {
                return;
            }
            let active = self.activate(ev.key, &Action::key(ev.key), ev.time, out);
            self.pressed.push((ev.device, ev.key, active));
        } else {
            self.release_physical(ev.device, ev.key, out);
        }
    }

    /// Advance timers (tap-hold timeouts, macro delays).
    pub fn tick(&mut self, now: Micros, out: &mut Vec<Output>) {
        self.evaluate(now, out);
        self.run_macros(now, out);
    }

    /// Release all output keys and forget all state (pause, emergency, reload, shutdown).
    pub fn release_all(&mut self, out: &mut Vec<Output>) {
        self.out.release_all(out);
        self.pressed.clear();
        self.pending = None;
        self.buffer.clear();
        self.macros.clear();
        let had_layers = !self.layers.order.is_empty();
        self.layers = LayerState::new(self.keymap.layers.len());
        if had_layers {
            out.push(Output::LayersChanged);
        }
    }

    /// A device disappeared: drop its pending events and release its held keys.
    pub fn device_removed(&mut self, device: DeviceId, now: Micros, out: &mut Vec<Output>) {
        self.buffer.retain(|e| e.device != device);
        if self.pending.as_ref().is_some_and(|p| p.device == device) {
            self.pending = None;
            let events = std::mem::take(&mut self.buffer);
            for ev in events {
                self.handle(ev, now, out);
            }
        }
        let keys: Vec<Key> = self
            .pressed
            .iter()
            .filter(|(d, _, _)| *d == device)
            .map(|(_, k, _)| *k)
            .collect();
        for k in keys.into_iter().rev() {
            self.release_physical(device, k, out);
        }
    }

    fn is_pressed(&self, device: DeviceId, key: Key) -> bool {
        self.pressed
            .iter()
            .any(|(d, k, _)| *d == device && *k == key)
    }

    /// Process an event that is not being buffered behind a pending tap-hold.
    fn process(&mut self, ev: KeyEvent, now: Micros, out: &mut Vec<Output>) {
        if self.pending.is_some() {
            self.buffer.push_back(ev);
            return;
        }
        if !ev.pressed {
            self.release_physical(ev.device, ev.key, out);
            return;
        }
        if self.is_pressed(ev.device, ev.key) {
            return;
        }
        let action = self.resolve(ev.key);
        if self.trace {
            out.push(Output::Resolved {
                device: ev.device,
                key: ev.key,
                action: action.describe(&self.keymap),
            });
        }
        if let Action::TapHold(th) = action {
            self.pending = Some(Pending {
                device: ev.device,
                key: ev.key,
                th: *th,
                press_time: ev.time,
            });
            return;
        }
        let active = self.activate(ev.key, &action, now, out);
        self.pressed.push((ev.device, ev.key, active));
    }

    /// Layer lookup plus shortcut matching (spec §5.2, §5.5).
    fn resolve(&self, key: Key) -> Action {
        let found = self
            .layers
            .order
            .iter()
            .rev()
            .chain(std::iter::once(&0))
            .find_map(|&l| self.keymap.layers[l].keys.get(&key));
        let action = found.cloned().unwrap_or(Action::key(key));
        self.apply_shortcuts(action)
    }

    fn apply_shortcuts(&self, action: Action) -> Action {
        let Action::Key {
            key: Some(key),
            mods,
            release_held,
        } = action
        else {
            return action;
        };
        if !mods.is_empty() || !release_held.is_empty() || Modifier::from_key(key).is_some() {
            return action;
        }
        let held = self.out.held_mods();
        let Some(rule) = self
            .keymap
            .shortcuts
            .iter()
            .find(|s| s.trigger.key == key && s.trigger.matches(held))
        else {
            return action;
        };
        let trigger_mods = held.intersection(rule.trigger.specific.union(rule.trigger.generic));
        match &rule.action {
            Action::Key {
                key,
                mods,
                release_held,
            } => Action::Key {
                key: *key,
                mods: *mods,
                release_held: release_held.union(trigger_mods),
            },
            other => other.clone(),
        }
    }

    fn activate(
        &mut self,
        key: Key,
        action: &Action,
        now: Micros,
        out: &mut Vec<Output>,
    ) -> Active {
        match action {
            Action::Key {
                key: k,
                mods,
                release_held,
            } => {
                self.out.suppress(*release_held, out);
                self.out.press_forced(*mods, out);
                if let Some(k) = k {
                    self.out.press(*k, out);
                }
                Active::Key {
                    key: *k,
                    mods: *mods,
                    suppressed: *release_held,
                }
            }
            Action::None => Active::Nothing,
            Action::Layer { layer, mode, mods } => {
                let l = *layer;
                if l >= self.keymap.layers.len() {
                    return Active::Nothing;
                }
                let was = self.layers.is_active(l);
                match mode {
                    LayerMode::Hold => {
                        self.layers.holds[l] += 1;
                        if self.layers.refresh(l, was) {
                            out.push(Output::LayersChanged);
                        }
                        for m in mods.iter() {
                            self.out.press(m.key(), out);
                        }
                        Active::HoldLayer {
                            layer: l,
                            mods: *mods,
                        }
                    }
                    LayerMode::Toggle => {
                        self.layers.toggled[l] = !self.layers.toggled[l];
                        if self.layers.refresh(l, was) {
                            out.push(Output::LayersChanged);
                        }
                        Active::Nothing
                    }
                }
            }
            // Nested tap-hold is rejected by config validation; treat the tap action as the key.
            Action::TapHold(th) => self.activate(key, &th.tap, now, out),
            Action::Macro(steps) => {
                if !self.macros.iter().any(|m| m.trigger == key) {
                    self.out.suppress(ModSet::ALL, out);
                    self.macros.push(RunningMacro {
                        trigger: key,
                        steps: Arc::clone(steps),
                        next_step: 0,
                        resume_at: now,
                    });
                    self.run_macros(now, out);
                }
                Active::Nothing
            }
        }
    }

    fn deactivate(&mut self, active: &Active, out: &mut Vec<Output>) {
        match active {
            Active::Key {
                key,
                mods,
                suppressed,
            } => {
                if let Some(k) = key {
                    self.out.release(*k, out);
                }
                self.out.release_forced(*mods, out);
                self.out.unsuppress(*suppressed, out);
            }
            Active::HoldLayer { layer, mods } => {
                for m in mods.iter_rev() {
                    self.out.release(m.key(), out);
                }
                let was = self.layers.is_active(*layer);
                self.layers.holds[*layer] = self.layers.holds[*layer].saturating_sub(1);
                if self.layers.refresh(*layer, was) {
                    out.push(Output::LayersChanged);
                }
            }
            Active::Nothing => {}
        }
    }

    fn release_physical(&mut self, device: DeviceId, key: Key, out: &mut Vec<Output>) {
        if let Some(i) = self
            .pressed
            .iter()
            .position(|(d, k, _)| *d == device && *k == key)
        {
            let (_, _, active) = self.pressed.remove(i);
            self.deactivate(&active, out);
        }
    }

    /// Resolve pending tap-hold keys as far as the buffered events and the clock allow.
    fn evaluate(&mut self, now: Micros, out: &mut Vec<Output>) {
        while let Some(p) = &self.pending {
            let Some(hold) = decide(p, &self.buffer, now) else {
                break;
            };
            let Some(p) = self.pending.take() else { break };
            if hold {
                let active = self.activate(p.key, &p.th.hold, now, out);
                self.pressed.push((p.device, p.key, active));
            } else {
                let active = self.activate(p.key, &p.th.tap, now, out);
                self.deactivate(&active, out);
                // The physical release still arrives later; it must do nothing.
                self.pressed.push((p.device, p.key, Active::Nothing));
            }
            let events = std::mem::take(&mut self.buffer);
            for ev in events {
                self.process(ev, now, out);
            }
        }
    }

    fn run_macros(&mut self, now: Micros, out: &mut Vec<Output>) {
        let mut i = 0;
        while i < self.macros.len() {
            if self.macros[i].resume_at > now {
                i += 1;
                continue;
            }
            let mut finished = false;
            loop {
                let m = &mut self.macros[i];
                let Some(step) = m.steps.get(m.next_step).copied() else {
                    finished = true;
                    break;
                };
                m.next_step += 1;
                match step {
                    MacroStep::Tap { key, mods } => {
                        self.out.press_forced(mods, out);
                        self.out.press(key, out);
                        self.out.release(key, out);
                        self.out.release_forced(mods, out);
                    }
                    MacroStep::Delay(d) => {
                        m.resume_at = now.saturating_add(d);
                        if d > 0 {
                            break;
                        }
                    }
                }
            }
            if finished {
                self.macros.remove(i);
                self.out.unsuppress(ModSet::ALL, out);
            } else {
                i += 1;
            }
        }
    }
}

/// Decide a pending tap-hold: `Some(true)` = hold, `Some(false)` = tap, `None` = undecided.
fn decide(p: &Pending, buffer: &VecDeque<KeyEvent>, now: Micros) -> Option<bool> {
    let deadline = p.deadline();
    let mut pressed_after: Vec<(DeviceId, Key)> = Vec::new();
    for ev in buffer {
        if ev.time >= deadline {
            return Some(true);
        }
        if ev.device == p.device && ev.key == p.key {
            if !ev.pressed {
                return Some(false);
            }
            continue;
        }
        match p.th.strategy {
            Strategy::HoldOnOtherPress if ev.pressed => return Some(true),
            Strategy::PermissiveHold => {
                if ev.pressed {
                    pressed_after.push((ev.device, ev.key));
                } else if pressed_after.contains(&(ev.device, ev.key)) {
                    return Some(true);
                }
            }
            _ => {}
        }
    }
    (now >= deadline).then_some(true)
}
