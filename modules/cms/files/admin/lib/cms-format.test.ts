// Tests for ./cms-format.ts. Repo-only: the descriptor ships `cms-format.ts`, never this
// file. Every date is formatted in UTC here, so the result does not depend on the machine.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chipCounts,
  conflictText,
  readConflict,
  relativeTime,
  revisionNumbers,
  savedLine,
  shortDate,
} from "./cms-format.ts";

const NOW = new Date("2026-11-07T10:00:00.000Z");
const UTC = { timeZone: "UTC" };
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe("relativeTime", () => {
  it("says just now under a minute", () => {
    assert.equal(relativeTime(ago(0.4), NOW, UTC), "just now");
  });

  it("counts minutes under an hour", () => {
    assert.equal(relativeTime(ago(38), NOW, UTC), "38 min ago");
    assert.equal(relativeTime(ago(1), NOW, UTC), "1 min ago");
  });

  it("counts hours under 36 hours, with one hour singular", () => {
    assert.equal(relativeTime(ago(60), NOW, UTC), "1 hour ago");
    assert.equal(relativeTime(ago(95), NOW, UTC), "2 hours ago");
    assert.equal(relativeTime(ago(60 * 26), NOW, UTC), "26 hours ago");
    assert.equal(relativeTime(ago(60 * 36 - 1), NOW, UTC), "36 hours ago");
  });

  it("shows the date and time from 36 hours on", () => {
    assert.equal(relativeTime(ago(60 * 36), NOW, UTC), "5 Nov 2026, 22:00");
    assert.equal(relativeTime(ago(60 * 24 * 3), NOW, UTC), "4 Nov 2026, 10:00");
  });

  it("takes an ISO string as well as a Date", () => {
    assert.equal(
      relativeTime("2026-11-07T09:22:00.000Z", NOW, UTC),
      "38 min ago"
    );
  });

  it("treats a time a little in the future as just now", () => {
    assert.equal(relativeTime(ago(-2), NOW, UTC), "just now");
  });
});

describe("shortDate", () => {
  it("writes day, short month and year", () => {
    assert.equal(shortDate("2026-10-12T08:00:00.000Z", UTC), "12 Oct 2026");
  });
});

describe("chipCounts", () => {
  it("adds draft and published into current, and everything into all", () => {
    assert.deepEqual(chipCounts({ archived: 1, draft: 2, published: 3 }), {
      all: 6,
      archived: 1,
      current: 5,
      draft: 2,
      published: 3,
    });
  });
});

describe("revisionNumbers", () => {
  it("numbers a newest-first list from the oldest, which is 1", () => {
    assert.deepEqual(revisionNumbers(5), [5, 4, 3, 2, 1]);
    assert.deepEqual(revisionNumbers(0), []);
  });
});

describe("savedLine", () => {
  it("names the unpublished edits on a published entry", () => {
    assert.equal(
      savedLine(
        { hasUnpublishedEdits: true, status: "published", updatedAt: ago(38) },
        NOW,
        UTC
      ),
      "Draft saved 38 min ago. Unpublished edits."
    );
  });

  it("says the live post matches when nothing is pending", () => {
    assert.equal(
      savedLine(
        { hasUnpublishedEdits: false, status: "published", updatedAt: ago(95) },
        NOW,
        UTC
      ),
      "Saved 2 hours ago. The live post matches the draft."
    );
  });

  it("says a draft is not live", () => {
    assert.equal(
      savedLine(
        { hasUnpublishedEdits: false, status: "draft", updatedAt: ago(5) },
        NOW,
        UTC
      ),
      "Draft saved 5 min ago. Not live."
    );
  });

  it("says an archived entry is offline", () => {
    assert.equal(
      savedLine(
        { hasUnpublishedEdits: false, status: "archived", updatedAt: ago(5) },
        NOW,
        UTC
      ),
      "Archived. Saved 5 min ago."
    );
  });
});

describe("readConflict", () => {
  it("reads the 409 body the api sends", () => {
    assert.deepEqual(
      readConflict({
        conflict: {
          updatedAt: "2026-11-07T09:58:00.000Z",
          updatedByName: "Tanvir Hasan",
          version: 4,
        },
        error: { code: "conflict", message: "Reload." },
      }),
      {
        updatedAt: "2026-11-07T09:58:00.000Z",
        updatedByName: "Tanvir Hasan",
        version: 4,
      }
    );
  });

  it("keeps a null editor name", () => {
    assert.equal(
      readConflict({
        conflict: { updatedAt: "x", updatedByName: null, version: 2 },
        error: { code: "conflict" },
      })?.updatedByName,
      null
    );
  });

  it("answers null for every other body", () => {
    assert.equal(readConflict({ error: { code: "slug_taken" } }), null);
    assert.equal(readConflict(null), null);
    assert.equal(readConflict("conflict"), null);
  });
});

describe("conflictText", () => {
  const conflict = {
    updatedAt: "2026-11-07T09:58:00.000Z",
    updatedByName: "Tanvir Hasan",
    version: 4,
  };

  it("names the other editor and the time, as the mockup reads", () => {
    assert.deepEqual(
      conflictText({
        action: "save",
        conflict,
        now: NOW,
        singular: "Post",
        ...UTC,
      }),
      {
        description:
          "Tanvir Hasan saved a newer version at 09:58, so your save was not applied. Reload to load the newer version. Your edits in this form are lost on reload, so copy any text you want to keep first.",
        title: "This post changed in another tab",
      }
    );
  });

  it("names the action that was refused", () => {
    assert.match(
      conflictText({
        action: "publish",
        conflict,
        now: NOW,
        singular: "Post",
        ...UTC,
      }).description,
      /so your publish was not applied/
    );
  });

  it("writes the date as well when the other save was not today", () => {
    assert.match(
      conflictText({
        action: "save",
        conflict: { ...conflict, updatedAt: "2026-11-05T09:58:00.000Z" },
        now: NOW,
        singular: "Post",
        ...UTC,
      }).description,
      /saved a newer version on 5 Nov 2026 at 09:58/
    );
  });

  it("says someone when the other editor's account is gone", () => {
    assert.match(
      conflictText({
        action: "save",
        conflict: { ...conflict, updatedByName: null },
        now: NOW,
        singular: "Page",
        ...UTC,
      }).description,
      /^Someone saved a newer version/
    );
  });
});
