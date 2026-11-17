#!/usr/bin/env node
/**
 * Stands in for journalctl in tests (KEYRIFT_JOURNALCTL): prints the lines of the file named by
 * FAKE_JOURNAL (journal entries as JSON, like `journalctl --output json`), then keeps running, as
 * `--follow` does, until killed. Its arguments go to stderr's first line, for tests to check.
 * With FAKE_JOURNAL_FAIL set it prints that to stderr and exits with 1 instead.
 */
import { readFileSync } from "node:fs";

if (process.env.FAKE_JOURNAL_FAIL) {
  process.stderr.write(`${process.env.FAKE_JOURNAL_FAIL}\n`);
  process.exit(1);
}
process.stdout.write(readFileSync(process.env.FAKE_JOURNAL ?? "/dev/null", "utf8"));
setInterval(() => {}, 1 << 30);
