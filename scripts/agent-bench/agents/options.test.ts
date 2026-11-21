import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentOptions, latestSol } from "./options.ts";

describe("benchmark model options", () => {
  it("uses medium effort without inventing a model", () => {
    assert.deepEqual(agentOptions([]), {
      model: undefined,
      effort: "medium",
      extra: [],
    });
  });

  it("accepts explicit models and effort without duplicate flags", () => {
    assert.deepEqual(
      agentOptions(["--model=custom", "--effort=high", "--verbose"]),
      {
        model: "custom",
        effort: "high",
        extra: ["--verbose"],
      }
    );
    assert.equal(agentOptions(["-m", "other"]).model, "other");
    assert.deepEqual(
      agentOptions(["-c", 'model_reasoning_effort="high"']).extra,
      ["-c", 'model_reasoning_effort="high"']
    );
  });

  it("rejects missing model or effort values", () => {
    for (const args of [["--model"], ["--effort", "--verbose"], ["--model="]]) {
      assert.throws(() => agentOptions(args), /needs a value/);
    }
  });
});

describe("latest Sol model", () => {
  it("compares version numbers and excludes other model families", () => {
    const cache = {
      models: [
        { slug: "gpt-6.2-sol" },
        { slug: "gpt-11-astra" },
        { slug: "gpt-6.10-sol" },
        { slug: "gpt-6.9-sol" },
        { slug: "gpt-7-sol" },
        { slug: "gpt-7-sol-preview" },
      ],
    };
    assert.equal(latestSol(cache), "gpt-7-sol");
    assert.equal(
      latestSol({ models: cache.models.slice(0, 4) }),
      "gpt-6.10-sol"
    );
  });

  it("requires an explicit model when no Sol model is listed", () => {
    for (const cache of [
      undefined,
      {},
      { models: [null, {}, { slug: "other" }] },
    ]) {
      assert.throws(() => latestSol(cache), /pass --model explicitly/);
    }
  });
});
