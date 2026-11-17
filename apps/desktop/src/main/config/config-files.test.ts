import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Profile } from "@keyrift/config-types";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { TestEngine } from "../../../test/test-engine.ts";
import type { EngineEvent } from "../../shared/protocol.ts";
import { ConfigFiles, isProfileName } from "./config-files.ts";

// Everything a test starts, removed after it even when it fails.
let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) {
    await step();
  }
  cleanup = [];
});

/** A fresh, empty config folder. */
function tempConfig(): { dir: string; files: ConfigFiles } {
  const dir = mkdtempSync(join(tmpdir(), "keyrift-config-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, files: new ConfigFiles(dir) };
}

/** Writes `text` to `file` inside `dir`, creating folders as needed. */
function put(dir: string, file: string, text: string): void {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), text);
}

const KBD = { vendorId: "0x0951", productId: "0x16d2", name: "HyperX Alloy" };

const PROFILE: Profile = {
  version: 1,
  name: "Daily",
  layers: [{ id: "base", name: "Base", keys: { KEY_CAPSLOCK: { type: "key", key: "KEY_ESC" } } }],
};

describe("isProfileName", () => {
  it.each(["daily", "My profile", "gaming-2", "a.b"])("accepts %j", (name) => {
    expect(isProfileName(name)).toBe(true);
  });

  it.each(["", ".hidden", "../settings", "a/b", "a\\b", 42, null])("rejects %j", (name) => {
    expect(isProfileName(name)).toBe(false);
  });
});

describe("ConfigFiles", () => {
  describe("activeProfile", () => {
    it('is "default" without a settings file', async () => {
      const { files } = tempConfig();
      expect(await files.activeProfile()).toEqual({ ok: true, value: "default" });
    });

    it("comes from settings.json", async () => {
      const { dir, files } = tempConfig();
      put(dir, "settings.json", '{"version": 1, "activeProfile": "daily"}');
      expect(await files.activeProfile()).toEqual({ ok: true, value: "daily" });
    });

    it("reports a broken settings file", async () => {
      const { dir, files } = tempConfig();
      put(dir, "settings.json", "{ not json");
      expect(await files.activeProfile()).toMatchObject({
        ok: false,
        problem: { file: "settings.json", message: expect.stringContaining("not valid JSON") },
      });
    });
  });

  describe("readProfile", () => {
    it("reads and validates a profile", async () => {
      const { dir, files } = tempConfig();
      put(dir, "profiles/daily.json", JSON.stringify(PROFILE));
      expect(await files.readProfile("daily")).toEqual({ ok: true, value: PROFILE });
    });

    it("gives null for a profile that doesn't exist yet", async () => {
      const { files } = tempConfig();
      expect(await files.readProfile("new")).toEqual({ ok: true, value: null });
    });

    it("reports where a profile breaks the schema", async () => {
      const { dir, files } = tempConfig();
      put(
        dir,
        "profiles/daily.json",
        '{"layers": [{"id": "base", "keys": {"KEY_A": {"type": "nope"}}}]}',
      );
      const outcome = await files.readProfile("daily");

      expect(outcome).toMatchObject({ ok: false, problem: { file: "profiles/daily.json" } });
      expect(outcome.ok ? [] : outcome.problem.issues).not.toEqual([]);
    });

    it("refuses names outside profiles/", async () => {
      const { files } = tempConfig();
      expect(await files.readProfile("../settings")).toMatchObject({
        ok: false,
        problem: { message: expect.stringContaining("not a valid profile name") },
      });
    });
  });

  describe("saveProfile", () => {
    it("writes formatted JSON that reads back the same", async () => {
      const { dir, files } = tempConfig();

      expect(await files.saveProfile("daily", PROFILE)).toEqual({ ok: true, value: null });
      const text = readFileSync(join(dir, "profiles/daily.json"), "utf8");
      expect(text).toBe(`${JSON.stringify(PROFILE, null, 2)}\n`);
      expect(await files.readProfile("daily")).toEqual({ ok: true, value: PROFILE });
    });

    it("leaves no temporary file behind", async () => {
      const { dir, files } = tempConfig();
      await files.saveProfile("daily", PROFILE);
      await files.saveProfile("daily", { ...PROFILE, name: "Changed" });

      expect(readdirSync(join(dir, "profiles"))).toEqual(["daily.json"]);
    });

    it("refuses an invalid profile and keeps the old file", async () => {
      const { dir, files } = tempConfig();
      await files.saveProfile("daily", PROFILE);
      const before = readFileSync(join(dir, "profiles/daily.json"), "utf8");

      const outcome = await files.saveProfile("daily", { layers: "not a list" });
      expect(outcome).toMatchObject({ ok: false, problem: { file: "profiles/daily.json" } });
      expect(readFileSync(join(dir, "profiles/daily.json"), "utf8")).toBe(before);
    });

    it("refuses names outside profiles/", async () => {
      const { dir, files } = tempConfig();
      const outcome = await files.saveProfile("../settings", PROFILE);

      expect(outcome.ok).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
    });

    it("is applied by a running engine", { timeout: 300_000 }, async () => {
      const engine = await TestEngine.start();
      cleanup.push(() => engine.stop());
      const client = await engine.connect();
      cleanup.push(() => client.close());
      await client.call("subscribe", { topics: ["config"] });
      const reloaded = new Promise<EngineEvent>((resolve) => {
        const stop = client.onEvent((event) => {
          if (event.event === "config") {
            stop();
            resolve(event);
          }
        });
      });

      // The test engine's active profile is "test".
      const outcome = await new ConfigFiles(engine.configDir).saveProfile("test", PROFILE);
      expect(outcome.ok).toBe(true);

      expect(await reloaded).toEqual({ event: "config", data: { ok: true, issues: [] } });
    });
  });

  describe("updateSettings", () => {
    it("merges each group into settings.json and keeps the rest", async () => {
      const { dir, files } = tempConfig();
      put(
        dir,
        "settings.json",
        '{"version": 1, "activeProfile": "daily", "ui": {"physicalLayout": "ansi-60"}}',
      );

      expect(
        await files.updateSettings({ ui: { theme: "light" }, tapHold: { timeoutMs: 250 } }),
      ).toEqual({ ok: true, value: null });
      await files.updateSettings({ logLevel: "warn" });
      expect(await files.readSettings()).toEqual({
        ok: true,
        value: {
          version: 1,
          activeProfile: "daily",
          ui: { physicalLayout: "ansi-60", theme: "light" },
          tapHold: { timeoutMs: 250 },
          logLevel: "warn",
        },
      });
    });

    it("creates settings.json if there is none", async () => {
      const { files } = tempConfig();
      await files.updateSettings({ emergencyRelease: { enabled: false } });
      expect(await files.readSettings()).toEqual({
        ok: true,
        value: { version: 1, emergencyRelease: { enabled: false } },
      });
    });

    it("refuses other groups and values the schema rejects", async () => {
      const { dir, files } = tempConfig();
      expect(await files.updateSettings({ activeProfile: "other" })).toMatchObject({ ok: false });
      expect(await files.updateSettings({ tapHold: { timeoutMs: -1 } })).toMatchObject({
        ok: false,
      });
      expect(await files.updateSettings("theme=light")).toMatchObject({ ok: false });
      expect(readdirSync(dir)).toEqual([]);
    });
  });

  describe("setDeviceRemapped", () => {
    it("excludes a keyboard and keeps the rest of settings.json", async () => {
      const { dir, files } = tempConfig();
      put(dir, "settings.json", '{"version": 1, "activeProfile": "daily", "logLevel": "debug"}');

      expect(await files.setDeviceRemapped(KBD, false, false)).toEqual({ ok: true, value: null });
      expect(await files.readSettings()).toEqual({
        ok: true,
        value: {
          version: 1,
          activeProfile: "daily",
          logLevel: "debug",
          devices: { excluded: [KBD] },
        },
      });
    });

    it("creates settings.json if there is none", async () => {
      const { files } = tempConfig();
      await files.setDeviceRemapped(KBD, false, false);

      expect(await files.readSettings()).toEqual({
        ok: true,
        value: { version: 1, devices: { excluded: [KBD] } },
      });
    });

    it("refuses arguments that aren't a device change", async () => {
      const { dir, files } = tempConfig();
      expect((await files.setDeviceRemapped({ name: "x" }, false, false)).ok).toBe(false);
      expect((await files.setDeviceRemapped(KBD, "no", false)).ok).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
    });

    it("doesn't touch a broken settings.json", async () => {
      const { dir, files } = tempConfig();
      put(dir, "settings.json", "{ not json");

      expect(await files.setDeviceRemapped(KBD, false, false)).toMatchObject({ ok: false });
      expect(readFileSync(join(dir, "settings.json"), "utf8")).toBe("{ not json");
    });

    it("is applied by a running engine", { timeout: 300_000 }, async () => {
      const engine = await TestEngine.start();
      cleanup.push(() => engine.stop());
      const client = await engine.connect();
      cleanup.push(() => client.close());
      await client.call("subscribe", { topics: ["config"] });
      const reloaded = new Promise<EngineEvent>((resolve) => {
        const stop = client.onEvent((event) => {
          if (event.event === "config") {
            stop();
            resolve(event);
          }
        });
      });

      const outcome = await new ConfigFiles(engine.configDir).setDeviceRemapped(KBD, false, false);
      expect(outcome.ok).toBe(true);

      // The engine accepted the new settings; its status still names the test profile.
      expect(await reloaded).toEqual({ event: "config", data: { ok: true, issues: [] } });
      expect(await client.call("status.get", {})).toMatchObject({ profile: "test" });
    });
  });

  describe("profile management", () => {
    /** A config folder with the given profiles and `active` as the active one. */
    async function withProfiles(names: string[], active: string) {
      const config = tempConfig();
      for (const name of names) {
        await config.files.saveProfile(name, { ...PROFILE, name });
      }
      put(config.dir, "settings.json", JSON.stringify({ version: 1, activeProfile: active }));
      return config;
    }

    it("lists profiles, sorted, without other files", async () => {
      const { dir, files } = await withProfiles(["work", "daily"], "daily");
      put(dir, "profiles/.daily.json.123.tmp", "{}");
      put(dir, "profiles/notes.txt", "");

      expect(await files.listProfiles()).toEqual({
        ok: true,
        value: [
          { file: "daily", name: "daily" },
          { file: "work", name: "work" },
        ],
      });
    });

    it("lists profiles by display name, or by file name without one", async () => {
      const { dir, files } = await withProfiles(["daily"], "daily");
      await files.createProfile("work-play", "Work & play", null);
      await files.createProfile("zz", "Alpha", null);
      put(dir, "profiles/broken.json", "{");

      expect(await files.listProfiles()).toEqual({
        ok: true,
        value: [
          { file: "zz", name: "Alpha" },
          { file: "broken", name: "broken" },
          { file: "daily", name: "daily" },
          { file: "work-play", name: "Work & play" },
        ],
      });
    });

    it("lists no profiles without a profiles folder", async () => {
      const { files } = tempConfig();
      expect(await files.listProfiles()).toEqual({ ok: true, value: [] });
    });

    it("creates an empty profile", async () => {
      const { files } = await withProfiles(["daily"], "daily");

      expect((await files.createProfile("gaming", "Gaming", null)).ok).toBe(true);
      expect(await files.readProfile("gaming")).toEqual({
        ok: true,
        value: {
          version: 1,
          name: "Gaming",
          layers: [{ id: "base", name: "Base", keys: {} }],
          shortcuts: [],
        },
      });
    });

    it("duplicates a profile under a new name", async () => {
      const { files } = await withProfiles(["daily"], "daily");

      await files.createProfile("copy", "Copy", "daily");
      expect(await files.readProfile("copy")).toEqual({
        ok: true,
        value: { ...PROFILE, name: "Copy" },
      });
    });

    it("doesn't overwrite an existing profile", async () => {
      const { files } = await withProfiles(["daily", "work"], "daily");

      expect(await files.createProfile("work", "Work", null)).toMatchObject({
        ok: false,
        problem: { message: "already exists" },
      });
      expect(await files.readProfile("work")).toMatchObject({ value: { name: "work" } });
    });

    it("renames the active profile and keeps it active", async () => {
      const { files } = await withProfiles(["daily"], "daily");

      expect((await files.renameProfile("daily", "main", "Main")).ok).toBe(true);
      expect(await files.listProfiles()).toEqual({
        ok: true,
        value: [{ file: "main", name: "Main" }],
      });
      expect(await files.activeProfile()).toEqual({ ok: true, value: "main" });
      expect(await files.readProfile("main")).toMatchObject({ value: { name: "Main" } });
    });

    it("changes only the name when the file stays the same", async () => {
      const { files } = await withProfiles(["daily"], "daily");

      expect((await files.renameProfile("daily", "daily", "Daily")).ok).toBe(true);
      expect(await files.listProfiles()).toEqual({
        ok: true,
        value: [{ file: "daily", name: "Daily" }],
      });
      expect(await files.readProfile("daily")).toMatchObject({ value: { name: "Daily" } });
    });

    it("doesn't rename onto an existing profile", async () => {
      const { files } = await withProfiles(["daily", "work"], "daily");

      expect((await files.renameProfile("daily", "work", "Work")).ok).toBe(false);
      expect(await files.listProfiles()).toEqual({
        ok: true,
        value: [
          { file: "daily", name: "daily" },
          { file: "work", name: "work" },
        ],
      });
    });

    it("deletes a profile, but not the active one", async () => {
      const { files } = await withProfiles(["daily", "work"], "daily");

      expect((await files.deleteProfile("daily")).ok).toBe(false);
      expect((await files.deleteProfile("work")).ok).toBe(true);
      expect(await files.listProfiles()).toEqual({
        ok: true,
        value: [{ file: "daily", name: "daily" }],
      });
    });

    it("switches only to a profile that exists", async () => {
      const { files } = await withProfiles(["daily", "work"], "daily");

      expect((await files.setActiveProfile("nope")).ok).toBe(false);
      expect((await files.setActiveProfile("work")).ok).toBe(true);
      expect(await files.activeProfile()).toEqual({ ok: true, value: "work" });
    });

    it("switches the running engine to another profile", { timeout: 300_000 }, async () => {
      const engine = await TestEngine.start();
      cleanup.push(() => engine.stop());
      const client = await engine.connect();
      cleanup.push(() => client.close());
      await client.call("subscribe", { topics: ["status"] });
      const switched = new Promise<EngineEvent>((resolve) => {
        const stop = client.onEvent((event) => {
          if (event.event === "status" && event.data.profile === "work") {
            stop();
            resolve(event);
          }
        });
      });

      const files = new ConfigFiles(engine.configDir);
      expect((await files.createProfile("work", "Work", "test")).ok).toBe(true);
      expect((await files.setActiveProfile("work")).ok).toBe(true);

      await switched;
      expect(await client.call("status.get", {})).toMatchObject({
        profile: "work",
        configIssues: [],
      });
    });
  });
});
