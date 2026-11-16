/**
 * A private engine for tests (spec §11.1), like `crates/cli/tests/common/mod.rs`.
 *
 * Safety: the daemon gets its own config dir and socket, an empty input directory (so it sees no
 * devices at all), and `--only-device` with a unique name as a second guard. It never touches
 * real keyboards or the user's `keyrift.service`.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { EngineClient } from "../src/main/engine/client.ts";

const REPO_DIR = join(import.meta.dirname, "../../..");

/** A profile with one empty layer: every key does its normal thing. */
const EMPTY_PROFILE = { version: 1, name: "Test", layers: [{ id: "base" }] };

let built = false;

/** Builds the engine once per test run, so tests always run the current source. */
function engineBinary(): string {
  if (!built) {
    execFileSync("cargo", ["build", "--quiet", "--package", "keyrift"], {
      cwd: REPO_DIR,
      stdio: ["ignore", "ignore", "inherit"],
    });
    built = true;
  }
  return join(REPO_DIR, "target/debug/keyrift");
}

export class TestEngine {
  /** Unique per engine; also the only device name the engine would grab. */
  readonly id: string;
  readonly dir: string;
  readonly socketPath: string;
  readonly configDir: string;
  #process: ChildProcess;

  private constructor(id: string, dir: string, process: ChildProcess) {
    this.id = id;
    this.dir = dir;
    this.socketPath = join(dir, "keyrift.sock");
    this.configDir = join(dir, "config");
    this.#process = process;
  }

  /**
   * Starts a daemon with `profile` as the active profile and waits until it answers.
   * `dir`: an existing directory to use (socket at `<dir>/keyrift.sock`), so a test can know the
   * socket path before the engine starts. Default: a new temporary directory.
   */
  static async start(options: { profile?: object; dir?: string } = {}): Promise<TestEngine> {
    const profile = options.profile ?? EMPTY_PROFILE;
    const dir = options.dir ?? mkdtempSync(join(tmpdir(), "keyrift-test-"));
    const id = `keyrift-test-${process.pid}-${dir.slice(-6)}`;
    const configDir = join(dir, "config");
    const inputDir = join(dir, "input");
    mkdirSync(join(configDir, "profiles"), { recursive: true });
    mkdirSync(inputDir, { recursive: true });
    writeFileSync(join(configDir, "profiles/test.json"), JSON.stringify(profile));
    writeFileSync(
      join(configDir, "settings.json"),
      JSON.stringify({ version: 1, activeProfile: "test" }),
    );

    const log = openSync(join(dir, "daemon.log"), "w");
    const child = spawn(
      engineBinary(),
      [
        "--socket",
        join(dir, "keyrift.sock"),
        "daemon",
        "--config-dir",
        configDir,
        "--input-dir",
        inputDir,
        "--only-device",
        id,
        "--output-name",
        `Keyrift virtual keyboard ${id}`,
      ],
      { stdio: ["ignore", log, log] },
    );
    const engine = new TestEngine(id, dir, child);
    await engine.#waitUntilReady();
    return engine;
  }

  /** Connects a new client (already past `hello`). The caller closes it. */
  async connect(): Promise<EngineClient> {
    const { client } = await EngineClient.connect(this.socketPath);
    return client;
  }

  /** The daemon's stdout/stderr so far, for debugging failed tests. */
  log(): string {
    return readFileSync(join(this.dir, "daemon.log"), "utf8");
  }

  /** Stops the daemon (SIGTERM, then SIGKILL after 3 s) and deletes its directory. */
  async stop(): Promise<void> {
    if (this.#process.exitCode === null && this.#process.signalCode === null) {
      const exited = new Promise((resolve) => this.#process.once("exit", resolve));
      this.#process.kill("SIGTERM");
      const timeout = sleep(3000).then(() => this.#process.kill("SIGKILL"));
      await Promise.race([exited, timeout]);
    }
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** Polls the socket until `hello` succeeds; fails with the daemon log after 5 s. */
  async #waitUntilReady(): Promise<void> {
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        const client = await this.connect();
        await client.close();
        return;
      } catch (error) {
        if (Date.now() > deadline || this.#process.exitCode !== null) {
          const log = this.log();
          await this.stop();
          throw new Error(`engine did not start: ${String(error)}\n${log}`, { cause: error });
        }
        await sleep(20);
      }
    }
  }
}
