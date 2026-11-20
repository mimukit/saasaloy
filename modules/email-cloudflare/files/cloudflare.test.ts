// Tests for the Cloudflare Email Sending provider's error mapping. Repo-only: the descriptor ships
// `cloudflare.ts` and nothing else, and this file runs on `node:test` via `pnpm test:modules`.
//
// The `send_email` binding is a stub on `env`, so nothing touches Cloudflare. `../provider`
// resolves through the shim beside this module to the real `packages/email` contract.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cloudflare } from "./cloudflare.ts";
import { EmailError } from "../provider.ts";
import type {
  EmailEnv,
  EmailErrorCode,
  ResolvedEmailMessage,
} from "../provider.ts";

const MESSAGE: ResolvedEmailMessage = {
  to: ["user@example.com"],
  from: "app@example.com",
  subject: "Hi",
  html: "<p>Hi</p>",
  text: "Hi",
};

/** An env whose `EMAIL` binding rejects every send with `thrown`. */
function failingEnv(thrown: unknown): EmailEnv {
  return {
    EMAIL_PROVIDER: "cloudflare",
    EMAIL: { send: () => Promise.reject(thrown) },
  };
}

/** A runtime-style error: an `Error` carrying a `code` string. */
function runtimeError(code: string): Error {
  return Object.assign(new Error(`send failed: ${code}`), { code });
}

async function sendError(env: EmailEnv): Promise<EmailError> {
  try {
    await cloudflare().send(env, MESSAGE);
  } catch (error) {
    assert.ok(error instanceof EmailError, "send threw a non-EmailError");
    return error;
  }
  assert.fail("send resolved, but a rejection was expected");
}

describe("cloudflare: error mapping", () => {
  const cases: [string, EmailErrorCode, boolean][] = [
    ["E_SENDER_NOT_VERIFIED", "sender_not_verified", false],
    ["E_RATE_LIMIT_EXCEEDED", "rate_limited", true],
    ["E_CONTENT_TOO_LARGE", "too_large", false],
    ["E_INTERNAL_SERVER_ERROR", "provider_error", true],
  ];

  for (const [raw, expected, retryable] of cases) {
    it(`maps ${raw} to ${expected}, retryable ${retryable}`, async () => {
      const thrown = runtimeError(raw);
      const error = await sendError(failingEnv(thrown));

      assert.equal(error.code, expected);
      assert.equal(error.retryable, retryable);
      assert.equal(error.providerCode, raw);
      assert.equal(error.cause, thrown);
      assert.equal(error.message, thrown.message);
    });
  }

  it("maps an unknown code to provider_error, not retryable, keeping the raw code", async () => {
    const error = await sendError(failingEnv(runtimeError("E_SOMETHING_NEW")));

    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, false);
    assert.equal(error.providerCode, "E_SOMETHING_NEW");
  });

  it("maps a thrown value with no code to provider_error with no providerCode", async () => {
    const error = await sendError(failingEnv(new Error("socket hang up")));

    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, false);
    assert.equal(error.providerCode, undefined);
    assert.equal(error.message, "socket hang up");
  });

  it("maps a thrown non-Error to provider_error with its string form", async () => {
    const error = await sendError(failingEnv("boom"));

    assert.equal(error.code, "provider_error");
    assert.equal(error.message, "boom");
  });

  it("passes an EmailError from the binding through untouched", async () => {
    const original = new EmailError("rate_limited", "slow down", {
      retryable: true,
    });
    const error = await sendError(failingEnv(original));

    assert.equal(error, original);
  });
});

describe("cloudflare: binding", () => {
  it("throws provider_error when the binding is missing", async () => {
    const error = await sendError({ EMAIL_PROVIDER: "cloudflare" });

    assert.equal(error.code, "provider_error");
    assert.match(error.message, /No `EMAIL` Email Sending binding/);
  });

  it("reads the binding name from the options, and returns the message id", async () => {
    const sent: unknown[] = [];
    const result = await cloudflare({ binding: "MAILER" }).send(
      {
        EMAIL_PROVIDER: "cloudflare",
        MAILER: {
          send: (payload: unknown) => {
            sent.push(payload);
            return Promise.resolve({ messageId: "cf-1" });
          },
        },
      },
      MESSAGE
    );

    assert.equal(result.messageId, "cf-1");
    assert.equal(sent.length, 1);
  });
});
