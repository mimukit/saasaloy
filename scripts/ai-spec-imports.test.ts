// The `ai` core may name the `LanguageModelV4` spec, and it may not load it (plan 0128).
// `@ai-sdk/provider` is a type-only dependency of `packages/ai`: a value import would make
// the vendor-blind core and every provider load a vendor package at runtime. This test
// fails on any value import of it in what a project receives: the base template and the
// payload of every `ai*` module, test files included, so a test cannot model the habit.
// The AI SDK runtime itself (`ai`, `@ai-sdk/react`) belongs to the `ai-sdk` driver alone.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SPEC = String.raw`["']@ai-sdk/provider(?:/[^"']*)?["']`;
const SOURCE = /\.(?:[cm]?[jt]s|tsx|jsx)$/;

/** One problem per value import of the spec package, as `line: statement`. */
function valueImports(text: string): string[] {
  const source = withoutComments(text);
  const problems: string[] = [];
  const statements = new RegExp(
    String.raw`^[ \t]*(import|export)\s+([^;]*?)\s*from\s*${SPEC}`,
    "gm"
  );
  for (const match of source.matchAll(statements)) {
    const clause = (match[2] ?? "").trim();
    if (!typeOnly(clause)) {
      problems.push(statement(source, match.index, match[0]));
    }
  }
  const bare = new RegExp(
    String.raw`^[ \t]*import\s*${SPEC}|\bimport\s*\(\s*${SPEC}|\brequire\s*\(\s*${SPEC}`,
    "gm"
  );
  for (const match of source.matchAll(bare)) {
    problems.push(statement(source, match.index, match[0]));
  }
  return problems;
}

/**
 * The source with each comment blanked and its line breaks kept, so a comment that names
 * the package is not read as an import and a reported line number stays true.
 */
function withoutComments(source: string): string {
  const blank = (comment: string) => comment.replaceAll(/[^\n]/g, " ");
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, blank)
    .replaceAll(
      /(^|[^:"'`\\])(\/\/[^\n]*)/g,
      (_match, before: string, comment: string) => `${before}${blank(comment)}`
    );
}

/** `type X`, `type { A }`, or `{ type A, type B }`: nothing in it is loaded at runtime. */
function typeOnly(clause: string): boolean {
  if (/^type\b/.test(clause)) {
    return true;
  }
  const braces = /^\{([^}]*)\}$/.exec(clause);
  if (!braces) {
    return false;
  }
  const names = (braces[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return names.length > 0 && names.every((name) => /^type\s/.test(name));
}

function statement(source: string, index: number, text: string): string {
  const line = source.slice(0, index).split("\n").length;
  return `${line}: ${text.replaceAll(/\s+/g, " ")}`;
}

/** Every source file under `dir`, skipping installed packages. */
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        found.push(...sourceFiles(path));
      }
    } else if (SOURCE.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

function shippedRoots(): string[] {
  const modules = join(ROOT, "modules");
  return [
    join(ROOT, "packages/cli/templates/base"),
    ...readdirSync(modules)
      .filter((name) => name === "ai" || name.startsWith("ai-"))
      .map((name) => join(modules, name, "files")),
  ];
}

describe("the value-import checker", () => {
  it("accepts a type import, a type export and inline type names", () => {
    assert.deepEqual(
      valueImports(
        [
          `import type { LanguageModelV4 } from "@ai-sdk/provider";`,
          `import type * as Spec from '@ai-sdk/provider';`,
          `import { type LanguageModelV4, type SharedV4Warning } from "@ai-sdk/provider";`,
          `export type { LanguageModelV4 } from "@ai-sdk/provider";`,
          `import { APICallError } from "@ai-sdk/provider-utils";`,
        ].join("\n")
      ),
      []
    );
  });

  it("rejects a value import, a mixed import, a re-export and a side-effect import", () => {
    const problems = valueImports(
      [
        `import { APICallError } from "@ai-sdk/provider";`,
        `import { type LanguageModelV4, APICallError } from "@ai-sdk/provider";`,
        `import * as spec from "@ai-sdk/provider";`,
        `export { APICallError } from "@ai-sdk/provider";`,
        `export * from "@ai-sdk/provider";`,
        `import "@ai-sdk/provider";`,
        `const spec = await import("@ai-sdk/provider");`,
      ].join("\n")
    );
    assert.deepEqual(
      problems.map((problem) => problem.split(":")[0]),
      ["1", "2", "3", "4", "5", "6", "7"]
    );
  });

  it("ignores a comment that names the package", () => {
    assert.deepEqual(
      valueImports(
        `// A type import only: a value import from "@ai-sdk/provider" loads it.\n/* import { A } from "@ai-sdk/provider" */`
      ),
      []
    );
  });

  it("reads an import clause that spans lines", () => {
    assert.deepEqual(
      valueImports(
        `import {\n  type A,\n  type B,\n} from "@ai-sdk/provider";`
      ),
      []
    );
    assert.equal(
      valueImports(`import {\n  type A,\n  B,\n} from "@ai-sdk/provider";`)
        .length,
      1
    );
  });
});

describe("what a project receives imports @ai-sdk/provider as types only", () => {
  const files = shippedRoots().flatMap(sourceFiles);

  it("finds the ai core's sources and the provider tests", () => {
    for (const path of [
      "modules/ai/files/src/provider.ts",
      "modules/ai-mock/files/mock.test.ts",
    ]) {
      assert.ok(
        files.some((file) => file.endsWith(join(path))),
        `${path} was not scanned`
      );
    }
  });

  it("holds no value import of @ai-sdk/provider", () => {
    const problems = files.flatMap((file) =>
      valueImports(readFileSync(file, "utf-8")).map(
        (problem) => `${relative(ROOT, file)}:${problem}`
      )
    );
    assert.deepEqual(problems, []);
  });
});

/** One problem per import of the AI SDK runtime (`ai`, `ai/*`, `@ai-sdk/react`), types included. */
function runtimeImports(text: string): string[] {
  const source = withoutComments(text);
  const name = String.raw`["'](?:ai(?:/[^"']*)?|@ai-sdk/react)["']`;
  const pattern = new RegExp(
    String.raw`^[ \t]*(?:import|export)\s+[^;]*?\s*from\s*${name}|^[ \t]*import\s*${name}|\bimport\s*\(\s*${name}|\brequire\s*\(\s*${name}`,
    "gm"
  );
  return [...source.matchAll(pattern)].map((match) =>
    statement(source, match.index, match[0])
  );
}

describe("only the ai-sdk driver imports the AI SDK runtime", () => {
  it("reads a value import, a type import and a subpath, and skips look-alikes", () => {
    const problems = runtimeImports(
      [
        `import { streamText } from "ai";`,
        `import type { UIMessage } from 'ai';`,
        `import { MockLanguageModelV4 } from "ai/test";`,
        `import { useChat } from "@ai-sdk/react";`,
        `import { x } from "aim";`,
        `import { y } from "@repo/ai";`,
        `// import { z } from "ai";`,
      ].join("\n")
    );
    assert.deepEqual(
      problems.map((problem) => problem.split(":")[0]),
      ["1", "2", "3", "4"]
    );
  });

  it("holds no import of ai or @ai-sdk/react outside modules/ai-sdk", () => {
    const driver = join(ROOT, "modules/ai-sdk");
    const problems = shippedRoots()
      .filter((root) => !root.startsWith(driver))
      .flatMap(sourceFiles)
      .flatMap((file) =>
        runtimeImports(readFileSync(file, "utf-8")).map(
          (problem) => `${relative(ROOT, file)}:${problem}`
        )
      );
    assert.deepEqual(problems, []);
  });
});
