import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every shared primitive the site renders has an `@source` line in globals.css.
//
// packages/ui/src/styles/globals.css names the primitives it scans one file at a time, to
// keep primitives only an admin screen uses out of the landing stylesheet. A missing line
// fails silently: the classes never reach the CSS and the component renders unstyled. This
// test makes it fail loudly instead. It follows imports from the site's pages and from the
// shared blocks and containers, then from each primitive into the primitives it imports.
//
// A primitive only one app renders belongs in that app's own theme file, not here, so the
// test reads only what globals.css scans: src/blocks/, src/containers/ and apps/web/src/.

const root = new URL("../../../../", import.meta.url);
const ui = new URL("packages/ui/src/", root);
const ROOTS = [
  new URL("blocks/", ui),
  new URL("containers/", ui),
  new URL("apps/web/src/", root),
];
// `@repo/ui/components/button` or `../components/button`, a primitive at the top of
// components/. A nested path such as `components/shell/x` belongs to another theme file.
const IMPORT =
  /from\s+["'](?:@repo\/ui\/|\.\.?\/(?:\.\.\/)*)components\/([a-z0-9-]+)["']/g;
const SIBLING = /from\s+["']\.\/([a-z0-9-]+)["']/g;

function sourceFiles(dir: URL): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .filter(
      (file) => /\.(tsx?|astro)$/.test(file) && !file.endsWith(".test.ts")
    )
    .map((file) => readFileSync(new URL(file, dir), "utf-8"));
}

function rendered(): Set<string> {
  const names = new Set<string>();
  const queue = ROOTS.flatMap(sourceFiles).flatMap((text) =>
    [...text.matchAll(IMPORT)].map((match) => match[1] ?? "")
  );
  while (queue.length > 0) {
    const name = queue.pop() ?? "";
    const file = new URL(`components/${name}.tsx`, ui);
    if (names.has(name) || !existsSync(file)) {
      continue;
    }
    names.add(name);
    const text = readFileSync(file, "utf-8");
    for (const match of [...text.matchAll(IMPORT), ...text.matchAll(SIBLING)]) {
      queue.push(match[1] ?? "");
    }
  }
  return names;
}

function listed(): Set<string> {
  const css = readFileSync(new URL("styles/globals.css", ui), "utf-8");
  return new Set(
    [...css.matchAll(/@source\s+"\.\.\/components\/([a-z0-9-]+)\.tsx"/g)].map(
      (match) => match[1] ?? ""
    )
  );
}

describe("globals.css", () => {
  it("scans every primitive the site renders", () => {
    const have = listed();
    const missing = [...rendered()]
      .filter((name) => !have.has(name))
      .toSorted();
    expect(
      missing,
      `Add to packages/ui/src/styles/globals.css: ${missing
        .map((name) => `@source "../components/${name}.tsx";`)
        .join(" ")}`
    ).toStrictEqual([]);
  });
});
