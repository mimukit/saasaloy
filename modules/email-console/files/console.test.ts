// Tests for the console provider's default sender. Repo-only: the descriptor ships
// `console.ts` and nothing else, and this file runs on `node:test` via `pnpm test:modules`.
//
// `../provider` resolves through the shim beside this module to the real `packages/email`
// contract, and the send goes through the real core in `modules/email`, so `resolve()`'s
// fallback to `defaultFrom` is what is under test.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { defineEmail } from "../../email/files/src/define.ts";
import { consoleEmail } from "./console.ts";

const MESSAGE = { to: "user@example.com", subject: "Hi", html: "<p>Hi</p>" };

let logged: string[];

beforeEach(() => {
  logged = [];
  mock.method(console, "log", (line: string) => {
    logged.push(line);
  });
});

afterEach(() => {
  mock.restoreAll();
});

describe("consoleEmail: default sender", () => {
  it("logs a mail from dev@localhost when EMAIL_FROM is unset", async () => {
    await defineEmail({ providers: [consoleEmail()] })
      .create({ EMAIL_PROVIDER: "console" })
      .send(MESSAGE);
    assert.match(logged.join("\n"), /^from: +dev@localhost$/m);
  });

  it("logs the sender consoleEmail({ from }) names instead", async () => {
    await defineEmail({ providers: [consoleEmail({ from: "app@test.local" })] })
      .create({ EMAIL_PROVIDER: "console" })
      .send(MESSAGE);
    assert.match(logged.join("\n"), /^from: +app@test\.local$/m);
  });

  it("still logs EMAIL_FROM when it is set", async () => {
    await defineEmail({ providers: [consoleEmail()] })
      .create({ EMAIL_PROVIDER: "console", EMAIL_FROM: "app@example.com" })
      .send(MESSAGE);
    assert.match(logged.join("\n"), /^from: +app@example\.com$/m);
  });
});
