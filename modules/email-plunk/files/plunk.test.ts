// Tests for the Plunk provider's error mapping. Repo-only: the descriptor ships `plunk.ts` and
// `env.ts` and nothing else, and this file runs on `node:test` via `pnpm test:modules`.
//
// `fetch` is stubbed, so nothing touches the network. `../provider` resolves through the shim
// beside this module to the real `packages/email` contract. The expected table pins the mapping
// in `plunk.ts` as it stands; it does not change it.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { plunk } from "./plunk.ts";
import { EmailError } from "../provider.ts";
import type {
  EmailEnv,
  EmailErrorCode,
  ResolvedEmailMessage,
} from "../provider.ts";

const ENV: EmailEnv = { EMAIL_PROVIDER: "plunk", PLUNK_API_KEY: "sk_test" };

const MESSAGE: ResolvedEmailMessage = {
  to: ["user@example.com"],
  from: "app@example.com",
  subject: "Hi",
  html: "<p>Hi</p>",
  text: "Hi",
};

const realFetch = globalThis.fetch;
let calls: string[];
let next: () => Promise<Response>;

function respondWith(status: number, body: unknown): void {
  next = () => Promise.resolve(Response.json(body, { status }));
}

beforeEach(() => {
  calls = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return next();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function sendError(): Promise<EmailError> {
  try {
    await plunk().send(ENV, MESSAGE);
  } catch (error) {
    assert.ok(error instanceof EmailError, "send threw a non-EmailError");
    return error;
  }
  assert.fail("send resolved, but a rejection was expected");
}

interface Mapping {
  status: number;
  code?: string;
  expected: EmailErrorCode;
  retryable: boolean;
}

function describeMapping({ status, code, expected, retryable }: Mapping) {
  const withCode = code ? ` with code ${code}` : "";
  return `${status}${withCode} to ${expected}, retryable ${retryable}`;
}

/** Answer the next request with `status`, then check the mapped error. */
async function expectMapping({ status, code, expected, retryable }: Mapping) {
  respondWith(status, {
    error: { message: "rejected", ...(code ? { code } : {}) },
  });
  const error = await sendError();

  assert.equal(error.code, expected);
  assert.equal(error.retryable, retryable);
  assert.equal(error.providerCode, code ?? String(status));
  assert.equal(calls.length, 1);
}

describe("plunk: status mapping", () => {
  const cases: Mapping[] = [
    { status: 429, expected: "rate_limited", retryable: true },
    { status: 413, expected: "too_large", retryable: false },
    {
      status: 422,
      code: "PAYLOAD_TOO_LARGE",
      expected: "too_large",
      retryable: false,
    },
    { status: 401, expected: "provider_error", retryable: false },
    { status: 403, expected: "provider_error", retryable: false },
    { status: 404, expected: "provider_error", retryable: false },
    { status: 422, expected: "provider_error", retryable: false },
    { status: 500, expected: "provider_error", retryable: true },
    { status: 503, expected: "provider_error", retryable: true },
    { status: 418, expected: "provider_error", retryable: false },
  ];

  for (const mapping of cases) {
    it(`maps ${describeMapping(mapping)}`, () => expectMapping(mapping));
  }

  it("lets a body code refine the status: a 422 with a size code is too_large, not provider_error", async () => {
    respondWith(422, { code: "MESSAGE_SIZE_EXCEEDED", message: "too big" });
    const error = await sendError();

    assert.equal(error.code, "too_large");
    assert.equal(error.providerCode, "MESSAGE_SIZE_EXCEEDED");
    assert.match(error.message, /too big/);
  });

  it("keeps the per-field detail of a 422 in the message", async () => {
    respondWith(422, {
      error: {
        message: "Invalid payload",
        errors: [{ path: ["to", 0], message: "Invalid email" }],
      },
    });
    const error = await sendError();

    assert.match(error.message, /Invalid payload — to\.0: Invalid email/);
  });

  it("tolerates a non-JSON error body and names the status", async () => {
    next = () =>
      Promise.resolve(
        new Response("<html>Bad Gateway</html>", { status: 502 })
      );
    const error = await sendError();

    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, true);
    assert.equal(error.providerCode, "502");
    assert.match(error.message, /HTTP 502/);
  });
});

describe("plunk: request failures", () => {
  it("maps a fetch that rejects to a retryable provider_error", async () => {
    const cause = new TypeError("fetch failed");
    next = () => Promise.reject(cause);
    const error = await sendError();

    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, true);
    assert.equal(error.cause, cause);
    assert.match(error.message, /request failed/);
  });

  it("names a timeout apart from other failures", async () => {
    next = () => Promise.reject(new DOMException("timed out", "TimeoutError"));
    const error = await sendError();

    assert.equal(error.retryable, true);
    assert.match(error.message, /timed out/);
  });

  it("throws before the request when PLUNK_API_KEY is unset", async () => {
    await assert.rejects(
      plunk().send({ EMAIL_PROVIDER: "plunk" }, MESSAGE),
      (error: unknown) =>
        error instanceof EmailError &&
        error.code === "provider_error" &&
        /PLUNK_API_KEY/.test(error.message)
    );
    assert.equal(calls.length, 0);
  });

  it("refuses a plain-HTTP PLUNK_API_URL that is not loopback", async () => {
    await assert.rejects(
      plunk().send(
        { ...ENV, PLUNK_API_URL: "http://plunk.example.com" },
        MESSAGE
      ),
      (error: unknown) =>
        error instanceof EmailError && /must use HTTPS/.test(error.message)
    );
    assert.equal(calls.length, 0);
  });
});

describe("plunk: success", () => {
  it("returns the first recipient's email id", async () => {
    respondWith(200, { data: { emails: [{ email: "msg_1" }] } });
    const result = await plunk().send(ENV, MESSAGE);

    assert.equal(result.messageId, "msg_1");
    assert.equal(calls[0], "https://next-api.useplunk.com/v1/send");
  });

  it("throws when a 2xx carries no message id", async () => {
    respondWith(200, {});
    const error = await sendError();

    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, false);
  });
});
