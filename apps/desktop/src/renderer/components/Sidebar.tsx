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

import { Button } from "@/components/ui/button.tsx";

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
};

export function Sidebar({ current, onSelect }: SidebarProps) {
  return (
    <nav aria-label="Screens" className="flex w-48 shrink-0 flex-col gap-1 border-r p-2">
      {/* One button per screen. `key` lets React tell the items apart between redraws. */}
      {SCREENS.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          variant={id === current ? "secondary" : "ghost"}
          className="justify-start"
          // Tells screen readers (and tests) which entry is open.
          aria-current={id === current ? "page" : undefined}
          onClick={() => onSelect(id)}
        >
          <Icon data-icon="inline-start" />
          {label}
        </Button>
      ))}
    </nav>
  );
}
