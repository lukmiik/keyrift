/**
 * The Devices screen (spec §7.3, §4.1): every keyboard the engine sees, with its VID:PID, grouped
 * sub-devices, grab status and a toggle to turn remapping on or off. Keyboards that are excluded in
 * `settings.json` but not plugged in are listed too ("remembered"), so they can be enabled again.
 */
import type { DeviceMatch, Settings } from "@keyrift/config-types";
import { useEffect, useState } from "react";

import type { ConfigApi, EngineApi } from "../../shared/api.ts";
import { deviceMatch, sameDevice, vidPid } from "../../shared/devices.ts";
import type { DeviceGroup, DeviceMember } from "../../shared/protocol.ts";
import { useDevices } from "../engine/useDevices.ts";
import { Badge } from "./ui/badge.tsx";
import { Switch } from "./ui/switch.tsx";

type DevicesScreenProps = {
  engine: EngineApi;
  config: ConfigApi;
};

/** How long a switched row waits for the engine's answer before showing its state again. */
const CONFIRM_MS = 2000;

/** A switch the user just changed: row id, new position, and the device list it was based on. */
type Wanted = { id: string; remap: boolean; devices: DeviceGroup[] | null };

/** A device that is in `settings.json` but not connected. */
type Remembered = { device: DeviceMatch; probablyMouse: boolean };

export function DevicesScreen({ engine, config }: DevicesScreenProps) {
  const devices = useDevices(engine);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  // Bumped after each change, so the effect below reads settings.json again.
  const [settingsChanges, setSettingsChanges] = useState(0);
  // Which device is being written right now, and the last error.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What the user just switched a row to, shown until the engine sends its next device list. The
  // engine's devices event comes 100 ms or more after the write (it debounces file changes);
  // without this the switch would stay put until then and jump late.
  const [wanted, setWanted] = useState<Wanted | null>(null);
  /** The switch position for row `id`: the user's choice while the engine hasn't answered. */
  const shownRemap = (id: string, actual: boolean) =>
    wanted !== null && wanted.id === id && wanted.devices === devices ? wanted.remap : actual;

  // Read settings.json on open, after each change, and when the engine's list changes (the
  // engine reloads settings.json too, e.g. after an edit in a text editor).
  useEffect(() => {
    let active = true;
    void config.readSettings().then((outcome) => {
      if (active && outcome.ok) setSettings(outcome.value);
    });
    return () => {
      active = false;
    };
  }, [config, devices, settingsChanges]);

  async function setRemapped(
    id: string,
    device: DeviceMatch,
    probablyMouse: boolean,
    remap: boolean,
  ) {
    // One change at a time: main reads and rewrites the whole settings.json for each.
    if (pending !== null) return;
    setPending(id);
    setError(null);
    // `devices` is the list at the click; a new list from the engine replaces the choice.
    const choice: Wanted = { id, remap, devices };
    setWanted(choice);
    const outcome = await config.setDeviceRemapped(device, probablyMouse, remap);
    setPending(null);
    // Unless a newer click replaced it, drop the choice: at once if saving failed, else after a
    // while in case the engine never sends a list (when nothing changed for it).
    const drop = () => setWanted((current) => (current === choice ? null : current));
    if (outcome.ok) {
      setTimeout(drop, CONFIRM_MS);
    } else {
      setError(`${outcome.problem.file}: ${outcome.problem.message}`);
      drop();
    }
    setSettingsChanges((n) => n + 1);
  }

  const shown = (devices ?? []).filter((group) => isShown(group, showHidden));
  const remembered = rememberedDevices(settings, devices ?? []);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Devices</h1>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showHidden} onCheckedChange={setShowHidden} />
          Show hidden devices
        </label>
      </div>
      {devices === null && (
        <p className="text-sm text-muted-foreground">
          The engine isn't connected, so connected devices can't be shown.
        </p>
      )}
      {devices !== null && shown.length === 0 && (
        <p className="text-sm text-muted-foreground">No keyboards connected.</p>
      )}
      {error !== null && <p className="text-sm text-destructive">Not saved: {error}</p>}

      <ul aria-label="Devices" className="flex flex-col gap-2">
        {shown.map((group) => (
          <DeviceRow
            key={group.key}
            name={group.name}
            device={deviceMatch(group)}
            status={deviceStatus(group)}
            subDevices={group.members}
            remapped={shownRemap(group.key, group.decision === "grab")}
            // A test-only filter can't be changed from here.
            disabled={group.decision === "filtered"}
            onRemap={(remap) =>
              void setRemapped(group.key, deviceMatch(group), group.kind === "probablyMouse", remap)
            }
          />
        ))}
        {remembered.map(({ device, probablyMouse }) => {
          const id = `${vidPid(device)} ${device.name}`;
          return (
            <DeviceRow
              key={id}
              name={device.name}
              device={device}
              status={{ label: "Not connected", variant: "outline" }}
              subDevices={[]}
              // Remembered keyboards are excluded; remembered mice are included.
              remapped={shownRemap(id, probablyMouse)}
              disabled={false}
              onRemap={(remap) => void setRemapped(id, device, probablyMouse, remap)}
            />
          );
        })}
      </ul>
    </section>
  );
}

type DeviceStatus = {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
};

type DeviceRowProps = {
  name: string;
  device: DeviceMatch;
  status: DeviceStatus;
  /** Sub device nodes in the group; shown when there is more than one. */
  subDevices: DeviceMember[];
  remapped: boolean;
  disabled: boolean;
  onRemap: (remap: boolean) => void;
};

function DeviceRow({
  name,
  device,
  status,
  subDevices,
  remapped,
  disabled,
  onRemap,
}: DeviceRowProps) {
  return (
    <li className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
      <div className="mr-auto flex flex-col">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground">{vidPid(device)}</span>
        {subDevices.length > 1 && (
          <ul aria-label="Sub-devices" className="text-xs text-muted-foreground">
            {subDevices.map((subDevice) => (
              // The path names one node and stays the same while it exists (names can repeat).
              <li key={subDevice.path}>
                {subDevice.name + " · " + subDevice.path.split("/").at(-1)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* No colour fade: the text changes at once, so a fade showed the new text in the old
          colour. A minimum width keeps the pill from changing size between short labels. */}
      <Badge variant={status.variant} className="min-w-20 transition-none">
        {status.label}
      </Badge>
      <Switch
        aria-label={`Remap ${name}`}
        checked={remapped}
        disabled={disabled}
        onCheckedChange={onRemap}
      />
    </li>
  );
}

/**
 * Keyboards are always listed (grabbed or excluded). Probable mice and devices outside the test
 * filter only with "Show hidden devices"; devices that aren't keyboards never.
 */
export function isShown(group: DeviceGroup, showHidden: boolean): boolean {
  switch (group.decision) {
    case "grab":
    case "excluded":
      return true;
    case "hidden":
    case "filtered":
      return showHidden;
    case "notKeyboard":
      return false;
  }
}

/** The grab status badge (spec §7.3: grabbed / excluded / busy). */
export function deviceStatus(group: DeviceGroup): DeviceStatus {
  switch (group.decision) {
    case "grab": {
      const blocked = group.members.find((member) => member.blocked !== null);
      if (blocked !== undefined) {
        return { label: `Busy: ${blocked.blocked}`, variant: "destructive" };
      }
      return group.members.every((member) => member.grabbed)
        ? { label: "Grabbed", variant: "default" }
        : { label: "Not grabbed yet", variant: "outline" };
    }
    case "excluded":
      return { label: "Excluded", variant: "secondary" };
    case "hidden":
      return { label: "Hidden: probably a mouse", variant: "secondary" };
    case "filtered":
      return { label: "Filtered (test)", variant: "outline" };
    case "notKeyboard":
      return { label: "Not a keyboard", variant: "outline" };
  }
}

/** Devices in settings.json's lists that the engine doesn't see right now. */
function rememberedDevices(settings: Settings | null, connected: DeviceGroup[]): Remembered[] {
  const notConnected = (device: DeviceMatch) =>
    !connected.some((group) => sameDevice(deviceMatch(group), device));
  return [
    ...(settings?.devices?.excluded ?? [])
      .filter(notConnected)
      .map((device) => ({ device, probablyMouse: false })),
    ...(settings?.devices?.included ?? [])
      .filter(notConnected)
      .map((device) => ({ device, probablyMouse: true })),
  ];
}
