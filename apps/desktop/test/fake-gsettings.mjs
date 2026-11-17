#!/usr/bin/env node
/**
 * Stands in for gsettings in GUI tests (KEYRIFT_GSETTINGS), so the user's desktop theme doesn't
 * affect them. `get … color-scheme` prints FAKE_COLOR_SCHEME (default: 'default', i.e. light);
 * `monitor` prints nothing and runs until killed, like the real one with no changes.
 */
const [, , command] = process.argv;
if (command === "get") {
  process.stdout.write(`'${process.env.FAKE_COLOR_SCHEME ?? "default"}'\n`);
} else if (command === "monitor") {
  setInterval(() => {}, 1 << 30);
}
