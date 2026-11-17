/**
 * Turns a name people type into a short id for files and references: lower case, letters and
 * digits joined by dashes. "Żółw & co" → "zolw-co", "Workspaces & Polish" → "workspaces-polish".
 * Returns `fallback` when nothing is left (e.g. "!!!").
 */
export function slugify(name: string, fallback: string): string {
  return (
    name
      .toLowerCase()
      // "ó" → "o" + an accent mark, then drop the marks. "ł" has no such split, so by hand.
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/ł/g, "l")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || fallback
  );
}
