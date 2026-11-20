// Tests for the vendor-blind half of packages/sms: provider selection, the E.164 check on every
// recipient, the empty-body check and the wrapping of a raw provider throw. Provider selection
// follows the rule AGENTS.md states for every capability: `SMS_PROVIDER` is required, and an
// unset or unknown value throws at construction. This file is repo-only (the descriptor does not
// list it), and it runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineSms } from "./define.ts";
import { SmsError } from "./provider.ts";
import type { ResolvedSmsMessage, SmsProvider } from "./provider.ts";

/** A provider that records what it was handed and sends nothing. */
function recorder(name: string) {
  const sent: ResolvedSmsMessage[] = [];
  const provider: SmsProvider = {
    name,
    send(_env, message) {
      sent.push(message);
      return Promise.resolve({ messageId: `${name}-1` });
    },
  };
  return { provider, sent };
}

function clientFor(provider: SmsProvider) {
  return defineSms({ providers: [provider] }).create({
    SMS_PROVIDER: provider.name,
  });
}

function isInvalidMessage(error: unknown): boolean {
  return (
    error instanceof SmsError &&
    error.code === "invalid_message" &&
    error.retryable === false
  );
}

describe("defineSms: provider selection", () => {
  it("throws when SMS_PROVIDER is unset", () => {
    const registry = defineSms({ providers: [recorder("console").provider] });
    assert.throws(() => registry.create({}), /SMS_PROVIDER is not set/);
  });

  it("throws when SMS_PROVIDER names an unregistered provider, and lists the registered ones", () => {
    const registry = defineSms({ providers: [recorder("console").provider] });
    assert.throws(
      () => registry.create({ SMS_PROVIDER: "twilio" }),
      /SMS_PROVIDER is "twilio", which is not registered\. Registered providers: console\./
    );
  });

  it("names the install command when no provider is registered", () => {
    const registry = defineSms({ providers: [] });
    assert.throws(
      () => registry.create({ SMS_PROVIDER: "console" }),
      /saasaloy add sms-console/
    );
  });

  it("selects the named provider, not the first one", async () => {
    const first = recorder("console");
    const second = recorder("khudebarta");
    const client = defineSms({
      providers: [first.provider, second.provider],
    }).create({ SMS_PROVIDER: "khudebarta" });

    assert.equal(client.provider, "khudebarta");
    const result = await client.send({ to: "+14155550123", body: "Hi" });
    assert.equal(result.messageId, "khudebarta-1");
    assert.equal(first.sent.length, 0);
    assert.equal(second.sent.length, 1);
  });
});

describe("defineSms: recipient and body checks", () => {
  it("accepts an E.164 number and hands the provider a normalized message", async () => {
    const { provider, sent } = recorder("console");
    await clientFor(provider).send({ to: "+14155550123", body: "Hi" });

    assert.deepEqual(sent[0]?.to, ["+14155550123"]);
    assert.equal(sent[0]?.estimatedSegments, 1);
  });

  for (const [label, number] of [
    ["a number with no +", "14155550123"],
    ["a country code that starts with 0", "+04155550123"],
    ["16 digits", "+1415555012345678"],
  ] as const) {
    it(`rejects ${label} as invalid_message, before the provider is called`, async () => {
      const { provider, sent } = recorder("console");
      await assert.rejects(
        clientFor(provider).send({ to: number, body: "Hi" }),
        isInvalidMessage
      );
      assert.equal(sent.length, 0);
    });
  }

  it("rejects the whole send when one of several recipients is not E.164", async () => {
    const { provider, sent } = recorder("console");
    await assert.rejects(
      clientFor(provider).send({
        to: ["+14155550123", "555-0123"],
        body: "Hi",
      }),
      isInvalidMessage
    );
    assert.equal(sent.length, 0);
  });

  it("rejects an empty recipient list as invalid_message", async () => {
    const { provider } = recorder("console");
    await assert.rejects(
      clientFor(provider).send({ to: [], body: "Hi" }),
      isInvalidMessage
    );
  });

  it("rejects an empty body as invalid_message", async () => {
    const { provider, sent } = recorder("console");
    await assert.rejects(
      clientFor(provider).send({ to: "+14155550123", body: "" }),
      isInvalidMessage
    );
    assert.equal(sent.length, 0);
  });
});

describe("defineSms: a raw provider throw", () => {
  it("reaches the caller as provider_error with retryable false", async () => {
    const cause = new TypeError("fetch failed");
    const client = clientFor({
      name: "broken",
      send: () => Promise.reject(cause),
    });

    await assert.rejects(
      client.send({ to: "+14155550123", body: "Hi" }),
      (error: unknown) =>
        error instanceof SmsError &&
        error.code === "provider_error" &&
        error.retryable === false &&
        error.cause === cause
    );
  });

  it("passes a well-formed SmsError through untouched", async () => {
    const original = new SmsError("rate_limited", "slow down", {
      retryable: true,
    });
    const client = clientFor({
      name: "limited",
      send: () => Promise.reject(original),
    });

    await assert.rejects(
      client.send({ to: "+14155550123", body: "Hi" }),
      (error: unknown) => error === original
    );
  });
});
