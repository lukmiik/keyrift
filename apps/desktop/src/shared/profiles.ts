/** Helpers for the profile list (`ConfigApi.listProfiles`), shared by main and the page. */
import type { ProfileEntry } from "./api.ts";

/** Orders profiles by display name, then by file name for profiles with the same name. */
export function byName(a: ProfileEntry, b: ProfileEntry): number {
  return a.name.localeCompare(b.name) || a.file.localeCompare(b.file);
}
