import { EventEmitter } from "node:events";

import { describe, expect, it } from "vite-plus/test";

import type { UpdateInfo } from "../../shared/api.ts";
import { type Updater, UpdateControl } from "./updates.ts";

/** An updater whose events the test sends itself; calls are recorded. */
class StubUpdater extends EventEmitter {
  readonly calls: string[] = [];
  checkForUpdates() {
    this.calls.push("check");
    return Promise.resolve();
  }
  downloadUpdate() {
    this.calls.push("download");
    return Promise.resolve();
  }
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean) {
    this.calls.push(`install silent=${isSilent} restart=${isForceRunAfter}`);
  }
}

function setup() {
  const updater = new StubUpdater();
  const seen: UpdateInfo[] = [];
  const control = new UpdateControl("0.1.0", updater as unknown as Updater, "", (info) =>
    seen.push(info),
  );
  return { updater, control, seen, status: () => control.info().state };
}

describe("UpdateControl", () => {
  it("checks, downloads and installs, telling the page each step", async () => {
    const { updater, control, seen, status } = setup();
    expect(control.info()).toEqual({ current: "0.1.0", state: { status: "idle" } });

    await control.check();
    expect(status()).toEqual({ status: "checking" });
    updater.emit("update-available", { version: "0.2.0" });
    expect(status()).toEqual({ status: "available", version: "0.2.0" });

    await control.download();
    updater.emit("download-progress", { percent: 41.7 });
    expect(status()).toEqual({ status: "downloading", version: "0.2.0", percent: 41 });
    updater.emit("update-downloaded", { version: "0.2.0" });
    expect(status()).toEqual({ status: "ready", version: "0.2.0" });

    control.install();
    expect(updater.calls).toEqual(["check", "download", "install silent=false restart=true"]);
    expect(seen.map((info) => info.state.status)).toEqual([
      "checking",
      "available",
      "downloading",
      "downloading",
      "ready",
    ]);
  });

  it("says when it is up to date", async () => {
    const { updater, control, status } = setup();
    await control.check();
    updater.emit("update-not-available");
    expect(status()).toEqual({ status: "up-to-date" });
  });

  it("only downloads a found update and only installs a downloaded one", async () => {
    const { updater, control } = setup();
    await control.download();
    control.install();
    expect(updater.calls).toEqual([]);
  });

  it("explains failures in a sentence", async () => {
    const { updater, control, status } = setup();
    await control.check();
    updater.emit("error", new Error("getaddrinfo ENOTFOUND github.com\n<html>…"));
    expect(status()).toEqual({
      status: "error",
      message: "Couldn't reach GitHub. Check the internet connection.",
    });
    updater.emit(
      "error",
      new Error("Command failed: pkexec /bin/bash -c 'dpkg -i …' (exit code 126)"),
    );
    expect(status()).toMatchObject({
      message: expect.stringContaining("password prompt was closed"),
    });
  });

  it("does nothing in a build that can't update itself", async () => {
    const control = new UpdateControl("0.1.0", null, "Development build.", () => {});
    await control.check();
    expect(control.info().state).toEqual({ status: "unavailable", reason: "Development build." });
  });
});
