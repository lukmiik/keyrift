import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { appImageEnginePath, installEngine, restartEngineUsing } from "./engine-binary.ts";

const temp = () => mkdtempSync(join(tmpdir(), "keyrift-engine-binary-"));

describe("engine binary", () => {
  it("puts an AppImage's engine under XDG_DATA_HOME", () => {
    expect(appImageEnginePath({ XDG_DATA_HOME: "/data" })).toBe("/data/keyrift/bin/keyrift");
    expect(appImageEnginePath({})).toMatch(/\/\.local\/share\/keyrift\/bin\/keyrift$/);
  });

  it("copies the engine only when it changed, as an executable", async () => {
    const dir = temp();
    const source = join(dir, "source");
    const target = join(dir, "bin/keyrift");
    writeFileSync(source, "v1");
    expect(await installEngine(source, target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("v1");
    expect(statSync(target).mode & 0o777).toBe(0o755);
    expect(await installEngine(source, target)).toBe(false);
    writeFileSync(source, "v2");
    expect(await installEngine(source, target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("v2");
  });

  it("restarts the service only when it runs that binary", async () => {
    const dir = temp();
    const log = join(dir, "calls");
    // A stand-in systemctl that records its arguments: the real one would restart the
    // user's engine.
    const systemctl = join(dir, "systemctl");
    writeFileSync(systemctl, `#!/bin/sh\necho "$@" >> ${log}\n`);
    chmodSync(systemctl, 0o755);
    const env = { XDG_CONFIG_HOME: join(dir, "config") };
    mkdirSync(join(dir, "config/systemd/user"), { recursive: true });
    const unit = join(dir, "config/systemd/user/keyrift.service");
    const calls = () => readFileSync(log, { encoding: "utf8", flag: "a+" });

    await restartEngineUsing("/a/keyrift", systemctl, env);
    expect(calls()).toBe("");
    writeFileSync(unit, "[Service]\nExecStart=/other/keyrift daemon\n");
    await restartEngineUsing("/a/keyrift", systemctl, env);
    expect(calls()).toBe("");
    writeFileSync(unit, "[Service]\nExecStart=/a/keyrift daemon\n");
    await restartEngineUsing("/a/keyrift", systemctl, env);
    expect(calls()).toBe("--user try-restart keyrift.service\n");
  });
});
