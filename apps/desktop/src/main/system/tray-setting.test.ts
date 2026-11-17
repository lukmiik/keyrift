import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { desktopEntry, TraySetting } from "./tray-setting.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A setting whose autostart folder is a fresh temporary one (not created yet, like on a new system). */
function setup(command = ["/opt/Keyrift/keyrift-gui", "--hidden"]) {
  const root = mkdtempSync(join(tmpdir(), "keyrift-tray-"));
  dirs.push(root);
  const dir = join(root, "autostart");
  const changes: boolean[] = [];
  const setting = new TraySetting(dir, command, (enabled) => changes.push(enabled));
  return { dir, file: join(dir, "keyrift.desktop"), setting, changes };
}

describe("desktopEntry", () => {
  it("quotes paths with spaces and escapes what the desktop entry spec asks", () => {
    expect(desktopEntry(["/opt/Keyrift/keyrift-gui", "--hidden"])).toContain(
      "Exec=/opt/Keyrift/keyrift-gui --hidden\n",
    );
    expect(desktopEntry(['/home/a b/My "Apps"/Keyrift 100%.AppImage', "--hidden"])).toContain(
      'Exec="/home/a b/My \\\\"Apps\\\\"/Keyrift 100%%.AppImage" --hidden\n',
    );
  });
});

describe("TraySetting", () => {
  it("is the login entry: on writes it, off removes it", async () => {
    const { file, setting, changes } = setup();
    expect(setting.enabled).toBe(false);

    expect(await setting.set(true)).toEqual({ ok: true, value: true });
    expect(readFileSync(file, "utf8")).toContain("Exec=/opt/Keyrift/keyrift-gui --hidden\n");
    expect(setting.enabled).toBe(true);

    expect(await setting.set(false)).toEqual({ ok: true, value: false });
    expect(existsSync(file)).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("finds an entry written before", async () => {
    const { dir, setting } = setup();
    await setting.set(true);
    expect(new TraySetting(dir, ["x"], () => {}).enabled).toBe(true);
  });

  it("points an existing entry at the app again when it moved", async () => {
    const { dir, file, setting } = setup(["/home/u/Keyrift-0.2.0.AppImage", "--hidden"]);
    await setting.set(true);
    const moved = new TraySetting(dir, ["/home/u/Keyrift-0.3.0.AppImage", "--hidden"], () => {});
    await moved.refresh();
    expect(readFileSync(file, "utf8")).toContain("Exec=/home/u/Keyrift-0.3.0.AppImage --hidden\n");
  });

  it("leaves things alone when off, and rejects values that aren't true or false", async () => {
    const { dir, file, setting } = setup();
    await setting.refresh();
    expect(existsSync(dir)).toBe(false);
    expect(await setting.set("yes")).toMatchObject({ ok: false });
    expect(existsSync(file)).toBe(false);
  });
});
