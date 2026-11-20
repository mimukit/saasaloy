// Tests for the GitHub Release body: the changelog stays first, the npm line names the
// released version, and `.release-it.js` hands the function to `github.releaseNotes`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NPM_PACKAGE_URL, npmLine, releaseNotes } from "./release-notes.ts";

describe("releaseNotes", () => {
  it("keeps the changelog first and appends the npm line", () => {
    const body = releaseNotes({
      changelog: "## 1.2.3\n\n* a fix\n\n",
      version: "1.2.3",
    });
    assert.equal(body, `## 1.2.3\n\n* a fix\n\n---\n\n${npmLine("1.2.3")}\n`);
  });

  it("links the npm page of the released version", () => {
    const line = npmLine("1.2.3");
    assert.ok(line.includes(`${NPM_PACKAGE_URL}/v/1.2.3`));
    assert.ok(line.includes("`npx saasaloy@1.2.3 init`"));
  });

  it("returns the npm line alone when the changelog is empty", () => {
    assert.equal(
      releaseNotes({ changelog: "", version: "1.2.3" }),
      `${npmLine("1.2.3")}\n`
    );
    assert.equal(releaseNotes({ version: "1.2.3" }), `${npmLine("1.2.3")}\n`);
  });
});

describe(".release-it.js", () => {
  it("passes releaseNotes to github.releaseNotes", async () => {
    const { default: config } = await import("../packages/cli/.release-it.js");
    assert.equal(config.github.releaseNotes, releaseNotes);
  });
});
