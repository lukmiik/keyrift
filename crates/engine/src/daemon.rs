//! The engine daemon: device grabbing, the event loop and runtime control (spec §4.8, §5).

use std::{
    collections::{BTreeMap, HashSet},
    io,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    time::Duration,
};

use evdev::{Device, EventType, InputEvent};
use keyrift_config::{
    ConfigDir, FileKind, Issue, LogLevel, Settings, validate_text, write_schemas,
};
use keyrift_core::{Engine, Key, KeyEvent, Keymap, Output};
use serde::Serialize;
use serde_json::{Value, json};
use tokio::{
    net::UnixListener,
    signal::unix::{SignalKind, signal},
    sync::{broadcast, mpsc},
    time::Instant,
};
use tracing::{debug, error, info, warn};

use crate::{
    devices::{self, Decision, Group},
    ipc::{self, Broadcast, IpcCommand},
    logging::LogControl,
    protocol::{PROTOCOL_VERSION, RpcError},
    vkbd::VirtualKeyboard,
    watch,
};

/// How long a valid new config may wait for all keys to be released (spec §5.7).
const RELOAD_MAX_WAIT: Duration = Duration::from_secs(5);
const RELOAD_DEBOUNCE: Duration = Duration::from_millis(100);
/// Retry interval for keyboards held by another program (e.g. kanata).
const BUSY_RETRY: Duration = Duration::from_secs(5);
/// Retry interval while a keyboard still has keys down or its node is not accessible yet.
const SHORT_RETRY: Duration = Duration::from_millis(50);
/// Prefix of the `blocked` reason for devices another program has grabbed (F-SYS-8).
const BUSY: &str = "busy:";

/// Recent input-to-output latencies (N-1), reported in `status.latency`.
#[derive(Default)]
struct Latency {
    samples: std::collections::VecDeque<u32>,
}

impl Latency {
    const KEEP: usize = 2048;

    fn record(&mut self, d: Duration) {
        if self.samples.len() == Self::KEEP {
            self.samples.pop_front();
        }
        self.samples
            .push_back(u32::try_from(d.as_micros()).unwrap_or(u32::MAX));
    }

    fn summary(&self) -> Value {
        let mut v: Vec<u32> = self.samples.iter().copied().collect();
        if v.is_empty() {
            return json!({ "samples": 0 });
        }
        v.sort_unstable();
        let pct = |p: usize| v[(v.len() * p / 100).min(v.len() - 1)];
        json!({ "samples": v.len(), "p50Us": pct(50), "p99Us": pct(99), "maxUs": v[v.len() - 1] })
    }
}

/// Result of trying to grab one device node.
enum Grab {
    Done,
    /// Not possible yet (permissions, keys held); try again after the delay.
    Retry(Duration),
    /// Another program has grabbed it.
    Busy,
}

pub struct Options {
    pub config_dir: PathBuf,
    pub socket: PathBuf,
    /// Testing: only grab devices whose name contains this substring.
    pub only_device: Option<String>,
    pub output_name: String,
    pub input_dir: PathBuf,
    pub log: LogControl,
}

/// Messages into the daemon loop.
pub enum Msg {
    Input {
        dev: u32,
        ev: InputEvent,
        at: Instant,
    },
    DeviceGone {
        dev: u32,
        error: String,
    },
    InputDirChanged,
    ConfigChanged,
    Ipc(IpcCommand),
    Shutdown,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum State {
    Running,
    Paused,
    Released,
    Error,
}

struct DevHandle {
    id: u32,
    path: PathBuf,
    group: String,
    name: String,
    /// Dropping the sender stops the reader task, which closes the device and ends the grab.
    _stop: mpsc::Sender<()>,
}

struct Record {
    conn: u64,
    keys: Vec<String>,
}

struct Daemon {
    opts: Options,
    cfg: ConfigDir,
    settings: Settings,
    profile_name: String,
    issues: Vec<Issue>,
    engine: Engine,
    vk: VirtualKeyboard,
    start: Instant,
    state: State,
    handles: Vec<DevHandle>,
    /// Device nodes that could not be grabbed, with the reason.
    blocked: BTreeMap<PathBuf, String>,
    groups: Vec<(Group, Decision)>,
    scanner: devices::Scanner,
    next_id: u32,
    raw_down: Vec<(u32, Key)>,
    record: Option<Record>,
    tester: HashSet<u64>,
    tx: mpsc::UnboundedSender<Msg>,
    events: broadcast::Sender<Broadcast>,
    reload_at: Option<Instant>,
    pending_keymap: Option<(Keymap, Instant)>,
    rescan_at: Option<Instant>,
    latency: Latency,
}

/// Run the daemon until SIGTERM/SIGINT.
pub async fn run(opts: Options) -> io::Result<()> {
    let cfg = ConfigDir::new(&opts.config_dir);
    if let Err(e) = write_schemas(&cfg.schema_dir()) {
        warn!(
            "cannot write JSON schemas to {}: {e}",
            cfg.schema_dir().display()
        );
    }
    let vk = VirtualKeyboard::create(&opts.output_name).map_err(|e| {
        error!("cannot create the virtual keyboard through /dev/uinput: {e}");
        e
    })?;
    info!("virtual keyboard `{}` at {:?}", opts.output_name, vk.node());

    let listener = bind_socket(&opts.socket)?;
    let (tx, mut rx) = mpsc::unbounded_channel();
    let (events, _) = broadcast::channel(1024);
    tokio::spawn(ipc::serve(listener, tx.clone(), events.clone()));
    watch::spawn_input_watch(&opts.input_dir, tx.clone())?;
    watch::spawn_config_watch(&opts.config_dir, tx.clone())?;
    spawn_signals(tx.clone())?;

    let mut d = Daemon {
        cfg,
        settings: Settings::default(),
        profile_name: String::new(),
        issues: Vec::new(),
        engine: Engine::new(Keymap::passthrough()),
        vk,
        start: Instant::now(),
        state: State::Error,
        handles: Vec::new(),
        blocked: BTreeMap::new(),
        groups: Vec::new(),
        scanner: devices::Scanner::default(),
        next_id: 1,
        raw_down: Vec::new(),
        record: None,
        tester: HashSet::new(),
        tx,
        events,
        reload_at: None,
        pending_keymap: None,
        rescan_at: None,
        latency: Latency::default(),
        opts,
    };
    d.reload();
    d.try_apply_pending();
    info!("listening on {}", d.opts.socket.display());

    loop {
        let deadline = d.next_deadline();
        tokio::select! {
            m = rx.recv() => match m {
                Some(Msg::Shutdown) | None => break,
                Some(m) => d.on_msg(m),
            },
            () = sleep_until(deadline) => {}
        }
        d.on_timers();
        d.try_apply_pending();
    }
    d.shutdown();
    Ok(())
}

async fn sleep_until(deadline: Option<Instant>) {
    match deadline {
        Some(t) => tokio::time::sleep_until(t).await,
        None => std::future::pending().await,
    }
}

fn bind_socket(path: &Path) -> io::Result<UnixListener> {
    if path.exists() {
        if std::os::unix::net::UnixStream::connect(path).is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                format!("another engine is already listening on {}", path.display()),
            ));
        }
        std::fs::remove_file(path)?;
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let listener = UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

fn spawn_signals(tx: mpsc::UnboundedSender<Msg>) -> io::Result<()> {
    let mut term = signal(SignalKind::terminate())?;
    let mut int = signal(SignalKind::interrupt())?;
    tokio::spawn(async move {
        tokio::select! {
            _ = term.recv() => {}
            _ = int.recv() => {}
        }
        let _ = tx.send(Msg::Shutdown);
    });
    Ok(())
}

fn min_opt(a: Option<Instant>, b: Option<Instant>) -> Option<Instant> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.min(y)),
        (x, y) => x.or(y),
    }
}

fn key_name(k: Key) -> String {
    k.to_string()
}

async fn reader(
    id: u32,
    dev: Device,
    tx: mpsc::UnboundedSender<Msg>,
    mut stop: mpsc::Receiver<()>,
) {
    let mut stream = match dev.into_event_stream() {
        Ok(s) => s,
        Err(e) => {
            let _ = tx.send(Msg::DeviceGone {
                dev: id,
                error: e.to_string(),
            });
            return;
        }
    };
    loop {
        tokio::select! {
            r = stream.next_event() => match r {
                Ok(ev) => {
                    if tx.send(Msg::Input { dev: id, ev, at: Instant::now() }).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.send(Msg::DeviceGone { dev: id, error: e.to_string() });
                    break;
                }
            },
            _ = stop.recv() => break,
        }
    }
}

impl Daemon {
    #[allow(clippy::cast_possible_truncation)] // u64 microseconds cover 584k years
    fn micros(&self, t: Instant) -> u64 {
        t.saturating_duration_since(self.start).as_micros() as u64
    }

    fn now_us(&self) -> u64 {
        self.micros(Instant::now())
    }

    fn next_deadline(&self) -> Option<Instant> {
        let engine = self
            .engine
            .next_deadline()
            .map(|us| self.start + Duration::from_micros(us));
        let pending = self.pending_keymap.as_ref().map(|(_, t)| *t);
        min_opt(
            min_opt(engine, pending),
            min_opt(self.reload_at, self.rescan_at),
        )
    }

    fn broadcast(&self, topic: &str, data: Value) {
        let _ = self.events.send(Broadcast {
            topic: topic.to_owned(),
            target: None,
            data,
        });
    }

    fn set_state(&mut self, s: State) {
        if self.state != s {
            info!("state: {:?} -> {s:?}", self.state);
            self.state = s;
            self.broadcast("status", self.status());
        }
    }

    fn on_msg(&mut self, m: Msg) {
        match m {
            Msg::Input { dev, ev, at } => self.on_input(dev, ev, at),
            Msg::DeviceGone { dev, error } => self.on_device_gone(dev, &error),
            Msg::InputDirChanged => self.schedule_rescan(SHORT_RETRY),
            Msg::ConfigChanged => self.reload_at = Some(Instant::now() + RELOAD_DEBOUNCE),
            Msg::Ipc(c) => self.on_ipc(c),
            Msg::Shutdown => {}
        }
    }

    fn on_timers(&mut self) {
        let now = Instant::now();
        if self.engine.next_deadline().is_some() {
            let mut out = Vec::new();
            self.engine.tick(self.micros(now), &mut out);
            self.apply(out, None);
        }
        if self.reload_at.is_some_and(|t| t <= now) {
            self.reload_at = None;
            self.reload();
        }
        if self.rescan_at.is_some_and(|t| t <= now) {
            self.rescan_at = None;
            self.rescan();
        }
    }

    fn schedule_rescan(&mut self, after: Duration) {
        let t = Instant::now() + after;
        self.rescan_at = Some(self.rescan_at.map_or(t, |x| x.min(t)));
    }

    // ------------------------------------------------------------------ input

    fn on_input(&mut self, dev: u32, ev: InputEvent, at: Instant) {
        if self.state != State::Running || !self.handles.iter().any(|h| h.id == dev) {
            return;
        }
        if ev.event_type() == EventType::RELATIVE {
            if let Err(e) = self.vk.forward(ev) {
                warn!("cannot forward event: {e}");
            }
            return;
        }
        if ev.event_type() != EventType::KEY || ev.value() == 2 {
            // Kernel auto-repeat is dropped: X generates its own repeat (spec §5.8).
            return;
        }
        let key = Key(ev.code());
        let pressed = ev.value() == 1;
        if pressed {
            if !self.raw_down.contains(&(dev, key)) {
                self.raw_down.push((dev, key));
            }
            if self.emergency_combo_held() {
                warn!("emergency release combo pressed: releasing all keyboards");
                self.release_devices(State::Released);
                return;
            }
        } else {
            self.raw_down.retain(|x| *x != (dev, key));
        }
        let kev = KeyEvent {
            device: dev,
            key,
            pressed,
            time: self.micros(at),
        };
        let mut out = Vec::new();
        if let Some(rec) = &mut self.record {
            self.engine.handle_unmapped(kev, &mut out);
            if pressed {
                rec.keys.push(key_name(key));
                let _ = self.events.send(Broadcast {
                    topic: "record".to_owned(),
                    target: Some(rec.conn),
                    data: json!({ "key": key_name(key), "device": self.device_name(dev) }),
                });
            }
        } else {
            let now = self.now_us();
            self.engine.handle(kev, now, &mut out);
        }
        self.apply(out, Some(kev));
        // N-1: time from the kernel timestamp of the input event to the end of the uinput write.
        if let Ok(d) = std::time::SystemTime::now().duration_since(ev.timestamp()) {
            self.latency.record(d);
        }
    }

    fn emergency_combo_held(&self) -> bool {
        let er = &self.settings.emergency_release;
        er.enabled
            && !er.keys.is_empty()
            && er
                .keys
                .iter()
                .all(|k| self.raw_down.iter().any(|(_, d)| *d == k.0))
    }

    fn device_name(&self, dev: u32) -> String {
        self.handles
            .iter()
            .find(|h| h.id == dev)
            .map(|h| h.name.clone())
            .unwrap_or_default()
    }

    fn apply(&mut self, out: Vec<Output>, ev: Option<KeyEvent>) {
        let mut outputs = Vec::new();
        let mut action = None;
        for o in out {
            match o {
                Output::Key { key, pressed } => {
                    if let Err(e) = self.vk.key(key, pressed) {
                        warn!("cannot emit {key}: {e}");
                    }
                    outputs.push(format!("{}{key}", if pressed { "+" } else { "-" }));
                }
                Output::LayersChanged => {
                    let layers = self.engine.active_layer_ids();
                    debug!("layers: {layers:?}");
                    self.broadcast("layer", json!({ "layers": layers }));
                }
                Output::Resolved { action: a, .. } => action = Some(a),
            }
        }
        if let Some(ev) = ev {
            // Debug level only: this logs typed keys.
            debug!(
                "{}{} -> {outputs:?}",
                if ev.pressed { "+" } else { "-" },
                ev.key
            );
        }
        if let Some(ev) = ev
            && !self.tester.is_empty()
        {
            self.broadcast(
                "tester",
                json!({
                    "timeUs": ev.time,
                    "device": self.device_name(ev.device),
                    "key": key_name(ev.key),
                    "pressed": ev.pressed,
                    "action": action,
                    "outputs": outputs,
                    "layers": self.engine.active_layer_ids(),
                }),
            );
        }
    }

    // ---------------------------------------------------------------- devices

    fn rescan(&mut self) {
        let groups = devices::group(self.scanner.scan(&self.opts.input_dir));
        let decided: Vec<(Group, Decision)> = groups
            .into_iter()
            .map(|g| {
                let d =
                    devices::decide(&g, &self.settings.devices, self.opts.only_device.as_deref());
                (g, d)
            })
            .collect();
        let present: HashSet<PathBuf> = decided
            .iter()
            .flat_map(|(g, _)| g.members.iter().map(|m| m.path.clone()))
            .collect();
        // Close handles for devices that disappeared or are no longer to be grabbed.
        let to_close: Vec<u32> = self
            .handles
            .iter()
            .filter(|h| {
                !present.contains(&h.path)
                    || decided
                        .iter()
                        .any(|(g, d)| g.key == h.group && *d != Decision::Grab)
                    || self.state != State::Running
            })
            .map(|h| h.id)
            .collect();
        for id in to_close {
            self.close_handle(id);
        }
        self.blocked.retain(|p, _| present.contains(p));
        let mut retry: Option<Duration> = None;
        if self.state == State::Running {
            for (g, d) in &decided {
                if *d != Decision::Grab {
                    continue;
                }
                // Members that were busy last time go first, so a keyboard held by another
                // program costs one failed grab per retry instead of grabbing and releasing the
                // other members every time.
                let mut members: Vec<_> = g.grab_members().collect();
                members.sort_by_key(|m| {
                    !self
                        .blocked
                        .get(&m.path)
                        .is_some_and(|r| r.starts_with(BUSY))
                });
                let mut busy = false;
                for m in members {
                    if self.handles.iter().any(|h| h.path == m.path) {
                        continue;
                    }
                    let wait = match self.open_and_grab(&m.path, &g.key, &m.name) {
                        Grab::Done => continue,
                        Grab::Retry(wait) => wait,
                        Grab::Busy => {
                            busy = true;
                            BUSY_RETRY
                        }
                    };
                    retry = Some(retry.map_or(wait, |r| r.min(wait)));
                    if busy {
                        break;
                    }
                }
                if busy {
                    // All or nothing (F-DEV-2): never hold part of a keyboard another program
                    // holds the rest of (kanata grabs only one of the HyperX interfaces).
                    let held: Vec<(u32, PathBuf)> = self
                        .handles
                        .iter()
                        .filter(|h| h.group == g.key)
                        .map(|h| (h.id, h.path.clone()))
                        .collect();
                    for (id, _) in held {
                        self.close_handle(id);
                    }
                    for m in g.grab_members() {
                        if !self
                            .blocked
                            .get(&m.path)
                            .is_some_and(|r| r.starts_with(BUSY))
                        {
                            let msg = format!("{BUSY} another program holds part of this keyboard");
                            self.blocked.insert(m.path.clone(), msg);
                        }
                    }
                }
            }
        }
        let changed = self.groups != decided;
        self.groups = decided;
        if let Some(r) = retry {
            self.schedule_rescan(r);
        }
        if changed {
            self.broadcast("devices", self.devices_json());
        }
    }

    /// Open and grab one device node.
    fn open_and_grab(&mut self, path: &Path, group: &str, name: &str) -> Grab {
        let mut dev = match Device::open(path) {
            Ok(d) => d,
            Err(e) => {
                // Permissions are applied by udev shortly after the node appears.
                let msg = format!("cannot open: {e}");
                if self
                    .blocked
                    .insert(path.to_path_buf(), msg.clone())
                    .as_deref()
                    != Some(msg.as_str())
                {
                    debug!("{} ({name}): {msg}", path.display());
                }
                return Grab::Retry(if e.kind() == io::ErrorKind::PermissionDenied {
                    SHORT_RETRY * 4
                } else {
                    BUSY_RETRY
                });
            }
        };
        // Never grab while keys are down: X saw the presses and would miss the releases.
        if dev.get_key_state().is_ok_and(|s| s.iter().next().is_some()) {
            self.blocked.insert(
                path.to_path_buf(),
                "waiting for keys to be released".to_owned(),
            );
            return Grab::Retry(SHORT_RETRY);
        }
        if let Err(e) = dev.grab() {
            let is_busy = e.raw_os_error() == Some(16); // EBUSY
            let msg = if is_busy {
                format!("{BUSY} another program has grabbed this device")
            } else {
                format!("cannot grab: {e}")
            };
            if self
                .blocked
                .insert(path.to_path_buf(), msg.clone())
                .as_deref()
                != Some(msg.as_str())
            {
                warn!("{} ({name}): {msg}", path.display());
            }
            return if is_busy {
                Grab::Busy
            } else {
                Grab::Retry(BUSY_RETRY)
            };
        }
        self.blocked.remove(path);
        let id = self.next_id;
        self.next_id += 1;
        let (stop_tx, stop_rx) = mpsc::channel(1);
        tokio::spawn(reader(id, dev, self.tx.clone(), stop_rx));
        info!("grabbed {} ({name})", path.display());
        self.handles.push(DevHandle {
            id,
            path: path.to_path_buf(),
            group: group.to_owned(),
            name: name.to_owned(),
            _stop: stop_tx,
        });
        Grab::Done
    }

    fn close_handle(&mut self, id: u32) {
        if let Some(i) = self.handles.iter().position(|h| h.id == id) {
            let h = self.handles.remove(i);
            info!("released {} ({})", h.path.display(), h.name);
            let mut out = Vec::new();
            let now = self.now_us();
            self.engine.device_removed(id, now, &mut out);
            self.apply(out, None);
            self.raw_down.retain(|(d, _)| *d != id);
        }
    }

    fn on_device_gone(&mut self, dev: u32, error: &str) {
        if self.handles.iter().any(|h| h.id == dev) {
            info!("device {} disconnected: {error}", self.device_name(dev));
            self.close_handle(dev);
            self.schedule_rescan(SHORT_RETRY * 4);
        }
    }

    /// Release every key and all keyboards (pause, emergency release).
    fn release_devices(&mut self, state: State) {
        let mut out = Vec::new();
        self.engine.release_all(&mut out);
        self.apply(out, None);
        let ids: Vec<u32> = self.handles.iter().map(|h| h.id).collect();
        for id in ids {
            self.close_handle(id);
        }
        self.raw_down.clear();
        self.set_state(state);
    }

    fn resume(&mut self) {
        self.set_state(State::Running);
        self.rescan();
    }

    // ----------------------------------------------------------------- config

    fn reload(&mut self) {
        let loaded = self.cfg.load();
        for i in &loaded.issues {
            if i.is_error() {
                error!("config: {i}");
            } else {
                warn!("config: {i}");
            }
        }
        self.issues = loaded.issues.clone();
        if loaded.has_errors() {
            error!("config rejected; keeping the previous configuration");
            self.broadcast("config", json!({ "ok": false, "issues": self.issues }));
            self.broadcast("status", self.status());
            return;
        }
        let devices_changed = self.settings.devices != loaded.settings.devices;
        self.settings = loaded.settings;
        self.profile_name = loaded.profile_name;
        self.opts.log.set_level(self.settings.log_level);
        self.pending_keymap = Some((loaded.keymap, Instant::now() + RELOAD_MAX_WAIT));
        info!("config loaded (profile `{}`)", self.profile_name);
        self.broadcast("config", json!({ "ok": true, "issues": self.issues }));
        if self.state == State::Error {
            self.set_state(State::Running);
            self.try_apply_pending();
            self.rescan();
        } else if devices_changed {
            self.rescan();
        }
    }

    fn try_apply_pending(&mut self) {
        let Some((_, force_at)) = &self.pending_keymap else {
            return;
        };
        let forced = Instant::now() >= *force_at;
        if !self.engine.is_idle() && !forced {
            return;
        }
        if let Some((km, _)) = self.pending_keymap.take() {
            if forced && !self.engine.is_idle() {
                warn!("keys still held after {RELOAD_MAX_WAIT:?}; applying config anyway");
            }
            let mut out = Vec::new();
            self.engine.set_keymap(km, &mut out);
            self.apply(out, None);
            info!("config applied");
            self.broadcast("status", self.status());
        }
    }

    // -------------------------------------------------------------------- ipc

    fn status(&self) -> Value {
        let grabbed = self.handles.len();
        json!({
            "state": self.state,
            "engineVersion": env!("CARGO_PKG_VERSION"),
            "pid": std::process::id(),
            "profile": self.profile_name,
            "activeLayers": self.engine.active_layer_ids(),
            "configIssues": self.issues,
            "configPending": self.pending_keymap.is_some(),
            "logLevel": self.opts.log.level(),
            "devices": {
                "grabbed": grabbed,
                "blocked": self.blocked.iter().map(|(p, m)| json!({ "path": p, "reason": m })).collect::<Vec<_>>(),
            },
            "outputDevice": self.vk.node(),
            "recording": self.record.is_some(),
            "latency": self.latency.summary(),
        })
    }

    fn devices_json(&self) -> Value {
        let list: Vec<Value> = self
            .groups
            .iter()
            .map(|(g, d)| {
                let members: Vec<Value> = g
                    .members
                    .iter()
                    .map(|m| {
                        json!({
                            "path": m.path,
                            "name": m.name,
                            "isPointer": m.is_pointer,
                            "hasLetters": m.has_letters,
                            "grabbed": self.handles.iter().any(|h| h.path == m.path),
                            "blocked": self.blocked.get(&m.path),
                        })
                    })
                    .collect();
                json!({
                    "key": g.key, "name": g.name, "vendorId": g.vendor_id, "productId": g.product_id,
                    "kind": g.kind, "decision": d, "members": members,
                })
            })
            .collect();
        json!({ "devices": list })
    }

    fn on_ipc(&mut self, c: IpcCommand) {
        match c {
            IpcCommand::Call {
                conn,
                method,
                params,
                reply,
            } => {
                let r = self.call(conn, &method, &params);
                let _ = reply.send(r);
            }
            IpcCommand::Tester { conn, subscribed } => {
                if subscribed {
                    self.tester.insert(conn);
                } else {
                    self.tester.remove(&conn);
                }
                self.engine.set_trace(!self.tester.is_empty());
            }
            IpcCommand::Disconnected { conn } => {
                if self.record.as_ref().is_some_and(|r| r.conn == conn) {
                    self.record = None;
                }
                if self.tester.remove(&conn) {
                    self.engine.set_trace(!self.tester.is_empty());
                }
            }
        }
    }

    fn call(&mut self, conn: u64, method: &str, params: &Value) -> Result<Value, RpcError> {
        match method {
            "hello" => Ok(json!({
                "protocolVersion": PROTOCOL_VERSION,
                "engineVersion": env!("CARGO_PKG_VERSION"),
                "state": self.state,
            })),
            "status.get" => Ok(self.status()),
            "devices.list" => Ok(self.devices_json()),
            "engine.pause" => {
                if self.state == State::Running {
                    self.release_devices(State::Paused);
                }
                Ok(self.status())
            }
            "engine.resume" => {
                if matches!(self.state, State::Paused | State::Released) {
                    self.resume();
                }
                Ok(self.status())
            }
            "config.reload" => {
                self.reload();
                self.try_apply_pending();
                let ok = !self.issues.iter().any(Issue::is_error);
                Ok(json!({ "ok": ok, "issues": self.issues }))
            }
            "config.validate" => {
                let text = params.get("text").and_then(Value::as_str).ok_or_else(|| {
                    RpcError::new(
                        "invalid_params",
                        "expected {\"text\": \"...\", \"kind\": \"settings|profile\"}",
                    )
                })?;
                let kind = match params.get("kind").and_then(Value::as_str) {
                    Some("settings") => FileKind::Settings,
                    Some("profile") | None => FileKind::Profile,
                    Some(k) => {
                        return Err(RpcError::new(
                            "invalid_params",
                            format!("unknown kind `{k}`"),
                        ));
                    }
                };
                let file = params
                    .get("file")
                    .and_then(Value::as_str)
                    .unwrap_or("input");
                let issues = validate_text(kind, file, text);
                let ok = !issues.iter().any(Issue::is_error);
                Ok(json!({ "ok": ok, "issues": issues }))
            }
            "log.setLevel" => {
                let level: LogLevel = params
                    .get("level")
                    .cloned()
                    .and_then(|v| serde_json::from_value(v).ok())
                    .ok_or_else(|| {
                        RpcError::new("invalid_params", "level must be error|warn|info|debug")
                    })?;
                self.opts.log.set_level(level);
                info!("log level set to {}", level.as_str());
                Ok(json!({ "level": level.as_str() }))
            }
            "record.start" => {
                if self.record.as_ref().is_some_and(|r| r.conn != conn) {
                    return Err(RpcError::new("busy", "another client is recording"));
                }
                self.record = Some(Record {
                    conn,
                    keys: Vec::new(),
                });
                Ok(json!({}))
            }
            "record.stop" => match self.record.take() {
                Some(r) if r.conn == conn => Ok(json!({ "keys": r.keys })),
                Some(r) => {
                    self.record = Some(r);
                    Err(RpcError::new("busy", "another client is recording"))
                }
                None => Ok(json!({ "keys": [] })),
            },
            _ => Err(RpcError::new(
                "unknown_method",
                format!("unknown method `{method}`"),
            )),
        }
    }

    fn shutdown(&mut self) {
        info!("shutting down");
        let mut out = Vec::new();
        self.engine.release_all(&mut out);
        self.apply(out, None);
        self.handles.clear();
        // Give readers of the virtual keyboard (X) time to see the releases before the device
        // disappears: events still queued on a destroyed evdev device are discarded.
        std::thread::sleep(Duration::from_millis(50));
        let _ = std::fs::remove_file(&self.opts.socket);
    }
}
