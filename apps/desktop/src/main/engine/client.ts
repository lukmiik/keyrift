/**
 * Connection to the engine's socket (spec §8): sends requests, matches each reply to its request
 * by `id`, and passes pushed events to listeners. Runs in Electron's main process (step 4+).
 *
 *     const { client, hello } = await EngineClient.connect(socketPath);
 *     const status = await client.call("status.get", {});
 */
import { createConnection, type Socket } from "node:net";

import { LineSplitter } from "./line-splitter.ts";
import {
  encodeRequest,
  type EngineEvent,
  type HelloResult,
  isCompatible,
  type Method,
  type ParamsOf,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ResultOf,
  type RpcError,
} from "../../shared/protocol.ts";

/** The engine answered a request with an error, e.g. code `invalid_params`. */
export class EngineError extends Error {
  /** The engine's error code (spec §8.1), for code that reacts to specific errors. */
  readonly code: string;

  constructor(method: string, error: RpcError) {
    super(`${method}: ${error.message}`);
    this.name = "EngineError";
    this.code = error.code;
  }
}

/** Called for each event the engine pushes, e.g. `{ event: "status", data: {...} }`. */
export type EventListener = (event: EngineEvent) => void;

/** A request that was sent and is waiting for its reply. */
type Pending = {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * Opens a Unix socket. Node reports the outcome through events ("connect" or "error"); this
 * wraps them in a Promise so callers can simply `await openSocket(path)`.
 */
function openSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

export class EngineClient {
  #socket: Socket;
  #splitter = new LineSplitter();
  #nextId = 1;
  /** Requests waiting for a reply, by id. */
  #pending = new Map<number, Pending>();
  #listeners = new Set<EventListener>();
  /** Why the connection ended; null while it is open. */
  #closedBy: Error | null = null;
  /** Resolves `closed`; saved here so `#fail` can call it later (see the Promise lessons). */
  #resolveClosed: (error: Error) => void = () => {};

  /** Resolves once, when the connection ends (engine stopped, `close()`, …), with the reason. */
  readonly closed: Promise<Error>;

  /** Use `EngineClient.connect`, which also does the `hello` handshake. */
  private constructor(socket: Socket) {
    this.#socket = socket;
    this.closed = new Promise((resolve) => {
      this.#resolveClosed = resolve;
    });
    socket.setEncoding("utf8");
    // These callbacks run whenever the socket has news, for as long as the connection lives:
    // the "background reader" from the async lesson.
    socket.on("data", (chunk: string) => {
      for (const line of this.#splitter.push(chunk)) {
        this.#handleLine(line);
      }
    });
    socket.on("error", (error) => this.#fail(error));
    socket.on("close", () => this.#fail(new Error("engine connection closed")));
  }

  /** Connects to the engine at `socketPath` and says `hello`. Throws if the engine is too old/new. */
  static async connect(socketPath: string): Promise<{ client: EngineClient; hello: HelloResult }> {
    const client = new EngineClient(await openSocket(socketPath));
    try {
      const hello = await client.call("hello", { protocolVersion: PROTOCOL_VERSION });
      if (!isCompatible(hello.protocolVersion)) {
        throw new Error(
          `engine speaks protocol ${hello.protocolVersion}, we need ${PROTOCOL_VERSION}`,
        );
      }
      return { client, hello };
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  /** Sends one request and waits for its result. Rejects with `EngineError` if the engine refuses. */
  async call<M extends Method>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    if (this.#closedBy !== null) {
      throw this.#closedBy;
    }
    const id = this.#nextId++;
    // The reply arrives later through the "data" callback; keep this Promise's resolve/reject
    // under the request's id so #handleLine can settle it then.
    return new Promise((resolve, reject) => {
      this.#pending.set(id, {
        method,
        resolve: (result) => resolve(result as ResultOf<M>),
        reject,
      });
      this.#socket.write(encodeRequest(id, method, params));
    });
  }

  /** Calls `listener` for every pushed event. Returns a function that stops it. */
  onEvent(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Closes the connection. Requests still waiting are rejected. */
  async close(): Promise<void> {
    if (this.#socket.closed) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.#socket.once("close", () => resolve());
      this.#socket.end();
    });
  }

  /** Routes one line from the engine: a reply settles its request, an event goes to listeners. */
  #handleLine(line: string): void {
    let message;
    try {
      message = parseServerMessage(line);
    } catch (error) {
      // The engine sent something that is not protocol: nothing after it can be trusted.
      this.#socket.destroy(error as Error);
      return;
    }
    switch (message.kind) {
      case "event":
        for (const listener of this.#listeners) {
          listener(message.event);
        }
        return;
      case "result":
      case "error": {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) {
          return; // A reply to nothing we asked: ignore it.
        }
        this.#pending.delete(message.id);
        if (message.kind === "result") {
          pending.resolve(message.result);
        } else {
          pending.reject(new EngineError(pending.method, message.error));
        }
        return;
      }
    }
  }

  /** The connection is gone: remember why and reject every waiting request. */
  #fail(error: Error): void {
    // "error" and "close" both arrive when a socket fails; only the first one counts.
    if (this.#closedBy === null) {
      this.#closedBy = error;
      this.#resolveClosed(error);
    }
    for (const pending of this.#pending.values()) {
      pending.reject(this.#closedBy);
    }
    this.#pending.clear();
  }
}
