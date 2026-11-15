//! The uinput virtual keyboard Keyrift emits through.

use std::{io, path::PathBuf, thread, time::Duration};

use evdev::{
    AttributeSet, EventType, InputEvent, KeyCode, RelativeAxisCode, uinput::VirtualDevice,
};
use keyrift_core::Key;

pub struct VirtualKeyboard {
    dev: VirtualDevice,
    node: Option<PathBuf>,
}

impl VirtualKeyboard {
    /// Create the device. Supports every key below [`Key::CODE_LIMIT`] and the wheel axes of
    /// consumer-control interfaces, whose events are forwarded unchanged.
    pub fn create(name: &str) -> io::Result<VirtualKeyboard> {
        let keys: AttributeSet<KeyCode> = (1..Key::CODE_LIMIT).map(KeyCode::new).collect();
        let rel: AttributeSet<RelativeAxisCode> = [
            RelativeAxisCode::REL_WHEEL,
            RelativeAxisCode::REL_HWHEEL,
            RelativeAxisCode::REL_WHEEL_HI_RES,
            RelativeAxisCode::REL_HWHEEL_HI_RES,
        ]
        .into_iter()
        .collect();
        let mut dev = VirtualDevice::builder()?
            .name(name)
            .input_id(evdev::InputId::new(
                evdev::BusType::BUS_USB,
                0x1d6b,
                0x4b52,
                1,
            ))
            .with_keys(&keys)?
            .with_relative_axes(&rel)?
            .build()?;
        // The node appears asynchronously; give udev a moment (bounded) so tests can find it.
        let mut node = None;
        for _ in 0..50 {
            if let Some(Ok(p)) = dev.enumerate_dev_nodes_blocking()?.next() {
                node = Some(p);
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        Ok(VirtualKeyboard { dev, node })
    }

    pub fn node(&self) -> Option<&PathBuf> {
        self.node.as_ref()
    }

    pub fn key(&mut self, key: Key, pressed: bool) -> io::Result<()> {
        self.dev.emit(&[InputEvent::new(
            EventType::KEY.0,
            key.code(),
            i32::from(pressed),
        )])
    }

    /// Forward a non-key event (e.g. a wheel event from a consumer-control interface).
    pub fn forward(&mut self, ev: InputEvent) -> io::Result<()> {
        self.dev.emit(&[ev])
    }
}
