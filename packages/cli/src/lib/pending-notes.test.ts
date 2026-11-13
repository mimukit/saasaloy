import { describe, expect, it } from "vitest";
import type { PendingNote } from "./manifest.js";
import { matchDone, mergePendingNotes } from "./pending-notes.js";
import type { UpdateNote } from "./update-notes.js";

// #298 Phase 4. A note an applied run shows stays pending until `update --done <id>`, and
// prints in every later merge plan. These are the pure halves: which ids `--done` names,
// and what a run shows and records once the pending list meets its own selection.

function note(id: string): UpdateNote {
  const [owner, rest] = id.split("/") as [string, string];
  return {
    id,
    owner,
    serial: Number(rest.slice(0, 4)),
    slug: rest.slice(5),
    title: `Title of ${id}`,
    body: `Body of ${id}\n`,
    path: `/tmp/${id}.md`,
  };
}

function pending(id: string, mayApply = false): PendingNote {
  return {
    id,
    title: `Title of ${id}`,
    body: `Body of ${id}\n`,
    ...(mayApply ? { mayApply: true } : {}),
  };
}

const ids = (notes: readonly { id: string }[]): string[] =>
  notes.map((n) => n.id);

describe(mergePendingNotes, () => {
  it("records every note a first run selects, in the plan's order", () => {
    const merged = mergePendingNotes(
      [],
      {
        notes: [note("base/0001-a"), note("api/0001-b")],
        mayApply: [note("x/0001-c")],
      },
      new Set()
    );
    expect(ids(merged.notes)).toStrictEqual(["base/0001-a", "api/0001-b"]);
    expect(ids(merged.mayApply)).toStrictEqual(["x/0001-c"]);
    expect(merged.pending).toStrictEqual([
      pending("base/0001-a"),
      pending("api/0001-b"),
      pending("x/0001-c", true),
    ]);
  });

  it("repeats a pending note the run did not select", () => {
    const merged = mergePendingNotes(
      [pending("base/0001-a"), pending("x/0001-c", true)],
      { notes: [], mayApply: [] },
      new Set()
    );
    expect(ids(merged.notes)).toStrictEqual(["base/0001-a"]);
    expect(ids(merged.mayApply)).toStrictEqual(["x/0001-c"]);
    expect(merged.notes[0]?.body).toBe("Body of base/0001-a\n");
  });

  it("lists a note both pending and selected once, in its pending place", () => {
    const merged = mergePendingNotes(
      [pending("api/0001-b")],
      { notes: [note("base/0001-a"), note("api/0001-b")], mayApply: [] },
      new Set()
    );
    expect(ids(merged.notes)).toStrictEqual(["api/0001-b", "base/0001-a"]);
    expect(ids(merged.pending)).toStrictEqual(["api/0001-b", "base/0001-a"]);
  });

  it("leaves out the ids `--done` clears, pending or selected again", () => {
    const merged = mergePendingNotes(
      [pending("base/0001-a"), pending("api/0001-b")],
      { notes: [note("base/0001-a")], mayApply: [] },
      new Set(["base/0001-a"])
    );
    expect(ids(merged.notes)).toStrictEqual(["api/0001-b"]);
    expect(ids(merged.pending)).toStrictEqual(["api/0001-b"]);
  });
});

describe(matchDone, () => {
  it("splits the named ids into pending and not pending", () => {
    expect(
      matchDone(
        ["base/0001-a", "nope/0001-z", "base/0001-a"],
        [pending("base/0001-a"), pending("api/0001-b")]
      )
    ).toStrictEqual({
      matched: new Set(["base/0001-a"]),
      unmatched: ["nope/0001-z"],
    });
  });
});
