/**
 * The setup wizard's checks (spec §9.3, F-UI-7): what Keyrift needs from the system, and what is
 * in its way. Each check reads the system through a `Probe`, so tests can describe a system
 * instead of reading the real one (probe.ts has both).
 */
import type { Autostart, SetupCheck } from "../../shared/api.ts";

/** What the checks read from the system. */
export type Probe = {
  username: string;
  /** Groups of this login session (`id -Gn`): new memberships only count after logging in again. */
  sessionGroups(): Promise<string[]>;
  /** Groups the user is a member of in /etc/group (`id -Gn <user>`). */
  configuredGroups(): Promise<string[]>;
  /** Whether this process may open `path` for reading (and writing with `write`). */
  canOpen(path: string, write: boolean): Promise<boolean>;
  /** File names in a directory; empty if it can't be read. */
  list(dir: string): Promise<string[]>;
  /** A file's text, or null if it can't be read. */
  read(path: string): Promise<string | null>;
  /** The running kernel's version (`uname -r`), for its module list. */
  kernelRelease(): Promise<string>;
  /** Names of running programs (/proc/<pid>/comm). */
  processes(): Promise<string[]>;
  /** Whether a systemd unit is enabled, in the user's session or system-wide. */
  unitEnabled(scope: "user" | "system", unit: string): Promise<boolean>;
  /** A unit's state (`systemctl is-active`): "active", "failed", "inactive"… */
  unitActiveState(scope: "user" | "system", unit: string): Promise<string>;
  autostart(): Promise<Autostart>;
};

/** Other remappers, by program name (as /proc shows it, at most 15 characters) and unit names. */
const REMAPPERS = [
  { name: "kanata", programs: ["kanata"], user: ["kanata.service"], system: ["kanata.service"] },
  { name: "keyd", programs: ["keyd"], user: [], system: ["keyd.service"] },
  { name: "xremap", programs: ["xremap"], user: ["xremap.service"], system: ["xremap.service"] },
  {
    name: "input-remapper",
    programs: ["input-remapper-", "input-remapper"],
    user: [],
    system: ["input-remapper.service", "input-remapper-daemon.service"],
  },
];

export async function runChecks(probe: Probe): Promise<SetupCheck[]> {
  return Promise.all([
    groupsCheck(probe),
    devicesCheck(probe),
    uinputBootCheck(probe),
    remappersCheck(probe),
    serviceCheck(probe),
  ]);
}

const GROUPS = ["input", "uinput"];

async function groupsCheck(probe: Probe): Promise<SetupCheck> {
  const base = { id: "groups", title: "Groups input and uinput", commands: [] } as const;
  const session = await probe.sessionGroups();
  if (GROUPS.every((group) => session.includes(group))) {
    return { ...base, status: "ok", detail: "You are in both groups.", fix: null };
  }
  const configured = await probe.configuredGroups();
  if (GROUPS.every((group) => configured.includes(group))) {
    return {
      ...base,
      status: "warn",
      detail: "You were added to them; log out and in again for it to take effect.",
      fix: null,
    };
  }
  const missing = GROUPS.filter((group) => !configured.includes(group));
  return {
    ...base,
    status: "fail",
    detail: `You aren't in ${missing.join(" and ")}: the engine can't read keyboards or type without them.`,
    fix: "system",
  };
}

async function devicesCheck(probe: Probe): Promise<SetupCheck> {
  const base = {
    id: "devices",
    title: "Access to keyboards and /dev/uinput",
    commands: [],
  } as const;
  const uinput = await probe.canOpen("/dev/uinput", true);
  const events = (await probe.list("/dev/input")).filter((name) => name.startsWith("event"));
  const readable = await Promise.all(
    events.map((name) => probe.canOpen(`/dev/input/${name}`, false)),
  );
  const keyboards = readable.some(Boolean);
  if (uinput && keyboards) {
    return {
      ...base,
      status: "ok",
      detail: "The engine can read keyboards and create its virtual keyboard.",
      fix: null,
    };
  }
  const problems = [
    ...(uinput ? [] : ["/dev/uinput can't be opened"]),
    ...(keyboards ? [] : ["no keyboard device can be read"]),
  ];
  return {
    ...base,
    status: "fail",
    detail: `${capitalise(problems.join(" and "))}. Keyrift's udev rule gives the groups access.`,
    fix: "system",
  };
}

/** Where systemd and Debian look for modules to load at boot. */
const MODULE_LISTS = ["/etc/modules-load.d", "/usr/lib/modules-load.d", "/run/modules-load.d"];

async function uinputBootCheck(probe: Probe): Promise<SetupCheck> {
  const base = { id: "uinput-boot", title: "uinput loaded at boot", commands: [] } as const;
  const release = await probe.kernelRelease();
  const builtin = (await probe.read(`/lib/modules/${release}/modules.builtin`)) ?? "";
  if (/\/uinput\.ko\b/.test(builtin)) {
    return { ...base, status: "ok", detail: "uinput is built into the kernel.", fix: null };
  }
  const files: string[] = ["/etc/modules"];
  for (const dir of MODULE_LISTS) {
    for (const name of await probe.list(dir)) {
      if (name.endsWith(".conf")) files.push(`${dir}/${name}`);
    }
  }
  for (const file of files) {
    const text = (await probe.read(file)) ?? "";
    if (text.split("\n").some((line) => line.trim() === "uinput")) {
      return { ...base, status: "ok", detail: `Loaded at boot (${file}).`, fix: null };
    }
  }
  return {
    ...base,
    status: "warn",
    detail: "Nothing loads the uinput module at boot, so after a restart the engine may not start.",
    fix: "system",
  };
}

async function remappersCheck(probe: Probe): Promise<SetupCheck> {
  const base = { id: "remappers", title: "No other remapper", fix: null } as const;
  const programs = await probe.processes();
  const found: string[] = [];
  const commands: string[] = [];
  let anyRunning = false;
  for (const remapper of REMAPPERS) {
    const userUnits = await enabled(probe, "user", remapper.user);
    const systemUnits = await enabled(probe, "system", remapper.system);
    const units = [
      ...userUnits.map((unit) => ({ scope: "user" as const, unit })),
      ...systemUnits.map((unit) => ({ scope: "system" as const, unit })),
    ];
    const states = await Promise.all(units.map((u) => probe.unitActiveState(u.scope, u.unit)));
    const running =
      states.includes("active") ||
      programs.some((program) => remapper.programs.some((name) => program.startsWith(name)));
    if (!running && units.length === 0) continue;
    anyRunning ||= running;
    found.push(
      describeRemapper(remapper.name, running, units.length > 0, states.includes("failed")),
    );
    for (const unit of userUnits) commands.push(`systemctl --user disable --now ${unit}`);
    for (const unit of systemUnits) commands.push(`sudo systemctl disable --now ${unit}`);
    if (running && units.length === 0) commands.push(`pkill ${remapper.programs[0]}`);
  }
  if (found.length === 0) {
    return { ...base, status: "ok", detail: "No other remapper found.", commands: [] };
  }
  return {
    ...base,
    // Running now: it holds the keyboards, so Keyrift can't. Only enabled: trouble once it starts.
    status: anyRunning ? "fail" : "warn",
    detail: `${found.join(" ")} ${
      anyRunning
        ? "Two remappers fight over the keyboards: stop and disable the other one."
        : "Disable it, so it can't fight Keyrift for the keyboards once it does start."
    }`,
    commands,
  };
}

/** One remapper in a sentence: whether it runs now, and whether it starts at login. */
export function describeRemapper(
  name: string,
  running: boolean,
  enabledUnit: boolean,
  failed: boolean,
): string {
  if (running) {
    return enabledUnit ? `${name} is running and starts at every login.` : `${name} is running.`;
  }
  // Only enabled (not running): it tries at every login, and may have failed this time.
  return `${name} isn't running, but its service is enabled, so it tries to start at every login${
    failed ? " (it failed last time)" : ""
  }.`;
}

async function enabled(probe: Probe, scope: "user" | "system", units: string[]) {
  const answers = await Promise.all(units.map((unit) => probe.unitEnabled(scope, unit)));
  return units.filter((_, i) => answers[i]);
}

async function serviceCheck(probe: Probe): Promise<SetupCheck> {
  const base = { id: "service", title: "Engine service", commands: [] } as const;
  const state = await probe.autostart();
  if (state === "enabled") {
    return {
      ...base,
      status: "ok",
      detail: "Installed, and starts when you log in.",
      fix: null,
    };
  }
  if (state === "disabled") {
    return {
      ...base,
      status: "warn",
      detail: "Installed, but doesn't start when you log in.",
      fix: "service",
    };
  }
  return {
    ...base,
    status: "fail",
    detail: "The engine's systemd user service isn't installed.",
    fix: "service",
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
