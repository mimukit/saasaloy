// Guards the rule that keeps the `shell` module app-neutral (issue #226, plan 0074): a
// file under the shell namespace reads only a token that the base theme or `shell.css`
// defines. `app` renders the shell with the web brand tokens and no admin token file, so a
// shell file that reads a token only `admin.css` declares compiles, lints and then paints
// nothing in `app`: a transparent pill, an unstyled sort header, with no error anywhere.
//
// It reads the files as text and checks three things a shell file can name:
//
//   - a colour utility (`bg-status-open`, `text-success-foreground/80`, `ring-border`);
//   - an `animate-` utility;
//   - a `var(--name)` reference.
//
// A name fails when `admin.css` declares it and neither the base theme nor `shell.css`
// does. A Tailwind palette step (`bg-emerald-500`) fails too, because a shell file reads
// semantic tokens only. Base UI's runtime variables (`--toast-height`, `--anchor-width`)
// are declared by no stylesheet, so the check leaves them alone. Run it with
// `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHELL_UI = join(ROOT, "modules", "shell", "files", "ui");
const BASE_STYLES = join(
  ROOT,
  "packages",
  "cli",
  "templates",
  "base",
  "packages",
  "ui",
  "src",
  "styles"
);
const ADMIN_CSS = join(
  ROOT,
  "modules",
  "admin",
  "files",
  "ui",
  "styles",
  "admin.css"
);
const SHELL_CSS = join(SHELL_UI, "styles", "shell.css");

// The base theme: web.css holds the token block today, and brand.css takes it over when
// the #227 split lands. Read whichever exist, so the test survives the move.
const BASE_THEME_FILES = ["globals.css", "web.css", "brand.css"]
  .map((file) => join(BASE_STYLES, file))
  .filter((file) => existsSync(file));

// Tailwind's own colour keywords, which no stylesheet declares.
const TAILWIND_KEYWORDS = new Set([
  "black",
  "current",
  "inherit",
  "transparent",
  "white",
]);

// Tailwind's built-in animations and tw-animate-css's enter and exit pair.
const BUILT_IN_ANIMATIONS = new Set([
  "bounce",
  "in",
  "none",
  "out",
  "ping",
  "pulse",
  "spin",
]);

const PALETTE =
  /^(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$/;

const COLOUR_UTILITY =
  /(?<![\w-])(?:[\w-]+:)*(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow|inset-ring|inset-shadow)-([a-z][a-z0-9-]*)/g;
const ANIMATE_UTILITY = /(?<![\w-])animate-([a-z][a-z0-9-]*)/g;
const VAR_REFERENCE = /var\(--([a-z][a-z0-9-]*)/g;

/** A stylesheet's text with its comments removed, so an example in a comment counts for nothing. */
function stylesheet(path: string): string {
  return readFileSync(path, "utf-8").replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

/** Every custom property a stylesheet declares, without the leading `--`. */
function declared(path: string): Set<string> {
  const css = stylesheet(path);
  return new Set(
    [...css.matchAll(/(?:^|[\s;{])--([a-z][a-z0-9-]*)\s*:/g)].map(
      (match) => match[1] ?? ""
    )
  );
}

/** A `--color-<name>` declaration also makes `<name>` a utility suffix. */
function withUtilityNames(names: Set<string>): Set<string> {
  const out = new Set(names);
  for (const name of names) {
    if (name.startsWith("color-")) {
      out.add(name.slice("color-".length));
    }
  }
  return out;
}

function shellSourceFiles(): string[] {
  return readdirSync(SHELL_UI, { recursive: true, encoding: "utf-8" })
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"))
    .map((file) => join(SHELL_UI, file));
}

const allowed = withUtilityNames(
  new Set(
    [...BASE_THEME_FILES, SHELL_CSS].flatMap((file) => [...declared(file)])
  )
);
const adminOnly = new Set(
  [...withUtilityNames(declared(ADMIN_CSS))].filter(
    (name) => !allowed.has(name)
  )
);
const shellAnimations = new Set(
  [...declared(SHELL_CSS)]
    .filter((name) => name.startsWith("animate-"))
    .map((name) => name.slice("animate-".length))
);

/** Each finding as `file: name (why)`. */
function findings(): string[] {
  const out: string[] = [];
  for (const file of shellSourceFiles()) {
    const source = readFileSync(file, "utf-8");
    const where = file.slice(ROOT.length);
    for (const [, name = ""] of source.matchAll(COLOUR_UTILITY)) {
      if (PALETTE.test(name)) {
        out.push(`${where}: ${name} (a palette step, not a semantic token)`);
      } else if (adminOnly.has(name) && !TAILWIND_KEYWORDS.has(name)) {
        out.push(`${where}: ${name} (declared only in admin.css)`);
      }
    }
    for (const [, name = ""] of source.matchAll(ANIMATE_UTILITY)) {
      if (!BUILT_IN_ANIMATIONS.has(name) && !shellAnimations.has(name)) {
        out.push(`${where}: animate-${name} (not in shell.css)`);
      }
    }
    for (const [, name = ""] of source.matchAll(VAR_REFERENCE)) {
      if (adminOnly.has(name)) {
        out.push(`${where}: var(--${name}) (declared only in admin.css)`);
      }
    }
  }
  return out;
}

describe("the shell reads no admin-only token", () => {
  it("finds the stylesheets it compares", () => {
    assert.ok(
      BASE_THEME_FILES.some((file) => /(?:web|brand)\.css$/.test(file)),
      "no base theme file"
    );
    assert.ok(existsSync(SHELL_CSS), "no shell.css");
    assert.ok(existsSync(ADMIN_CSS), "no admin.css");
  });

  it("reads only base or shell tokens from every shell file", () => {
    assert.deepEqual(findings(), []);
  });

  it("keeps shell.css free of imports", () => {
    assert.doesNotMatch(stylesheet(SHELL_CSS), /@import\b/);
  });

  it("imports nothing from the admin namespace", () => {
    for (const file of shellSourceFiles()) {
      const source = readFileSync(file, "utf-8");
      assert.doesNotMatch(
        source,
        /@repo\/ui\/(?:components|blocks|containers|lib|styles)\/admin/,
        file
      );
    }
  });
});
