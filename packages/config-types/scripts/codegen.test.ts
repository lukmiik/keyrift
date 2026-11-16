/**
 * Drift check (spec M4 exit criterion: "generated TS types match the current Rust schema").
 * Regenerates everything in memory from the engine source and compares it with the committed
 * files. Fails when `crates/config` changed but `generate.ts` was not run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { generate, PACKAGE_DIR } from "./codegen.ts";

describe("generated config types", () => {
  // Generous timeout: on a fresh checkout `cargo run` first has to build the CLI.
  it("match the engine's current schemas", { timeout: 300_000 }, async () => {
    const files = await generate();
    for (const file of files) {
      const committed = readFileSync(join(PACKAGE_DIR, file.path), "utf8");
      expect(committed, `${file.path} is stale: run scripts/generate.ts`).toBe(file.text);
    }
  });
});
