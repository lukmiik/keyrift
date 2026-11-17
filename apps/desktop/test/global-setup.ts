/**
 * Runs once before any test file (Vitest `globalSetup`): builds the app, the engine and the
 * virtual-keyboard helper for the GUI tests, so they always run the current source. Building here
 * and not in each test file matters: test files run in parallel workers, and a build in one worker
 * rewrites `dist/` or `target/debug/keyrift` while another worker's app or engine is starting from
 * it.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export default function buildApp(): void {
  execFileSync(
    "cargo",
    ["build", "--quiet", "--package", "keyrift", "--package", "keyrift-test-keyboard"],
    {
      cwd: join(import.meta.dirname, "../../.."),
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  execFileSync("vp", ["build"], {
    cwd: join(import.meta.dirname, ".."),
    stdio: ["ignore", "ignore", "inherit"],
  });
}
