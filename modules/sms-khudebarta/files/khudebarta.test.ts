// Tests for the Khudebarta provider. Repo-only: the descriptor ships `khudebarta.ts` and nothing
// else, and this file runs on `node:test` via `pnpm test:modules`.
//
// `fetch` is stubbed, so nothing touches the network. `../provider` resolves through the shim
// beside this module to the real `packages/sms` contract, so `SmsError`'s retryable coercion is
// the one a deployed Worker gets.
//
// The status table below is transcribed from Khudebarta's API document. It is the only thing that
// reads the error map back, because the live gateway cannot be reached until its certificate is
// renewed.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { khudebarta } from "./khudebarta.ts";
import { SmsError } from "../provider.ts";
import type { ResolvedSmsMessage, SmsEnv, SmsErrorCode } from "../provider.ts";

const ENV: SmsEnv = {
  SMS_PROVIDER: "khudebarta",
  KHUDEBARTA_API_KEY: "key",
  KHUDEBARTA_SECRET_KEY: "secret",
};

function message(
  overrides: Partial<ResolvedSmsMessage> = {}
): ResolvedSmsMessage {
  return {
    to: ["+8801712345678"],
    from: "ACME",
    body: "Your code is 123456",
    estimatedSegments: 1,
    ...overrides,
  };
}

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

const realFetch = globalThis.fetch;
let calls: Call[];
let responses: unknown[];

function respondWith(...bodies: unknown[]): void {
  responses = bodies;
}

beforeEach(() => {
  calls = [];
  responses = [];
  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      init,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const next = responses.shift() ?? {
      Status: "0",
      StatusDescription: "",
      Text: "ACCEPTD",
      Message_ID: "31771702",
    };
    // HTTP 200 whatever the body says, exactly as the gateway answers.
    return Promise.resolve(Response.json(next, { status: 200 }));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function rejected(status: string, description: string) {
  return {
    Status: status,
    StatusDescription: description,
    Text: "REJECTD",
    Message_ID: "-1",
  };
}

async function sendError(
  env: SmsEnv,
  msg: ResolvedSmsMessage
): Promise<SmsError> {
  try {
    await khudebarta().send(env, msg);
  } catch (error) {
    assert.ok(
      error instanceof SmsError,
      `expected SmsError, got ${String(error)}`
    );
    return error;
  }
  assert.fail("expected send() to throw");
}

describe("khudebarta: success", () => {
  it("is selected by the name `khudebarta`", () => {
    assert.equal(khudebarta().name, "khudebarta");
  });

  it("returns Message_ID as messageId", async () => {
    const result = await khudebarta().send(ENV, message());
    assert.deepEqual(result, { messageId: "31771702" });
  });

  it("posts JSON to <base>/sendtext with toUser stripped of its +", async () => {
    await khudebarta().send(ENV, message());

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.url, "https://portal.khudebarta.com:3770/sendtext");
    assert.equal(call.init.method, "POST");
    // Workers reject `redirect: "error"`, so the provider must ask for `"manual"`.
    assert.equal(call.init.redirect, "manual");
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.deepEqual(call.body, {
      apikey: "key",
      secretkey: "secret",
      callerID: "ACME",
      toUser: "8801712345678",
      messageContent: "Your code is 123456",
    });
  });

  it("honors KHUDEBARTA_API_URL, trailing slash and all", async () => {
    await khudebarta().send(
      { ...ENV, KHUDEBARTA_API_URL: "https://gw.example.com:4000/" },
      message()
    );
    assert.equal(calls[0].url, "https://gw.example.com:4000/sendtext");
  });

  it("sends one request per recipient and returns the first id", async () => {
    respondWith(
      { Status: "0", Message_ID: "111" },
      { Status: "0", Message_ID: "222" }
    );
    const result = await khudebarta().send(
      ENV,
      message({ to: ["+8801711111111", "+8801822222222"] })
    );

    assert.deepEqual(
      calls.map((call) => call.body.toUser),
      ["8801711111111", "8801822222222"]
    );
    assert.deepEqual(result, { messageId: "111" });
  });
});

describe("khudebarta: refused before any request", () => {
  it("throws provider_error when the API key is missing", async () => {
    const error = await sendError(
      { ...ENV, KHUDEBARTA_API_KEY: undefined },
      message()
    );
    assert.equal(error.code, "provider_error");
    assert.equal(calls.length, 0);
  });

  it("throws provider_error when the secret key is missing", async () => {
    const error = await sendError(
      { ...ENV, KHUDEBARTA_SECRET_KEY: "" },
      message()
    );
    assert.equal(error.code, "provider_error");
    assert.equal(calls.length, 0);
  });

  it("throws invalid_message when there is no sender", async () => {
    const error = await sendError(ENV, message({ from: undefined }));
    assert.equal(error.code, "invalid_message");
    assert.equal(calls.length, 0);
  });

  it("throws invalid_number for a non-+880 recipient anywhere in to[]", async () => {
    const error = await sendError(
      ENV,
      message({ to: ["+8801711111111", "+14155550123"] })
    );
    assert.equal(error.code, "invalid_number");
    assert.match(error.message, /\+14155550123/);
    assert.equal(calls.length, 0);
  });

  it("throws invalid_number for a +880 number with the wrong length", async () => {
    const error = await sendError(ENV, message({ to: ["+880"] }));
    assert.equal(error.code, "invalid_number");
    assert.equal(calls.length, 0);
  });
});

describe("khudebarta: rejections", () => {
  it("throws on an HTTP 200 that carries a failure Status", async () => {
    respondWith(rejected("-1", "Org Client Not Found"));
    const error = await sendError(ENV, message());
    assert.equal(error.code, "account_error");
  });

  // Every documented non-zero Status, in the order the vendor lists them.
  const table: [string, string, SmsErrorCode, boolean][] = [
    ["-1", "Org Client Not Found", "account_error", false],
    ["-3", "Invalid Dest No.", "invalid_number", false],
    ["-4", "Insufficient Balance", "account_error", false],
    ["-5", "Org Rate Not Found", "account_error", false],
    ["-6", "Org Blocked", "account_error", false],
    ["-7", "Invalid Sender ID", "account_error", false],
    ["-36", "Invalid Request Type", "provider_error", false],
    ["-42", "Authorization Failed", "account_error", false],
    ["-44", "ContactNo Blocked", "opted_out", false],
    ["-45", "ContactNo Blocked by Admin", "opted_out", false],
    ["-46", "Dipping Failed", "provider_error", false],
    ["-47", "Content not Whitelisted", "provider_error", false],
    ["-48", "URL Blocked", "provider_error", false],
    ["-49", "Content is Blocked", "provider_error", false],
    ["-52", "License Limit Exceeded", "account_error", false],
    ["-54", "Sender ID Empty", "account_error", false],
    ["-55", "Destination ID Empty", "invalid_number", false],
    ["-56", "Message Content Empty", "provider_error", false],
    ["-58", "HLR Request Failed", "provider_error", false],
    ["-59", "IP Not Allowed", "account_error", false],
    ["-60", "Invalid Hash value", "provider_error", false],
    ["-61", "Invalid parameter", "provider_error", false],
    ["-62", "Internal Server Error", "provider_error", true],
    ["-63", "Invalid Transaction ID", "provider_error", false],
    ["-64", "Sender ID Block", "account_error", false],
    ["-65", "Bulk Limit Exceeded", "provider_error", false],
    ["-66", "Invalid API Key", "account_error", false],
    ["-67", "Invalid Secret Key", "account_error", false],
    ["-68", "Duplicate Transaction ID", "provider_error", false],
  ];

  for (const [status, description, code, retryable] of table) {
    it(`Status ${status} (${description}) → ${code}${retryable ? ", retryable" : ""}`, async () => {
      respondWith(rejected(status, description));
      const error = await sendError(ENV, message());

      assert.equal(error.code, code);
      assert.equal(error.retryable, retryable);
      assert.equal(error.providerCode, status);
      assert.match(
        error.message,
        new RegExp(description.replaceAll(".", "\\."))
      );
    });
  }

  it("accepts a numeric Status of 0", async () => {
    respondWith({ Status: 0, Message_ID: 4242 });
    const result = await khudebarta().send(ENV, message());
    assert.deepEqual(result, { messageId: "4242" });
  });

  it("throws provider_error, not retryable, when the body has no Status", async () => {
    respondWith({ Text: "ACCEPTD" });
    const error = await sendError(ENV, message());
    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, false);
    assert.equal(error.providerCode, undefined);
    assert.match(error.message, /no Status/);
  });

  it("throws provider_error when Status is 0 but Message_ID is missing", async () => {
    respondWith({ Status: "0" });
    const error = await sendError(ENV, message());
    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, false);
    assert.match(error.message, /Message_ID/);
  });

  it("maps an undocumented status to provider_error, not retryable", async () => {
    respondWith(rejected("-99", "Something New"));
    const error = await sendError(ENV, message());
    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, false);
    assert.equal(error.providerCode, "-99");
  });

  it("stops at the first rejection, leaving earlier recipients sent", async () => {
    respondWith(
      { Status: "0", Message_ID: "111" },
      rejected("-3", "Invalid Dest No."),
      { Status: "0", Message_ID: "333" }
    );
    const error = await sendError(
      ENV,
      message({ to: ["+8801711111111", "+8801822222222", "+8801933333333"] })
    );
    assert.equal(error.code, "invalid_number");
    assert.equal(calls.length, 2);
  });
});

describe("khudebarta: transport failures", () => {
  it("maps a non-JSON body to provider_error, not retryable, naming the HTTP status", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("<html>Bad Gateway</html>", { status: 502 })
      )) as typeof fetch;

    const error = await sendError(ENV, message());
    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, false);
    assert.match(error.message, /unreadable response \(HTTP 502\)/);
  });

  it("refuses a redirect instead of following it", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://elsewhere.example/sendtext" },
        })
      )) as typeof fetch;

    const error = await sendError(ENV, message());
    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, false);
    assert.match(error.message, /redirect \(HTTP 302\)/);
  });

  it("maps a thrown fetch to provider_error, not retryable, with the cause", async () => {
    const failure = new TypeError("connection reset");
    globalThis.fetch = (() => Promise.reject(failure)) as typeof fetch;

    const error = await sendError(ENV, message());
    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, false);
    assert.equal(error.cause, failure);
  });

  it("maps an abort to provider_error, not retryable", async () => {
    const abort = new DOMException("timed out", "TimeoutError");
    globalThis.fetch = (() => Promise.reject(abort)) as typeof fetch;

    const error = await sendError(ENV, message());
    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, false);
    assert.match(error.message, /timed out/);
    assert.equal(error.cause, abort);
  });
});
