/**
 * Logs (spec F-UI-6, M5 exit criteria): entries that journalctl prints appear on the Logs screen,
 * and the level filter works. journalctl is a fake (test/fake-journalctl.mjs) printing a prepared
 * journal, so the test never reads the user's own log.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { TestApp } from "../test/test-app.ts";
import { TestEngine } from "../test/test-engine.ts";
import { uinputAvailable } from "../test/test-keyboard.ts";

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) {
    await step();
  }
  cleanup = [];
});

/** A journal entry as `journalctl --output json` prints it. */
function entry(cursor: string, priority: number, message: string, identifier = "keyrift"): string {
  return JSON.stringify({
    __CURSOR: cursor,
    __REALTIME_TIMESTAMP: String(Date.now() * 1000),
    PRIORITY: String(priority),
    SYSLOG_IDENTIFIER: identifier,
    MESSAGE: message,
  });
}

describe.skipIf(!uinputAvailable())("Logs", () => {
  it("shows journal entries and filters them by level", { timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "keyrift-logs-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const journal = join(dir, "journal.jsonl");
    writeFileSync(
      journal,
      [
        entry("1", 6, "Started keyrift.service.", "systemd"),
        entry("2", 6, " INFO engine started"),
        entry("3", 4, " WARN device disappeared"),
        entry("4", 3, "ERROR config invalid"),
      ].join("\n") + "\n",
    );
    const engine = await TestEngine.start();
    cleanup.push(() => engine.stop());
    const app = await TestApp.start({
      socketPath: engine.socketPath,
      configDir: engine.configDir,
      env: { FAKE_JOURNAL: journal },
    });
    cleanup.push(() => app.close());
    const w = app.window;

    await w.getByRole("button", { name: "Logs" }).click();
    const rows = w.getByRole("table", { name: "Log entries" }).getByRole("row");
    // Errors and warnings by default, newest first; header row first.
    await expect.poll(() => rows.count(), { timeout: 5000 }).toBe(3);
    expect(await rows.nth(1).textContent()).toContain("config invalid");
    expect(await rows.nth(2).textContent()).toContain("device disappeared");

    await w.getByRole("combobox", { name: "Show" }).click();
    await w.getByRole("option", { name: "Info and above" }).click();
    await expect.poll(() => rows.count()).toBe(5);
    expect(await rows.nth(4).textContent()).toContain("systemd: Started keyrift.service.");
  });
});
