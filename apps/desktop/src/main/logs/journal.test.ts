import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import type { LogEntry } from "../../shared/api.ts";
import { JournalFollower, parseJournalLine } from "./journal.ts";

const FAKE = join(import.meta.dirname, "../../../test/fake-journalctl.mjs");

/** A journal entry as `journalctl --output json` prints it. */
function line(fields: Record<string, unknown>): string {
  return JSON.stringify({
    __CURSOR: "s=1;i=1",
    __REALTIME_TIMESTAMP: "1763283907042123",
    PRIORITY: "6",
    SYSLOG_IDENTIFIER: "keyrift",
    MESSAGE: " INFO config applied",
    ...fields,
  });
}

describe("parseJournalLine", () => {
  it("reads an engine line, without its level prefix", () => {
    expect(parseJournalLine(line({}))).toEqual({
      cursor: "s=1;i=1",
      timeMs: 1763283907042,
      level: "info",
      message: "config applied",
      source: "engine",
    });
  });

  it("maps syslog priorities to levels", () => {
    const level = (priority: string) => parseJournalLine(line({ PRIORITY: priority }))?.level;
    expect(["0", "3", "4", "5", "6", "7"].map(level)).toEqual([
      "error",
      "error",
      "warn",
      "info",
      "info",
      "debug",
    ]);
  });

  it("keeps systemd's own lines as they are", () => {
    const entry = parseJournalLine(
      line({ SYSLOG_IDENTIFIER: "systemd", MESSAGE: "Started keyrift.service." }),
    );
    expect(entry?.source).toBe("systemd");
    expect(entry?.message).toBe("Started keyrift.service.");
  });

  it("decodes messages journalctl printed as bytes", () => {
    const bytes = [...Buffer.from(" WARN café\u0007")];
    expect(parseJournalLine(line({ MESSAGE: bytes }))?.message).toBe("café\u0007");
  });

  it("skips lines that aren't entries", () => {
    expect(parseJournalLine("not json")).toBeNull();
    expect(parseJournalLine("[1, 2]")).toBeNull();
    expect(parseJournalLine(line({ MESSAGE: null }))).toBeNull();
  });
});

describe("JournalFollower", () => {
  let dir = "";
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.FAKE_JOURNAL;
    delete process.env.FAKE_JOURNAL_FAIL;
  });

  it("passes on the entries journalctl prints", async () => {
    dir = mkdtempSync(join(tmpdir(), "keyrift-journal-"));
    const file = join(dir, "journal.jsonl");
    writeFileSync(file, `${line({ __CURSOR: "a" })}\nnot json\n${line({ __CURSOR: "b" })}\n`);
    process.env.FAKE_JOURNAL = file;

    const received: LogEntry[] = [];
    const follower = new JournalFollower(FAKE, {
      entries: (entries) => received.push(...entries),
      error: (message) => {
        throw new Error(message);
      },
    });
    await expect.poll(() => received.map((entry) => entry.cursor)).toEqual(["a", "b"]);
    follower.stop();
  });

  it("reports journalctl's error", async () => {
    process.env.FAKE_JOURNAL_FAIL = "No journal files were found.";
    let error = "";
    new JournalFollower(FAKE, { entries: () => {}, error: (message) => (error = message) });
    await expect.poll(() => error).toBe("No journal files were found.");
  });

  it("reports a missing journalctl", async () => {
    let error = "";
    new JournalFollower("/nonexistent/journalctl", {
      entries: () => {},
      error: (message) => (error = message),
    });
    await expect.poll(() => error).toMatch(/^cannot run \/nonexistent\/journalctl: .*ENOENT/);
  });
});
