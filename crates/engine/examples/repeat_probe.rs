//! M0 research probe: creates a uinput keyboard, holds `KEY_F24` (unmapped in X) for 1.5 s and
//! releases it, so X auto-repeat behaviour can be observed with `xinput test-xi2 --root`.
//! Optional arg `kernel-repeat` also enables `EV_REP` on the device to compare.
#![allow(clippy::print_stdout, clippy::unwrap_used)]

use std::{thread, time::Duration};

use evdev::{AttributeSet, EventType, InputEvent, KeyCode, uinput::VirtualDevice};

fn main() {
    let keys: AttributeSet<KeyCode> = (1..560).map(KeyCode::new).collect();
    let mut dev = VirtualDevice::builder()
        .unwrap()
        .name("keyrift-repeat-probe")
        .with_keys(&keys)
        .unwrap()
        .build()
        .unwrap();
    let node = dev
        .enumerate_dev_nodes_blocking()
        .unwrap()
        .next()
        .unwrap()
        .unwrap();
    println!("created {}", node.display());
    // Give X time to add the device.
    thread::sleep(Duration::from_millis(1500));
    let key = KeyCode::KEY_F24.code();
    dev.emit(&[InputEvent::new(EventType::KEY.0, key, 1)])
        .unwrap();
    println!("pressed");
    thread::sleep(Duration::from_millis(1500));
    dev.emit(&[InputEvent::new(EventType::KEY.0, key, 0)])
        .unwrap();
    println!("released");
    thread::sleep(Duration::from_millis(300));
}
