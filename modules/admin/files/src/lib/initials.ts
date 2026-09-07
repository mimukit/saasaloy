// The avatar fallback, in one place. Two surfaces need it — the rail's account avatar and
// the first cell of the users table — and a second copy is a second answer the day someone
// changes one of them.

/**
 * Up to two initials for an avatar, falling back to `?` for an unnameable account.
 *
 * Runs of whitespace collapse, so a padded or double-spaced name gives the same answer as
 * a clean one. A name with no word characters at all (better-auth allows an empty `name`)
 * gives `?` rather than an empty circle.
 */
export function initialsOf(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "?";
}
