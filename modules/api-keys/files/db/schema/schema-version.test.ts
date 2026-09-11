// Guards the one rule each `api_keys` schema variant's header states about itself: the
// snapshot is hand-authored against a named `@better-auth/api-key` version, so a bump
// that skips the re-verification has to fail something. This is the twin of
// `modules/auth/files/src/schema-version.test.ts`, and it exists for the same reason.
//
// It is NOT in the descriptor's `files` list, so `add api-keys` never copies it into a
// user's project. It runs here only, under `pnpm test:modules`.
//
// The pinned version does not live in a `package.json` this repo ships. `packages/auth`
// exists only inside a scaffolded project, and the dependency lands there through this
// module's `package-json-dependency` patch. So the descriptor's patch `range` is the
// source of truth, and that is what the header is checked against.
//
// It reads the schema files as text rather than importing them. Both variants import
// `drizzle-orm`, which this repo's root `node_modules` does not carry, so an import would
// fail before an assertion ran. Text is also the honest medium: the claim under test is a
// sentence in a comment, not a value the module exports.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8");

const PACKAGE = "@better-auth/api-key";

interface Descriptor {
  patches?: {
    kind?: string;
    name?: string;
    range?: string;
  }[];
}

const descriptor: Descriptor = JSON.parse(read("../../../registry-item.json"));
const pinned = descriptor.patches?.find(
  (patch) => patch.kind === "package-json-dependency" && patch.name === PACKAGE
)?.range;

const VARIANTS = [
  { dialect: "sqlite", path: "./api-keys.sqlite.ts" },
  { dialect: "postgres", path: "./api-keys.pg.ts" },
];

// This file runs on `node:test`, whose `describe` carries no `.each`. The rule below
// reads the call as vitest's and is wrong here.
// oxlint-disable-next-line vitest/prefer-each
for (const variant of VARIANTS) {
  const schemaSource = read(variant.path);

  describe(`the ${variant.dialect} api_keys schema snapshot header`, () => {
    it("names an @better-auth/api-key version in the form the test can read", () => {
      // The header writes `@better-auth/api-key@1.7.2`. Reword the sentence freely; keep
      // that token, or this test goes quiet instead of going red.
      assert.match(
        schemaSource,
        /@better-auth\/api-key@\d+\.\d+\.\d+/,
        "the snapshot header must state the @better-auth/api-key version it was verified against"
      );
    });

    it("matches the version the descriptor patches in", () => {
      const header = /@better-auth\/api-key@(\d+\.\d+\.\d+)/.exec(
        schemaSource
      )?.[1];

      assert.equal(
        header,
        pinned,
        `the snapshot says it was verified against @better-auth/api-key@${header}, but registry-item.json patches in ${pinned}. Re-verify every column against the pinned version's apiKeySchema() and its Drizzle type mapping, fix any column that moved, then update the header.`
      );
    });

    it("states no second, stale version anywhere in the file", () => {
      // A bump that edits the first mention and leaves an older one further down would
      // pass the check above while still lying. Every mention has to agree.
      const mentions = [
        ...schemaSource.matchAll(/@better-auth\/api-key@(\d+\.\d+\.\d+)/g),
      ].map((match) => match[1]);

      assert.equal(
        new Set(mentions).size,
        1,
        `the header mentions more than one @better-auth/api-key version: ${mentions.join(", ")}`
      );
    });
  });
}
