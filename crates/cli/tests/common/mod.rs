//! End-to-end test harness (spec §11.1).
//!
//! Each test starts its own `keyrift daemon` with `--only-device <unique name>`, a private
//! config dir and socket, so real keyboards (and a running kanata) are never touched.
//! Events are sent through virtual source keyboards created with uinput and read back from
//! the engine's output device, which the test grabs first so nothing reaches X.
#![allow(
    dead_code,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::print_stderr
)]

pub mod raw;

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicU32, Ordering},
    thread,
    time::{Duration, Instant},
};

use evdev::{AttributeSet, Device, EventType, InputEvent, KeyCode, uinput::VirtualDevice};
use keyrift_engine::client::Client;
use serde_json::Value;

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// Whether this machine can run end-to-end tests (needs write access to /dev/uinput).
pub fn uinput_available() -> bool {
    let ok = fs::OpenOptions::new()
        .write(true)
        .open("/dev/uinput")
        .is_ok();
    if !ok {
        eprintln!("skipping: /dev/uinput is not writable");
    }
    ok
}

pub fn unique(tag: &str) -> String {
    format!(
        "keyrift-test-{}-{}-{tag}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    )
}

pub fn key(name: &str) -> KeyCode {
    KeyCode::new(
        keyrift_core::Key::from_name(name)
            .unwrap_or_else(|| panic!("unknown key {name}"))
            .code(),
    )
}

pub fn key_name(code: u16) -> String {
    keyrift_core::Key(code).to_string()
}

pub fn wait_until<T>(timeout: Duration, mut f: impl FnMut() -> Option<T>) -> Option<T> {
    let end = Instant::now() + timeout;
    loop {
        if let Some(v) = f() {
            return Some(v);
        }
        if Instant::now() > end {
            return None;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

/// A virtual keyboard the test types on.
pub struct Source {
    pub name: String,
    dev: VirtualDevice,
    pub node: PathBuf,
}

impl Source {
    pub fn new(name: &str) -> Source {
        let keys: AttributeSet<KeyCode> = (1..560).map(KeyCode::new).collect();
        let mut dev = VirtualDevice::builder()
            .unwrap()
            .name(name)
            .input_id(evdev::InputId::new(
                evdev::BusType::BUS_USB,
                0x1234,
                0x5678,
                1,
            ))
            .with_keys(&keys)
            .unwrap()
            .build()
            .unwrap();
        let node = wait_until(Duration::from_secs(3), || {
            dev.enumerate_dev_nodes_blocking().ok()?.next()?.ok()
        })
        .expect("source node");
        Source {
            name: name.to_owned(),
            dev,
            node,
        }
    }

    pub fn send(&mut self, name: &str, pressed: bool) {
        self.dev
            .emit(&[InputEvent::new(
                EventType::KEY.0,
                key(name).code(),
                i32::from(pressed),
            )])
            .unwrap();
        thread::sleep(Duration::from_millis(2));
    }

    pub fn down(&mut self, name: &str) -> &mut Self {
        self.send(name, true);
        self
    }

    pub fn up(&mut self, name: &str) -> &mut Self {
        self.send(name, false);
        self
    }

    pub fn tap(&mut self, name: &str) -> &mut Self {
        self.down(name).up(name)
    }

    /// Send a kernel auto-repeat event (value 2).
    pub fn repeat(&mut self, name: &str) {
        self.dev
            .emit(&[InputEvent::new(EventType::KEY.0, key(name).code(), 2)])
            .unwrap();
        thread::sleep(Duration::from_millis(2));
    }

    /// Try to grab our own source node: succeeds only if nobody else (the engine) holds it.
    /// Keeps the grab so nothing reaches X. Returns whether the grab succeeded.
    pub fn grab_self(&self) -> Option<Device> {
        let mut d = Device::open(&self.node).ok()?;
        d.grab().ok()?;
        Some(d)
    }
}

/// The engine's output device, grabbed by the test.
pub struct Output {
    dev: Device,
}

impl Output {
    pub fn open(node: &Path) -> Output {
        let mut dev = Device::open(node).expect("open output");
        dev.grab().expect("grab output: nothing may reach X");
        dev.set_nonblocking(true).unwrap();
        Output { dev }
    }

    /// Read key events (`+KEY_X` / `-KEY_X`, repeats ignored) until `n` arrived or timeout.
    pub fn read(&mut self, n: usize, timeout: Duration) -> Vec<String> {
        let mut got = Vec::new();
        let end = Instant::now() + timeout;
        while got.len() < n && Instant::now() < end {
            match self.dev.fetch_events() {
                Ok(evs) => {
                    for e in evs {
                        if e.event_type() == EventType::KEY && e.value() != 2 {
                            got.push(format!(
                                "{}{}",
                                if e.value() == 1 { "+" } else { "-" },
                                key_name(e.code())
                            ));
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(2));
                }
                // The engine destroyed its device (e.g. on shutdown).
                Err(_) => break,
            }
        }
        got
    }

    /// Assert the exact sequence of key events, then that nothing else arrives shortly after.
    pub fn expect(&mut self, expected: &[&str]) {
        let got = self.read(expected.len(), Duration::from_secs(2));
        let expected: Vec<String> = expected.iter().map(|s| (*s).to_owned()).collect();
        assert_eq!(got, expected, "output events");
        self.expect_nothing(Duration::from_millis(30));
    }

    pub fn expect_nothing(&mut self, d: Duration) {
        let extra = self.read(usize::MAX, d);
        assert!(extra.is_empty(), "unexpected output events: {extra:?}");
    }

    /// Read relative events (for forwarded wheel events).
    pub fn read_raw(&mut self, timeout: Duration) -> Vec<InputEvent> {
        let mut got = Vec::new();
        let end = Instant::now() + timeout;
        while Instant::now() < end {
            if let Ok(evs) = self.dev.fetch_events() {
                got.extend(evs.filter(|e| e.event_type() != EventType::SYNCHRONIZATION));
            } else {
                thread::sleep(Duration::from_millis(2));
            }
        }
        got
    }

    /// Stuck-key check: the output device must have no key held.
    pub fn assert_no_keys_held(&self) {
        let held: Vec<String> = self
            .dev
            .get_key_state()
            .unwrap()
            .iter()
            .map(|k| key_name(k.code()))
            .collect();
        assert!(held.is_empty(), "keys stuck on the output: {held:?}");
    }
}

/// A running daemon with a private config dir and socket.
pub struct Engine {
    pub id: String,
    pub dir: tempfile::TempDir,
    pub socket: PathBuf,
    pub config: PathBuf,
    pub output_name: String,
    child: Option<Child>,
    log: PathBuf,
}

pub fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_keyrift")
}

impl Engine {
    /// Start with the given profile (as `profiles/test.json`) and optional extra settings.
    pub fn start(profile: &str, settings: Option<&str>) -> Engine {
        let id = unique("e");
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config");
        fs::create_dir_all(config.join("profiles")).unwrap();
        fs::write(config.join("profiles/test.json"), profile).unwrap();
        let settings = settings.map_or_else(
            || r#"{"version":1,"activeProfile":"test"}"#.to_owned(),
            ToOwned::to_owned,
        );
        fs::write(config.join("settings.json"), settings).unwrap();
        let mut e = Engine {
            output_name: format!("Keyrift virtual keyboard {id}"),
            socket: dir.path().join("keyrift.sock"),
            log: dir.path().join("daemon.log"),
            config,
            id,
            dir,
            child: None,
        };
        e.spawn();
        e
    }

    pub fn spawn(&mut self) {
        let log = fs::File::create(&self.log).unwrap();
        let child = Command::new(bin())
            .args(["--socket"])
            .arg(&self.socket)
            .args(["daemon", "--config-dir"])
            .arg(&self.config)
            .args([
                "--only-device",
                &self.id,
                "--output-name",
                &self.output_name,
            ])
            .env("RUST_BACKTRACE", "1")
            .stdout(Stdio::from(log.try_clone().unwrap()))
            .stderr(Stdio::from(log))
            .spawn()
            .unwrap();
        self.child = Some(child);
        wait_until(Duration::from_secs(5), || {
            Client::connect(&self.socket, "test").ok()
        })
        .unwrap_or_else(|| panic!("engine did not start:\n{}", self.log()));
    }

    pub fn log(&self) -> String {
        let mut s = String::new();
        if let Ok(mut f) = fs::File::open(&self.log) {
            let _ = f.read_to_string(&mut s);
        }
        s
    }

    pub fn client(&self) -> Client {
        Client::connect(&self.socket, "test").unwrap().0
    }

    pub fn call(&self, method: &str, params: Value) -> Value {
        self.client()
            .call(method, params)
            .unwrap_or_else(|e| panic!("{method}: {e}\n{}", self.log()))
    }

    pub fn status(&self) -> Value {
        self.call("status.get", Value::Null)
    }

    /// Open and grab the engine's output device.
    pub fn output(&self) -> Output {
        let node = wait_until(Duration::from_secs(3), || {
            self.status()["outputDevice"].as_str().map(PathBuf::from)
        })
        .expect("output node");
        Output::open(&node)
    }

    /// Create a source keyboard and wait until the engine grabbed it.
    pub fn source(&self, tag: &str) -> Source {
        let before = self.grabbed();
        let s = Source::new(&format!("{}-{tag}", self.id));
        self.wait_grabbed(before + 1);
        s
    }

    pub fn grabbed(&self) -> u64 {
        self.status()["devices"]["grabbed"].as_u64().unwrap_or(0)
    }

    pub fn wait_grabbed(&self, n: u64) {
        wait_until(Duration::from_secs(5), || {
            (self.grabbed() == n).then_some(())
        })
        .unwrap_or_else(|| {
            panic!(
                "expected {n} grabbed device(s), status: {}\n{}",
                self.status(),
                self.log()
            )
        });
    }

    pub fn write_profile(&self, text: &str) {
        keyrift_config::write_atomic(&self.config.join("profiles/test.json"), text.as_bytes())
            .unwrap();
    }

    pub fn write_settings(&self, text: &str) {
        keyrift_config::write_atomic(&self.config.join("settings.json"), text.as_bytes()).unwrap();
    }

    pub fn pid(&self) -> u32 {
        self.child.as_ref().map_or(0, Child::id)
    }

    /// Send a signal without waiting for the process to exit.
    pub fn signal(&self, sig: &str) {
        let _ = Command::new("kill")
            .arg(format!("-{sig}"))
            .arg(self.pid().to_string())
            .status();
    }

    /// Stop with SIGTERM and wait.
    pub fn stop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let _ = Command::new("kill")
                .arg("-TERM")
                .arg(c.id().to_string())
                .status();
            let ok = wait_until(Duration::from_secs(3), || c.try_wait().ok().flatten()).is_some();
            if !ok {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.stop();
        if thread::panicking() {
            eprintln!("---- daemon log ({}) ----\n{}", self.id, self.log());
        }
    }
}

/// The author's baseline profile (spec §6.6).
pub fn baseline_profile() -> String {
    fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../examples/config/profiles/daily.json"
    ))
    .unwrap()
}
