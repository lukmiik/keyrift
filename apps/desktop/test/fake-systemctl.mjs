#!/usr/bin/env node
/**
 * Stands in for systemctl in GUI tests (KEYRIFT_SYSTEMCTL), so they never enable or disable the
 * user's real keyrift.service. Answers `--user is-enabled|enable|disable keyrift.service`, keeping
 * the state in the file named by FAKE_SYSTEMCTL_STATE ("disabled" until enabled).
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , , command] = process.argv;
const file = process.env.FAKE_SYSTEMCTL_STATE;
const read = () => {
  try {
    return readFileSync(file ?? "", "utf8").trim();
  } catch {
    return "disabled";
  }
};

if (command === "is-enabled") {
  const state = read();
  process.stdout.write(`${state}\n`);
  process.exit(state === "enabled" ? 0 : 1);
}
if (command === "enable" || command === "disable") {
  if (file !== undefined) writeFileSync(file, `${command}d\n`);
  process.exit(0);
}
process.stderr.write(`fake systemctl: unknown command ${String(command)}\n`);
process.exit(1);
