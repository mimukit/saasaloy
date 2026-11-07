// Tests for the decisions the cms repository makes, kept free of Drizzle so they run under
// `pnpm test:modules` (this repo's root carries no drizzle-orm). Repo-only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertDeletable,
  canonicalJson,
  CmsRepositoryError,
  hasUnpublishedEdits,
  pageWindow,
  publishedAtFor,
  REVISION_LIMIT,
  redirectSlugFor,
  revisionsToPrune,
} from "./cms-rules.ts";

function revisions(count: number) {
  // Newest first is not assumed: the input is shuffled by id order, oldest id first.
  return Array.from({ length: count }, (_, i) => ({
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
    id: `r${String(i).padStart(3, "0")}`,
  }));
}

describe("revisionsToPrune", () => {
  it("keeps the newest 50 and prunes the rest", () => {
    assert.equal(REVISION_LIMIT, 50);
    const pruned = revisionsToPrune(revisions(53), null);
    assert.deepEqual(pruned, ["r000", "r001", "r002"]);
  });

  it("prunes nothing at or under the limit", () => {
    assert.deepEqual(revisionsToPrune(revisions(50), null), []);
  });

  it("never prunes the live revision, however old", () => {
    const pruned = revisionsToPrune(revisions(53), "r001");
    assert.deepEqual(pruned, ["r000", "r002"]);
  });

  it("orders by createdAt, not by input order", () => {
    const shuffled = revisions(52).toReversed();
    assert.deepEqual(revisionsToPrune(shuffled, null), ["r000", "r001"]);
  });
});

describe("canonicalJson", () => {
  it("ignores key order, which Postgres jsonb does not keep", () => {
    assert.equal(
      canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }),
      canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 })
    );
  });

  it("tells different values apart", () => {
    assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
  });
});

describe("hasUnpublishedEdits", () => {
  const live = { data: { body: { type: "doc" } }, slug: "a", title: "A" };

  it("is false for a published entry equal to its live revision", () => {
    assert.equal(
      hasUnpublishedEdits({ status: "published", ...live }, live),
      false
    );
  });

  it("is true when the title, the slug or the data differ", () => {
    for (const change of [
      { title: "B" },
      { slug: "b" },
      { data: { body: { type: "doc", content: [] } } },
    ]) {
      assert.equal(
        hasUnpublishedEdits({ status: "published", ...live, ...change }, live),
        true,
        JSON.stringify(change)
      );
    }
  });

  it("is false for a draft or an archived entry", () => {
    assert.equal(
      hasUnpublishedEdits({ status: "draft", ...live, title: "B" }, null),
      false
    );
    assert.equal(
      hasUnpublishedEdits({ status: "archived", ...live, title: "B" }, null),
      false
    );
  });
});

describe("publishedAtFor", () => {
  it("sets the date on the first publish only", () => {
    const now = new Date("2026-11-07T10:00:00Z");
    const first = new Date("2026-10-01T10:00:00Z");
    assert.equal(publishedAtFor(null, now), now);
    assert.equal(publishedAtFor(first, now), first);
  });
});

describe("redirectSlugFor", () => {
  it("returns the old live slug when publish changes it", () => {
    assert.equal(redirectSlugFor("old", "new"), "old");
  });

  it("returns null on a first publish or an unchanged slug", () => {
    assert.equal(redirectSlugFor(null, "new"), null);
    assert.equal(redirectSlugFor("same", "same"), null);
  });
});

describe("assertDeletable", () => {
  it("allows draft and archived entries", () => {
    assertDeletable("draft");
    assertDeletable("archived");
  });

  it("refuses a published entry with invalid_state", () => {
    assert.throws(
      () => assertDeletable("published"),
      (error: unknown) =>
        error instanceof CmsRepositoryError && error.code === "invalid_state"
    );
  });
});

describe("pageWindow", () => {
  it("turns a 1-based page into a limit and offset", () => {
    assert.deepEqual(pageWindow(3, 10), { limit: 10, offset: 20, page: 3 });
  });

  it("clamps a page below 1 and a non-integer page", () => {
    assert.deepEqual(pageWindow(0, 10), { limit: 10, offset: 0, page: 1 });
    assert.deepEqual(pageWindow(Number.NaN, 10), {
      limit: 10,
      offset: 0,
      page: 1,
    });
    assert.deepEqual(pageWindow(2.7, 10), { limit: 10, offset: 10, page: 2 });
  });
});
