import { describe, expect, it } from "vitest";
import { RefusalError } from "../lib/exit.js";
import {
  createTextMerger,
  hasConflictMarkers,
  mergeStyleFor,
  theirsLabel,
} from "./merge.js";

const BASE = ["one", "two", "three", "four", "five", ""].join("\n");

describe(mergeStyleFor, () => {
  it("picks zdiff3 from git 2.35 and diff3 below it", () => {
    expect(mergeStyleFor("git version 2.43.0")).toBe("zdiff3");
    expect(mergeStyleFor("git version 2.35.1")).toBe("zdiff3");
    expect(mergeStyleFor("git version 2.34.9")).toBe("diff3");
    expect(mergeStyleFor("git version 3.0.0")).toBe("zdiff3");
  });
});

describe(hasConflictMarkers, () => {
  it("finds a marker line and ignores a quoted one", () => {
    expect(
      hasConflictMarkers("a\n<<<<<<< mine\nb\n=======\nc\n>>>>>>> x\n")
    ).toBeTruthy();
    expect(hasConflictMarkers("a\n=======\n")).toBeTruthy();
    expect(hasConflictMarkers("Quote: `<<<<<<< mine` in prose\n")).toBeFalsy();
    expect(hasConflictMarkers("========\n")).toBeFalsy();
  });
});

describe(createTextMerger, () => {
  const merger = createTextMerger();

  it("merges two edits in different lines cleanly", async () => {
    const out = await merger.merge({
      base: BASE,
      mine: BASE.replace("one", "ONE"),
      theirs: BASE.replace("five", "FIVE"),
      version: "0.10.0",
    });
    expect(out.conflicts).toBe(0);
    expect(out.content).toBe(
      BASE.replace("one", "ONE").replace("five", "FIVE")
    );
  });

  it("writes zdiff3 markers labelled mine, base and saasaloy <version>", async () => {
    const out = await merger.merge({
      base: BASE,
      mine: BASE.replace("three", "mine three"),
      theirs: BASE.replace("three", "their three"),
      version: "0.10.0",
    });
    expect(out.conflicts).toBe(1);
    expect(out.content).toContain("<<<<<<< mine\nmine three\n");
    expect(out.content).toContain("||||||| base\nthree\n");
    expect(out.content).toContain(
      `their three\n>>>>>>> ${theirsLabel("0.10.0")}\n`
    );
  });

  it("writes two-way markers with no base section when no base is known", async () => {
    const out = await merger.merge({
      base: undefined,
      mine: "shared\nmine\n",
      theirs: "shared\ntheirs\n",
      version: "0.10.0",
    });
    expect(out.conflicts).toBeGreaterThan(0);
    expect(out.content).toContain("<<<<<<< mine");
    expect(out.content).toContain(">>>>>>> saasaloy 0.10.0");
    expect(out.content).not.toContain("|||||||");
  });

  it("refuses with exit 2 when a merge needs git and git is missing", async () => {
    const noGit = createTextMerger({ git: "/nonexistent/git" });
    await expect(
      noGit.merge({
        base: "a\n",
        mine: "b\n",
        path: "src/x.ts",
        theirs: "c\n",
        version: "0.10.0",
      })
    ).rejects.toThrow(RefusalError);
  });
});
