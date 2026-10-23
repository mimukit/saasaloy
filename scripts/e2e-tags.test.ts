// Guards the `e2e` module's tag vocabulary.
//
// A Playwright spec in `modules/e2e/files/specs/` declares the modules it needs as tags —
// `test.describe("admin login", { tag: ["@admin", "@auth"] }, …)` — and the suite's
// `playwright.config.ts` turns every tag whose module is absent into `grepInvert`, so that
// spec is never collected in a project that does not have it.
//
// That mechanism fails silently in one direction. A tag naming no module is a tag that is
// never in `installed`, so its spec is uncollected in EVERY project: the flow stops running
// and the suite still reports green. A module rename does exactly that. This test is where
// it goes red instead.
//
// Two assertions, and both are needed. `SPEC_TAGS` in `lib/project.ts` is what the config
// reads, and every name in it must be a real directory under `modules/`. Every tag a spec
// actually writes must be in `SPEC_TAGS`, because a tag the list does not carry gates
// nothing and the spec runs everywhere.
//
// It reads the files as text: the suite's own sources import `@playwright/test`, which this
// repo's root `node_modules` does not carry. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULES = join(ROOT, "modules");
const E2E = join(MODULES, "e2e", "files");
const SPECS = join(E2E, "specs");

/** Every name in `SPEC_TAGS`, read out of `lib/project.ts` as text. */
export function declaredTags(source: string): string[] {
  const match = /export const SPEC_TAGS = \[([^\]]*)\]/.exec(source);
  assert.ok(
    match?.[1] !== undefined,
    "lib/project.ts exports no SPEC_TAGS array."
  );
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]!);
}

/** Every tag written in a spec's `test.describe(..., { tag: [...] }, ...)` calls. */
export function usedTags(source: string): string[] {
  return [...source.matchAll(/tag:\s*\[([^\]]*)\]/g)].flatMap((call) =>
    [...(call[1] ?? "").matchAll(/"@([^"]+)"/g)].map((entry) => entry[1]!)
  );
}

function specSources(): { file: string; source: string }[] {
  return readdirSync(SPECS)
    .filter((file) => file.endsWith(".spec.ts"))
    .map((file) => ({
      file,
      source: readFileSync(join(SPECS, file), "utf-8"),
    }));
}

describe("e2e tag vocabulary", () => {
  const tags = declaredTags(
    readFileSync(join(E2E, "lib", "project.ts"), "utf-8")
  );

  it("declares at least one tag", () => {
    assert.ok(tags.length > 0, "SPEC_TAGS is empty, so no spec can be gated.");
  });

  it("names a real module for every declared tag", () => {
    for (const tag of tags) {
      assert.ok(
        existsSync(join(MODULES, tag)),
        `SPEC_TAGS holds "${tag}", but modules/${tag} does not exist. A tag that names no module gates every project, so its spec never runs.`
      );
    }
  });

  it("declares every tag the specs actually use", () => {
    for (const { file, source } of specSources()) {
      for (const tag of usedTags(source)) {
        assert.ok(
          tags.includes(tag),
          `specs/${file} uses "@${tag}", which SPEC_TAGS does not declare. An undeclared tag gates nothing, so the spec runs in a project without the module.`
        );
      }
    }
  });

  it("finds a spec for the tags it declares", () => {
    const used = new Set(
      specSources().flatMap(({ source }) => usedTags(source))
    );
    assert.ok(
      used.size > 0,
      "No spec declares a tag. Every spec must name the modules it needs."
    );
  });
});
