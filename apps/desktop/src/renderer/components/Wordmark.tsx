/**
 * The app's name as its logo: "Keyrift" sliced through the middle, the lower half slipped sideways
 * in sky blue (the colour of a remapped key on the Keymap screen). What you type comes out shifted.
 * Text and CSS only, so it stays sharp at any size; the font size sets everything else (em units).
 */
import { cn } from "cn";

export function Wordmark({ className }: { className?: string }) {
  return (
    // One name for screen readers and tests; the two drawn copies are hidden from them.
    <span
      role="img"
      aria-label="Keyrift"
      className={cn(
        "relative inline-block leading-none font-extrabold tracking-[-0.03em] whitespace-nowrap",
        className,
      )}
    >
      {/* Top half: the copy cut off below 58 % of its height. */}
      <span aria-hidden className="block [clip-path:inset(0_0_42%_0)]">
        Keyrift
      </span>
      {/* Bottom half: a copy on top of the first, cut off above 58 %, moved right. */}
      <span
        aria-hidden
        className="absolute inset-0 translate-x-[0.09em] text-sky-500 dark:text-sky-400 [clip-path:inset(58%_0_0_0)]"
      >
        Keyrift
      </span>
    </span>
  );
}
