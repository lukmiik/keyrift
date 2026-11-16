//! A virtual keyboard for the GUI tests (`apps/desktop/test/test-keyboard.ts`), like the `Source`
//! keyboards of the Rust tests: the Node tests can't create uinput devices themselves.
//!
//! Usage: `keyrift-test-keyboard <device name>`. Creates the keyboard, prints its event node
//! (e.g. `/dev/input/event27`), then reads commands from stdin, one per line, and answers each with
//! `ok` or `error: …`:
//!
//! - `down KEY_A` / `up KEY_A`: press or release a key
//! - `tap KEY_A`: press and release it
//! - `grab <device name>`: grab another input device by its exact name until exit, so its events
//!   reach no one else. The tests grab their engine's output keyboard, so recorded keys (which the
//!   engine passes through) aren't typed into the desktop.
//!
//! The device is removed when stdin closes. The tests give it a unique name and start their engine
//! with `--only-device <that name>`, so no other engine (e.g. the user's service) treats it as
//! special; a running service may grab it like any keyboard, which is harmless.

use std::{
    io::{self, BufRead, Write},
    thread,
    time::{Duration, Instant},
};

use evdev::{AttributeSet, Device, EventType, InputEvent, KeyCode, uinput::VirtualDevice};
use keyrift_core::Key;

fn main() -> Result<(), String> {
    let name = std::env::args()
        .nth(1)
        .ok_or("usage: keyrift-test-keyboard <device name>")?;
    let mut dev = create(&name).map_err(|e| format!("cannot create the keyboard: {e}"))?;
    let node = wait_for_node(&mut dev).ok_or("the keyboard's event node did not appear")?;

    // Grabbed devices stay grabbed while their handle is open.
    let mut grabbed: Vec<Device> = Vec::new();
    let mut out = io::stdout().lock();
    writeln!(out, "{}", node.display()).map_err(|e| e.to_string())?;
    out.flush().map_err(|e| e.to_string())?;
    for line in io::stdin().lock().lines() {
        let line = line.map_err(|e| e.to_string())?;
        let answer = match run(&mut dev, &mut grabbed, &line) {
            Ok(()) => "ok".to_owned(),
            Err(e) => format!("error: {e}"),
        };
        writeln!(out, "{answer}").map_err(|e| e.to_string())?;
        out.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A USB keyboard with every key the engine knows.
fn create(name: &str) -> io::Result<VirtualDevice> {
    let keys: AttributeSet<KeyCode> = (1..Key::CODE_LIMIT).map(KeyCode::new).collect();
    VirtualDevice::builder()?
        .name(name)
        .input_id(evdev::InputId::new(
            evdev::BusType::BUS_USB,
            0x1234,
            0x5678,
            1,
        ))
        .with_keys(&keys)?
        .build()
}

/// The node appears asynchronously (udev); wait up to 3 s.
fn wait_for_node(dev: &mut VirtualDevice) -> Option<std::path::PathBuf> {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(Ok(node)) = dev.enumerate_dev_nodes_blocking().ok()?.next() {
            return Some(node);
        }
        thread::sleep(Duration::from_millis(20));
    }
    None
}

fn run(dev: &mut VirtualDevice, grabbed: &mut Vec<Device>, line: &str) -> Result<(), String> {
    let (command, name) = line
        .trim()
        .split_once(' ')
        .ok_or("expected `<down|up|tap> KEY_NAME` or `grab <device name>`")?;
    if command == "grab" {
        grabbed.push(grab(name)?);
        return Ok(());
    }
    let key = Key::from_name(name).ok_or_else(|| format!("unknown key `{name}`"))?;
    match command {
        "down" => send(dev, key, true),
        "up" => send(dev, key, false),
        "tap" => {
            send(dev, key, true)?;
            send(dev, key, false)
        }
        _ => Err(format!("unknown command `{command}`")),
    }
}

/// One key event plus the sync report that ends it.
fn send(dev: &mut VirtualDevice, key: Key, pressed: bool) -> Result<(), String> {
    let event = InputEvent::new(EventType::KEY.0, key.code(), i32::from(pressed));
    dev.emit(&[event]).map_err(|e| e.to_string())
}

/// Opens and grabs the input device named exactly `name`. Waits up to 3 s for it: a new device's
/// node becomes readable only after udev has set its permissions.
fn grab(name: &str) -> Result<Device, String> {
    let start = Instant::now();
    let (_, mut device) = loop {
        if let Some(found) = evdev::enumerate().find(|(_, d)| d.name() == Some(name)) {
            break found;
        }
        if start.elapsed() > Duration::from_secs(3) {
            return Err(format!("no input device named `{name}`"));
        }
        thread::sleep(Duration::from_millis(20));
    };
    device
        .grab()
        .map_err(|e| format!("cannot grab `{name}`: {e}"))?;
    Ok(device)
}
