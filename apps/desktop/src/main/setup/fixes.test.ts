import { describe, expect, it } from "vite-plus/test";

import { isSafeUsername, systemFixScript } from "./fixes.ts";

describe("systemFixScript", () => {
  it("adds the groups and installs both files, stopping at the first error", () => {
    const script = systemFixScript("alice", "/tmp/keyrift-setup-x");
    expect(script.split("\n")).toEqual([
      "set -e",
      "groupadd -f input",
      "groupadd -f uinput",
      "usermod -aG input,uinput alice",
      "install -m 644 '/tmp/keyrift-setup-x/70-keyrift.rules' /etc/udev/rules.d/70-keyrift.rules",
      "install -m 644 '/tmp/keyrift-setup-x/keyrift.conf' /etc/modules-load.d/keyrift.conf",
      "modprobe uinput || true",
      "udevadm control --reload",
      "udevadm trigger --subsystem-match=misc --sysname-match=uinput",
      "udevadm trigger --subsystem-match=input --property-match=ID_INPUT_KEYBOARD=1",
    ]);
  });

  it("refuses user names that could break out of the script", () => {
    expect(isSafeUsername("alice")).toBe(true);
    expect(isSafeUsername("a_b-c")).toBe(true);
    expect(isSafeUsername("alice; rm -rf /")).toBe(false);
    expect(() => systemFixScript("x$(reboot)", "/tmp")).toThrow(/unusual user name/);
  });
});
