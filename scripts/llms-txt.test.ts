// Checks that every link in the root `llms.txt` resolves to a file in this repo (issue
// #228, plan 0074). `llms.txt` is the first file an agent reads when it wants to build a
// product with Saasaloy, so a dead link there sends the agent nowhere with no error.
//
// A link is either relative to the repo root or a GitHub URL into this repo
// (`https://github.com/mimukit/saasaloy/blob/main/<path>`), which the agent can fetch
// without a clone. Both forms must name a file that exists. Run it with
// `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_URL = "https://github.com/mimukit/saasaloy/";

/** The repo path a link names, or `undefined` for a link that points outside the repo. */
export function repoPath(href: string): string | undefined {
  const target = href.split("#")[0] ?? "";
  if (target.startsWith(REPO_URL)) {
    const match = /^(?:blob|tree)\/[^/]+\/(.+)$/.exec(
      target.slice(REPO_URL.length)
    );
    return match?.[1];
  }
  if (/^[a-z]+:/i.test(target) || target === "") {
    return undefined;
  }
  return target.replace(/^\.\//, "");
}

export function links(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map(
    (match) => match[1] ?? ""
  );
}

describe("the link reader", () => {
  it("maps a GitHub blob URL to a repo path", () => {
    assert.equal(
      repoPath(`${REPO_URL}blob/main/docs/wiki/index.md#top`),
      "docs/wiki/index.md"
    );
  });

  it("keeps a relative path, and ignores an outside URL", () => {
    assert.equal(repoPath("./README.md"), "README.md");
    assert.equal(repoPath("https://example.com/x"), undefined);
  });

  it("finds every Markdown link", () => {
    assert.deepEqual(links("[a](x.md) and [b](https://y.test/z)"), [
      "x.md",
      "https://y.test/z",
    ]);
  });
});

describe("llms.txt", () => {
  const path = join(ROOT, "llms.txt");

  it("exists at the repo root", () => {
    assert.ok(existsSync(path), "llms.txt is missing");
  });

  it("links only to files that exist in this repo", () => {
    const hrefs = links(readFileSync(path, "utf-8"));
    assert.ok(hrefs.length > 0, "llms.txt has no links");
    const broken = hrefs.filter((href) => {
      const target = repoPath(href);
      return target === undefined || !existsSync(join(ROOT, target));
    });
    assert.deepEqual(broken, []);
  });
});
