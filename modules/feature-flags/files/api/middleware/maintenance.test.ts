// Tests for maintenance mode: who gets the 503 page and who walks past it. Repo-only — the
// descriptor ships `maintenance.ts`, never this file.
//
// Nothing here is stubbed except the Hono context, which is a hand-built object carrying the
// three members the middleware reads (`req.path`, and the `html` and `next` it calls). `hono`
// is not a dependency of this repo, and resolving it from a global cache would be luck rather
// than a test.
//
// The flag client and the admin check are *arguments* to `maintenance()`, not imports, so
// this file needs no database, no session and no kv. That is the reason they are injected.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

// Two bare specifiers only exist inside a scaffolded project. Both are mapped to the real
// files in this repo, so the middleware under test is the code a generated project gets.
const FLAGS_CORE = new URL("../../src/index.ts", import.meta.url).href;
const KV_CORE = new URL("../../../../kv/files/src/index.ts", import.meta.url)
  .href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@repo/feature-flags") {
      return nextResolve(FLAGS_CORE, context);
    }
    if (specifier === "@repo/kv") {
      return nextResolve(KV_CORE, context);
    }
    return nextResolve(specifier, context);
  },
});

// Dynamic, and after the hook: a static import is hoisted above `registerHooks`.
const { MAINTENANCE_KEY } = await import(FLAGS_CORE);
const { isBypassPath, maintenance, maintenanceHtml } =
  await import("./maintenance.ts");

/** The slice of Hono's context the middleware reads, plus a record of what it did. */
function honoContext(path) {
  const calls = { html: null, nexted: false };
  return {
    calls,
    c: {
      html: (body, status, headers) => {
        calls.html = { body, headers, status };
        return { body, headers, status };
      },
      req: { path },
    },
    next: () => {
      calls.nexted = true;
      return Promise.resolve();
    },
  };
}

/** A flag client that answers one value, and counts how often it was asked. */
function flagClient(value, thrown) {
  const asked = [];
  return {
    asked,
    build: () => ({
      flag: (key) => {
        asked.push(key);
        if (thrown) {
          return Promise.reject(thrown);
        }
        return Promise.resolve(value);
      },
    }),
  };
}

async function run(options, path) {
  const { c, calls, next } = honoContext(path);
  await maintenance(options)(c, next);
  return calls;
}

describe("isBypassPath", () => {
  it("matches a prefix at a path boundary", () => {
    assert.equal(isBypassPath("/auth/sign-in", ["/auth"]), true);
    assert.equal(isBypassPath("/auth", ["/auth"]), true);
  });

  it("does not match a prefix mid-segment", () => {
    // `/authors` is not under `/auth`, and matching it would leave a route open by accident.
    assert.equal(isBypassPath("/authors", ["/auth"]), false);
  });

  it("matches only itself for the root path", () => {
    assert.equal(isBypassPath("/", ["/"]), true);
    assert.equal(isBypassPath("/anything", ["/"]), false);
  });
});

/** An admin check that always answers the same way. */
const isAdmin = (value) => () => Promise.resolve(value);

describe("maintenance", () => {
  it("passes every request through while the flag is off", async () => {
    const flags = flagClient(false);
    const calls = await run(
      { flags: flags.build, isAdmin: isAdmin(false) },
      "/users"
    );

    assert.equal(calls.nexted, true);
    assert.equal(calls.html, null);
    assert.deepEqual(flags.asked, [MAINTENANCE_KEY]);
  });

  it("serves a 503 page with Retry-After while the flag is on", async () => {
    const flags = flagClient(true);
    const calls = await run(
      { flags: flags.build, isAdmin: isAdmin(false) },
      "/users"
    );

    assert.equal(calls.nexted, false);
    assert.equal(calls.html.status, 503);
    assert.equal(calls.html.headers["Retry-After"], "300");
    assert.equal(calls.html.headers["Cache-Control"], "no-store");
    assert.match(calls.html.body, /Down for maintenance/);
  });

  it("lets an admin through", async () => {
    const flags = flagClient(true);
    const calls = await run(
      { flags: flags.build, isAdmin: isAdmin(true) },
      "/users"
    );

    assert.equal(calls.nexted, true);
    assert.equal(calls.html, null);
  });

  it("lets a configured path through without reading the flag", async () => {
    const flags = flagClient(true);
    const calls = await run(
      {
        bypassPaths: ["/health", "/auth"],
        flags: flags.build,
        isAdmin: isAdmin(false),
      },
      "/health"
    );

    assert.equal(calls.nexted, true);
    assert.deepEqual(flags.asked, [], "a health check costs no kv read");
  });

  it("fails open when the flag cannot be resolved", async () => {
    const flags = flagClient(true, new Error("kv is having a day"));
    const calls = await run(
      { flags: flags.build, isAdmin: isAdmin(false) },
      "/users"
    );

    assert.equal(calls.nexted, true, "a store outage does not close the site");
    assert.equal(calls.html, null);
  });

  it("uses the configured wording and retry window", async () => {
    const flags = flagClient(true);
    const calls = await run(
      {
        flags: flags.build,
        isAdmin: isAdmin(false),
        page: {
          message: "Back at 09:00 UTC.",
          title: "Upgrading the database",
        },
        retryAfterSeconds: 60,
      },
      "/users"
    );

    assert.equal(calls.html.headers["Retry-After"], "60");
    assert.match(calls.html.body, /Upgrading the database/);
    assert.match(calls.html.body, /Back at 09:00 UTC\./);
  });
});

describe("maintenanceHtml", () => {
  it("escapes the copy", () => {
    const html = maintenanceHtml({
      message: 'a "quote" & an <img>',
      title: "<script>alert(1)</script>",
    });

    assert.ok(!html.includes("<script>"));
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&quot;quote&quot; &amp; an &lt;img&gt;/);
  });

  it("depends on no other request", () => {
    const html = maintenanceHtml({ message: "m", title: "t" });

    assert.ok(!html.includes("<link"));
    assert.ok(!html.includes("<script"));
  });
});
