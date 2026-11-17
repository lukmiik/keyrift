/**
 * The bar above the page (spec §7.1): the open profile's undo/redo and save status on the left,
 * the engine's live state on the right, passed in as `children` (like a default slot in Vue). The
 * profile selector is at the bottom of the sidebar.
 */
import type { ReactNode } from "react";

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    // Tailwind: each class is one small piece of CSS, e.g. `flex` = display: flex,
    // `gap-3` = 0.75rem between children, `border-b` = a bottom border.
    // pl-2.5: the undo button's icon sits 6 px inside it, so its icon is 16 px from the edge,
    // like the switch on the right (pr-4) and the sidebar's contents.
    <header className="flex h-12 shrink-0 items-center gap-3 border-b pr-4 pl-2.5">
      {children}
    </header>
  );
}
