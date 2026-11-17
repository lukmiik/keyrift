/**
 * The AppImage on a fresh account (spec M5): with an empty HOME it starts, copies its engine to
 * ~/.local/share/keyrift/bin, and that engine runs as a systemd user unit the app connects to.
 *
 * Opt-in, since it needs the built package: `vp run package`, then
 * `KEYRIFT_APPIMAGE=release/Keyrift-0.1.0.AppImage vp test e2e/appimage`.
 *
 * Safety: the unit has its own name (not keyrift.service) and runs with `--only-device` on a
 * virtual keyboard, an input folder of its own and a private socket, so the user's engine and
 * keyboards are untouched. The app gets a stand-in systemctl, so its "Start at login" switch can't
 * change the user's unit either.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { _electron as electron } from "playwright-core";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { TestKeyboard, uinputAvailable } from "../test/test-keyboard.ts";
import type { TestEngine } from "../test/test-engine.ts";

const APP_DIR = join(import.meta.dirname, "..");
const appImage = process.env.KEYRIFT_APPIMAGE;

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) {
    await step();
  }
  cleanup = [];
});

describe.skipIf(appImage === undefined || !uinputAvailable())("AppImage", () => {
  it(
    "starts with an empty HOME and reaches its engine as a user unit",
    { timeout: 90_000 },
    async () => {
      const home = mkdtempSync(join(tmpdir(), "keyrift-appimage-"));
      cleanup.push(() => rmSync(home, { recursive: true, force: true }));
      const id = `keyrift-test-appimage-${process.pid}`;
      const outputName = `Keyrift virtual keyboard ${id}`;
      const socketPath = join(home, "keyrift.sock");
      const inputDir = join(home, "input");
      mkdirSync(inputDir);
      const xdg = {
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_DATA_HOME: join(home, ".local/share"),
        XDG_CACHE_HOME: join(home, ".cache"),
        XDG_STATE_HOME: join(home, ".local/state"),
      };

      const app = await electron.launch({
        executablePath: resolve(APP_DIR, appImage!),
        args: [],
        env: {
          ...process.env,
          HOME: home,
          ...xdg,
          // The default socket is the user's engine; this one will be the test unit's.
          KEYRIFT_SOCKET: socketPath,
          KEYRIFT_HIDE_WINDOW: "1",
          KEYRIFT_SYSTEMCTL: join(APP_DIR, "test/fake-systemctl.mjs"),
          FAKE_SYSTEMCTL_STATE: join(home, "systemctl-state"),
        },
      });
      cleanup.push(() => app.close());
      const w = await app.firstWindow();

      // First run: the wizard, with the real (read-only) checks.
      await w.getByRole("list", { name: "Checks" }).waitFor();
      const engine = join(xdg.XDG_DATA_HOME, "keyrift/bin/keyrift");
      expect(statSync(engine).mode & 0o777).toBe(0o755);
      expect(
        readFileSync(engine).equals(
          readFileSync(join(APP_DIR, "release/linux-unpacked/resources/keyrift")),
        ),
      ).toBe(true);

      // What the wizard's "Install the engine service" runs, with a test unit instead of keyrift.
      // The unit goes to the real ~/.config/systemd/user, where the user's systemd finds it.
      const configDir = join(xdg.XDG_CONFIG_HOME, "keyrift");
      mkdirSync(join(configDir, "profiles"), { recursive: true });
      writeFileSync(
        join(configDir, "settings.json"),
        JSON.stringify({ version: 1, activeProfile: "test" }),
      );
      writeFileSync(
        join(configDir, "profiles/test.json"),
        JSON.stringify({ version: 1, name: "Test", layers: [{ id: "base", keys: {} }] }),
      );
      const daemonArgs = [
        "--only-device",
        id,
        "--output-name",
        outputName,
        "--config-dir",
        configDir,
        "--input-dir",
        inputDir,
        "--socket",
        socketPath,
      ];
      execFileSync(engine, ["service", "install", "--unit", id, "--", ...daemonArgs]);
      cleanup.push(() => {
        execFileSync(engine, ["service", "uninstall", "--unit", id]);
      });
      const unit = readFileSync(
        join(process.env.HOME!, `.config/systemd/user/${id}.service`),
        "utf8",
      );
      expect(unit).toContain(`ExecStart=${engine} daemon`);

      // A keyboard for it to grab: the app then shows the engine running with one keyboard.
      const keyboard = await TestKeyboard.attach({ id, inputDir, outputName } as TestEngine);
      cleanup.push(() => keyboard.close());
      await w
        .getByRole("button", { name: "Done" })
        .or(w.getByRole("button", { name: "Skip for now" }))
        .click();
      await w.getByText("1 keyboard", { exact: false }).waitFor({ timeout: 15_000 });
      await w.getByText("Active", { exact: true }).waitFor();
    },
  );
});
