//! Keyrift engine: grabs keyboards, feeds events through `keyrift-core` and emits the
//! result through a uinput virtual keyboard.

pub mod client;
pub mod daemon;
pub mod devices;
pub mod ipc;
pub mod logging;
pub mod paths;
pub mod protocol;
pub mod vkbd;
mod watch;
