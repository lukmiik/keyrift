/**
 * Short labels for evdev key names, as printed on a US keycap: `KEY_LEFTSHIFT` → "Shift".
 */
import type { KeyName } from "@keyrift/config-types";

const LABELS: Partial<Record<KeyName, string>> = {
  KEY_ESC: "Esc",
  KEY_MINUS: "-",
  KEY_EQUAL: "=",
  KEY_BACKSPACE: "Backspace",
  KEY_TAB: "Tab",
  KEY_LEFTBRACE: "[",
  KEY_RIGHTBRACE: "]",
  KEY_ENTER: "Enter",
  KEY_LEFTCTRL: "Ctrl",
  KEY_SEMICOLON: ";",
  KEY_APOSTROPHE: "'",
  KEY_GRAVE: "`",
  KEY_LEFTSHIFT: "Shift",
  KEY_BACKSLASH: "\\",
  KEY_COMMA: ",",
  KEY_DOT: ".",
  KEY_SLASH: "/",
  KEY_RIGHTSHIFT: "Shift",
  KEY_LEFTALT: "Alt",
  KEY_SPACE: "Space",
  KEY_CAPSLOCK: "Caps",
  KEY_102ND: "< >",
  KEY_RIGHTCTRL: "Ctrl",
  KEY_RIGHTALT: "AltGr",
  KEY_LEFTMETA: "Super",
  KEY_RIGHTMETA: "Super",
  KEY_COMPOSE: "Menu",
  KEY_SYSRQ: "PrtSc",
  KEY_SCROLLLOCK: "ScrLk",
  KEY_PAUSE: "Pause",
  KEY_INSERT: "Ins",
  KEY_HOME: "Home",
  KEY_PAGEUP: "PgUp",
  KEY_DELETE: "Del",
  KEY_END: "End",
  KEY_PAGEDOWN: "PgDn",
  KEY_UP: "↑",
  KEY_DOWN: "↓",
  KEY_LEFT: "←",
  KEY_RIGHT: "→",
  KEY_NUMLOCK: "Num",
  KEY_KPSLASH: "/",
  KEY_KPASTERISK: "*",
  KEY_KPMINUS: "-",
  KEY_KPPLUS: "+",
  KEY_KPENTER: "Enter",
  KEY_KPDOT: ".",
};

/** The keycap label of `key`; for keys not in the table, the name without `KEY_`, e.g. "Mute". */
export function keyLabel(key: KeyName): string {
  const label = LABELS[key];
  if (label !== undefined) return label;
  const name = key.replace(/^(KEY|BTN)_/, "");
  const keypad = /^KP(\d)$/.exec(name);
  if (keypad !== null) return keypad[1] ?? name;
  // KEY_A → "A", KEY_F1 → "F1", KEY_MUTE → "Mute".
  return name.length <= 3 ? name : name.charAt(0) + name.slice(1).toLowerCase();
}

/**
 * A name for screen readers and tests: the label, with "Left"/"Right" for the keys that exist
 * twice (Shift, Ctrl, Alt, Super) and words for the arrows.
 */
export function keyName(key: KeyName): string {
  const arrows: Partial<Record<KeyName, string>> = {
    KEY_UP: "Up",
    KEY_DOWN: "Down",
    KEY_LEFT: "Left",
    KEY_RIGHT: "Right",
  };
  const arrow = arrows[key];
  if (arrow !== undefined) return arrow;
  if (/^KEY_LEFT(SHIFT|CTRL|ALT|META)$/.test(key)) return `Left ${keyLabel(key)}`;
  if (/^KEY_RIGHT(SHIFT|CTRL|META)$/.test(key)) return `Right ${keyLabel(key)}`;
  if (key.startsWith("KEY_KP")) return `Keypad ${keyLabel(key)}`;
  return keyLabel(key);
}
