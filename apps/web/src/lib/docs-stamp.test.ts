import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stampOf } from "./docs-stamp.ts";
import { remarkDropStamp } from "./docs-title.ts";

const LINE = "_Verified against `main`@`42cbf03` on 2026-09-11._";

describe("stampOf", () => {
  it("reads the sha and the date", () => {
    assert.deepEqual(stampOf(`Text.\n\n${LINE}\n`), {
      sha: "42cbf03",
      date: "2026-09-11",
    });
  });

  it("returns undefined without a stamp line", () => {
    assert.equal(stampOf("# Page\n\nVerified against nothing.\n"), undefined);
  });

  it("ignores a stamp that sits inside running text", () => {
    assert.equal(stampOf(`Quote: ${LINE} and more.\n`), undefined);
  });
});

describe("remarkDropStamp", () => {
  const stamp = {
    type: "paragraph",
    children: [
      {
        type: "emphasis",
        children: [
          { type: "text", value: "Verified against " },
          { type: "inlineCode", value: "main" },
          { type: "text", value: "@" },
          { type: "inlineCode", value: "42cbf03" },
          { type: "text", value: " on 2026-09-11." },
        ],
      },
    ],
  };
  const prose = {
    type: "paragraph",
    children: [{ type: "text", value: "Body." }],
  };

  it("drops the stamp paragraph and keeps the rest", () => {
    const tree = { type: "root", children: [prose, stamp] };
    remarkDropStamp()(tree);
    assert.deepEqual(tree.children, [prose]);
  });

  it("leaves a page with no stamp alone", () => {
    const tree = { type: "root", children: [prose] };
    remarkDropStamp()(tree);
    assert.deepEqual(tree.children, [prose]);
  });
});
