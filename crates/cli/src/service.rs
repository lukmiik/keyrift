//! Installing the systemd user unit (spec §9.1).

use std::{
    path::PathBuf,
    process::{Command, ExitCode},
};

use clap::Subcommand;

#[derive(Subcommand)]
pub enum ServiceCmd {
    /// Write ~/.config/systemd/user/<unit>.service, then enable and start it.
    Install {
        /// Unit name (tests use a separate unit).
        #[arg(long, default_value = "keyrift")]
        unit: String,
        /// Only write and enable the unit; do not start it.
        #[arg(long)]
        no_start: bool,
        /// Extra arguments for `keyrift daemon`.
        #[arg(last = true)]
        daemon_args: Vec<String>,
    },
    /// Stop, disable and remove the unit.
    Uninstall {
        #[arg(long, default_value = "keyrift")]
        unit: String,
    },
}

fn unit_dir() -> PathBuf {
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map_or_else(
            || PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"),
            PathBuf::from,
        );
    config.join("systemd/user")
}

fn quote(arg: &str) -> String {
    if arg
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "/._-=:".contains(c))
    {
        arg.to_owned()
    } else {
        format!("\"{}\"", arg.replace('\\', "\\\\").replace('"', "\\\""))
    }
}

/// The unit file text. The binary is referenced by absolute path and run without a shell.
pub fn unit_text(exe: &str, daemon_args: &[String]) -> String {
    let mut exec = vec![quote(exe), "daemon".to_owned()];
    exec.extend(daemon_args.iter().map(|a| quote(a)));
    format!(
        "[Unit]\n\
         Description=Keyrift keyboard remapping engine\n\
         After=graphical-session.target\n\
         \n\
         [Service]\n\
         ExecStart={}\n\
         Restart=on-failure\n\
         RestartSec=1\n\
         \n\
         [Install]\n\
         WantedBy=default.target\n",
        exec.join(" ")
    )
}

fn systemctl(args: &[&str]) -> Result<(), String> {
    let status = Command::new("systemctl")
        .arg("--user")
        .args(args)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("systemctl --user {} failed", args.join(" ")))
    }
}

pub fn run(cmd: ServiceCmd) -> Result<ExitCode, String> {
    match cmd {
        ServiceCmd::Install {
            unit,
            no_start,
            daemon_args,
        } => {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe = exe.canonicalize().unwrap_or(exe);
            let dir = unit_dir();
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("{unit}.service"));
            let text = unit_text(&exe.to_string_lossy(), &daemon_args);
            keyrift_config::write_atomic(&path, text.as_bytes()).map_err(|e| e.to_string())?;
            println!("wrote {}", path.display());
            systemctl(&["daemon-reload"])?;
            if no_start {
                systemctl(&["enable", &format!("{unit}.service")])?;
            } else {
                systemctl(&["enable", "--now", &format!("{unit}.service")])?;
                // A running unit keeps the old binary; restart so updates take effect.
                systemctl(&["restart", &format!("{unit}.service")])?;
            }
            println!("{unit}.service enabled");
            Ok(ExitCode::SUCCESS)
        }
        ServiceCmd::Uninstall { unit } => {
            let path = unit_dir().join(format!("{unit}.service"));
            let _ = systemctl(&["disable", "--now", &format!("{unit}.service")]);
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| e.to_string())?;
                println!("removed {}", path.display());
            }
            systemctl(&["daemon-reload"])?;
            Ok(ExitCode::SUCCESS)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_uses_absolute_path_and_quotes_args() {
        let t = unit_text(
            "/usr/bin/keyrift",
            &["--only-device".into(), "my kbd".into()],
        );
        assert!(t.contains("ExecStart=/usr/bin/keyrift daemon --only-device \"my kbd\"\n"));
        assert!(t.contains("Restart=on-failure"));
        assert!(!t.contains("sh -c"));
    }
}
