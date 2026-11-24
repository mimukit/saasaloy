import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blankOnPurposeKeys,
  conditionalKeys,
  describeMissing,
  incompleteKeys,
} from "./check.ts";

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

// #390: the lines `saasaloy add` writes for a key with `envRequiredWhen`.
const CONDITIONAL = [
  "# @required-when EMAIL_PROVIDER!=console",
  "# The sender.",
  "EMAIL_FROM=",
  "",
  "# @required-when EMAIL_PROVIDER=plunk",
  "PLUNK_API_KEY=",
  "",
  "# @required-when PAYMENT_PROVIDER=bkash",
  "# @required-when SMS_PROVIDER=bkash",
  "BKASH_KEY=",
];

describe("conditionalKeys", () => {
  it("reads every directive in a key's comment block", () => {
    assert.deepEqual(
      [...conditionalKeys(CONDITIONAL)],
      [
        ["EMAIL_FROM", [{ key: "EMAIL_PROVIDER", isNot: "console" }]],
        ["PLUNK_API_KEY", [{ key: "EMAIL_PROVIDER", is: "plunk" }]],
        [
          "BKASH_KEY",
          [
            { key: "PAYMENT_PROVIDER", is: "bkash" },
            { key: "SMS_PROVIDER", is: "bkash" },
          ],
        ],
      ]
    );
  });

  it("ends the block at a blank line", () => {
    const keys = conditionalKeys(["# @required-when A=b", "", "C="]);
    assert.deepEqual([...keys], []);
  });
});

describe("incompleteKeys with conditional keys", () => {
  it("skips a blank conditional key while no condition holds", () => {
    const values = new Map([["EMAIL_PROVIDER", "console"]]);
    assert.deepEqual(incompleteKeys(CONDITIONAL, values), []);
  });

  it("names a blank conditional key while a condition holds", () => {
    const values = new Map([["EMAIL_PROVIDER", "plunk"]]);
    assert.deepEqual(incompleteKeys(CONDITIONAL, values), [
      "EMAIL_FROM",
      "PLUNK_API_KEY",
    ]);
  });

  it("treats a blank controlling key as holding no name", () => {
    assert.deepEqual(incompleteKeys(CONDITIONAL, new Map()), ["EMAIL_FROM"]);
  });

  it("matches a name in a comma list, and any one of several conditions", () => {
    const values = new Map([
      ["EMAIL_PROVIDER", "console"],
      ["SMS_PROVIDER", "console"],
      ["PAYMENT_PROVIDER", "manual, bkash"],
    ]);
    assert.deepEqual(incompleteKeys(CONDITIONAL, values), ["BKASH_KEY"]);
  });
});

describe("describeMissing", () => {
  it("prints each conditional key with the condition that holds", () => {
    const values = new Map([["EMAIL_PROVIDER", "plunk"]]);
    assert.deepEqual(
      describeMissing(CONDITIONAL, values, [
        "EMAIL_FROM",
        "PLUNK_API_KEY",
        "A",
      ]),
      [
        "EMAIL_FROM (required: EMAIL_PROVIDER!=console)",
        "PLUNK_API_KEY (required: EMAIL_PROVIDER=plunk)",
        "A",
      ]
    );
  });
});
