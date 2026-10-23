import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isRefusal } from "./exit.js";
import { emptyManifest } from "./manifest.js";
import type { Manifest } from "./manifest.js";
import { baseTemplateDir } from "./scaffold.js";
import { validateSaasaloyConfig } from "./schema.js";
import type { SaasaloyConfig } from "./schema.js";
import {
  TESTING_BLOCK_END,
  TESTING_BLOCK_START,
  TESTING_BLOCKS,
  TESTING_MODES,
  parseTestingMode,
  readTestingMode,
  rewriteTestingBlock,
  suggestsTestingMode,
} from "./testing.js";

// #242 Phase 1: one testing mode per project, held in `saasaloy.json` and mirrored into a
// marked block in the root `AGENTS.md`. These cover the pure half: the schema, the parser,
// the absent-key default, the block rewrite and the `update` suggestion predicate.

const BASE_CONFIG: SaasaloyConfig = {
  aliases: { "@web": "apps/web/src" },
  installed: [],
};

describe("saasaloy.json — the testing key (#242)", () => {
  it.each(TESTING_MODES)("accepts testing.mode %s", async (mode) => {
    const result = await validateSaasaloyConfig({
      ...BASE_CONFIG,
      testing: { mode },
    });

    expect(result.errors).toStrictEqual([]);
  });

  it("rejects a mode it does not know", async () => {
    const result = await validateSaasaloyConfig({
      ...BASE_CONFIG,
      testing: { mode: "always" },
    });

    expect(result.valid).toBeFalsy();
  });

  it("rejects an unknown key inside testing", async () => {
    const result = await validateSaasaloyConfig({
      ...BASE_CONFIG,
      testing: { mode: "off", e2e: true },
    });

    expect(result.valid).toBeFalsy();
  });

  it("still accepts a config with no testing key", async () => {
    const result = await validateSaasaloyConfig(BASE_CONFIG);

    expect(result.valid).toBeTruthy();
  });
});

describe(readTestingMode, () => {
  it("reads an absent key as off", () => {
    expect(readTestingMode(BASE_CONFIG)).toBe("off");
  });

  it("reads the recorded mode", () => {
    expect(readTestingMode({ ...BASE_CONFIG, testing: { mode: "tdd" } })).toBe(
      "tdd"
    );
  });
});

describe(parseTestingMode, () => {
  it.each(TESTING_MODES)("returns %s unchanged", (mode) => {
    expect(parseTestingMode(mode)).toBe(mode);
  });

  it("refuses a bad value, naming the three it takes", () => {
    let caught: unknown;
    try {
      parseTestingMode("bogus");
    } catch (error) {
      caught = error;
    }

    expect(isRefusal(caught)).toBeTruthy();
    expect((caught as Error).message).toContain('"bogus"');
    expect((caught as Error).message).toContain("off, tests-after, tdd");
  });
});

describe("the three block texts", () => {
  it("off names the command that turns tests on", () => {
    expect(TESTING_BLOCKS.off).toContain("saasaloy testing tests-after");
  });

  it("tests-after points at the saasaloy-testing skill", () => {
    expect(TESTING_BLOCKS["tests-after"]).toContain("saasaloy-testing");
  });

  it("tdd states the loop, failure before code", () => {
    const text = TESTING_BLOCKS.tdd;
    const fail = text.indexOf("fail");
    const code = text.indexOf("Write the code");

    expect(fail).toBeGreaterThan(-1);
    expect(code).toBeGreaterThan(fail);
    expect(text).toContain("pass");
  });
});

describe(rewriteTestingBlock, () => {
  const doc = [
    "# app",
    "",
    "## Testing Instructions",
    "",
    TESTING_BLOCK_START,
    "old text",
    TESTING_BLOCK_END,
    "",
    "- Run the tests",
    "",
  ].join("\n");

  it("replaces only the text between the markers", () => {
    const result = rewriteTestingBlock(doc, "tdd");

    expect(result.found).toBeTruthy();
    const content = result.found ? result.content : "";
    expect(content).toBe(doc.replace("old text", TESTING_BLOCKS.tdd.trimEnd()));
  });

  it("is idempotent", () => {
    const once = rewriteTestingBlock(doc, "tests-after");
    const twice = rewriteTestingBlock(
      once.found ? once.content : "",
      "tests-after"
    );

    expect(twice).toStrictEqual(once);
  });

  it("reports missing markers rather than throwing", () => {
    expect(rewriteTestingBlock("# app\n", "tdd")).toStrictEqual({
      found: false,
    });
  });

  it("reports an end marker that comes before the start as missing", () => {
    const swapped = `${TESTING_BLOCK_END}\nx\n${TESTING_BLOCK_START}\n`;

    expect(rewriteTestingBlock(swapped, "tdd")).toStrictEqual({ found: false });
  });

  it("the template AGENTS.md ships the markers holding the off text", async () => {
    const template = await readFile(
      join(await baseTemplateDir(), "AGENTS.md"),
      "utf-8"
    );
    const rewritten = rewriteTestingBlock(template, "off");

    expect(rewritten).toStrictEqual({ found: true, content: template });
  });
});

describe("suggestsTestingMode — the update hint (#242)", () => {
  function manifestWith(entries: Manifest["managed"]): Manifest {
    return { ...emptyManifest(), managed: entries };
  }

  const shipped = manifestWith({
    "apps/api/src/routes/auth.test.ts": { hash: "a", module: "auth" },
  });

  it("suggests when the key is absent and a module owns a test file", () => {
    expect(suggestsTestingMode(BASE_CONFIG, shipped)).toBeTruthy();
  });

  it("says nothing once the key is present, even at off", () => {
    expect(
      suggestsTestingMode({ ...BASE_CONFIG, testing: { mode: "off" } }, shipped)
    ).toBeFalsy();
  });

  it("ignores the base's own tests", () => {
    const base = manifestWith({
      "packages/env/src/env.test.ts": { hash: "a", module: "base" },
    });

    expect(suggestsTestingMode(BASE_CONFIG, base)).toBeFalsy();
  });

  it("says nothing when no module ships a test", () => {
    const plain = manifestWith({
      "apps/api/src/routes/auth.ts": { hash: "a", module: "auth" },
    });

    expect(suggestsTestingMode(BASE_CONFIG, plain)).toBeFalsy();
  });
});
