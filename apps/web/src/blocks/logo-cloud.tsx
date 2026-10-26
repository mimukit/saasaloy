import type { ReactNode } from "react";

import { landing, ui } from "@web/content/landing";

// Fully static: an endless slider in CSS (the `marquee` utility in ../styles/web.css),
// so the block ships no JavaScript. Under reduced motion the row stops, wraps and drops
// its duplicate copy.
//
// ADDING A REAL LOGO. Content names a mark (`landing.logos.items[].mark`) and this file
// draws it, the same way feature icons work. Paste the customer's SVG into LOGO_MARKS
// under a kebab-case key, set its `viewBox` and keep `fill="currentColor"` on the paths so
// it follows the theme, then put that key in the item's `mark`:
//
//   const LOGO_MARKS = {
//     "northwind": (
//       <svg viewBox="0 0 120 28" fill="currentColor" aria-hidden="true">…</svg>
//     ),
//   };
//
// A mark the registry doesn't know, the empty string included, renders the item's `name`
// as a text wordmark. That is what the default row does: the real stack, by name, with no
// third-party artwork in the template.
//
// The two marks below are token-drawn placeholders, kept as a worked example of the
// shape. Delete them once a real logo is in.

const LOGO_MARKS: Record<string, ReactNode> = {
  "placeholder-circle": (
    <svg viewBox="0 0 120 28" fill="currentColor" aria-hidden="true">
      <circle cx="14" cy="14" r="10" />
      <rect x="34" y="9" width="70" height="10" rx="5" opacity="0.6" />
    </svg>
  ),
  "placeholder-square": (
    <svg viewBox="0 0 120 28" fill="currentColor" aria-hidden="true">
      <rect x="4" y="4" width="20" height="20" rx="5" />
      <rect x="34" y="9" width="56" height="10" rx="5" opacity="0.6" />
    </svg>
  ),
};

export interface LogoItem {
  /** Stable key, never the array position (see the content file). */
  id: string;
  /** The accessible name, and the wordmark when `mark` is not in the registry. */
  name: string;
  mark: string;
}

export interface LogoCloudProps {
  id?: string;
  label?: string;
  items?: LogoItem[];
}

function Logo({ item }: { item: LogoItem }) {
  const mark = Object.hasOwn(LOGO_MARKS, item.mark)
    ? LOGO_MARKS[item.mark]
    : undefined;
  if (mark !== undefined) {
    return (
      <span
        role="img"
        aria-label={item.name}
        className="block h-6 [&_svg]:h-full [&_svg]:w-auto"
      >
        {mark}
      </span>
    );
  }
  return (
    <span className="text-lg font-semibold tracking-tight whitespace-nowrap">
      {item.name}
    </span>
  );
}

export function LogoCloud({
  id = "logos",
  label = landing.logos.label,
  items = landing.logos.items,
}: LogoCloudProps) {
  return (
    <section id={id} className="section-container py-12 md:py-16">
      <div className="grid items-center gap-5 md:grid-cols-[13rem_1fr]">
        <p className="text-muted-foreground text-center text-sm text-balance md:border-r md:pr-6 md:text-right">
          {label}
        </p>
        <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)] motion-reduce:[mask-image:none]">
          <div className="marquee text-muted-foreground flex w-max items-center gap-12 [--marquee-gap:3rem] motion-reduce:w-full">
            <ul
              aria-label={ui.logos.listLabel}
              className="flex shrink-0 items-center gap-12 motion-reduce:w-full motion-reduce:shrink motion-reduce:flex-wrap motion-reduce:justify-center motion-reduce:gap-x-8 motion-reduce:gap-y-4"
            >
              {items.map((item) => (
                <li key={item.id}>
                  <Logo item={item} />
                </li>
              ))}
            </ul>
            {/* The second copy makes the loop seamless. Screen readers skip it, and
                reduced motion removes it. */}
            <ul
              aria-hidden="true"
              className="flex shrink-0 items-center gap-12 motion-reduce:hidden"
            >
              {items.map((item) => (
                <li key={item.id}>
                  <Logo item={item} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
