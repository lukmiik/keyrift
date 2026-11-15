//! Linux evdev key codes and their names (`KEY_*`).

use std::fmt;

use crate::keys_generated::CANONICAL;

/// A key, identified by its Linux evdev key code.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct Key(pub u16);

impl Key {
    /// Codes at or above this value cannot be emitted through uinput reliably.
    pub const CODE_LIMIT: u16 = 560;

    pub const ESC: Key = Key(1);
    pub const CAPSLOCK: Key = Key(58);
    pub const SPACE: Key = Key(57);
    pub const LEFTCTRL: Key = Key(29);
    pub const LEFTSHIFT: Key = Key(42);
    pub const LEFTALT: Key = Key(56);
    pub const LEFTMETA: Key = Key(125);
    pub const RIGHTCTRL: Key = Key(97);
    pub const RIGHTSHIFT: Key = Key(54);
    pub const RIGHTALT: Key = Key(100);
    pub const RIGHTMETA: Key = Key(126);

    pub const fn code(self) -> u16 {
        self.0
    }

    /// Looks a key up by its evdev name, e.g. `"KEY_CAPSLOCK"`.
    pub fn from_name(name: &str) -> Option<Key> {
        CANONICAL
            .iter()
            .find(|(n, _)| *n == name)
            .map(|&(_, c)| Key(c))
    }

    /// The canonical evdev name of this key, if it is a known key.
    pub fn name(self) -> Option<&'static str> {
        CANONICAL
            .binary_search_by_key(&self.0, |&(_, c)| c)
            .ok()
            .map(|i| CANONICAL[i].0)
    }

    /// All known keys as `(name, key)`, sorted by code.
    pub fn all() -> impl Iterator<Item = (&'static str, Key)> {
        CANONICAL.iter().map(|&(n, c)| (n, Key(c)))
    }

    /// Whether this key can be emitted through the virtual keyboard.
    pub const fn is_emittable(self) -> bool {
        self.0 > 0 && self.0 < Self::CODE_LIMIT
    }
}

impl fmt::Display for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.name() {
            Some(n) => f.write_str(n),
            None => write!(f, "KEY_{}", self.0),
        }
    }
}

/// One of the eight modifier keys.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Modifier {
    LeftCtrl,
    LeftShift,
    LeftAlt,
    LeftSuper,
    RightCtrl,
    RightShift,
    RightAlt,
    RightSuper,
}

impl Modifier {
    pub const ALL: [Modifier; 8] = [
        Modifier::LeftCtrl,
        Modifier::LeftShift,
        Modifier::LeftAlt,
        Modifier::LeftSuper,
        Modifier::RightCtrl,
        Modifier::RightShift,
        Modifier::RightAlt,
        Modifier::RightSuper,
    ];

    pub const fn key(self) -> Key {
        match self {
            Modifier::LeftCtrl => Key::LEFTCTRL,
            Modifier::LeftShift => Key::LEFTSHIFT,
            Modifier::LeftAlt => Key::LEFTALT,
            Modifier::LeftSuper => Key::LEFTMETA,
            Modifier::RightCtrl => Key::RIGHTCTRL,
            Modifier::RightShift => Key::RIGHTSHIFT,
            Modifier::RightAlt => Key::RIGHTALT,
            Modifier::RightSuper => Key::RIGHTMETA,
        }
    }

    pub fn from_key(key: Key) -> Option<Modifier> {
        Modifier::ALL.into_iter().find(|m| m.key() == key)
    }

    const fn index(self) -> usize {
        self as usize
    }
}

/// A set of modifiers (bit set).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct ModSet(u8);

impl ModSet {
    pub const EMPTY: ModSet = ModSet(0);
    pub const ALL: ModSet = ModSet(0xff);
    pub const CTRL: ModSet = ModSet(1 | 1 << 4);
    pub const SHIFT: ModSet = ModSet(1 << 1 | 1 << 5);
    pub const ALT: ModSet = ModSet(1 << 2 | 1 << 6);
    pub const SUPER: ModSet = ModSet(1 << 3 | 1 << 7);
    /// The four left/right groups (Ctrl, Shift, Alt, Super).
    pub const GROUPS: [ModSet; 4] = [ModSet::CTRL, ModSet::SHIFT, ModSet::ALT, ModSet::SUPER];

    pub fn from_mods(mods: impl IntoIterator<Item = Modifier>) -> ModSet {
        mods.into_iter().fold(ModSet::EMPTY, ModSet::with)
    }

    #[must_use]
    pub const fn with(self, m: Modifier) -> ModSet {
        ModSet(self.0 | 1 << m.index())
    }

    pub const fn contains(self, m: Modifier) -> bool {
        self.0 & (1 << m.index()) != 0
    }

    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    #[must_use]
    pub const fn union(self, o: ModSet) -> ModSet {
        ModSet(self.0 | o.0)
    }

    #[must_use]
    pub const fn intersection(self, o: ModSet) -> ModSet {
        ModSet(self.0 & o.0)
    }

    pub const fn is_subset(self, o: ModSet) -> bool {
        self.0 & !o.0 == 0
    }

    pub fn iter(self) -> impl Iterator<Item = Modifier> {
        Modifier::ALL.into_iter().filter(move |m| self.contains(*m))
    }

    /// Reverse of [`ModSet::iter`]: combos release their modifiers in reverse press order.
    pub fn iter_rev(self) -> impl Iterator<Item = Modifier> {
        Modifier::ALL
            .into_iter()
            .rev()
            .filter(move |m| self.contains(*m))
    }
}

impl FromIterator<Modifier> for ModSet {
    fn from_iter<T: IntoIterator<Item = Modifier>>(iter: T) -> Self {
        ModSet::from_mods(iter)
    }
}
