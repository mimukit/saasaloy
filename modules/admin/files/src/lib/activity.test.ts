// Tests for ./activity.ts. This file is NOT in the admin descriptor's scaffold list, so
// `add admin` never copies it into a project. It exists for this repo only. Run it with
// `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activityListKey,
  activityPageQuery,
  activityParams,
  activitySearch,
  agoLabel,
  changeRows,
  rangeStart,
  searchOf,
  valueText,
  whenLabel,
} from "./activity.ts";

// Local times, so the day boundaries hold in any time zone the tests run in.
const now = new Date(2026, 10, 4, 12, 0, 0);

describe("rangeStart", () => {
  it("starts today at local midnight and a day range that many days back", () => {
    assert.equal(
      rangeStart("today", now),
      new Date(2026, 10, 4, 0, 0, 0).toISOString()
    );
    assert.equal(
      rangeStart("7d", now),
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    );
    assert.equal(rangeStart("all", now), undefined);
  });
});

describe("activitySearch and searchOf", () => {
  it("keep the known filters and drop the defaults and the rest", () => {
    assert.deepEqual(
      activitySearch({ actor: "u1", area: "payments", range: "30d", x: 1 }),
      { actor: "u1", area: "payments", range: "30d" }
    );
    assert.deepEqual(
      activitySearch({ actor: "", area: "all", range: "7d" }),
      {}
    );
    assert.deepEqual(activitySearch({ range: "forever", area: 3 }), {});
  });

  it("keep the search text, and drop a blank one", () => {
    assert.deepEqual(activitySearch({ q: "INV-2041" }), { q: "INV-2041" });
    assert.deepEqual(activitySearch({ q: "   " }), {});
    assert.deepEqual(activitySearch({ q: 1004 }), { q: "1004" });
    assert.deepEqual(activitySearch({ q: true }), {});
    assert.deepEqual(searchOf(undefined, "all", "7d", " 1004 "), { q: "1004" });
    assert.deepEqual(searchOf(undefined, "all", "7d", "  "), {});
  });

  it("write a filter change with the defaults left out", () => {
    assert.deepEqual(searchOf(undefined, "all", "7d"), {});
    assert.deepEqual(searchOf("u1", "members", "today"), {
      actor: "u1",
      area: "members",
      range: "today",
    });
  });
});

describe("activityParams", () => {
  it("sends only the filters that narrow, and the cursor when given", () => {
    assert.deepEqual(
      activityParams({ area: "all", q: "  ", range: "all" }, now),
      {}
    );
    assert.deepEqual(
      activityParams(
        { actor: "u1", area: "flags", q: " INV ", range: "today" },
        now,
        "c1"
      ),
      {
        actor: "u1",
        area: "flags",
        cursor: "c1",
        from: new Date(2026, 10, 4).toISOString(),
        q: "INV",
      }
    );
  });
});

describe("activityListKey and activityPageQuery", () => {
  it("fix the range start in the key, so every page of one list sends the same from", () => {
    const key = activityListKey(
      { area: "all", q: "", range: "7d" },
      new Date(2026, 10, 4, 12, 0, 0)
    );
    const from = new Date(
      new Date(2026, 10, 4, 12, 0, 0).getTime() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    assert.deepEqual(key, ["admin", "activity", "list", { from }]);
    assert.deepEqual(activityPageQuery(key), { from });
    assert.deepEqual(activityPageQuery(key, "c1"), { cursor: "c1", from });
    assert.deepEqual(activityPageQuery(key, "c2"), { cursor: "c2", from });
  });

  it("give a later start a different key, so the lists never mix", () => {
    const filters = { area: "all", q: "", range: "today" } as const;
    assert.notDeepEqual(
      activityListKey(filters, new Date(2026, 10, 4, 12)),
      activityListKey(filters, new Date(2026, 10, 5, 12))
    );
    assert.deepEqual(
      activityListKey({ area: "all", q: "", range: "all" }, now),
      ["admin", "activity", "list", {}]
    );
  });
});

describe("whenLabel and agoLabel", () => {
  it("name today and yesterday, then the date", () => {
    assert.equal(
      whenLabel(new Date(2026, 10, 4, 10, 41).toISOString(), now),
      "Today, 10:41"
    );
    assert.equal(
      whenLabel(new Date(2026, 10, 3, 17, 40).toISOString(), now),
      "Yesterday, 17:40"
    );
    assert.equal(
      whenLabel(new Date(2026, 10, 1, 14, 22).toISOString(), now),
      "1 Nov 2026, 14:22"
    );
    assert.equal(
      whenLabel(new Date(2026, 10, 2, 9, 0).toISOString(), now, {
        withTime: false,
      }),
      "2 Nov 2026"
    );
  });

  it("say how long ago", () => {
    assert.equal(
      agoLabel(new Date(2026, 10, 4, 11, 59, 30).toISOString(), now),
      "just now"
    );
    assert.equal(
      agoLabel(new Date(2026, 10, 4, 11, 15).toISOString(), now),
      "45 min ago"
    );
    assert.equal(
      agoLabel(new Date(2026, 10, 4, 10, 0).toISOString(), now),
      "2 h ago"
    );
    assert.equal(
      agoLabel(new Date(2026, 10, 3, 18, 0).toISOString(), now),
      "Yesterday"
    );
  });
});

describe("changeRows and valueText", () => {
  it("list every stored field once, with each side", () => {
    assert.deepEqual(
      changeRows({ status: "submitted" }, { note: "ok", status: "successful" }),
      [
        { after: "successful", before: "submitted", field: "status" },
        { after: "ok", before: undefined, field: "note" },
      ]
    );
    assert.deepEqual(changeRows(null, null), []);
  });

  it("write a missing value as a dash", () => {
    // A field one side of the change does not hold reads as undefined.
    assert.equal(valueText(changeRows({ a: 1 }, null)[0]?.after), "–");
    assert.equal(valueText(null), "–");
    assert.equal(valueText(false), "false");
    assert.equal(valueText(12), "12");
    assert.equal(valueText({ a: 1 }), '{"a":1}');
  });
});
