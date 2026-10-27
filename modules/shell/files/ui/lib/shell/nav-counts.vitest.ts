// Tests for ./nav-counts.ts. The file ships as `nav-counts.test.ts` beside it when
// testing is on, and `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.

import { describe, expect, it } from "vitest";
import { liveCount, withLiveCounts } from "./nav-counts";

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

describe(liveCount, () => {
  it("lets a live count replace a static one", () => {
    expect(liveCount({ to: "/payments", count: 5 }, { "/payments": 2 })).toBe(
      2
    );
  });

  it("hides the badge for a live 0", () => {
    expect(
      liveCount({ to: "/payments", count: 5 }, { "/payments": 0 })
    ).toBeUndefined();
    expect(liveCount({ to: "/payments" }, { "/payments": 0 })).toBeUndefined();
  });

  it("keeps a static 0 when no live value is known", () => {
    expect(liveCount({ to: "/users", count: 0 }, {})).toBe(0);
  });

  it("ignores a live count for another row", () => {
    expect(liveCount({ to: "/users", count: 3 }, { "/payments": 7 })).toBe(3);
    expect(liveCount({ to: "/users" }, { "/payments": 7 })).toBeUndefined();
  });

  it("keeps the static count when the live value is undefined or not a number", () => {
    expect(
      liveCount({ to: "/payments", count: 5 }, { "/payments": undefined })
    ).toBe(5);
    expect(
      liveCount({ to: "/payments", count: 5 }, { "/payments": Number.NaN })
    ).toBe(5);
  });

  it("does not read inherited keys as live counts", () => {
    expect(liveCount({ to: "toString", count: 1 }, {})).toBe(1);
  });
});

describe(withLiveCounts, () => {
  it("sets every item's count by the rule and leaves the input alone", () => {
    const merged = withLiveCounts(areas, {
      "/payments": 0,
      "/users": 4,
      "/gone": 9,
    });
    expect(countsOf(merged)).toStrictEqual([
      ["/", undefined],
      ["/users", 4],
      ["/payments", undefined],
    ]);
    expect(areas[0]?.groups[0]?.items[2]?.count).toBe(5);
  });

  it("keeps the static counts when no live value is known", () => {
    expect(countsOf(withLiveCounts(areas, {}))).toStrictEqual([
      ["/", undefined],
      ["/users", 0],
      ["/payments", 5],
    ]);
  });
});
