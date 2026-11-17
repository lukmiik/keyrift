/**
 * A quiet status: a small coloured dot and muted text, e.g. "● Active". Used where a filled pill
 * would draw too much attention, like one status per device row.
 */
import { cn } from "cn";
import type { ComponentProps } from "react";

export type StatusTone = "good" | "off" | "waiting" | "problem";

const DOT: Record<StatusTone, string> = {
  good: "bg-emerald-500",
  off: "bg-muted-foreground/40",
  waiting: "bg-amber-500",
  problem: "bg-destructive",
};

export function StatusDot({
  tone,
  label,
  detail,
  className,
  ...rest
}: {
  tone: StatusTone;
  label: string;
  /** Shown as a tooltip. */
  detail?: string | undefined;
} & Omit<ComponentProps<"span">, "children">) {
  return (
    <span
      // Other span attributes pass through, e.g. role="status" for the header's engine state.
      {...rest}
      title={detail}
      data-tone={tone}
      className={cn(
        "flex items-center gap-1.5 text-sm whitespace-nowrap",
        tone === "problem" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
      {label}
    </span>
  );
}
