import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addExampleKeys,
  formatEnv,
  formatLine,
  parseValues,
  planEnv,
  removeKey,
  setKey,
  splitLines,
} from "./dotenv.ts";

describe("parseValues", () => {
  it("reads plain, quoted and exported lines", () => {
    const values = parseValues([
      "A=1",
      'B="two"',
      "C='three'",
      "export D=4",
      "# E=5",
      "",
    ]);
    assert.deepEqual(
      [...values],
      [
        ["A", "1"],
        ["B", "two"],
        ["C", "three"],
        ["D", "4"],
      ]
    );
  });

  it("keeps the last value of a repeated key", () => {
    assert.equal(parseValues(["A=1", "A=2"]).get("A"), "2");
  });
});

describe("splitLines and formatEnv", () => {
  it("round-trips a file without growing a blank line", () => {
    const text = "# c\nA=1\n";
    assert.equal(formatEnv(splitLines(text)), text);
  });
});

describe("setKey and removeKey", () => {
  it("writes the first line and drops the later ones", () => {
    assert.deepEqual(setKey(["A=1", "B=2", "A=3"], "A", "9"), ["A=9", "B=2"]);
  });

  it("appends a key the file has never heard of", () => {
    assert.deepEqual(setKey(["A=1"], "B", "2"), ["A=1", "B=2"]);
  });

  it("removes every line for a key", () => {
    assert.deepEqual(removeKey(["A=1", "B=2", "A=3"], "A"), ["B=2"]);
  });
});

describe("addExampleKeys", () => {
  it("keeps a value the target set", () => {
    assert.deepEqual(addExampleKeys(["A=mine"], ["A=default"]), ["A=mine"]);
  });

  it("fills a blank the example has a default for", () => {
    assert.deepEqual(addExampleKeys(["A="], ["A=default"]), ["A=default"]);
  });

  it("leaves a blank alone when the example is blank too", () => {
    assert.deepEqual(addExampleKeys(["A="], ["A="]), ["A="]);
  });

  it("appends a key the target lacks", () => {
    assert.deepEqual(addExampleKeys(["A=1"], ["B=2"]), ["A=1", "B=2"]);
  });
});

describe("formatLine", () => {
  it("writes a plain value bare", () => {
    assert.equal(formatLine("A", "one"), "A=one");
  });

  it("single-quotes a value with a space or a hash", () => {
    assert.equal(formatLine("A", "a b"), "A='a b'");
    assert.equal(formatLine("A", "a#b"), "A='a#b'");
  });

  it("refuses a value no quoting can carry", () => {
    assert.throws(() => formatLine("A", "it's"), /single quote/);
    assert.throws(() => formatLine("A", "a\nb"), /line break/);
  });
});

describe("planEnv", () => {
  const example = ["# what A is", "A=local", "", "# what B is", "B="];

  it("keeps the example's comments and fills the values", () => {
    const plan = planEnv({
      example,
      values: new Map([
        ["A", "one"],
        ["B", "two"],
      ]),
      blankOnPurpose: new Set(),
      keep: new Map(),
      omit: [],
    });
    assert.deepEqual(plan.lines, [
      "# what A is",
      "A=one",
      "",
      "# what B is",
      "B=two",
    ]);
    assert.deepEqual(plan.missingKeys, []);
    assert.deepEqual(plan.extraKeys, []);
  });

  it("names a key with no value and no blank-on-purpose marker", () => {
    const plan = planEnv({
      example,
      values: new Map([["A", "one"]]),
      blankOnPurpose: new Set(),
      keep: new Map(),
      omit: [],
    });
    assert.deepEqual(plan.missingKeys, ["B"]);
  });

  it("accepts a blank-on-purpose key with no value", () => {
    const plan = planEnv({
      example,
      values: new Map([["A", "one"]]),
      blankOnPurpose: new Set(["B"]),
      keep: new Map(),
      omit: [],
    });
    assert.deepEqual(plan.missingKeys, []);
  });

  it("lets a kept value win over the source", () => {
    const plan = planEnv({
      example: ["A=local"],
      values: new Map([["A", "source"]]),
      blankOnPurpose: new Set(),
      keep: new Map([["A", "mine"]]),
      omit: [],
    });
    assert.deepEqual(plan.lines, ["A=mine"]);
  });

  it("blanks an omitted key and never calls it missing", () => {
    const plan = planEnv({
      example: ["A=local"],
      values: new Map([["A", "source"]]),
      blankOnPurpose: new Set(),
      keep: new Map(),
      omit: ["A"],
    });
    assert.deepEqual(plan.lines, ["A="]);
    assert.deepEqual(plan.missingKeys, []);
  });

  it("appends a key only the source holds and reports it", () => {
    const plan = planEnv({
      example: ["A=local"],
      values: new Map([
        ["A", "one"],
        ["Z", "extra"],
      ]),
      blankOnPurpose: new Set(),
      keep: new Map(),
      omit: [],
    });
    assert.deepEqual(plan.lines, ["A=one", "Z=extra"]);
    assert.deepEqual(plan.extraKeys, ["Z"]);
  });
});
