// Guards the rule that a block paints with semantic tokens only (plan 0128, the "UI house
// rules" row). A block in `packages/ui/src/blocks/` can render in any app, so a colour it
// names must come from the theme every app loads, never from a palette step or a literal.
//
// It reads every block file as text, from the base template and from each module's
// `files/ui/blocks/`, and checks four things:
//
//   - no Tailwind palette step (`bg-emerald-500`), which ignores the theme and dark mode;
//   - no colour literal in an arbitrary value (`bg-[#fff]`, `text-[oklch(0.5_0_0)]`);
//   - no colour literal in a string at all (`"#0f172a"`, `"rgb(0 0 0)"`);
//   - a block reads no token that only a module stylesheet declares, because the web app
//     loads the base theme alone. A module that reaches `shell`, `app` or `admin` through
//     `dependsOn` renders inside a shell-wearing app, so its blocks may read those tokens.
//
// Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULES = join(ROOT, "modules");
const BASE_UI = join(
  ROOT,
  "packages",
  "cli",
  "templates",
  "base",
  "packages",
  "ui",
  "src"
);
const BASE_BLOCKS = join(BASE_UI, "blocks");
const BASE_THEME_FILES = ["globals.css", "web.css", "brand.css"]
  .map((file) => join(BASE_UI, "styles", file))
  .filter((file) => existsSync(file));

const SHELL_APPS = new Set(["shell", "app", "admin"]);

// The sign-in blocks render only on app and admin pages, which load shell.css, but the
// auth modules cannot depend on those apps, because both apps depend on auth.
const SHELL_RENDERED = new Set(["auth", "auth-phone"]);

function dependsOnOf(name: string): string[] {
  const path = join(MODULES, name, "registry-item.json");
  if (!existsSync(path)) {
    return [];
  }
  const descriptor = JSON.parse(readFileSync(path, "utf-8")) as {
    dependsOn?: string[];
  };
  return descriptor.dependsOn ?? [];
}

/** Whether a module's blocks render only inside an app that loads the shell stylesheet. */
export function rendersInShell(name: string): boolean {
  if (SHELL_RENDERED.has(name)) {
    return true;
  }
  const seen = new Set<string>();
  const stack = [name];
  while (stack.length > 0) {
    const next = stack.pop() ?? "";
    if (SHELL_APPS.has(next)) {
      return true;
    }
    if (!seen.has(next)) {
      seen.add(next);
      stack.push(...dependsOnOf(next));
    }
  }
  return false;
}

/** The module that ships a block file, or `undefined` for a base block. */
function moduleOf(file: string): string | undefined {
  const rel = relative(MODULES, file);
  return rel.startsWith("..") ? undefined : rel.split(/[\\/]/)[0];
}

const PALETTE =
  /(?<![\w-])(?:[\w-]+:)*(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow|inset-ring|inset-shadow)-((?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/g;
const COLOUR_UTILITY =
  /(?<![\w-])(?:[\w-]+:)*(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow|inset-ring|inset-shadow)-([a-z][a-z0-9-]*)/g;
const ARBITRARY_COLOUR =
  /-\[(?:#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\()/g;
const STRING_COLOUR =
  /["'`]\s*(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab)\([^)]*\))\s*["'`]/g;
const VAR_REFERENCE = /var\(--([a-z][a-z0-9-]*)/g;

function stylesheet(path: string): string {
  return readFileSync(path, "utf-8").replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

/** Every custom property a stylesheet declares, without the leading `--`. */
function declared(path: string): Set<string> {
  return new Set(
    [...stylesheet(path).matchAll(/(?:^|[\s;{])--([a-z][a-z0-9-]*)\s*:/g)].map(
      (match) => match[1] ?? ""
    )
  );
}

/** A `--color-<name>` declaration also makes `<name>` a utility suffix. */
function withUtilityNames(names: Iterable<string>): Set<string> {
  const out = new Set(names);
  for (const name of out) {
    if (name.startsWith("color-")) {
      out.add(name.slice("color-".length));
    }
  }
  return out;
}

function moduleStylesheets(): string[] {
  return readdirSync(MODULES).flatMap((name) => {
    const dir = join(MODULES, name, "files", "ui", "styles");
    return existsSync(dir)
      ? readdirSync(dir)
          .filter((file) => file.endsWith(".css"))
          .map((file) => join(dir, file))
      : [];
  });
}

function tsxUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => join(dir, file));
}

export function blockFiles(): string[] {
  const moduleBlocks = readdirSync(MODULES).flatMap((name) => {
    const dir = join(MODULES, name, "files", "ui", "blocks");
    return existsSync(dir) ? tsxUnder(dir) : [];
  });
  return [...tsxUnder(BASE_BLOCKS), ...moduleBlocks];
}

const baseTokens = withUtilityNames(
  BASE_THEME_FILES.flatMap((file) => [...declared(file)])
);
const moduleOnly = new Set(
  [
    ...withUtilityNames(moduleStylesheets().flatMap((f) => [...declared(f)])),
  ].filter((name) => !baseTokens.has(name))
);

/** Each finding in one block's source, as `name (why)`. */
export function findingsIn(source: string, moduleThemed: boolean): string[] {
  const out: string[] = [];
  for (const [, name = ""] of source.matchAll(PALETTE)) {
    out.push(`${name} (a palette step, not a semantic token)`);
  }
  for (const [match] of source.matchAll(ARBITRARY_COLOUR)) {
    out.push(`${match} (a colour literal in an arbitrary value)`);
  }
  for (const [match] of source.matchAll(STRING_COLOUR)) {
    out.push(`${match.trim()} (a colour literal)`);
  }
  if (!moduleThemed) {
    for (const [, name = ""] of source.matchAll(COLOUR_UTILITY)) {
      if (moduleOnly.has(name)) {
        out.push(`${name} (declared only in a module stylesheet)`);
      }
    }
    for (const [, name = ""] of source.matchAll(VAR_REFERENCE)) {
      if (moduleOnly.has(name)) {
        out.push(`var(--${name}) (declared only in a module stylesheet)`);
      }
    }
  }
  return out;
}

function findings(): string[] {
  return blockFiles().flatMap((file) => {
    const where = relative(ROOT, file);
    const owner = moduleOf(file);
    return findingsIn(
      readFileSync(file, "utf-8"),
      owner !== undefined && rendersInShell(owner)
    ).map((finding) => `${where}: ${finding}`);
  });
}

describe("every block reads semantic tokens only", () => {
  it("finds the base theme, a module stylesheet and the blocks", () => {
    assert.ok(
      BASE_THEME_FILES.some((file) => file.endsWith("brand.css")),
      "no brand.css"
    );
    assert.ok(
      moduleOnly.has("success"),
      "shell.css no longer declares success"
    );
    const files = new Set(blockFiles().map((file) => relative(ROOT, file)));
    assert.ok(files.has("modules/ai/files/ui/blocks/ai-chat.tsx"));
    assert.ok(files.has("modules/waitlist/files/ui/blocks/waitlist.tsx"));
  });

  it("flags a palette step, a colour literal and a module-only token", () => {
    assert.deepEqual(findingsIn(`className="bg-emerald-500"`, false), [
      "emerald-500 (a palette step, not a semantic token)",
    ]);
    assert.deepEqual(findingsIn(`className="dark:text-[#fff]"`, false), [
      "-[# (a colour literal in an arbitrary value)",
    ]);
    assert.deepEqual(findingsIn(`style={{ color: "oklch(0.5 0 0)" }}`, false), [
      `"oklch(0.5 0 0)" (a colour literal)`,
    ]);
    assert.deepEqual(findingsIn(`className="text-success"`, false), [
      "success (declared only in a module stylesheet)",
    ]);
    assert.deepEqual(findingsIn(`className="text-success"`, true), []);
  });

  it("lets only a shell-rendered module read a module-only token", () => {
    assert.equal(rendersInShell("notification"), true);
    assert.equal(rendersInShell("auth"), true);
    assert.equal(rendersInShell("ai"), false);
    assert.equal(rendersInShell("waitlist"), false);
  });

  it("passes the semantic tokens of the base theme", () => {
    assert.deepEqual(
      findingsIn(
        `className="bg-muted text-muted-foreground border-border ring-foreground/10 bg-warning/10 text-destructive"`,
        false
      ),
      []
    );
  });

  it("reads only semantic tokens in every block file", () => {
    assert.deepEqual(findings(), []);
  });
});
