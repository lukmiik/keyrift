/**
 * Physical keyboard layouts for the visual keyboard (spec §7.2): ISO or ANSI, each as full size,
 * TKL (no numpad), 75% and 60%. A layout is only data: a list of keys with positions, measured in
 * key units (1 = the width of a letter key). The keyboard component draws whatever list it gets.
 */
import type { KeyName } from "@keyrift/config-types";

/** One physical key: its code and where it is. `w` and `h` default to 1. */
export type KeySpec = { key: KeyName; x: number; y: number; w?: number; h?: number };

export type LayoutId = `${"iso" | "ansi"}-${"full" | "tkl" | "75" | "60"}`;

export const LAYOUT_IDS: LayoutId[] = [
  "iso-full",
  "iso-tkl",
  "iso-75",
  "iso-60",
  "ansi-full",
  "ansi-tkl",
  "ansi-75",
  "ansi-60",
];

/** The default (spec §7.2): ISO TKL, like the HyperX Alloy FPS Pro. */
export const DEFAULT_LAYOUT: LayoutId = "iso-tkl";

/** `settings.ui.physicalLayout` as a layout; unknown or missing values give the default. */
export function layoutId(value: string | undefined): LayoutId {
  return LAYOUT_IDS.find((id) => id === value) ?? DEFAULT_LAYOUT;
}

/** A row of keys from left to right, starting at `x`; each entry is a key or `[key, width]`. */
function row(y: number, x: number, keys: (KeyName | [KeyName, number])[]): KeySpec[] {
  const specs: KeySpec[] = [];
  for (const entry of keys) {
    const [key, w] = typeof entry === "string" ? [entry, 1] : entry;
    specs.push({ key, x, y, w });
    x += w;
  }
  return specs;
}

const DIGITS: KeyName[] = [
  "KEY_1",
  "KEY_2",
  "KEY_3",
  "KEY_4",
  "KEY_5",
  "KEY_6",
  "KEY_7",
  "KEY_8",
  "KEY_9",
  "KEY_0",
];
const QWERTY: KeyName[] = [
  "KEY_Q",
  "KEY_W",
  "KEY_E",
  "KEY_R",
  "KEY_T",
  "KEY_Y",
  "KEY_U",
  "KEY_I",
  "KEY_O",
  "KEY_P",
];
const HOME: KeyName[] = [
  "KEY_A",
  "KEY_S",
  "KEY_D",
  "KEY_F",
  "KEY_G",
  "KEY_H",
  "KEY_J",
  "KEY_K",
  "KEY_L",
];
const BOTTOM: KeyName[] = [
  "KEY_Z",
  "KEY_X",
  "KEY_C",
  "KEY_V",
  "KEY_B",
  "KEY_N",
  "KEY_M",
  "KEY_COMMA",
  "KEY_DOT",
  "KEY_SLASH",
];

/**
 * The letter block, 15 units wide, with its top row at `y`. `compact`: the 75% shape, where the
 * right Shift and the right-hand bottom keys are shorter to make room for the arrow keys.
 */
function mainBlock(iso: boolean, y: number, compact: boolean): KeySpec[] {
  const keys = [
    ...row(y, 0, ["KEY_GRAVE", ...DIGITS, "KEY_MINUS", "KEY_EQUAL", ["KEY_BACKSPACE", 2]]),
    ...row(y + 1, 0, [["KEY_TAB", 1.5], ...QWERTY, "KEY_LEFTBRACE", "KEY_RIGHTBRACE"]),
    ...row(y + 2, 0, [["KEY_CAPSLOCK", 1.75], ...HOME, "KEY_SEMICOLON", "KEY_APOSTROPHE"]),
  ];
  if (iso) {
    // ISO: a tall Enter over two rows (drawn as a rectangle), "#" left of it, and an extra key
    // ("< >") right of a short left Shift.
    keys.push({ key: "KEY_ENTER", x: 13.75, y: y + 1, w: 1.25, h: 2 });
    keys.push({ key: "KEY_BACKSLASH", x: 12.75, y: y + 2 });
    keys.push(...row(y + 3, 0, [["KEY_LEFTSHIFT", 1.25], "KEY_102ND", ...BOTTOM]));
  } else {
    keys.push({ key: "KEY_BACKSLASH", x: 13.5, y: y + 1, w: 1.5 });
    keys.push({ key: "KEY_ENTER", x: 12.75, y: y + 2, w: 2.25 });
    keys.push(...row(y + 3, 0, [["KEY_LEFTSHIFT", 2.25], ...BOTTOM]));
  }
  keys.push({ key: "KEY_RIGHTSHIFT", x: 12.25, y: y + 3, w: compact ? 1.75 : 2.75 });
  const left: [KeyName, number][] = [
    ["KEY_LEFTCTRL", 1.25],
    ["KEY_LEFTMETA", 1.25],
    ["KEY_LEFTALT", 1.25],
    ["KEY_SPACE", 6.25],
  ];
  keys.push(
    ...row(
      y + 4,
      0,
      compact
        ? [...left, "KEY_RIGHTALT", "KEY_RIGHTCTRL"]
        : [
            ...left,
            ["KEY_RIGHTALT", 1.25],
            ["KEY_RIGHTMETA", 1.25],
            ["KEY_COMPOSE", 1.25],
            ["KEY_RIGHTCTRL", 1.25],
          ],
    ),
  );
  return keys;
}

/** Esc and F1–F12 with the usual gaps between the groups of four. */
function functionRow(): KeySpec[] {
  const f = (n: number) => `KEY_F${n}` as KeyName;
  return [
    { key: "KEY_ESC", x: 0, y: 0 },
    ...row(0, 2, [f(1), f(2), f(3), f(4)]),
    ...row(0, 6.5, [f(5), f(6), f(7), f(8)]),
    ...row(0, 11, [f(9), f(10), f(11), f(12)]),
  ];
}

/** The six keys above the arrows, and the arrows; starting at `x`. */
function navCluster(x: number): KeySpec[] {
  return [
    ...row(0, x, ["KEY_SYSRQ", "KEY_SCROLLLOCK", "KEY_PAUSE"]),
    ...row(1.25, x, ["KEY_INSERT", "KEY_HOME", "KEY_PAGEUP"]),
    ...row(2.25, x, ["KEY_DELETE", "KEY_END", "KEY_PAGEDOWN"]),
    { key: "KEY_UP", x: x + 1, y: 4.25 },
    ...row(5.25, x, ["KEY_LEFT", "KEY_DOWN", "KEY_RIGHT"]),
  ];
}

function numpad(x: number): KeySpec[] {
  return [
    ...row(1.25, x, ["KEY_NUMLOCK", "KEY_KPSLASH", "KEY_KPASTERISK", "KEY_KPMINUS"]),
    ...row(2.25, x, ["KEY_KP7", "KEY_KP8", "KEY_KP9"]),
    { key: "KEY_KPPLUS", x: x + 3, y: 2.25, h: 2 },
    ...row(3.25, x, ["KEY_KP4", "KEY_KP5", "KEY_KP6"]),
    ...row(4.25, x, ["KEY_KP1", "KEY_KP2", "KEY_KP3"]),
    { key: "KEY_KPENTER", x: x + 3, y: 4.25, h: 2 },
    { key: "KEY_KP0", x, y: 5.25, w: 2 },
    { key: "KEY_KPDOT", x: x + 2, y: 5.25 },
  ];
}

/** The 75% shape: one top row with no gaps, a column of navigation keys, arrows tucked in. */
function seventyFive(iso: boolean): KeySpec[] {
  const f = Array.from({ length: 12 }, (_, i) => `KEY_F${i + 1}` as KeyName);
  return [
    ...row(0, 0, ["KEY_ESC", ...f, "KEY_SYSRQ", "KEY_INSERT", "KEY_DELETE"]),
    ...mainBlock(iso, 1, true),
    ...row(1, 15, ["KEY_HOME"]),
    ...row(2, 15, ["KEY_PAGEUP"]),
    ...row(3, 15, ["KEY_PAGEDOWN"]),
    ...row(4, 15, ["KEY_END"]),
    { key: "KEY_UP", x: 14, y: 4 },
    ...row(5, 13, ["KEY_LEFT", "KEY_DOWN", "KEY_RIGHT"]),
  ];
}

/** The keys of layout `id`. */
export function layoutKeys(id: LayoutId): KeySpec[] {
  const iso = id.startsWith("iso");
  switch (id.split("-")[1]) {
    case "full":
      return [
        ...functionRow(),
        ...mainBlock(iso, 1.25, false),
        ...navCluster(15.25),
        ...numpad(18.5),
      ];
    case "tkl":
      return [...functionRow(), ...mainBlock(iso, 1.25, false), ...navCluster(15.25)];
    case "75":
      return seventyFive(iso);
    default:
      return mainBlock(iso, 0, false);
  }
}
