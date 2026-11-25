import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CODE_PATHS, CONTENT_PATHS, isUnder } from "./site-content.ts";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(webRoot, "../..");

/** One path outside apps/web that a source line names, repo-relative. */
interface Read {
  file: string;
  line: number;
  path: string;
}

const RELATIVE_LITERAL = /(["'`])(\.\.?\/[^"'`\s]*)\1/g;
// Astro's glob loader resolves `base` against the project root, not against the file.
const BASE_OPTION = /\bbase:\s*$/;
// `repoRoot` in astro.config.mjs and the remark plugins is the repo root, so its joins
// name repo-relative paths.
const ROOT_JOIN = /\b(?:join|resolve)\(\s*repoRoot\s*,\s*(["'`])([^"'`]+)\1/g;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/** The reads outside apps/web that `source`, the text of `file`, names. */
function readsOf(source: string, file: string): Read[] {
  const reads: Read[] = [];
  const shown = toPosix(relative(repoRoot, file));
  for (const [index, text] of source.split("\n").entries()) {
    if (COMMENT_LINE.test(text)) {
      continue;
    }
    for (const match of text.matchAll(RELATIVE_LITERAL)) {
      const literal = (match[2] as string).replace(/\?.*$/, "");
      const before = text.slice(0, match.index);
      const base = BASE_OPTION.test(before) ? webRoot : dirname(file);
      const target = resolve(base, literal);
      const fromWeb = relative(webRoot, target);
      if (fromWeb !== ".." && !fromWeb.startsWith(`..${sep}`)) {
        continue;
      }
      const path = toPosix(relative(repoRoot, target));
      // The repo root itself is an anchor for the joins below, not a read.
      if (path !== "") {
        reads.push({ file: shown, line: index + 1, path });
      }
    }
    for (const match of text.matchAll(ROOT_JOIN)) {
      const path = posix.normalize(match[2] as string).replace(/\/$/, "");
      reads.push({ file: shown, line: index + 1, path });
    }
  }
  return reads;
}

const SOURCE = /\.(?:ts|tsx|astro|mjs|js|css|mdx)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return SOURCE.test(entry.name) && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

function siteReads(): Read[] {
  return [
    ...sourceFiles(join(webRoot, "src")),
    join(webRoot, "astro.config.mjs"),
  ].flatMap((file) => readsOf(readFileSync(file, "utf-8"), file));
}

function uncovered(reads: readonly Read[]): Read[] {
  return reads.filter(
    (read) =>
      !isUnder(read.path, CONTENT_PATHS) && !isUnder(read.path, CODE_PATHS)
  );
}

describe("site content paths", () => {
  it("names every path outside apps/web that the site reads", () => {
    const missing = uncovered(siteReads());
    assert.deepEqual(
      missing,
      [],
      `The site reads paths that neither CONTENT_PATHS nor CODE_PATHS in scripts/site-content.ts names:\n${missing
        .map((read) => `  ${read.file}:${read.line} reads ${read.path}`)
        .join("\n")}`
    );
  });

  it("finds the reads the site makes today", () => {
    const paths = new Set(siteReads().map((read) => read.path));
    for (const path of [
      "llms.txt",
      "docs/wiki",
      "docs/wiki/.wikimap.yaml",
      "modules",
      "modules/*/registry-item.json",
      "packages/cli/package.json",
    ]) {
      assert.ok(paths.has(path), `the scan missed ${path}`);
    }
  });

  it("reports a read that no list names", () => {
    const file = join(webRoot, "src/pages/llms.txt.ts");
    const reads = readsOf('import x from "../../../../README.md?raw";', file);
    assert.deepEqual(uncovered(reads), [
      { file: "apps/web/src/pages/llms.txt.ts", line: 1, path: "README.md" },
    ]);
  });

  it("resolves an Astro base option against the web app", () => {
    const file = join(webRoot, "src/content.config.ts");
    assert.deepEqual(
      readsOf('    base: "../../docs/adr",', file).map((read) => read.path),
      ["docs/adr"]
    );
  });

  it("skips comment lines and paths inside apps/web", () => {
    const file = join(webRoot, "src/lib/x.ts");
    const source = [
      "// a link such as `../../../../CONTEXT.md`",
      'import y from "../content/landing.ts";',
    ].join("\n");
    assert.deepEqual(readsOf(source, file), []);
  });
});
