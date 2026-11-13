// The rule a notification's `href` follows, in a file of its own with no imports, so a
// plain `node --test` can check it and `notify` and any later caller share one answer.
//
// A row's link opens inside `apps/app`, so it has to be an app-relative path. A full URL
// would let a caller that copies text from a user into `href` send another user to any
// site, and a link that starts with `//` is a full URL to the browser, protocol-relative.
// A backslash is refused for the same reason: some browsers read `/\evil.example` as
// `//evil.example`.

/** Whether `href` is an app-relative path: starts with `/`, not `//`, and has no `\`. */
export function isAppPath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.includes("\\");
}
