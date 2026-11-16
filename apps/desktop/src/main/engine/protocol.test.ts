import { describe, expect, it } from "vite-plus/test";

import { encodeRequest, isCompatible, parseServerMessage, stateLabel } from "./protocol.ts";

describe("parseServerMessage", () => {
  it("parses a result", () => {
    expect(parseServerMessage('{"id":3,"result":{"state":"running"}}')).toEqual({
      kind: "result",
      id: 3,
      result: { state: "running" },
    });
  });

  it("parses an error", () => {
    expect(
      parseServerMessage('{"id":1,"error":{"code":"hello_required","message":"send hello"}}'),
    ).toEqual({
      kind: "error",
      id: 1,
      error: { code: "hello_required", message: "send hello" },
    });
  });

  it("parses an event", () => {
    expect(parseServerMessage('{"event":"status","data":{"state":"paused"}}')).toEqual({
      kind: "event",
      event: "status",
      data: { state: "paused" },
    });
  });

  it("rejects invalid JSON", () => {
    expect(() => parseServerMessage("{not json")).toThrow();
  });

  it("rejects JSON that is not an object", () => {
    expect(() => parseServerMessage("[1,2]")).toThrow("not a JSON object");
  });

  it("rejects a message with neither an id nor an event", () => {
    expect(() => parseServerMessage('{"result":{}}')).toThrow("neither an id nor an event");
  });

  it("rejects an error without a message", () => {
    expect(() => parseServerMessage('{"id":5,"error":{"code":"x"}}')).toThrow("no code or message");
  });
});

describe("stateLabel", () => {
  it("names every engine state", () => {
    expect(stateLabel("running")).toBe("Running");
    expect(stateLabel("released")).toBe("Released (emergency)");
  });
});

describe("isCompatible", () => {
  it("accepts the same major version", () => {
    expect(isCompatible("1.0")).toBe(true);
    expect(isCompatible("1.7")).toBe(true);
  });

  it("rejects a different major version", () => {
    expect(isCompatible("2.0")).toBe(false);
    expect(isCompatible("10.0")).toBe(false);
  });

  it("rejects an empty version", () => {
    expect(isCompatible("")).toBe(false);
  });
});

describe("encodeRequest", () => {
  it("encodes a request as one JSON line", () => {
    expect(encodeRequest(1, "status.get", {})).toBe('{"id":1,"method":"status.get","params":{}}\n');
  });

  it("includes the params", () => {
    expect(encodeRequest(2, "hello", { protocolVersion: "1.0" })).toBe(
      '{"id":2,"method":"hello","params":{"protocolVersion":"1.0"}}\n',
    );
  });

  it("encodes log.setLevel", () => {
    expect(encodeRequest(3, "log.setLevel", { level: "debug" })).toBe(
      '{"id":3,"method":"log.setLevel","params":{"level":"debug"}}\n',
    );
  });
});
