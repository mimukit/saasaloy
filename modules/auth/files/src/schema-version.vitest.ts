// Guards the one rule each schema variant's header states about itself: the snapshot
// is hand-authored against a named `better-auth` version, so a bump that skips the
// re-verification has to fail something.
//
// It never ships: it reads both dialect variants, and a project holds only one, so the
// descriptor lists no entry for it. In the saasaloy repo
// `pnpm test:modules` runs it in place on Vitest.
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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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

describe.each(VARIANTS)(
  "the $dialect auth schema snapshot header",
  (variant) => {
    const schemaSource = read(variant.path);

    it("names a better-auth version in the form the test can read", () => {
      // The header writes `better-auth@1.7.2`. Reword the sentence freely; keep that
      // token, or this test goes quiet instead of going red.
      expect(
        schemaSource,
        "the snapshot header must state the better-auth version it was verified against"
      ).toMatch(/better-auth@\d+\.\d+\.\d+/);
    });

    it("matches the version package.json pins", () => {
      const header = /better-auth@(\d+\.\d+\.\d+)/.exec(schemaSource)?.[1];
      const pinned = packageJson.dependencies?.["better-auth"];

      expect(
        header,
        `the snapshot says it was verified against better-auth@${header}, but package.json pins ${pinned}. Re-verify the four tables against the pinned version's getAuthTables() and its Drizzle SQLite type mapping, fix any column that moved, then update the header.`
      ).toBe(pinned);
    });

    it("states no second, stale version anywhere in the file", () => {
      // A bump that edits the first mention and leaves an older one further down would
      // pass the check above while still lying. Every mention has to agree.
      const mentions = [
        ...schemaSource.matchAll(/better-auth@(\d+\.\d+\.\d+)/g),
      ].map((match) => match[1]);

      expect(
        new Set(mentions).size,
        `the header mentions more than one better-auth version: ${mentions.join(", ")}`
      ).toBe(1);
    });
  }
);
