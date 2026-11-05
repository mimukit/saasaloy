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
// Graphemes, not UTF-16 code units: `"🦊"[0]` is half a surrogate pair and renders as
// "�", and an accent typed as a combining mark is a second code unit of one letter.
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), (part) => part.segment);
}

export function initialsOf(name: string): string {
  const initials = graphemes(
    name
      .trim()
      .split(/\s+/)
      .map((part) => graphemes(part)[0] ?? "")
      .join("")
      // Uppercase BEFORE slicing. `toUpperCase` can expand one character into two —
      // "ß" becomes "SS" — so slicing first would return three characters and break the
      // two-initial contract the avatar circle is sized for.
      .toUpperCase()
  )
    .slice(0, 2)
    .join("");

  return initials || "?";
}
