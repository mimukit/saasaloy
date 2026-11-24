// Tests for provider selection in ./define.ts, the rule AGENTS.md states for every capability:
// `EMAIL_PROVIDER` is required, and an unset or unknown value throws at construction. This file
// is repo-only (the descriptor does not list it, so `saasaloy add email` never copies it), and it
// runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineEmail } from "./define.ts";
import { EmailError } from "./provider.ts";
import type { EmailProvider, ResolvedEmailMessage } from "./provider.ts";

/** A provider that records what it was handed and sends nothing. */
function recorder(name: string) {
  const sent: ResolvedEmailMessage[] = [];
  const provider: EmailProvider = {
    name,
    send(_env, message) {
      sent.push(message);
      return Promise.resolve({ messageId: `${name}-1` });
    },
  };
  return { provider, sent };
}

describe("defineEmail: provider selection", () => {
  it("throws when EMAIL_PROVIDER is unset", () => {
    const registry = defineEmail({ providers: [recorder("console").provider] });
    assert.throws(() => registry.create({}), /EMAIL_PROVIDER is not set/);
  });

  it("throws when EMAIL_PROVIDER is empty", () => {
    const registry = defineEmail({ providers: [recorder("console").provider] });
    assert.throws(
      () => registry.create({ EMAIL_PROVIDER: "" }),
      /EMAIL_PROVIDER is not set/
    );
  });

  it("throws when EMAIL_PROVIDER names an unregistered provider, and lists the registered ones", () => {
    const registry = defineEmail({ providers: [recorder("console").provider] });
    assert.throws(
      () => registry.create({ EMAIL_PROVIDER: "resend" }),
      /EMAIL_PROVIDER is "resend", which is not registered\. Registered providers: console\./
    );
  });

  it("names the install command when no provider is registered", () => {
    const registry = defineEmail({ providers: [] });
    assert.throws(
      () => registry.create({ EMAIL_PROVIDER: "console" }),
      /saasaloy add email-console/
    );
  });

  it("selects the named provider, not the first one", async () => {
    const first = recorder("console");
    const second = recorder("plunk");
    const client = defineEmail({
      providers: [first.provider, second.provider],
    }).create({ EMAIL_PROVIDER: "plunk", EMAIL_FROM: "app@example.com" });

    assert.equal(client.provider, "plunk");
    const result = await client.send({
      to: "user@example.com",
      subject: "Hi",
      html: "<p>Hi</p>",
    });
    assert.equal(result.messageId, "plunk-1");
    assert.equal(first.sent.length, 0);
    assert.equal(second.sent.length, 1);
  });

  it("wraps a raw provider throw as a non-retryable provider_error", async () => {
    const client = defineEmail({
      providers: [
        {
          name: "broken",
          send: () => Promise.reject(new TypeError("fetch failed")),
        },
      ],
    }).create({ EMAIL_PROVIDER: "broken", EMAIL_FROM: "app@example.com" });

    await assert.rejects(
      client.send({ to: "user@example.com", subject: "Hi", html: "<p>Hi</p>" }),
      (error: unknown) =>
        error instanceof EmailError &&
        error.code === "provider_error" &&
        error.retryable === false
    );
  });
});

describe("defineEmail: sender resolution", () => {
  const MESSAGE = { to: "user@example.com", subject: "Hi", html: "<p>Hi</p>" };

  /** A recorder that carries a `defaultFrom`, the way `consoleEmail()` does. */
  function withDefault(defaultFrom: string) {
    const { provider, sent } = recorder("console");
    return { provider: { ...provider, defaultFrom }, sent };
  }

  it("falls back to the provider's defaultFrom when EMAIL_FROM is unset", async () => {
    const { provider, sent } = withDefault("dev@localhost");
    await defineEmail({ providers: [provider] })
      .create({ EMAIL_PROVIDER: "console" })
      .send(MESSAGE);
    assert.equal(sent[0]?.from, "dev@localhost");
  });

  it("treats a blank EMAIL_FROM as unset", async () => {
    const { provider, sent } = withDefault("dev@localhost");
    await defineEmail({ providers: [provider] })
      .create({ EMAIL_PROVIDER: "console", EMAIL_FROM: "" })
      .send(MESSAGE);
    assert.equal(sent[0]?.from, "dev@localhost");
  });

  it("prefers EMAIL_FROM to defaultFrom, and the message's from to both", async () => {
    const { provider, sent } = withDefault("dev@localhost");
    const client = defineEmail({ providers: [provider] }).create({
      EMAIL_PROVIDER: "console",
      EMAIL_FROM: "app@example.com",
    });
    await client.send(MESSAGE);
    await client.send({ ...MESSAGE, from: "ops@example.com" });
    assert.deepEqual(
      sent.map((message) => message.from),
      ["app@example.com", "ops@example.com"]
    );
  });

  it("throws invalid_message when no sender is named anywhere", async () => {
    const { provider, sent } = recorder("plunk");
    const client = defineEmail({ providers: [provider] }).create({
      EMAIL_PROVIDER: "plunk",
    });
    await assert.rejects(
      client.send(MESSAGE),
      (error: unknown) =>
        error instanceof EmailError &&
        error.code === "invalid_message" &&
        /set EMAIL_FROM/.test(error.message) &&
        /plunk provider has no default sender/.test(error.message)
    );
    assert.equal(sent.length, 0);
  });
});
