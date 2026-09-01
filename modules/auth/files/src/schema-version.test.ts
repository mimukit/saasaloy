// Guards the one rule each schema variant's header states about itself: the snapshot
// is hand-authored against a named `better-auth` version, so a bump that skips the
// re-verification has to fail something. This file is NOT in the descriptor's
// `scaffolds[].files` list, so `add auth` never copies it into a user's project — it
// exists for this repo only.
//
// It runs on `node:test`, not on the CLI's vitest instance, for the reason ./env.test.ts
// spells out: the payload's own tsconfig resolves only inside a scaffolded project. Run
// it with `pnpm test:modules`; `pnpm test` runs that after the turbo pass.
//
// It reads the files as text rather than importing them. The schema variants import
// `drizzle-orm`, which this repo's root `node_modules` does not carry, so an import
// would fail before an assertion ran. Text is also the honest medium here: the claim
// under test is a sentence in a comment, not a value the module exports.
//
// Both variants are checked. `add auth` installs only the one matching the project's
// driver (#99), so a bump that re-verified one and forgot the other would ship a stale
// snapshot to half the projects and nothing would say so.
//
// What it cannot do: check a single column. Nothing short of installing better-auth and
// running its generator does that, and that is a job for a person on a bump. The test
// fails the build at the exact moment the header rule asks someone to do that job.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8");

const VARIANTS = [
  { dialect: "sqlite", path: "../db/schema/auth.sqlite.ts" },
  { dialect: "postgres", path: "../db/schema/auth.pg.ts" },
];
const packageJson: { dependencies?: Record<string, string> } = JSON.parse(
  read("../package.json")
);

// This file runs on `node:test`, whose `describe` carries no `.each`. The rule below
// reads the call as vitest's and is wrong here.
// oxlint-disable-next-line vitest/prefer-each
for (const variant of VARIANTS) {
  const schemaSource = read(variant.path);

  describe(`the ${variant.dialect} auth schema snapshot header`, () => {
    it("names a better-auth version in the form the test can read", () => {
      // The header writes `better-auth@1.7.2`. Reword the sentence freely; keep that
      // token, or this test goes quiet instead of going red.
      assert.match(
        schemaSource,
        /better-auth@\d+\.\d+\.\d+/,
        "the snapshot header must state the better-auth version it was verified against"
      );
    });

    it("matches the version package.json pins", () => {
      const header = /better-auth@(\d+\.\d+\.\d+)/.exec(schemaSource)?.[1];
      const pinned = packageJson.dependencies?.["better-auth"];

      assert.equal(
        header,
        pinned,
        `the snapshot says it was verified against better-auth@${header}, but package.json pins ${pinned}. Re-verify the four tables against the pinned version's getAuthTables() and its Drizzle SQLite type mapping, fix any column that moved, then update the header.`
      );
    });

    it("states no second, stale version anywhere in the file", () => {
      // A bump that edits the first mention and leaves an older one further down would
      // pass the check above while still lying. Every mention has to agree.
      const mentions = [
        ...schemaSource.matchAll(/better-auth@(\d+\.\d+\.\d+)/g),
      ].map((match) => match[1]);

      assert.equal(
        new Set(mentions).size,
        1,
        `the header mentions more than one better-auth version: ${mentions.join(", ")}`
      );
    });
  });
}
