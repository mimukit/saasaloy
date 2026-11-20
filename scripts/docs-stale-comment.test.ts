// Tests for the stale-docs comment (plan 0114, Phase 5): the three cases the pull request
// shows, plus a check that `site.yml` wires the check the way the plan says.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { buildComment, LABEL, MARKER } from "./docs-stale-comment.ts";
import type { Report } from "./docs-stale.ts";
import { handWritten, readWikimap } from "./docs-wikimap.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const STALE: Report = {
  base: "origin/main",
  pages: [
    {
      path: "how-to/add-a-module.md",
      title: "Add a module",
      stamp: undefined,
      note: undefined,
      commits: [{ sha: "abc1234", subject: "feat(cli): change add" }],
    },
  ],
};
const NONE: Report = { base: "origin/main", pages: [] };

describe("buildComment", () => {
  it("names a stale page and its commits, and starts with the marker", () => {
    const body = buildComment(STALE, false);
    assert.equal(body.split("\n")[0], MARKER);
    assert.match(
      body,
      /`docs\/wiki\/how-to\/add-a-module\.md` \(Add a module\)/
    );
    assert.match(body, /`abc1234` feat\(cli\): change add/);
    assert.match(body, /add the `docs: none` label/);
  });

  it("says no page needs a look when none is stale", () => {
    const body = buildComment(NONE, false);
    assert.equal(body.split("\n")[0], MARKER);
    assert.match(body, /^No page covers a file/m);
    assert.doesNotMatch(body, /docs\/wiki/);
  });

  it("says the pull request needs no docs change under the label", () => {
    const body = buildComment(STALE, true);
    assert.equal(body.split("\n")[0], MARKER);
    assert.match(
      body,
      /has the `docs: none` label, so it needs no docs change/
    );
    assert.match(body, /would list 1 page/);
    assert.doesNotMatch(body, /add-a-module/);
    assert.equal(LABEL, "docs: none");
  });

  it("keeps the label text and drops the count when nothing is stale", () => {
    const body = buildComment(NONE, true);
    assert.match(body, /needs no docs change/);
    assert.doesNotMatch(body, /would list/);
  });

  it("caps the commits of one page", () => {
    const commits = Array.from({ length: 8 }, (_, index) => ({
      sha: `c${index}`,
      subject: "x",
    }));
    const body = buildComment(
      { base: "b", pages: [{ ...STALE.pages[0]!, commits }] },
      false
    );
    assert.match(body, /and 3 more/);
  });
});

describe("the site workflow", () => {
  const text = readFileSync(join(ROOT, ".github/workflows/site.yml"), "utf-8");
  const workflow = parse(text) as {
    on: { pull_request: { paths: string[]; types?: string[] } };
    jobs: { site?: { permissions?: Record<string, string> } };
  };

  it("runs on every path a hand-written page covers", () => {
    const paths = workflow.on.pull_request.paths;
    const covers = (pattern: string, glob: string): boolean =>
      pattern.endsWith("/**")
        ? glob.startsWith(pattern.slice(0, -2))
        : pattern === glob;
    const missing = handWritten(readWikimap(ROOT)).flatMap((page) =>
      page.documents.filter((glob) => !paths.some((p) => covers(p, glob)))
    );
    assert.deepEqual([...new Set(missing)], []);
  });

  it("gives the job pull-requests write and runs when a label changes", () => {
    assert.equal(workflow.jobs.site?.permissions?.["pull-requests"], "write");
    assert.ok(workflow.on.pull_request.types?.includes("labeled"));
    assert.ok(workflow.on.pull_request.types?.includes("unlabeled"));
  });

  it("builds the comment with the script and finds it by the marker", () => {
    assert.match(text, /docs-stale-comment\.ts/);
    assert.ok(text.includes(MARKER));
  });
});
