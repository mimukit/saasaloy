// Opens every link that leaves the site in a new tab. A block spreads
// `externalLinkProps(href)` onto its anchor and renders `newTabHint(href)` inside it, so
// an href in ../content/landing.ts decides the behaviour: a same-page anchor or a path
// on this site stays in the tab, an absolute URL opens a new one.
//
// The hint is screen-reader text. A sighted visitor sees the new tab open; a screen-reader
// user is told before they follow the link (WCAG technique G201).
//
// A .ts file, not .tsx: `@repo/ui/lib/*` resolves to `src/lib/*.ts`, so this builds the
// element with createElement rather than JSX.

import { createElement } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { ui } from "@repo/ui/content/landing";

/** True for an absolute `http(s)://` or protocol-relative `//` URL. */
export function isExternalHref(href: string): boolean {
  return /^(?:https?:)?\/\//i.test(href);
}

/** `target` and `rel` for an outbound href, nothing for a link that stays on the site. */
export function externalLinkProps(
  href: string
): Pick<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel"> {
  return isExternalHref(href)
    ? { target: "_blank", rel: "noopener noreferrer" }
    : {};
}

/** Screen-reader text announcing the new tab, or nothing for a link that stays. */
export function newTabHint(href: string): ReactNode {
  return isExternalHref(href)
    ? createElement("span", { className: "sr-only" }, ` ${ui.link.newTab}`)
    : null;
}
