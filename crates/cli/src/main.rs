//! `keyrift` binary: the CLI and, via `keyrift daemon`, the engine entry point (spec §8.3).
// A command-line tool reports to the terminal.
#![allow(clippy::print_stdout, clippy::print_stderr)]

mod service;

use std::{
    path::{Path, PathBuf},
    process::ExitCode,
};

use clap::{Parser, Subcommand};
use keyrift_config::{ConfigDir, LogLevel, Severity, detect_kind, validate_text, write_schemas};
use keyrift_engine::{
    client::{Client, ClientError},
    daemon, devices, logging, paths,
};
use serde_json::{Value, json};

#[derive(Parser)]
#[command(
    name = "keyrift",
    version,
    about = "Keyboard remapping engine for Linux/X11"
)]
struct Cli {
    /// Engine socket (default: `$XDG_RUNTIME_DIR/keyrift.sock`).
    #[arg(long, global = true)]
    socket: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Run the engine (used by the systemd unit).
    Daemon {
        /// Config directory (default: ~/.config/keyrift).
        #[arg(long)]
        config_dir: Option<PathBuf>,
        /// Testing only: grab nothing but devices whose name contains this text.
        #[arg(long)]
        only_device: Option<String>,
        /// Name of the virtual output keyboard.
        #[arg(long, default_value = devices::OUTPUT_NAME)]
        output_name: String,
        /// Directory with input device nodes.
        #[arg(long, default_value = "/dev/input", hide = true)]
        input_dir: PathBuf,
    },
    /// Show engine state, profile, layers and config errors.
    Status {
        #[arg(long)]
        json: bool,
    },
    /// List keyboards (from the running engine, or scanned locally when it is not running).
    Devices {
        #[arg(long)]
        json: bool,
    },
    /// Release all keyboards until `resume`.
    Pause,
    /// Grab keyboards again after `pause` or an emergency release.
    Resume,
    /// Reload the config now.
    Reload,
    /// Validate a settings or profile file without applying it.
    Validate { file: PathBuf },
    /// Change the engine's log level at runtime.
    LogLevel { level: String },
    /// Print key events as the engine processes them.
    Monitor,
    /// Write the JSON Schemas (default: <config dir>/schema).
    Schema {
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Manage the systemd user service.
    Service {
        #[command(subcommand)]
        cmd: service::ServiceCmd,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let socket = cli
        .socket
        .clone()
        .unwrap_or_else(paths::default_socket_path);
    let result = match cli.cmd {
        Cmd::Daemon {
            config_dir,
            only_device,
            output_name,
            input_dir,
        } => run_daemon(config_dir, socket, only_device, output_name, input_dir),
        Cmd::Status { json } => status(&socket, json),
        Cmd::Devices { json } => list_devices(&socket, json),
        Cmd::Pause => simple(&socket, "engine.pause", Value::Null).map(|v| print_state(&v)),
        Cmd::Resume => simple(&socket, "engine.resume", Value::Null).map(|v| print_state(&v)),
        Cmd::Reload => reload(&socket),
        Cmd::Validate { file } => validate(&file),
        Cmd::LogLevel { level } => {
            simple(&socket, "log.setLevel", json!({ "level": level })).map(|v| {
                println!("log level: {}", v["level"].as_str().unwrap_or("?"));
                ExitCode::SUCCESS
            })
        }
        Cmd::Monitor => monitor(&socket),
        Cmd::Schema { out } => {
            let dir =
                out.unwrap_or_else(|| ConfigDir::new(paths::default_config_dir()).schema_dir());
            write_schemas(&dir)
                .map(|_| {
                    println!("schemas written to {}", dir.display());
                    ExitCode::SUCCESS
                })
                .map_err(|e| e.to_string())
        }
        Cmd::Service { cmd } => service::run(cmd),
    };
    match result {
        Ok(code) => code,
        Err(e) => {
            eprintln!("keyrift: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run_daemon(
    config_dir: Option<PathBuf>,
    socket: PathBuf,
    only_device: Option<String>,
    output_name: String,
    input_dir: PathBuf,
) -> Result<ExitCode, String> {
    let log = logging::init(LogLevel::Info);
    let opts = daemon::Options {
        config_dir: config_dir.unwrap_or_else(paths::default_config_dir),
        socket,
        only_device,
        output_name,
        input_dir,
        log,
    };
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    rt.block_on(daemon::run(opts)).map_err(|e| e.to_string())?;
    Ok(ExitCode::SUCCESS)
}

fn connect(socket: &Path) -> Result<Client, String> {
    Client::connect(socket, "keyrift-cli")
        .map(|(c, _)| c)
        .map_err(|e| match e {
            ClientError::Io(io) => format!(
                "cannot reach the engine at {} ({io}); is it running?",
                socket.display()
            ),
            other => other.to_string(),
        })
}

fn simple(socket: &Path, method: &str, params: Value) -> Result<Value, String> {
    connect(socket)?
        .call(method, params)
        .map_err(|e| e.to_string())
}

fn print_state(v: &Value) -> ExitCode {
    println!("state: {}", v["state"].as_str().unwrap_or("?"));
    ExitCode::SUCCESS
}

fn print_issues(issues: &Value) {
    for i in issues.as_array().into_iter().flatten() {
        let path = i["path"].as_str().unwrap_or("");
        let loc = if path.is_empty() {
            String::new()
        } else {
            format!(": {path}")
        };
        println!(
            "  {}: {}{loc}: {}",
            i["severity"].as_str().unwrap_or("?"),
            i["file"].as_str().unwrap_or("?"),
            i["message"].as_str().unwrap_or("")
        );
    }
}

fn status(socket: &Path, as_json: bool) -> Result<ExitCode, String> {
    let v = simple(socket, "status.get", Value::Null)?;
    if as_json {
        println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
        return Ok(ExitCode::SUCCESS);
    }
    println!("state:    {}", v["state"].as_str().unwrap_or("?"));
    println!("profile:  {}", v["profile"].as_str().unwrap_or("?"));
    let layers: Vec<&str> = v["activeLayers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    println!("layers:   {}", layers.join(", "));
    println!("grabbed:  {} device node(s)", v["devices"]["grabbed"]);
    for b in v["devices"]["blocked"].as_array().into_iter().flatten() {
        println!(
            "blocked:  {} ({})",
            b["path"].as_str().unwrap_or("?"),
            b["reason"].as_str().unwrap_or("")
        );
    }
    if v["configIssues"].as_array().is_some_and(|a| !a.is_empty()) {
        println!("config issues:");
        print_issues(&v["configIssues"]);
    }
    Ok(ExitCode::SUCCESS)
}

fn list_devices(socket: &Path, as_json: bool) -> Result<ExitCode, String> {
    let (v, source) = if let Ok((mut c, _)) = Client::connect(socket, "keyrift-cli") {
        (
            c.call("devices.list", Value::Null)
                .map_err(|e| e.to_string())?,
            "engine",
        )
    } else {
        let settings = ConfigDir::new(paths::default_config_dir()).load().settings;
        let groups = devices::group(devices::scan(Path::new("/dev/input")));
        let list: Vec<Value> = groups
            .iter()
            .map(|g| {
                let mut j = serde_json::to_value(g).unwrap_or_default();
                j["decision"] = serde_json::to_value(devices::decide(g, &settings.devices, None))
                    .unwrap_or_default();
                j
            })
            .collect();
        (json!({ "devices": list }), "local scan; engine not running")
    };
    if as_json {
        println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
        return Ok(ExitCode::SUCCESS);
    }
    println!("({source})");
    for g in v["devices"].as_array().into_iter().flatten() {
        if g["kind"] == "other" {
            continue;
        }
        println!(
            "{} [{}:{}] kind={} decision={}",
            g["name"].as_str().unwrap_or("?"),
            g["vendorId"].as_str().unwrap_or("?"),
            g["productId"].as_str().unwrap_or("?"),
            g["kind"].as_str().unwrap_or("?"),
            g["decision"].as_str().unwrap_or("?"),
        );
        for m in g["members"].as_array().into_iter().flatten() {
            let mut flags = Vec::new();
            if m["hasLetters"] == true {
                flags.push("letters");
            }
            if m["isPointer"] == true {
                flags.push("pointer");
            }
            if m["grabbed"] == true {
                flags.push("grabbed");
            }
            let blocked = m["blocked"]
                .as_str()
                .map(|b| format!(" blocked: {b}"))
                .unwrap_or_default();
            println!(
                "    {} {:?} [{}]{blocked}",
                m["path"].as_str().unwrap_or("?"),
                m["name"].as_str().unwrap_or("?"),
                flags.join(",")
            );
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn reload(socket: &Path) -> Result<ExitCode, String> {
    let v = simple(socket, "config.reload", Value::Null)?;
    print_issues(&v["issues"]);
    if v["ok"] == true {
        println!("config reloaded");
        Ok(ExitCode::SUCCESS)
    } else {
        println!("config rejected; the engine keeps the previous configuration");
        Ok(ExitCode::FAILURE)
    }
}

fn validate(file: &Path) -> Result<ExitCode, String> {
    let text = std::fs::read_to_string(file).map_err(|e| format!("{}: {e}", file.display()))?;
    let kind = detect_kind(file, &text);
    let issues = validate_text(kind, &file.display().to_string(), &text);
    for i in &issues {
        println!("{i}");
    }
    if issues.iter().any(|i| i.severity == Severity::Error) {
        Ok(ExitCode::FAILURE)
    } else {
        println!("{}: valid {kind:?}", file.display());
        Ok(ExitCode::SUCCESS)
    }
}

fn monitor(socket: &Path) -> Result<ExitCode, String> {
    let mut c = connect(socket)?;
    c.call(
        "subscribe",
        json!({ "topics": ["tester", "layer", "status", "config", "devices"] }),
    )
    .map_err(|e| e.to_string())?;
    println!("monitoring {} (Ctrl+C to stop)", socket.display());
    loop {
        let ev = c.next_event(None).map_err(|e| e.to_string())?;
        let d = &ev.data;
        match ev.event.as_str() {
            "tester" => {
                let outs: Vec<&str> = d["outputs"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect();
                #[allow(clippy::cast_precision_loss)]
                let t = d["timeUs"].as_u64().unwrap_or(0) as f64 / 1000.0;
                println!(
                    "{t:>12.1}ms {} {}{} -> {} [{}] ({})",
                    d["device"].as_str().unwrap_or("?"),
                    if d["pressed"] == true { "+" } else { "-" },
                    d["key"].as_str().unwrap_or("?"),
                    d["action"].as_str().unwrap_or("-"),
                    outs.join(" "),
                    d["layers"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(","),
                );
            }
            "layer" => println!("layers: {}", d["layers"]),
            "status" => println!("state: {}", d["state"].as_str().unwrap_or("?")),
            other => println!("{other}: {d}"),
        }
    }
}
