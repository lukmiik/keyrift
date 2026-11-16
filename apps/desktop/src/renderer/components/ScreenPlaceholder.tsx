/**
 * Stand-in for a screen that isn't built yet: its title and when it arrives.
 */
import type { ReactNode } from "react";

type ScreenPlaceholderProps = {
  title: string;
  /** When the screen is built: an M4 plan step (e.g. "step 9") or a later milestone ("M5"). */
  comesIn: string;
  /** Anything to show already, below the note. */
  children?: ReactNode;
};

export function ScreenPlaceholder({ title, comesIn, children }: ScreenPlaceholderProps) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">This screen comes in {comesIn}.</p>
      {children}
    </section>
  );
}
