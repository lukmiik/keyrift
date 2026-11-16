/**
 * The contract between the preload script and the page: what `window.keyrift` offers.
 * Shared by both halves, so it must not import anything Node- or browser-specific.
 */
import type { EngineEvent, HelloResult, Method, ParamsOf, ResultOf, RpcError } from "./protocol.ts";

/**
 * How a call ended. Errors are returned as data, not thrown: a thrown error loses everything but
 * its message on the way from main to the page, and the page needs `error.code`.
 */
export type CallOutcome<R> = { ok: true; result: R } | { ok: false; error: RpcError };

/** Whether the GUI is connected to the engine right now. */
export type ConnectionState =
  | { connected: true; hello: HelloResult }
  | { connected: false; reason: string };

/** Methods the page may call: every engine method except `hello`, which main does itself. */
export type PageMethod = Exclude<Method, "hello">;

/** The engine, as the page sees it (main holds the real connection, step 5). */
export type EngineApi = {
  /** Calls an engine method. Resolves with the outcome; never rejects. */
  call<M extends PageMethod>(method: M, params: ParamsOf<M>): Promise<CallOutcome<ResultOf<M>>>;
  /** The connection state right now. */
  state(): Promise<ConnectionState>;
  /** Calls `listener` for each engine event (after `subscribe`). Returns a function that stops it. */
  onEvent(listener: (event: EngineEvent) => void): () => void;
  /**
   * Calls `listener` when the connection comes or goes. After a reconnect the engine has forgotten
   * the page's subscriptions, so the page subscribes again here.
   */
  onStateChange(listener: (state: ConnectionState) => void): () => void;
};

export type KeyriftApi = {
  /** Versions of the parts Electron is made of, shown on the placeholder page. */
  versions: { electron: string; chrome: string; node: string; v8: string };
  engine: EngineApi;
};
