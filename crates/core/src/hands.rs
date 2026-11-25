//! Which hand types a key on a standard touch-typing layout (spec §5.4, opposite-hand rule).

use crate::Key;

/// The hand that types a key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hand {
    Left,
    Right,
}

impl Key {
    /// The hand that types this key with standard touch typing on a row-staggered (ANSI/ISO)
    /// keyboard, split between `5`/`6`, `T`/`Y`, `G`/`H` and `B`/`N`. `None` for keys that either
    /// hand or a thumb may press (Space, Alt keys, arrows, function keys, numpad, …).
    pub const fn hand(self) -> Option<Hand> {
        match self.0 {
            // Esc, 1–5, Tab, Q–T, Ctrl, A–G, LeftShift, `, Z–B, CapsLock, ISO <>, LeftMeta.
            1..=6 | 15..=20 | 29..=34 | 41 | 42 | 44..=48 | 58 | 86 | 125 => Some(Hand::Left),
            // 6–0, -, =, Backspace, Y–P, [, ], Enter, H–', \, N–/, RightShift, RightCtrl,
            // RightMeta, Compose.
            7..=14 | 21..=28 | 35..=40 | 43 | 49..=54 | 97 | 126 | 127 => Some(Hand::Right),
            _ => None,
        }
    }
}
