// Tests for ./nav-counts.ts. This file is NOT in the descriptor's `files` list, so
// `add shell` never copies it into a user's project; it exists for this repo only, the
// same way ../../blocks/shell/data-table-cards.test.ts does.
//
// It runs on `node:test` because vite has to load a tsconfig for every file it transforms,
// and this payload's tsconfig resolves only inside a scaffolded project. Run them with
// `pnpm test:modules`.
//
// The import needs the explicit `.ts` extension because Node's type stripping resolves the
// real file rather than a bundler's guess.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveCount, withLiveCounts } from "./nav-counts.ts";

const areas = [
  {
    label: "Admin",
    to: "/",
    groups: [
      {
        label: "Manage",
        items: [
          { to: "/", label: "Overview" },
          { to: "/users", label: "Users", count: 0 },
          { to: "/payments", label: "Payments", count: 5 },
        ],
      },
    ],
  },
];

function countsOf(
  merged: ReturnType<typeof withLiveCounts<(typeof areas)[number]>>
) {
  return merged[0]?.groups[0]?.items.map((item) => [item.to, item.count]);
}

describe("liveCount", () => {
  it("lets a live count replace a static one", () => {
    assert.equal(
      liveCount({ to: "/payments", count: 5 }, { "/payments": 2 }),
      2
    );
  });

  it("hides the badge for a live 0", () => {
    assert.equal(
      liveCount({ to: "/payments", count: 5 }, { "/payments": 0 }),
      undefined
    );
    assert.equal(liveCount({ to: "/payments" }, { "/payments": 0 }), undefined);
  });

  it("keeps a static 0 when no live value is known", () => {
    assert.equal(liveCount({ to: "/users", count: 0 }, {}), 0);
  });

  it("ignores a live count for another row", () => {
    assert.equal(liveCount({ to: "/users", count: 3 }, { "/payments": 7 }), 3);
    assert.equal(liveCount({ to: "/users" }, { "/payments": 7 }), undefined);
  });

  it("keeps the static count when the live value is undefined or not a number", () => {
    assert.equal(
      liveCount({ to: "/payments", count: 5 }, { "/payments": undefined }),
      5
    );
    assert.equal(
      liveCount({ to: "/payments", count: 5 }, { "/payments": Number.NaN }),
      5
    );
  });

  it("does not read inherited keys as live counts", () => {
    assert.equal(liveCount({ to: "toString", count: 1 }, {}), 1);
  });
});

describe("withLiveCounts", () => {
  it("sets every item's count by the rule and leaves the input alone", () => {
    const merged = withLiveCounts(areas, {
      "/payments": 0,
      "/users": 4,
      "/gone": 9,
    });
    assert.deepEqual(countsOf(merged), [
      ["/", undefined],
      ["/users", 4],
      ["/payments", undefined],
    ]);
    assert.equal(areas[0]?.groups[0]?.items[2]?.count, 5);
  });

  it("keeps the static counts when no live value is known", () => {
    assert.deepEqual(countsOf(withLiveCounts(areas, {})), [
      ["/", undefined],
      ["/users", 0],
      ["/payments", 5],
    ]);
  });
});
