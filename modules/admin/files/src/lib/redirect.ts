// Where a visitor lands when there is nothing to return to, or when what was asked for
// cannot be trusted.
export const DEFAULT_DESTINATION = "/";

const LOGIN_PATH = "/login";

const SPACE = 0x20;
const DELETE = 0x7f;
const BACKSLASH = "\\";

// A destination arrives from the address bar, so it is attacker input on every request.
// This rejects anything a browser might read as an origin, an authority, or a scheme:
//
//   //evil.example        protocol-relative; the browser fills the current scheme in
//   /\evil.example        some browsers normalise the backslash and do the same
//   https://evil.example  an absolute url carrying its own scheme
//
// A control character or a space closes the same door from the other side. A url parser
// strips those out, so a tab wedged after the leading slash would be read as the
// protocol-relative form the caller already rejects.
function hasUnsafeCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= SPACE || code === DELETE || character === BACKSLASH) {
      return true;
    }
  }
  return false;
}

/**
 * Narrows a raw search-param value to a path on this origin, keeping its search and hash.
 * Returns `undefined` for anything else. This is the shape check only; it says nothing
 * about whether the path names a real route.
 */
export function toInternalPath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }
  if (hasUnsafeCharacter(value)) {
    return undefined;
  }
  return value;
}

/**
 * Turns the `redirect` search param the login screen was handed into the path to navigate
 * to after a successful sign-in.
 *
 * A destination has to clear two gates. `toInternalPath` keeps it on this origin, and
 * `isKnownRoute` — the router's own route-tree lookup — keeps it on a route this app
 * actually has. Either failure falls back to `/` rather than raising: the visitor is
 * signed in by then, and a stale bookmark is no reason to show them a wall.
 *
 * `isKnownRoute` is a parameter rather than a router import, so this stays a pure function
 * the repo can test without standing a router up.
 */
export function resolveDestination(
  value: unknown,
  isKnownRoute: (pathname: string) => boolean
): string {
  const path = toInternalPath(value);
  if (!path) {
    return DEFAULT_DESTINATION;
  }

  // Match on the pathname alone; the route tree knows nothing about a query or a fragment.
  const pathname = path.split(/[?#]/)[0] ?? path;

  // Bouncing back to /login would loop: the root guard redirects a signed-in admin
  // straight off it again.
  if (pathname === LOGIN_PATH || !isKnownRoute(pathname)) {
    return DEFAULT_DESTINATION;
  }

  return path;
}
