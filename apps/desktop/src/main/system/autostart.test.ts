import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AutostartControl } from "./autostart.ts";

// The fake systemctl (never the real one: these tests must not touch the user's service).
const FAKE = join(import.meta.dirname, "../../../test/fake-systemctl.mjs");

let dir = "";
let state = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "keyrift-systemctl-"));
  state = join(dir, "state");
  process.env.FAKE_SYSTEMCTL_STATE = state;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FAKE_SYSTEMCTL_STATE;
});

describe("AutostartControl", () => {
  it("reads, enables and disables the unit", async () => {
    const autostart = new AutostartControl(FAKE);
    expect(await autostart.state()).toEqual({ ok: true, value: "disabled" });
    expect(await autostart.set(true)).toEqual({ ok: true, value: "enabled" });
    expect(readFileSync(state, "utf8").trim()).toBe("enabled");
    expect(await autostart.set(false)).toEqual({ ok: true, value: "disabled" });
  });

  it("says when the unit isn't installed", async () => {
    writeFileSync(state, "not-found");
    expect(await new AutostartControl(FAKE).state()).toEqual({ ok: true, value: "not-installed" });
  });

  it("refuses a value that isn't true or false", async () => {
    expect(await new AutostartControl(FAKE).set("yes")).toMatchObject({ ok: false });
  });

  it("reports a missing systemctl", async () => {
    const outcome = await new AutostartControl("/nonexistent/systemctl").state();
    expect(outcome).toMatchObject({ ok: false });
    expect(!outcome.ok && outcome.message).toMatch(/^cannot run \/nonexistent\/systemctl/);
  });
});
