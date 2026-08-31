// Tests for the redaction in ./define.ts. `redact` is private, so the test drives it
// through the seam a route uses: a registry built over a capturing provider. That is the
// path a real leak would take, which is what makes it worth asserting. This file is NOT
// in the descriptor's `files`/`scaffolds[].files` list, so `add logger` never copies it
// into a user's project — it exists for this repo only.
//
// It runs on `node:test`, not on the CLI's vitest instance, and the reason is mechanical:
// vite has to load a tsconfig for every file it transforms, the payload's own
// `modules/logger/files/tsconfig.json` extends `@repo/tsconfig/base.json`, and that
// package resolves only inside a scaffolded project. Vitest therefore fails the file with
// TSCONFIG_ERROR before a single assertion runs. Node 24 strips the types with no tsconfig
// at all. Run them with `pnpm test:modules`; `pnpm test` runs that after the turbo pass.
//
// The import needs the explicit `.ts` extension because Node's type stripping resolves the
// real file rather than a bundler's guess. Shipped payload code keeps the extensionless
// style the rest of the modules use; only this repo-only file differs.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineLogger } from "./define.ts";
import type { LogEvent, LogProvider } from "./provider.ts";

const REDACTED = "[redacted]";

/** A provider that writes nowhere and keeps every event, so a test can read the fields. */
function capturing(): { provider: LogProvider; events: LogEvent[] } {
  const events: LogEvent[] = [];
  return {
    events,
    provider: {
      name: "capture",
      write(_env, event) {
        events.push(event);
      },
    },
  };
}

function logWith(
  fields: Record<string, unknown>,
  redactExtra?: string[]
): LogEvent {
  const sink = capturing();
  const registry = defineLogger({
    providers: [sink.provider],
    ...(redactExtra ? { redact: redactExtra } : {}),
  });
  registry.create({}).info("hello", fields);
  const [event] = sink.events;
  assert.ok(event, "the capturing provider received no event");
  return event;
}

describe("redaction", () => {
  it("redacts every built-in key", () => {
    const event = logWith({
      api_key: "k",
      authorization: "Bearer abc",
      cookie: "sid=1",
      password: "hunter2",
      secret: "s",
      "set-cookie": "sid=1",
      token: "t",
    });
    for (const value of Object.values(event.fields ?? {})) {
      assert.equal(value, REDACTED);
    }
  });

  it("matches a key case-insensitively", () => {
    const event = logWith({ AUTHORIZATION: "Bearer abc", Cookie: "sid=1" });
    assert.equal(event.fields?.AUTHORIZATION, REDACTED);
    assert.equal(event.fields?.Cookie, REDACTED);
  });

  // Exact match, not substring: `authorizationHeader` is a different field, and treating
  // it as a hit would redact fields nobody meant to hide.
  it("leaves a key that merely contains a denied name alone", () => {
    const event = logWith({ authorizationHeader: "visible", tokenCount: 3 });
    assert.equal(event.fields?.authorizationHeader, "visible");
    assert.equal(event.fields?.tokenCount, 3);
  });

  it("redacts one level into a nested plain object", () => {
    const event = logWith({ headers: { accept: "json", cookie: "sid=1" } });
    assert.deepEqual(event.fields?.headers, {
      accept: "json",
      cookie: REDACTED,
    });
  });

  it("unions a project's extra keys with the built-in list", () => {
    const event = logWith({ authorization: "a", ssn: "1" }, ["ssn"]);
    assert.equal(event.fields?.ssn, REDACTED);
    assert.equal(event.fields?.authorization, REDACTED);
  });

  it("redacts a field bound through child() as well as a call-site one", () => {
    const sink = capturing();
    const registry = defineLogger({ providers: [sink.provider] });
    registry.create({}).child({ token: "bound" }).info("hello", { keep: 1 });
    const [event] = sink.events;
    assert.equal(event?.fields?.token, REDACTED);
    assert.equal(event?.fields?.keep, 1);
  });

  it("leaves an undenied field untouched", () => {
    const event = logWith({ requestId: "r-1", userId: "u-1" });
    assert.equal(event.fields?.requestId, "r-1");
    assert.equal(event.fields?.userId, "u-1");
  });
});
