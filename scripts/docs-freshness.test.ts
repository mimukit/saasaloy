// Tests for `scripts/docs-freshness.ts` (plan 0114, Phase 5): the stamp reader, both modes
// against a throwaway git repository, and the guarantee that a generated page is never
// listed.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { findStale, formatReport, repoGit, stampOf } from "./docs-freshness.ts";
import type { WikiPage } from "./docs-wikimap.ts";

describe("stampOf", () => {
  it("reads the sha of the stamp line", () => {
    assert.equal(
      stampOf("Text.\n\n_Verified against `main`@`42cbf03` on 2026-09-11._\n"),
      "42cbf03"
    );
  });

  it("returns undefined for a page with no stamp", () => {
    assert.equal(stampOf("# Page\n\nNothing here.\n"), undefined);
  });
});

describe("findStale", () => {
  let dir: string;
  let stamp: string;
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (message: string): void => {
    git("add", "-A");
    git("commit", "--quiet", "-m", message);
  };
  const pages: WikiPage[] = [
    {
      path: "how-to/add.md",
      title: "Add",
      generated: false,
      documents: ["src/commands/add.ts", "modules/*/item.json"],
    },
    {
      path: "how-to/remove.md",
      title: "Remove",
      generated: false,
      documents: ["src/commands/remove.ts"],
    },
    {
      path: "generated/cli.md",
      title: "CLI",
      generated: true,
      documents: ["src/commands/**"],
    },
  ];
  const read = (path: string): string => {
    if (path === "how-to/add.md") {
      return `Text.\n\n_Verified against \`main\`@\`${stamp}\` on 2026-09-11._\n`;
    }
    return "No stamp here.\n";
  };

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "saasaloy-docs-freshness-"));
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    write("src/commands/add.ts", "1");
    write("src/commands/remove.ts", "1");
    write("docs/wiki/how-to/add.md", "page");
    commit("chore: start");
    stamp = git("rev-parse", "--short", "HEAD");
    git("branch", "base");
    write("src/commands/add.ts", "2");
    commit("feat(cli): change add");
    write("modules/email/item.json", "{}");
    commit("feat(email): add the module");
    write("src/commands/add.ts", "3");
    commit("chore(release): v1.2.3");
    write("src/commands/remove.ts", "2");
    write("docs/wiki/how-to/remove.md", "page");
    commit("fix(cli): change remove and its page");
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists commits after the stamp that touched a covered path", () => {
    const report = findStale({ pages, read, git: repoGit(dir) });
    const add = report.pages.find((page) => page.path === "how-to/add.md");
    assert.deepEqual(
      add?.commits.map((entry) => entry.subject),
      ["feat(email): add the module", "feat(cli): change add"]
    );
    assert.equal(add?.stamp, stamp);
  });

  it("skips a release commit, which only bumps versions", () => {
    const report = findStale({ pages, read, git: repoGit(dir) });
    const add = report.pages.find((page) => page.path === "how-to/add.md");
    assert.ok(
      add?.commits.every((entry) => !entry.subject.startsWith("chore(release)"))
    );
  });

  it("lists a page with no stamp, with a note and no commits", () => {
    const report = findStale({ pages, read, git: repoGit(dir) });
    const remove = report.pages.find(
      (page) => page.path === "how-to/remove.md"
    );
    assert.equal(remove?.note, "the page has no stamp");
    assert.deepEqual(remove?.commits, []);
  });

  it("never lists a generated page", () => {
    const report = findStale({ pages, read, git: repoGit(dir) });
    assert.equal(
      report.pages.some((page) => page.path.startsWith("generated/")),
      false
    );
  });

  it("notes a stamp commit that git does not know", () => {
    const report = findStale({
      pages: [pages[0]!],
      read: () => "_Verified against `main`@`deadbee` on 2026-09-11._\n",
      git: repoGit(dir),
    });
    assert.match(report.pages[0]?.note ?? "", /deadbee is unknown/);
  });

  it("with a base, lists the pages whose covered paths changed and that stay unchanged", () => {
    const report = findStale({ pages, read, git: repoGit(dir), base: "base" });
    assert.deepEqual(
      report.pages.map((page) => page.path),
      ["how-to/add.md"]
    );
    assert.equal(report.pages[0]?.commits.length, 2);
  });

  it("with a base, says so when no page is stale", () => {
    const report = findStale({
      pages: [pages[1]!],
      read,
      git: repoGit(dir),
      base: "base",
    });
    assert.deepEqual(report.pages, []);
    assert.match(formatReport(report), /no page covers a file/);
  });
});
