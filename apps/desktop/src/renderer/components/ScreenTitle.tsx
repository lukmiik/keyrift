/**
 * The screen's heading, for screen readers only: the sidebar already shows which screen is open, so
 * a visible title would repeat it. `sr-only` hides an element visually but keeps it in the
 * accessibility tree.
 */
export function ScreenTitle({ title }: { title: string }) {
  return <h1 className="sr-only">{title}</h1>;
}
