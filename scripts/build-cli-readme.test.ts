// Tests for `scripts/build-cli-readme.ts`. The script itself is a read, a rewrite and a
// write; only the rewrite is worth pinning, and it is worth pinning precisely.
//
// A relative link that survives the copy does not fail loudly. npm resolves it against
// `repository.directory`, so `LICENSE.md` becomes a packages/cli/LICENSE.md that does not
// exist, and the npm page carries a dead link nobody clicks until a user does.
//
// It runs on `node:test` under Node's type stripping, like the other maintainer-script
// suites. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { absolutizeLinks, isAbsoluteTarget } from "./build-cli-readme.ts";

describe("isAbsoluteTarget", () => {
  it("accepts a full URL", () => {
    assert.equal(isAbsoluteTarget("https://ui.shadcn.com/"), true);
  });

  it("accepts an anchor, a protocol-relative URL and a mailto", () => {
    assert.equal(isAbsoluteTarget("#modules"), true);
    assert.equal(isAbsoluteTarget("//example.com/x"), true);
    assert.equal(isAbsoluteTarget("mailto:me@example.com"), true);
  });

  it("rejects a repo-relative path", () => {
    assert.equal(isAbsoluteTarget("LICENSE.md"), false);
    assert.equal(isAbsoluteTarget("docs/wiki/index.md"), false);
    assert.equal(isAbsoluteTarget("./docs/wiki/index.md"), false);
  });
});

describe("absolutizeLinks", () => {
  it("rewrites a repo-relative link to a blob URL", () => {
    assert.equal(
      absolutizeLinks("see [the docs](docs/wiki/index.md)."),
      "see [the docs](https://github.com/mimukit/saasaloy/blob/main/docs/wiki/index.md)."
    );
  });

  it("drops a leading ./ rather than doubling it into the URL", () => {
    assert.equal(
      absolutizeLinks("[license](./LICENSE.md)"),
      "[license](https://github.com/mimukit/saasaloy/blob/main/LICENSE.md)"
    );
  });

  it("leaves an absolute link untouched", () => {
    const line =
      "[shadcn](https://ui.shadcn.com/) and [#14](https://github.com/mimukit/saasaloy/issues/14)";
    assert.equal(absolutizeLinks(line), line);
  });

  it("keeps a link title", () => {
    assert.equal(
      absolutizeLinks('[license](LICENSE.md "MIT")'),
      '[license](https://github.com/mimukit/saasaloy/blob/main/LICENSE.md "MIT")'
    );
  });

  // The root README's install block holds `npm install -g saasaloy`, and a rewriter that
  // reached into fenced code would corrupt a command the reader is meant to paste.
  it("does not touch text that is not an inline link", () => {
    const fence = "```bash\nnpm install -g saasaloy\n```";
    assert.equal(absolutizeLinks(fence), fence);
  });
});
