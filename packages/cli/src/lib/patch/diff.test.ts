import { describe, expect, it } from "vitest";
import { toDiff } from "./diff.js";

describe("toDiff", () => {
  it("returns an empty string when content is unchanged (idempotent no-op)", () => {
    expect(toDiff("a\nb\n", "a\nb\n", "file.txt")).toBe("");
  });

  it("produces a unified diff carrying the filename and the changed lines", () => {
    const diff = toDiff("a\n", "b\n", "wrangler.jsonc");
    expect(diff).toContain("wrangler.jsonc");
    expect(diff).toContain("-a");
    expect(diff).toContain("+b");
  });

  it("treats a missing trailing newline the same as present for the no-op check", () => {
    expect(toDiff("x", "x", "file.txt")).toBe("");
  });
});
