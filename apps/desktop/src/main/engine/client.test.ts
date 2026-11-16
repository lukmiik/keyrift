import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { TestEngine } from "../../../test/test-engine.ts";
import { EngineClient, EngineError } from "./client.ts";
import type { EngineEvent, LogLevel } from "../../shared/protocol.ts";

/**
 * Resolves with the data of the next event named `name` that `client` receives.
 * Stops listening once it has it.
 */
function nextEvent(client: EngineClient, name: EngineEvent["event"]): Promise<unknown> {
  const promise = new Promise((resolve) => {
    const stopFunction = client.onEvent((event) => {
      if (event.event === name) {
        resolve(event.data);
        stopFunction();
      }
    });
  });
  return promise;
}

// One engine for the whole file: starting it takes a moment, and these tests don't change it
// in ways that leak between tests.
let engine: TestEngine;
let client: EngineClient;

beforeAll(async () => {
  engine = await TestEngine.start();
  client = await engine.connect();
}, 300_000); // the first run may have to build the engine

afterAll(async () => {
  await client.close();
  await engine.stop();
});

describe("EngineClient", () => {
  it("says hello and gets the engine's version", async () => {
    const { client: other, hello } = await EngineClient.connect(engine.socketPath);
    expect(hello.protocolVersion).toBe("1.0");
    expect(hello.engineVersion).toMatch(/^\d+\.\d+\.\d+/);
    await other.close();
  });

  it("gets the status of the test engine", async () => {
    const status = await client.call("status.get", {});
    expect(status.profile).toBe("test");
    expect(status.devices.grabbed).toBe(0);
  });

  it("matches replies to requests sent at the same time", async () => {
    const [status, level] = await Promise.all([
      client.call("status.get", {}),
      client.call("log.setLevel", { level: "debug" }),
    ]);
    expect(status.pid).toBeGreaterThan(0);
    expect(level).toEqual({ level: "debug" });
  });

  it("rejects with the engine's error code", async () => {
    const call = client.call("log.setLevel", { level: "loud" as LogLevel });
    await expect(call).rejects.toThrow(EngineError);
    await expect(call).rejects.toMatchObject({ code: "invalid_params" });
  });

  it("receives events after subscribing", async () => {
    await client.call("subscribe", { topics: ["status"] });
    const event = nextEvent(client, "status");
    await client.call("engine.pause", {});
    expect(await event).toMatchObject({ state: "paused" });
    await client.call("engine.resume", {});
    await client.call("unsubscribe", { topics: ["status"] });
  });

  it("fails calls after the connection is closed", async () => {
    const other = await engine.connect();
    await other.close();
    await expect(other.call("status.get", {})).rejects.toThrow("engine connection closed");
  });

  it("fails waiting calls when the engine goes away", async () => {
    const own = await TestEngine.start();
    const other = await own.connect();
    await own.stop();
    await expect(other.call("status.get", {})).rejects.toThrow();
  });
});
