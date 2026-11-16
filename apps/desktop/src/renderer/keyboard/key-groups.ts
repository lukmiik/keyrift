/**
 * The key picker's groups (spec §7.2: Letters, Digits, Modifiers, Navigation, Function,
 * Media/System, Numpad, International, Other), plus "Typing" for Esc, Enter, Space and the
 * punctuation keys, which fit none of the others and would get lost among the 300 "Other" keys.
 */
import type { KeyName } from "@keyrift/config-types";
import { KEY_NAMES } from "@keyrift/config-types/keys";

import { keyLabel, keyName } from "./key-labels.ts";

export type KeyGroup = { label: string; items: KeyName[] };

/** Names without `KEY_`, so the lists stay short. */
const TYPING = new Set(
  "ESC MINUS EQUAL BACKSPACE TAB LEFTBRACE RIGHTBRACE ENTER SEMICOLON APOSTROPHE GRAVE BACKSLASH COMMA DOT SLASH SPACE CAPSLOCK 102ND COMPOSE".split(
    " ",
  ),
);
const MODIFIERS = new Set(
  "LEFTCTRL RIGHTCTRL LEFTSHIFT RIGHTSHIFT LEFTALT RIGHTALT LEFTMETA RIGHTMETA".split(" "),
);
const NAVIGATION = new Set("UP DOWN LEFT RIGHT HOME END PAGEUP PAGEDOWN INSERT DELETE".split(" "));
const INTERNATIONAL = new Set(
  "ZENKAKUHANKAKU RO KATAKANA HIRAGANA HENKAN KATAKANAHIRAGANA MUHENKAN KPJPCOMMA HANGEUL HANJA YEN".split(
    " ",
  ),
);
const MEDIA_SYSTEM = new Set(
  "MUTE VOLUMEDOWN VOLUMEUP MICMUTE PLAYPAUSE PLAY PAUSECD PLAYCD STOPCD NEXTSONG PREVIOUSSONG FASTFORWARD REWIND RECORD EJECTCD MEDIA BRIGHTNESSDOWN BRIGHTNESSUP KBDILLUMTOGGLE KBDILLUMDOWN KBDILLUMUP POWER SLEEP WAKEUP SUSPEND SYSRQ PRINT SCROLLLOCK PAUSE CALC MAIL WWW HOMEPAGE BACK FORWARD REFRESH SEARCH BOOKMARKS COMPUTER FILE".split(
    " ",
  ),
);

function groupOf(key: KeyName): string {
  const name = key.slice("KEY_".length);
  if (/^[A-Z]$/.test(name)) return "Letters";
  if (/^\d$/.test(name)) return "Digits";
  if (TYPING.has(name)) return "Typing";
  if (MODIFIERS.has(name)) return "Modifiers";
  if (NAVIGATION.has(name)) return "Navigation";
  if (/^F\d+$/.test(name)) return "Function";
  if (INTERNATIONAL.has(name)) return "International";
  if (MEDIA_SYSTEM.has(name)) return "Media/System";
  if (name.startsWith("KP") || name === "NUMLOCK") return "Numpad";
  return "Other";
}

const ORDER = [
  "Letters",
  "Digits",
  "Typing",
  "Modifiers",
  "Navigation",
  "Function",
  "Media/System",
  "Numpad",
  "International",
  "Other",
];

/** Every key the engine knows, in the groups above. Within a group: by evdev code. */
export const KEY_GROUPS: KeyGroup[] = ORDER.map((label) => ({
  label,
  items: KEY_NAMES.filter((key) => groupOf(key) === label),
}));

/**
 * Whether `key` matches what the user typed in the picker: its label ("Esc"), its accessible name
 * ("Left Shift") or its evdev name ("KEY_LEFTSHIFT", also without "KEY_"). Case is ignored.
 */
export function matchesKey(key: KeyName, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return [keyLabel(key), keyName(key), key].some((text) => text.toLowerCase().includes(q));
}
