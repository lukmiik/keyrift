/**
 * Where the `keyrift` engine binary is, for the setup wizard's "install the engine service" fix
 * (spec §9.1). The unit it writes points at this path, so it must outlive the GUI:
 * - dev: `keyrift` on PATH (`cargo install` or a symlink).
 * - .deb / pacman: the copy shipped next to the app (`/opt/Keyrift/resources/keyrift`), which the
 *   package manager owns and replaces on upgrade.
 * - AppImage: its files only exist while it runs, mounted at a new path each time, so the engine is
 *   copied to `~/.local/share/keyrift/bin/keyrift` and the unit points there.
 */
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where an AppImage's engine is copied to: `$XDG_DATA_HOME/keyrift/bin/keyrift`. */
export function appImageEnginePath(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome =
    env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME !== ""
      ? env.XDG_DATA_HOME
      : join(homedir(), ".local/share");
  return join(dataHome, "keyrift/bin/keyrift");
}

/**
 * Copies `source` to `target` unless it already has the same bytes. Returns whether it copied.
 *
 * The copy is written next to the target and then renamed over it. A running engine keeps its old
 * file open (Linux won't let a running binary be overwritten in place: "text file busy"), and the
 * new one is used from the next start.
 */
export async function installEngine(source: string, target: string): Promise<boolean> {
  const next = await readFile(source);
  const current = await readFile(target).catch(() => null);
  if (current !== null && current.equals(next)) return false;
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.new`;
  await copyFile(source, temporary);
  await chmod(temporary, 0o755);
  await rename(temporary, target);
  return true;
}

/**
 * Restarts the engine service if it runs the binary at `path`, so an updated AppImage's engine
 * takes over. The engine releases the keyboards when it stops, so no keys stay held. Does nothing
 * when the unit isn't installed, isn't running (`try-restart`), or runs another binary (e.g. a
 * developer's own build).
 */
export async function restartEngineUsing(
  path: string,
  systemctl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // Where `keyrift service install` writes the unit (crates/cli/src/service.rs).
  const config =
    env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME !== ""
      ? env.XDG_CONFIG_HOME
      : join(homedir(), ".config");
  const unitFile = join(config, "systemd/user/keyrift.service");
  const unit = await readFile(unitFile, "utf8").catch(() => "");
  // `keyrift service install` quotes the path only when it has unusual characters (spaces…).
  if (!unit.includes(`ExecStart=${path} `) && !unit.includes(`ExecStart="${path}" `)) return;
  await new Promise<void>((resolve) => {
    execFile(systemctl, ["--user", "try-restart", "keyrift.service"], { timeout: 30_000 }, () =>
      resolve(),
    );
  });
}
