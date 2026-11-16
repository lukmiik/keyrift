/**
 * A virtual keyboard for GUI tests (spec §11.1), typed through `crates/test-keyboard`: Node can't
 * create uinput devices itself.
 *
 * Safety: the keyboard is named `<engine id>-kbd`, so only the test's own engine grabs it (a normal
 * engine, like the user's service, skips `keyrift-test-*` devices). It is linked into the test
 * engine's private input folder. The helper also grabs the test engine's output keyboard, so keys
 * the engine passes through are never typed into the desktop.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { accessSync, constants, rmSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

import type { KeyName } from "@keyrift/config-types";

import type { TestEngine } from "./test-engine.ts";

const REPO_DIR = join(import.meta.dirname, "../../..");

let built = false;

function helperBinary(): string {
  if (!built) {
    execFileSync("cargo", ["build", "--quiet", "--package", "keyrift-test-keyboard"], {
      cwd: REPO_DIR,
      stdio: ["ignore", "ignore", "inherit"],
    });
    built = true;
  }
  return join(REPO_DIR, "target/debug/keyrift-test-keyboard");
}

/** Whether this user may create virtual keyboards (member of the `uinput` group). */
export function uinputAvailable(): boolean {
  try {
    accessSync("/dev/uinput", constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export class TestKeyboard {
  readonly name: string;
  readonly #process: ChildProcess;
  /** The keyboard's link in the engine's input folder. */
  #link: string | null = null;
  /** Lines from the helper that no one waited for yet, and callers waiting for a line. */
  readonly #lines: string[] = [];
  readonly #waiting: ((line: string | null) => void)[] = [];
  #closed = false;

  private constructor(name: string, process: ChildProcess) {
    this.name = name;
    this.#process = process;
    createInterface({ input: process.stdout! }).on("line", (line) => this.#receive(line));
    // null tells waiting callers that the helper is gone.
    process.stdout!.on("close", () => this.#receive(null));
  }

  /** Creates a keyboard that only `engine` sees, and grabs the engine's output keyboard. */
  static async attach(engine: TestEngine): Promise<TestKeyboard> {
    const name = `${engine.id}-kbd`;
    const child = spawn(helperBinary(), [name], { stdio: ["pipe", "pipe", "inherit"] });
    const keyboard = new TestKeyboard(name, child);
    // The helper's first line is the new keyboard's event node.
    const node = await keyboard.#nextLine();
    if (node === null) {
      throw new Error("keyrift-test-keyboard exited before creating the keyboard");
    }
    try {
      // The engine watches its input folder, so the new link counts as a plugged-in keyboard.
      keyboard.#link = join(engine.inputDir, basename(node));
      symlinkSync(node, keyboard.#link);
      await keyboard.#command(`grab ${engine.outputName}`);
    } catch (error) {
      await keyboard.close();
      throw error;
    }
    return keyboard;
  }

  /** Presses and releases `key`. */
  tap(key: KeyName): Promise<void> {
    return this.#command(`tap ${key}`);
  }

  down(key: KeyName): Promise<void> {
    return this.#command(`down ${key}`);
  }

  up(key: KeyName): Promise<void> {
    return this.#command(`up ${key}`);
  }

  /** Removes the keyboard (the helper exits when its input closes). */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#link !== null) rmSync(this.#link, { force: true });
    const exited = new Promise((resolve) => this.#process.once("exit", resolve));
    this.#process.stdin!.end();
    if (this.#process.exitCode === null) await exited;
  }

  async #command(line: string): Promise<void> {
    this.#process.stdin!.write(`${line}\n`);
    const answer = await this.#nextLine();
    if (answer !== "ok") {
      throw new Error(`keyrift-test-keyboard: \`${line}\` → ${answer ?? "exited"}`);
    }
  }

  #nextLine(): Promise<string | null> {
    const line = this.#lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  #receive(line: string | null): void {
    const waiter = this.#waiting.shift();
    if (waiter !== undefined) waiter(line);
    else if (line !== null) this.#lines.push(line);
  }
}
