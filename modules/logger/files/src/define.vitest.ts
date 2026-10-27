// Tests for the redaction in ./define.ts. `redact` is private, so the test drives it
// through the seam a route uses: a registry built over a capturing provider. That is the
// path a real leak would take, which is what makes it worth asserting. It ships as
// `src/define.test.ts` when testing is on, and `pnpm test:modules` runs it in place in
// the saasaloy repo.

import { assert, describe, expect, it } from "vitest";
import { defineLogger } from "./define";
import type { LogEvent, LogProvider } from "./provider";

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
  assert(event, "the capturing provider received no event");
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
      expect(value).toBe(REDACTED);
    }
  });

  it("matches a key case-insensitively", () => {
    const event = logWith({ AUTHORIZATION: "Bearer abc", Cookie: "sid=1" });
    expect(event.fields?.AUTHORIZATION).toBe(REDACTED);
    expect(event.fields?.Cookie).toBe(REDACTED);
  });

  // Exact match, not substring: `authorizationHeader` is a different field, and treating
  // it as a hit would redact fields nobody meant to hide.
  it("leaves a key that merely contains a denied name alone", () => {
    const event = logWith({ authorizationHeader: "visible", tokenCount: 3 });
    expect(event.fields?.authorizationHeader).toBe("visible");
    expect(event.fields?.tokenCount).toBe(3);
  });

  it("redacts one level into a nested plain object", () => {
    const event = logWith({ headers: { accept: "json", cookie: "sid=1" } });
    expect(event.fields?.headers).toStrictEqual({
      accept: "json",
      cookie: REDACTED,
    });
  });

  it("unions a project's extra keys with the built-in list", () => {
    const event = logWith({ authorization: "a", ssn: "1" }, ["ssn"]);
    expect(event.fields?.ssn).toBe(REDACTED);
    expect(event.fields?.authorization).toBe(REDACTED);
  });

  it("redacts a field bound through child() as well as a call-site one", () => {
    const sink = capturing();
    const registry = defineLogger({ providers: [sink.provider] });
    registry.create({}).child({ token: "bound" }).info("hello", { keep: 1 });
    const [event] = sink.events;
    expect(event?.fields?.token).toBe(REDACTED);
    expect(event?.fields?.keep).toBe(1);
  });

  it("leaves an undenied field untouched", () => {
    const event = logWith({ requestId: "r-1", userId: "u-1" });
    expect(event.fields?.requestId).toBe("r-1");
    expect(event.fields?.userId).toBe("u-1");
  });
});
