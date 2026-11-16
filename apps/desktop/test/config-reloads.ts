/**
 * Follows a test engine's config reloads, so a GUI test can wait until a save reached the engine
 * and check that the engine accepted it.
 */
import { setTimeout as sleep } from "node:timers/promises";

import { expect } from "vite-plus/test";

import type { TestEngine } from "./test-engine.ts";

type Reload = { ok: boolean; issues: { severity: string; message: string }[] };

export type ConfigReloads = {
  /**
   * Waits (up to 5 s) for the next reload, checks the engine accepted the file (no errors) and
   * still runs profile "test", and returns the messages of its warnings.
   */
  next: () => Promise<string[]>;
  close: () => Promise<void>;
};

export async function watchReloads(engine: TestEngine): Promise<ConfigReloads> {
  const client = await engine.connect();
  await client.call("subscribe", { topics: ["config"] });
  const reloads: Reload[] = [];
  client.onEvent((event) => {
    if (event.event === "config") reloads.push(event.data as Reload);
  });
  let seen = 0;
  return {
    async next() {
      for (let i = 0; i < 100 && reloads.length === seen; i++) await sleep(50);
      expect(reloads.length, "the engine didn't reload the config").toBeGreaterThan(seen);
      seen = reloads.length;
      const result = reloads.at(-1)!;
      expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
      expect(result.ok).toBe(true);
      expect(await client.call("status.get", {})).toMatchObject({ profile: "test" });
      return result.issues.map((issue) => issue.message);
    },
    close: () => client.close(),
  };
}
