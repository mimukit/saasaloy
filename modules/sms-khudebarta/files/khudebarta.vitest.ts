// Tests for the Khudebarta provider. It ships as `packages/sms/src/providers/khudebarta.test.ts`
// when testing is on, and `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.
//
// `fetch` is stubbed, so nothing touches the network. `../provider` resolves by project path to
// the real `packages/sms` contract, so `SmsError`'s retryable coercion is the one a deployed
// Worker gets.
//
// The status table below is transcribed from Khudebarta's API document. It is the only thing that
// reads the error map back, because the live gateway cannot be reached until its certificate is
// renewed.

import { afterEach, assert, beforeEach, describe, expect, it } from "vitest";
import { khudebarta } from "./khudebarta";
import { SmsError } from "../provider";
import type { ResolvedSmsMessage, SmsEnv, SmsErrorCode } from "../provider";

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

describe("khudebarta provider", () => {
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
    // A send that resolves leaves its result here, which fails the instanceof check.
    const outcome: unknown = await khudebarta()
      .send(env, msg)
      .catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(SmsError);
    return outcome as SmsError;
  }

  describe("khudebarta: success", () => {
    it("is selected by the name `khudebarta`", () => {
      expect(khudebarta().name).toBe("khudebarta");
    });

    it("returns Message_ID as messageId", async () => {
      const result = await khudebarta().send(ENV, message());
      expect(result).toStrictEqual({ messageId: "31771702" });
    });

    it("posts JSON to <base>/sendtext with toUser stripped of its +", async () => {
      await khudebarta().send(ENV, message());

      expect(calls).toHaveLength(1);
      const [call] = calls;
      assert(call, "the provider made no fetch call");
      expect(call.url).toBe("https://portal.khudebarta.com:3770/sendtext");
      // Workers reject `redirect: "error"`, so the provider must ask for `"manual"`.
      expect(call.init).toMatchObject({ method: "POST", redirect: "manual" });
      expect(call.init.signal instanceof AbortSignal).toBeTruthy();
      expect(call.body).toStrictEqual({
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
      expect(calls[0]?.url).toBe("https://gw.example.com:4000/sendtext");
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

      expect(calls.map((call) => call.body.toUser)).toStrictEqual([
        "8801711111111",
        "8801822222222",
      ]);
      expect(result).toStrictEqual({ messageId: "111" });
    });
  });

  describe("khudebarta: refused before any request", () => {
    it("throws provider_error when the API key is missing", async () => {
      const error = await sendError(
        { ...ENV, KHUDEBARTA_API_KEY: undefined },
        message()
      );
      expect(error.code).toBe("provider_error");
      expect(calls).toHaveLength(0);
    });

    it("throws provider_error when the secret key is missing", async () => {
      const error = await sendError(
        { ...ENV, KHUDEBARTA_SECRET_KEY: "" },
        message()
      );
      expect(error.code).toBe("provider_error");
      expect(calls).toHaveLength(0);
    });

    it("throws invalid_message when there is no sender", async () => {
      const error = await sendError(ENV, message({ from: undefined }));
      expect(error.code).toBe("invalid_message");
      expect(calls).toHaveLength(0);
    });

    it("throws invalid_number for a non-+880 recipient anywhere in to[]", async () => {
      const error = await sendError(
        ENV,
        message({ to: ["+8801711111111", "+14155550123"] })
      );
      expect(error.code).toBe("invalid_number");
      expect(error.message).toMatch(/\+14155550123/);
      expect(calls).toHaveLength(0);
    });

    it("throws invalid_number for a +880 number with the wrong length", async () => {
      const error = await sendError(ENV, message({ to: ["+880"] }));
      expect(error.code).toBe("invalid_number");
      expect(calls).toHaveLength(0);
    });
  });

  describe("khudebarta: rejections", () => {
    it("throws on an HTTP 200 that carries a failure Status", async () => {
      respondWith(rejected("-1", "Org Client Not Found"));
      const error = await sendError(ENV, message());
      expect(error.code).toBe("account_error");
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

    it.each(table)(
      "Status %s (%s) → %s, retryable %s",
      async (status, description, code, retryable) => {
        respondWith(rejected(status, description));
        const error = await sendError(ENV, message());

        expect(error.code).toBe(code);
        expect(error.retryable).toBe(retryable);
        expect(error.providerCode).toBe(status);
        expect(error.message).toMatch(
          new RegExp(description.replaceAll(".", "\\."))
        );
      }
    );

    it("accepts a numeric Status of 0", async () => {
      respondWith({ Status: 0, Message_ID: 4242 });
      const result = await khudebarta().send(ENV, message());
      expect(result).toStrictEqual({ messageId: "4242" });
    });

    it("throws provider_error, not retryable, when the body has no Status", async () => {
      respondWith({ Text: "ACCEPTD" });
      const error = await sendError(ENV, message());
      expect(error.code).toBe("provider_error");
      expect(error.retryable).toBeFalsy();
      expect(error.providerCode).toBeUndefined();
      expect(error.message).toMatch(/no Status/);
    });

    it("throws provider_error when Status is 0 but Message_ID is missing", async () => {
      respondWith({ Status: "0" });
      const error = await sendError(ENV, message());
      expect(error.code).toBe("provider_error");
      expect(error.retryable).toBeFalsy();
      expect(error.message).toMatch(/Message_ID/);
    });

    it("maps an undocumented status to provider_error, not retryable", async () => {
      respondWith(rejected("-99", "Something New"));
      const error = await sendError(ENV, message());
      expect(error.code).toBe("provider_error");
      expect(error.retryable).toBeFalsy();
      expect(error.providerCode).toBe("-99");
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
      expect(error.code).toBe("invalid_number");
      expect(calls).toHaveLength(2);
    });
  });

  describe("khudebarta: transport failures", () => {
    it("maps a non-JSON body to provider_error, not retryable, naming the HTTP status", async () => {
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response("<html>Bad Gateway</html>", { status: 502 })
        )) as typeof fetch;

      const error = await sendError(ENV, message());
      expect(error.code).toBe("provider_error");
      expect(error.retryable).toBeFalsy();
      expect(error.message).toMatch(/unreadable response \(HTTP 502\)/);
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
      expect(error.code).toBe("provider_error");
      expect(error.retryable).toBeFalsy();
      expect(error.message).toMatch(/redirect \(HTTP 302\)/);
    });

    it("maps a thrown fetch to provider_error, not retryable, with the cause", async () => {
      const failure = new TypeError("connection reset");
      globalThis.fetch = (() => Promise.reject(failure)) as typeof fetch;

      const error = await sendError(ENV, message());
      expect(error.code).toBe("provider_error");
      expect(error.retryable).toBeFalsy();
      expect(error.cause).toBe(failure);
    });

    it("maps an abort to provider_error, not retryable", async () => {
      const abort = new DOMException("timed out", "TimeoutError");
      globalThis.fetch = (() => Promise.reject(abort)) as typeof fetch;

      const error = await sendError(ENV, message());
      expect(error.code).toBe("provider_error");
      expect(error.retryable).toBeFalsy();
      expect(error.message).toMatch(/timed out/);
      expect(error.cause).toBe(abort);
    });
  });
});
