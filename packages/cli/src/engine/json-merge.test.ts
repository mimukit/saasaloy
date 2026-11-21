import { describe, expect, it } from "vitest";
import { mergeJson, mergesByKey } from "./json-merge.js";
import { createTextMerger } from "./merge.js";
import type { TextMerger } from "./merge.js";

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** A merger that fails the test if the JSON merge reaches for git. */
const noText: TextMerger = {
  merge() {
    throw new Error("the text merge ran");
  },
};

describe(mergesByKey, () => {
  it("names the four files that merge by key, in any folder", () => {
    expect(mergesByKey("package.json")).toBeTruthy();
    expect(mergesByKey("apps/api/wrangler.jsonc")).toBeTruthy();
    expect(mergesByKey("packages/db/tsconfig.json")).toBeTruthy();
    expect(mergesByKey("turbo.json")).toBeTruthy();
    expect(mergesByKey("saasaloy.json")).toBeTruthy();
    expect(mergesByKey("apps/api/src/data.json")).toBeFalsy();
  });
});

describe(mergeJson, () => {
  const base = json({
    name: "demo",
    scripts: { build: "tsc", dev: "vite", lint: "oxlint" },
    dependencies: { a: "1.0.0" },
  });

  it("takes each side's own keys with no text merge and keeps the project's layout", async () => {
    const mine = json({
      name: "demo",
      scripts: { build: "tsc -b", dev: "vite", lint: "oxlint", mine: "x" },
      dependencies: { a: "1.0.0" },
    });
    const theirs = json({
      name: "demo",
      scripts: { build: "tsc", dev: "vite --host", lint: "oxlint" },
      dependencies: { a: "1.0.0", b: "2.0.0" },
    });
    const out = await mergeJson(
      { base, mine, theirs, version: "1.0.0" },
      noText
    );
    expect(out.conflicts).toBe(0);
    expect(JSON.parse(out.content)).toStrictEqual({
      name: "demo",
      scripts: {
        build: "tsc -b",
        dev: "vite --host",
        lint: "oxlint",
        mine: "x",
      },
      dependencies: { a: "1.0.0", b: "2.0.0" },
    });
  });

  it("drops a key upstream deleted when the project left it alone", async () => {
    const theirs = json({
      name: "demo",
      scripts: { build: "tsc", dev: "vite" },
      dependencies: { a: "1.0.0" },
    });
    const out = await mergeJson(
      { base, mine: base, theirs, version: "1.0.0" },
      noText
    );
    expect(JSON.parse(out.content)).not.toHaveProperty("scripts.lint");
  });

  it("puts markers around a key both sides changed, and only around it", async () => {
    const mine = json({
      name: "demo",
      scripts: { build: "tsc", dev: "vite", lint: "oxlint --mine" },
      dependencies: { a: "1.0.0" },
    });
    const theirs = json({
      name: "demo",
      scripts: { build: "tsc", dev: "vite --host", lint: "oxlint --theirs" },
      dependencies: { a: "1.1.0" },
    });
    const out = await mergeJson(
      { base, mine, theirs, version: "1.0.0" },
      createTextMerger()
    );
    expect(out.conflicts).toBe(1);
    const lines = out.content.split("\n");
    const start = lines.indexOf("<<<<<<< mine");
    const end = lines.findIndex((line) => line.startsWith(">>>>>>> "));
    const region = lines.slice(start, end + 1).join("\n");
    expect(region).toContain('"lint": "oxlint --mine"');
    expect(region).toContain('"lint": "oxlint --theirs"');
    expect(region).not.toContain("dev");
    // The keys that did not conflict are merged outside the markers.
    expect(out.content).toContain('"dev": "vite --host"');
    expect(out.content).toContain('"a": "1.1.0"');
  });

  it("keeps comments in a wrangler.jsonc", async () => {
    const wranglerBase =
      '{\n  // the worker\n  "name": "api",\n  "main": "src/index.ts"\n}\n';
    const mine =
      '{\n  // the worker\n  "name": "api",\n  "main": "src/index.ts",\n  "vars": {}\n}\n';
    const theirs =
      '{\n  // the worker\n  "name": "api",\n  "main": "src/worker.ts"\n}\n';
    const out = await mergeJson(
      {
        base: wranglerBase,
        mine,
        path: "wrangler.jsonc",
        theirs,
        version: "1.0.0",
      },
      noText
    );
    expect(out.content).toContain("// the worker");
    expect(out.content).toContain('"main": "src/worker.ts"');
    expect(out.content).toContain('"vars": {}');
  });

  it("falls back to the text merge when a side does not parse", async () => {
    const out = await mergeJson(
      { base, mine: "{ not json", theirs: base, version: "1.0.0" },
      createTextMerger()
    );
    expect(out.content).toBe("{ not json");
  });
});
