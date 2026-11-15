//! Output-side key state: reference counts, modifier suppression and forcing.
//!
//! A key is down on the output when at least one source holds it and, for modifiers,
//! it is not suppressed (or it is forced by the action currently using it). See spec §5.3.

use crate::{Key, ModSet, Modifier, Output};

const N: usize = Key::CODE_LIMIT as usize;

#[derive(Debug)]
pub(crate) struct OutputState {
    refs: Vec<u16>,
    down: Vec<bool>,
    suppress: [u16; 8],
    force: [u16; 8],
}

impl Default for OutputState {
    fn default() -> Self {
        OutputState {
            refs: vec![0; N],
            down: vec![false; N],
            suppress: [0; 8],
            force: [0; 8],
        }
    }
}

impl OutputState {
    fn desired(&self, key: Key) -> bool {
        let i = usize::from(key.code());
        if self.refs[i] == 0 {
            return false;
        }
        match Modifier::from_key(key) {
            Some(m) => self.suppress[m as usize] == 0 || self.force[m as usize] > 0,
            None => true,
        }
    }

    fn reconcile(&mut self, key: Key, out: &mut Vec<Output>) {
        if !key.is_emittable() {
            return;
        }
        let want = self.desired(key);
        let i = usize::from(key.code());
        if self.down[i] != want {
            self.down[i] = want;
            out.push(Output::Key { key, pressed: want });
        }
    }

    pub(crate) fn press(&mut self, key: Key, out: &mut Vec<Output>) {
        if !key.is_emittable() {
            return;
        }
        let i = usize::from(key.code());
        self.refs[i] = self.refs[i].saturating_add(1);
        self.reconcile(key, out);
    }

    pub(crate) fn release(&mut self, key: Key, out: &mut Vec<Output>) {
        if !key.is_emittable() {
            return;
        }
        let i = usize::from(key.code());
        self.refs[i] = self.refs[i].saturating_sub(1);
        self.reconcile(key, out);
    }

    /// Press modifiers that the current action needs even while they are suppressed.
    pub(crate) fn press_forced(&mut self, mods: ModSet, out: &mut Vec<Output>) {
        for m in mods.iter() {
            self.force[m as usize] += 1;
            self.press(m.key(), out);
        }
    }

    pub(crate) fn release_forced(&mut self, mods: ModSet, out: &mut Vec<Output>) {
        for m in mods.iter_rev() {
            let i = usize::from(m.key().code());
            self.refs[i] = self.refs[i].saturating_sub(1);
            self.force[m as usize] = self.force[m as usize].saturating_sub(1);
            self.reconcile(m.key(), out);
        }
    }

    pub(crate) fn suppress(&mut self, mods: ModSet, out: &mut Vec<Output>) {
        for m in mods.iter() {
            self.suppress[m as usize] += 1;
            self.reconcile(m.key(), out);
        }
    }

    pub(crate) fn unsuppress(&mut self, mods: ModSet, out: &mut Vec<Output>) {
        for m in mods.iter() {
            self.suppress[m as usize] = self.suppress[m as usize].saturating_sub(1);
            self.reconcile(m.key(), out);
        }
    }

    /// Modifiers currently down on the output.
    pub(crate) fn held_mods(&self) -> ModSet {
        Modifier::ALL
            .into_iter()
            .filter(|m| self.down[usize::from(m.key().code())])
            .collect()
    }

    pub(crate) fn any_down(&self) -> bool {
        self.down.iter().any(|d| *d)
    }

    /// Release every key that is down and forget all state.
    pub(crate) fn release_all(&mut self, out: &mut Vec<Output>) {
        for (i, d) in self.down.iter_mut().enumerate() {
            if *d {
                *d = false;
                #[allow(clippy::cast_possible_truncation)] // i < CODE_LIMIT
                out.push(Output::Key {
                    key: Key(i as u16),
                    pressed: false,
                });
            }
        }
        self.refs.fill(0);
        self.suppress = [0; 8];
        self.force = [0; 8];
    }
}
