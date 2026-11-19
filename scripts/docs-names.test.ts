// Tests for `scripts/docs-names.ts` (plan 0114, Phase 5). The first block runs the check over
// the repo's own hand-written pages, which is how `pnpm test:scripts` catches a page that
// names a command, flag, module or env var the code no longer has. The second block pins
// each rule on small strings.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { nameProblems, wikiProblems } from "./docs-names.ts";
import type { Names } from "./docs-names.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const NAMES: Names = {
  surface: {
    commands: new Map([
      ["add", new Set(["-y", "--yes", "--with"])],
      ["list", new Set<string>()],
    ]),
    globalFlags: new Set(["-h", "--help"]),
  },
  skills: new Set(["saasaloy-env"]),
  modules: new Set(["email", "email-plunk"]),
  tokens: new Set(["SAASALOY_DEBUG", "--migrate"]),
};

describe("the hand-written wiki pages", () => {
  it("name only commands, flags, modules and env vars that exist", () => {
    const found = [...wikiProblems(ROOT)].map(
      ([file, problems]) => `${file}: ${problems.join("; ")}`
    );
    assert.deepEqual(found, []);
  });
});

describe("nameProblems", () => {
  it("accepts a real command, flag, module and env var", () => {
    const page = [
      "Run `saasaloy add email-plunk --yes`, then set `SAASALOY_DEBUG`.",
      "The `--migrate` flag and the `modules/email/` folder exist.",
    ].join("\n");
    assert.deepEqual(nameProblems(page, NAMES), []);
  });

  it("flags a command that is not in the CLI", () => {
    assert.deepEqual(nameProblems("Run `saasaloy sync`.", NAMES), [
      'the command "saasaloy sync" is not in the CLI',
    ]);
  });

  it("flags a flag the command does not take", () => {
    assert.deepEqual(nameProblems("Run `saasaloy list --yes`.", NAMES), [
      'the flag "--yes" is not a flag of "saasaloy list"',
    ]);
  });

  it("flags a bare flag that no code names", () => {
    assert.deepEqual(nameProblems("Pass `--gone`.", NAMES), [
      'the flag "--gone" is not a flag of any command',
    ]);
  });

  it("flags a module that is not in modules/", () => {
    assert.deepEqual(
      nameProblems(
        "Run `saasaloy add email billing@main`, see `modules/ghost/files`.",
        NAMES
      ),
      [
        'the module "billing" is not in modules/',
        'the module "ghost" is not in modules/',
      ]
    );
  });

  it("flags an env var that no shipped code holds", () => {
    assert.deepEqual(nameProblems("Set `MISSING_VAR`.", NAMES), [
      'the env var "MISSING_VAR" is in no shipped code',
    ]);
  });

  it("ignores a fenced sample and a placeholder", () => {
    const page = "```sh\nsaasaloy sync --gone\n```\n\nSee `saasaloy-<name>`.";
    assert.deepEqual(nameProblems(page, NAMES), []);
  });
});
