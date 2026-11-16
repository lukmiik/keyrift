/**
 * Regenerates the config types and schema copies from the engine source.
 * Run after changing `crates/config`: `vpx packages/config-types/scripts/generate.ts`
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { generate, PACKAGE_DIR } from "./codegen.ts";

for (const file of await generate()) {
  const path = join(PACKAGE_DIR, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.text);
  console.log(`wrote ${file.path}`);
}
