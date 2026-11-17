/**
 * The sidebar (spec §7.1): one entry per screen. App keeps which screen is open; the sidebar only
 * shows it and reports clicks.
 */
import {
  Activity,
  Command,
  Keyboard,
  type LucideIcon,
  ScrollText,
  Settings,
  Usb,
} from "lucide-react";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button.tsx";

import { Wordmark } from "./Wordmark.tsx";

/** The screens of the app, in sidebar order. */
export type Screen = "keymap" | "shortcuts" | "devices" | "tester" | "logs" | "settings";

/** Label and icon for each screen. An array, because the sidebar shows them in this order. */
export const SCREENS: { id: Screen; label: string; icon: LucideIcon }[] = [
  { id: "keymap", label: "Keymap", icon: Keyboard },
  { id: "shortcuts", label: "Shortcuts", icon: Command },
  { id: "devices", label: "Devices", icon: Usb },
  { id: "tester", label: "Tester", icon: Activity },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "settings", label: "Settings", icon: Settings },
];

type SidebarProps = {
  current: Screen;
  onSelect: (screen: Screen) => void;
  /** Shown at the bottom of the sidebar: the profile selector. */
  footer?: ReactNode;
  /** Screens with something waiting there get a dot; the text is read out after their name. */
  notices?: Partial<Record<Screen, string>>;
};

export function Sidebar({ current, onSelect, footer, notices = {} }: SidebarProps) {
  return (
    // Full window height, with the app's name on top; the header sits only over the page.
    <aside className="flex w-48 shrink-0 flex-col border-r bg-sidebar">
      {/* h-12 = the top bar's height, so the name lines up with the bar's contents. */}
      <div className="flex h-12 shrink-0 items-center px-4">
        <Wordmark className="text-xl" />
      </div>
      <nav aria-label="Screens" className="flex flex-col gap-1 p-2">
        {/* One button per screen. `key` lets React tell the items apart between redraws. */}
        {SCREENS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={id === current ? "secondary" : "ghost"}
            // Navigation, not an action: no 1 px press nudge (shadcn's Button default). pl-[7px]
            // + the 1 px border puts the icons 16 px from the edge, like the logo and profile.
            className="justify-start has-data-[icon=inline-start]:pl-[7px] active:not-aria-[haspopup]:translate-y-0"
            // Tells screen readers (and tests) which entry is open.
            aria-current={id === current ? "page" : undefined}
            onClick={() => onSelect(id)}
          >
            <Icon data-icon="inline-start" />
            {label}
            {notices[id] !== undefined && (
              <>
                <span aria-hidden className="ml-auto size-2 rounded-full bg-primary" />
                <span className="sr-only"> ({notices[id]})</span>
              </>
            )}
          </Button>
        ))}
      </nav>
      {/* mt-auto: all free space goes above it, so it sits at the bottom. */}
      <div className="mt-auto border-t p-2">{footer}</div>
    </aside>
  );
}
