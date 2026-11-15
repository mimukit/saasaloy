// The one link rule of the CMS. The editor's Link extension and the renderer both call
// `isSafeHref`, so a body written straight to the api, past the editor, still cannot carry a
// `javascript:` link onto the public site.
//
// The rule is an allowlist: `http`, `https`, `mailto`, `tel`, and a relative URL. Anything
// else with a scheme is refused, whatever the scheme is.

/** The schemes a stored link may use. Everything else is dropped. */
export const ALLOWED_SCHEMES: readonly string[] = [
  "http",
  "https",
  "mailto",
  "tel",
];

// A browser ignores ASCII tabs, newlines and other control characters inside a URL, so
// `java\tscript:` runs as `javascript:`. Strip them before reading the scheme.
// oxlint-disable-next-line no-control-regex -- the control characters are the point
const IGNORED = /[\u0000- \u007F]/g;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * True when `href` may be stored and rendered as a link.
 *
 * A relative URL (`/blog/x`, `#intro`, `?page=2`, `about`) passes. A protocol-relative URL
 * (`//host`) is refused: it points at another host with no scheme to check.
 */
export function isSafeHref(href: string | null | undefined): boolean {
  if (typeof href !== "string") {
    return false;
  }
  const value = href.replace(IGNORED, "");
  if (value.length === 0) {
    return false;
  }
  // Two leading slashes of either kind: a browser reads `/\host` and `\/host` as `//host`.
  if (/^[/\\]{2}/.test(value) || value.startsWith("\\")) {
    return false;
  }
  const scheme = SCHEME.exec(value);
  if (!scheme) {
    return true;
  }
  return ALLOWED_SCHEMES.includes((scheme[1] ?? "").toLowerCase());
}
