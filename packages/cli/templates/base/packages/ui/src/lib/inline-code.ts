// Renders a content message that quotes code. A pair of backticks inside a message
// (`saasaloy add`) becomes a <code> element, so the copy in ../content/landing.ts stays a
// plain string a translator can read, and a block never splits a sentence around a
// command by hand.
//
// A .ts file, not .tsx: `@repo/ui/lib/*` resolves to `src/lib/*.ts`, so this builds the
// elements with createElement rather than JSX.

import { createElement } from "react";
import type { ReactNode } from "react";

const CODE_CLASS =
  "bg-muted text-foreground rounded-md border px-1.5 py-0.5 font-mono text-[0.85em]";

/**
 * Split `message` on backtick pairs and wrap every odd part in <code>. An unmatched
 * backtick is left as written — a visible stray backtick is a bug you can see.
 */
export function inlineCode(message: string): ReactNode[] {
  const parts = message.split("`");
  if (parts.length % 2 === 0) {
    return [message];
  }
  return parts.map((part, index) =>
    index % 2 === 1
      ? createElement("code", { key: index, className: CODE_CLASS }, part)
      : part
  );
}
