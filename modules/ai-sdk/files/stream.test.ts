// Tests for the tool-call reader, ported from PrimeShopr's `stream.test.ts`. Repo-only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import { asRecord, isFinishedCall, toolCallsOf } from "./stream.ts";

// A finished assistant message, written by hand in the shape a UI message stream ends with.
const MESSAGE: UIMessage = {
  id: "m1",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "tool-run_sql",
      toolCallId: "c1",
      state: "output-available",
      input: { sql: "select 1" },
      output: { rowCount: 1, rows: [{ one: 1 }] },
    },
    {
      type: "tool-propose_action",
      toolCallId: "c2",
      state: "input-available",
      input: { action: "extend_cart_hold", input: { id: "x" } },
    },
    {
      type: "tool-get_order",
      toolCallId: "c3",
      state: "output-error",
      input: { invoice: "INV-1" },
      errorText: "boom",
    },
    {
      type: "dynamic-tool",
      toolName: "search_docs",
      toolCallId: "c4",
      state: "output-available",
      input: { q: "refunds" },
      output: ["doc-1"],
    },
    { type: "text", text: "Done." },
  ],
};

describe("toolCallsOf", () => {
  it("lists each tool part in order, with its name, and skips the rest", () => {
    assert.deepEqual(toolCallsOf(MESSAGE), [
      {
        id: "c1",
        name: "run_sql",
        state: "output-available",
        input: { sql: "select 1" },
        output: { rowCount: 1, rows: [{ one: 1 }] },
      },
      {
        id: "c2",
        name: "propose_action",
        state: "input-available",
        input: { action: "extend_cart_hold", input: { id: "x" } },
        output: undefined,
      },
      {
        id: "c3",
        name: "get_order",
        state: "output-error",
        input: { invoice: "INV-1" },
        output: undefined,
        errorText: "boom",
      },
      {
        id: "c4",
        name: "search_docs",
        state: "output-available",
        input: { q: "refunds" },
        output: ["doc-1"],
      },
    ]);
  });

  it("gives no calls when there is no message", () => {
    assert.deepEqual(toolCallsOf(), []);
  });

  it("counts a call as finished when it answered or threw", () => {
    assert.deepEqual(toolCallsOf(MESSAGE).map(isFinishedCall), [
      true,
      false,
      true,
      true,
    ]);
  });
});

describe("asRecord", () => {
  it("keeps an object and wraps anything else", () => {
    assert.deepEqual(asRecord({ a: 1 }), { a: 1 });
    assert.deepEqual(asRecord([1, 2]), { value: [1, 2] });
    assert.deepEqual(asRecord("text"), { value: "text" });
    assert.deepEqual(asRecord(null), { value: null });
  });
});
