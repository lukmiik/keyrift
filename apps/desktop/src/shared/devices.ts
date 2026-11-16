/**
 * Device identity and the exclude/include lists in `settings.json` (spec §4.1 F-DEV-3..5).
 * Pure functions, used by main (to change the settings) and the page (to show them).
 */
import type { DeviceMatch, DeviceSettings, Settings } from "@keyrift/config-types";

import type { DeviceGroup } from "./protocol.ts";

/**
 * Whether two identities name the same keyboard: same vendor ID, product ID and name. The IDs are
 * compared as numbers, like the engine does, so "0x0951" and "0x951" match.
 */
export function sameDevice(a: DeviceMatch, b: DeviceMatch): boolean {
  return (
    Number.parseInt(a.vendorId, 16) === Number.parseInt(b.vendorId, 16) &&
    Number.parseInt(a.productId, 16) === Number.parseInt(b.productId, 16) &&
    a.name === b.name
  );
}

/** The identity of a connected device group, in the form `settings.json` stores. */
export function deviceMatch(group: DeviceGroup): DeviceMatch {
  return { vendorId: group.vendorId, productId: group.productId, name: group.name };
}

/** "0951:16d2": the usual way to write a USB vendor and product ID. */
export function vidPid(device: DeviceMatch): string {
  const hex = (id: string) => id.replace(/^0x/i, "").padStart(4, "0").toLowerCase();
  return `${hex(device.vendorId)}:${hex(device.productId)}`;
}

/**
 * New settings in which `device` is (`remap` true) or isn't remapped. A keyboard is remapped
 * unless it is in `excluded`; a probable mouse (F-DEV-3) is skipped unless it is in `included`.
 * Returns the same object if nothing changes.
 */
export function setRemapped(
  settings: Settings,
  device: DeviceMatch,
  probablyMouse: boolean,
  remap: boolean,
): Settings {
  const wantExcluded = !probablyMouse && !remap;
  const wantIncluded = probablyMouse && remap;
  const inList = (list: DeviceMatch[] | undefined) =>
    (list ?? []).some((d) => sameDevice(d, device));
  if (
    inList(settings.devices?.excluded) === wantExcluded &&
    inList(settings.devices?.included) === wantIncluded
  ) {
    return settings;
  }

  const others = (list: DeviceMatch[] | undefined) =>
    (list ?? []).filter((d) => !sameDevice(d, device));
  const excluded = wantExcluded
    ? [...others(settings.devices?.excluded), device]
    : others(settings.devices?.excluded);
  const included = wantIncluded
    ? [...others(settings.devices?.included), device]
    : others(settings.devices?.included);

  // Leave out empty lists, so the file stays as short as the user wrote it.
  const devices: DeviceSettings = { ...settings.devices };
  delete devices.excluded;
  delete devices.included;
  if (excluded.length > 0) devices.excluded = excluded;
  if (included.length > 0) devices.included = included;
  const next: Settings = { ...settings, devices };
  if (Object.keys(devices).length === 0) delete next.devices;
  return next;
}
