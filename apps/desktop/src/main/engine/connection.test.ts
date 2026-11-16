import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { TestEngine } from "../../../test/test-engine.ts";
import type { ConnectionState } from "../../shared/api.ts";
import { EngineConnection } from "./connection.ts";

/** Resolves once `connection` is in a state that `matches` (right away if it already is). */
function waitForState(
  connection: EngineConnection,
  matches: (state: ConnectionState) => boolean,
): Promise<ConnectionState> {
  return new Promise((resolve) => {
    if (matches(connection.state)) {
      resolve(connection.state);
      return;
    }
    const stop = connection.onStateChange((state) => {
      if (matches(state)) {
        stop();
        resolve(state);
      }
    });
  });
}

const isConnected = (state: ConnectionState) => state.connected;
const isDisconnected = (state: ConnectionState) =>
  !state.connected && state.reason !== "connecting";

// Everything a test starts, stopped after it even when it fails.
let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) {
    await step();
  }
  cleanup = [];
});

/** A fresh directory for a private engine's socket. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "keyrift-conn-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Starts a connection with a short retry delay and stops it after the test. */
function connect(socketPath: string): EngineConnection {
  const connection = new EngineConnection(socketPath, { retryMs: 50 });
  cleanup.push(() => connection.stop());
  connection.start();
  return connection;
}

describe("EngineConnection", () => {
  it("connects and calls the engine", { timeout: 300_000 }, async () => {
    const engine = await TestEngine.start();
    cleanup.push(() => engine.stop());
    const connection = connect(engine.socketPath);

    const state = await waitForState(connection, isConnected);
    expect(state).toMatchObject({ connected: true, hello: { protocolVersion: "1.0" } });
    const outcome = await connection.call("status.get", {});
    expect(outcome).toMatchObject({ ok: true, result: { profile: "test" } });
  });

  it("returns engine errors as data, keeping the code", async () => {
    const engine = await TestEngine.start();
    cleanup.push(() => engine.stop());
    const connection = connect(engine.socketPath);
    await waitForState(connection, isConnected);

    const outcome = await connection.call("subscribe", { topics: ["nope" as "status"] });
    expect(outcome).toMatchObject({ ok: false, error: { code: "invalid_params" } });
  });

  it("reports a missing engine and answers calls with not_connected", async () => {
    const connection = connect(join(tempDir(), "keyrift.sock"));

    const state = await waitForState(connection, isDisconnected);
    expect(state).toEqual({ connected: false, reason: "the engine is not running" });
    const outcome = await connection.call("status.get", {});
    expect(outcome).toMatchObject({ ok: false, error: { code: "not_connected" } });
  });

  it("connects once the engine starts, and notices when it stops", async () => {
    const dir = tempDir();
    const connection = connect(join(dir, "keyrift.sock"));
    await waitForState(connection, isDisconnected);

    const engine = await TestEngine.start({ dir });
    await waitForState(connection, isConnected);

    await engine.stop();
    expect(await waitForState(connection, isDisconnected)).toEqual({
      connected: false,
      reason: "the engine stopped",
    });
  });
});
