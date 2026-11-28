import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UIMessage } from "ai";

import {
  approvalIdFor,
  CHAT_ERRORS,
  toBlockError,
  toBlockMessages,
} from "./ai-chat-messages.ts";

const tool = (extra: Record<string, unknown>): UIMessage["parts"][number] =>
  ({
    input: { id: 1042 },
    toolCallId: "call-1",
    type: "tool-refundOrder",
    ...extra,
  }) as UIMessage["parts"][number];

function assistant(parts: UIMessage["parts"]): UIMessage {
  return { id: "a1", parts, role: "assistant" };
}

describe("toBlockMessages", () => {
  it("maps text, reasoning and both source kinds, and drops other parts", () => {
    const messages: UIMessage[] = [
      { id: "s", parts: [{ text: "be brief", type: "text" }], role: "system" },
      { id: "u1", parts: [{ text: "hi", type: "text" }], role: "user" },
      assistant([
        { type: "step-start" },
        { state: "streaming", text: "thinking", type: "reasoning" },
        { text: "hello", type: "text" },
        {
          sourceId: "s1",
          title: "Order",
          type: "source-url",
          url: "https://x.test/o",
        },
        {
          mediaType: "text/plain",
          sourceId: "s2",
          title: "Policy",
          type: "source-document",
        },
      ]),
    ];
    assert.deepEqual(toBlockMessages(messages), [
      { id: "u1", parts: [{ text: "hi", type: "text" }], role: "user" },
      {
        id: "a1",
        parts: [
          { streaming: true, text: "thinking", type: "reasoning" },
          { text: "hello", type: "text" },
          {
            id: "s1",
            title: "Order",
            type: "source",
            url: "https://x.test/o",
          },
          { id: "s2", title: "Policy", type: "source" },
        ],
        role: "assistant",
      },
    ]);
  });

  it("maps each tool state onto the block's five states", () => {
    const states = [
      [{ state: "input-streaming" }, "running"],
      [{ state: "input-available" }, "running"],
      [{ approval: { id: "ap" }, state: "approval-requested" }, "approval"],
      [
        { approval: { approved: true, id: "ap" }, state: "approval-responded" },
        "running",
      ],
      [
        {
          approval: { approved: false, id: "ap" },
          state: "approval-responded",
        },
        "denied",
      ],
      [{ output: { ok: true }, state: "output-available" }, "finished"],
      [{ errorText: "boom", state: "output-error" }, "error"],
      [
        { approval: { approved: false, id: "ap" }, state: "output-denied" },
        "denied",
      ],
    ] as const;
    for (const [extra, expected] of states) {
      const [message] = toBlockMessages([assistant([tool(extra)])]);
      assert.equal(message?.parts[0]?.type, "tool");
      assert.equal(
        message?.parts[0]?.type === "tool" ? message.parts[0].state : "",
        expected,
        extra.state
      );
    }
  });

  it("keeps a tool's name, input, output and error text", () => {
    const [done] = toBlockMessages([
      assistant([tool({ output: { ok: true }, state: "output-available" })]),
    ]);
    assert.deepEqual(done?.parts[0], {
      errorText: undefined,
      input: { id: 1042 },
      name: "refundOrder",
      output: { ok: true },
      state: "finished",
      toolCallId: "call-1",
      type: "tool",
    });
    const [failed] = toBlockMessages([
      assistant([
        {
          errorText: "no such order",
          input: {},
          state: "output-error",
          toolCallId: "call-2",
          toolName: "lookup",
          type: "dynamic-tool",
        },
      ]),
    ]);
    assert.equal(
      failed?.parts[0]?.type === "tool" ? failed.parts[0].name : "",
      "lookup"
    );
    assert.equal(
      failed?.parts[0]?.type === "tool" ? failed.parts[0].errorText : "",
      "no such order"
    );
  });
});

describe("approvalIdFor", () => {
  it("finds the approval id of a call that waits for an answer", () => {
    const messages = [
      assistant([
        tool({ approval: { id: "ap-7" }, state: "approval-requested" }),
      ]),
    ];
    assert.equal(approvalIdFor(messages, "call-1"), "ap-7");
    assert.equal(approvalIdFor(messages, "call-9"), undefined);
  });

  it("finds nothing for a call that was already answered", () => {
    const messages = [
      assistant([
        tool({
          approval: { approved: true, id: "ap-7" },
          state: "approval-responded",
        }),
      ]),
    ];
    assert.equal(approvalIdFor(messages, "call-1"), undefined);
  });
});

describe("toBlockError", () => {
  it("is null with no error", () => {
    assert.equal(toBlockError(), null);
  });

  it("reads the driver's ChatErrorBody", () => {
    const body = {
      code: "rate_limited",
      message: "The AI service is busy. Try again in a moment.",
      retryable: true,
    };
    assert.deepEqual(toBlockError(new Error(JSON.stringify(body))), {
      message: body.message,
      retryable: true,
    });
    assert.deepEqual(
      toBlockError(
        new Error(
          JSON.stringify({ code: "quota", message: "Out", retryable: false })
        )
      ),
      { message: "Out", retryable: false }
    );
  });

  it("reads the api's error envelope", () => {
    const envelope = (code: string) =>
      new Error(JSON.stringify({ error: { code, message: code } }));
    assert.deepEqual(toBlockError(envelope("unauthorized")), {
      message: CHAT_ERRORS.signedOut,
      retryable: false,
    });
    assert.deepEqual(toBlockError(envelope("rate_limited")), {
      message: CHAT_ERRORS.rateLimited,
      retryable: true,
    });
    assert.deepEqual(toBlockError(envelope("internal_error")), {
      message: CHAT_ERRORS.failed,
      retryable: true,
    });
  });

  it("shows a fixed line for a network failure, never its text", () => {
    assert.deepEqual(toBlockError(new TypeError("Failed to fetch")), {
      message: CHAT_ERRORS.failed,
      retryable: true,
    });
  });
});
