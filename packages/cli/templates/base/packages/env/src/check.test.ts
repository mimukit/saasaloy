import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blankOnPurposeKeys, incompleteKeys } from "./check.ts";

describe("blankOnPurposeKeys", () => {
  it("marks a key whose comment block carries the line", () => {
    const keys = blankOnPurposeKeys([
      "# Blank on purpose: unset means no proxy.",
      "# A second comment line still belongs to the block.",
      "A=",
      "",
      "B=",
    ]);
    assert.deepEqual([...keys], ["A"]);
  });

  it("ends the block at a blank line", () => {
    const keys = blankOnPurposeKeys(["# Blank on purpose", "", "A="]);
    assert.deepEqual([...keys], []);
  });
});

describe("incompleteKeys", () => {
  const example = ["A=", "# Blank on purpose", "B=", "C="];

  it("names every key with no value", () => {
    assert.deepEqual(incompleteKeys(example, new Map()), ["A", "C"]);
  });

  it("ignores a key the service omits", () => {
    assert.deepEqual(incompleteKeys(example, new Map(), ["C"]), ["A"]);
  });

  it("is empty when every key has a value", () => {
    const values = new Map([
      ["A", "1"],
      ["C", "3"],
    ]);
    assert.deepEqual(incompleteKeys(example, values), []);
  });
});
