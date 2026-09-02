import { describe, expect, it } from "vitest";
import { lineDiff } from "./diff.js";

// `--diff` is a preview a person reads before they let `add` write, so the shape of the
// output is the contract: one entry per line, in file order, each classified. The empty
// side is special-cased in the source, and that is the case a naive split gets wrong.

function render(oldText: string, newText: string): string[] {
  return lineDiff(oldText, newText).map(
    (line) => `${{ add: "+", context: " ", del: "-" }[line.kind]}${line.text}`
  );
}

describe("lineDiff — how each line is classified", () => {
  it("reads a created file as pure addition, with no phantom blank line", () => {
    expect(render("", "a\nb")).toStrictEqual(["+a", "+b"]);
  });

  it("reads a deleted file as pure removal", () => {
    expect(render("a\nb", "")).toStrictEqual(["-a", "-b"]);
  });

  it("takes two empty sides as the creation of one empty line", () => {
    // The empty-old branch wins, so the result is `[""]` added rather than nothing. No
    // plan reaches it — an unchanged empty file classifies as `unchanged` and is never
    // diffed — and this pins the behaviour rather than endorsing it.
    expect(lineDiff("", "")).toStrictEqual([{ kind: "add", text: "" }]);
  });

  it("marks every line as context when nothing changed", () => {
    expect(render("a\nb\nc", "a\nb\nc")).toStrictEqual([" a", " b", " c"]);
  });

  it("keeps the surrounding lines as context around an insertion", () => {
    expect(render("a\nc", "a\nb\nc")).toStrictEqual([" a", "+b", " c"]);
  });

  it("reports a deletion in place", () => {
    expect(render("a\nb\nc", "a\nc")).toStrictEqual([" a", "-b", " c"]);
  });

  it("reports a changed line as a delete then an add", () => {
    expect(render("a\nb\nc", "a\nB\nc")).toStrictEqual([
      " a",
      "-b",
      "+B",
      " c",
    ]);
  });

  it("reports lines appended past the end of the old file", () => {
    expect(render("a", "a\nb\nc")).toStrictEqual([" a", "+b", "+c"]);
  });

  it("reports lines truncated off the end of the old file", () => {
    expect(render("a\nb\nc", "a")).toStrictEqual([" a", "-b", "-c"]);
  });

  it("finds the longest common subsequence rather than diffing line by line", () => {
    // A naive per-line compare would call every line changed. The LCS keeps `b` and `d`.
    expect(render("a\nb\nc\nd", "x\nb\ny\nd")).toStrictEqual([
      "-a",
      "+x",
      " b",
      "-c",
      "+y",
      " d",
    ]);
  });

  it("counts a trailing newline as its own empty line", () => {
    expect(render("a\n", "a\nb\n")).toStrictEqual([" a", "+b", " "]);
  });

  it("reports a total rewrite as every line removed then every line added", () => {
    expect(render("a\nb", "x\ny")).toStrictEqual(["-a", "-b", "+x", "+y"]);
  });
});
