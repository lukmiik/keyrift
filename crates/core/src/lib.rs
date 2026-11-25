//! Pure remapping logic for Keyrift.
//!
//! This crate is a state machine with no I/O: input events and the current time go in,
//! output events and timer deadlines come out. That keeps it fully testable with
//! simulated, timestamped input (see the specification, §5).
#![forbid(unsafe_code)]

mod engine;
mod hands;
mod keymap;
mod keys;
mod keys_generated;
mod output;

pub use engine::{DeviceId, Engine, KeyEvent, Output};
pub use hands::Hand;
pub use keymap::{
    Action, Keymap, Layer, LayerMode, MacroStep, Shortcut, Strategy, TapHold, Trigger,
};
pub use keys::{Key, ModSet, Modifier};

/// Time in microseconds on the engine's monotonic clock.
pub type Micros = u64;

/// Convert milliseconds to [`Micros`].
pub const fn ms(millis: u64) -> Micros {
    millis * 1000
}
