// Tests for maintenance mode: who gets the 503 page and who walks past it. It ships as
// `maintenance.test.ts` beside `maintenance.ts` when testing is on, and
// `pnpm test:modules` runs it in place in the saasaloy repo.
//
// Nothing here is stubbed except the Hono context, which is a hand-built object carrying the
// three members the middleware reads (`req.path`, and the `html` and `next` it calls). `hono`
// is not a dependency of this repo, and resolving it from a global cache would be luck rather
// than a test.
//
// The flag client and the admin check are *arguments* to `maintenance()`, not imports, so
// this file needs no database, no session and no kv. That is the reason they are injected.
//
// `@repo/feature-flags` resolves to the real core: in a project through the workspace, and
// in the saasaloy repo through the module layout `pnpm test:modules` builds.

import { MAINTENANCE_KEY } from "@repo/feature-flags";
import type { Context } from "hono";
import { assert, describe, expect, it } from "vitest";
import { isBypassPath, maintenance, maintenanceHtml } from "./maintenance";
import type { MaintenanceOptions } from "./maintenance";

/** One `c.html(...)` call, as the middleware made it. */
interface HtmlCall {
  body: string;
  headers: Record<string, string>;
  status: number;
}

/** The slice of Hono's context the middleware reads, plus a record of what it did. */
function honoContext(path: string) {
  const calls: { html: HtmlCall | null; nexted: boolean } = {
    html: null,
    nexted: false,
  };
  const slice = {
    html: (body: string, status: number, headers: Record<string, string>) => {
      calls.html = { body, headers, status };
      return { body, headers, status };
    },
    req: { path },
  };
  return {
    calls,
    // The middleware reads only these members; a full Hono Context is not built here.
    c: slice as unknown as Context,
    next: () => {
      calls.nexted = true;
      return Promise.resolve();
    },
  };
}

/** The page the middleware served; fails the test when it served none. */
function served(calls: { html: HtmlCall | null }): HtmlCall {
  assert(calls.html, "the middleware served no page");
  return calls.html;
}

/** A flag client that answers one value, and counts how often it was asked. */
function flagClient(value: boolean, thrown?: Error) {
  const asked: string[] = [];
  return {
    asked,
    build: () => ({
      flag: (key: string) => {
        asked.push(key);
        if (thrown) {
          return Promise.reject(thrown);
        }
        return Promise.resolve(value);
      },
    }),
  };
}

async function run(options: MaintenanceOptions, path: string) {
  const { c, calls, next } = honoContext(path);
  await maintenance(options)(c, next);
  return calls;
}

describe(isBypassPath, () => {
  it("matches a prefix at a path boundary", () => {
    expect(isBypassPath("/auth/sign-in", ["/auth"])).toBeTruthy();
    expect(isBypassPath("/auth", ["/auth"])).toBeTruthy();
  });

  it("does not match a prefix mid-segment", () => {
    // `/authors` is not under `/auth`, and matching it would leave a route open by accident.
    expect(isBypassPath("/authors", ["/auth"])).toBeFalsy();
  });

  it("matches only itself for the root path", () => {
    expect(isBypassPath("/", ["/"])).toBeTruthy();
    expect(isBypassPath("/anything", ["/"])).toBeFalsy();
  });
});

/** An admin check that always answers the same way. */
const isAdmin = (value: boolean) => () => Promise.resolve(value);

describe(maintenance, () => {
  it("passes every request through while the flag is off", async () => {
    const flags = flagClient(false);
    const calls = await run(
      { flags: flags.build, isAdmin: isAdmin(false) },
      "/users"
    );

    expect(calls.nexted).toBeTruthy();
    expect(calls.html).toBeNull();
    expect(flags.asked).toStrictEqual([MAINTENANCE_KEY]);
  });

  it("serves a 503 page with Retry-After while the flag is on", async () => {
    const flags = flagClient(true);
    const calls = await run(
      { flags: flags.build, isAdmin: isAdmin(false) },
      "/users"
    );

    expect(calls.nexted).toBeFalsy();
    expect(served(calls).status).toBe(503);
    expect(served(calls).headers["Retry-After"]).toBe("300");
    expect(served(calls).headers["Cache-Control"]).toBe("no-store");
    expect(served(calls).body).toMatch(/Down for maintenance/);
  });

  it("lets an admin through", async () => {
    const flags = flagClient(true);
    const calls = await run(
      { flags: flags.build, isAdmin: isAdmin(true) },
      "/users"
    );

    expect(calls.nexted).toBeTruthy();
    expect(calls.html).toBeNull();
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

    expect(calls.nexted).toBeTruthy();
    expect(flags.asked, "a health check costs no kv read").toStrictEqual([]);
  });

  it("fails open when the flag cannot be resolved", async () => {
    const flags = flagClient(true, new Error("kv is having a day"));
    const calls = await run(
      { flags: flags.build, isAdmin: isAdmin(false) },
      "/users"
    );

    expect(calls.nexted, "a store outage does not close the site").toBeTruthy();
    expect(calls.html).toBeNull();
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

    expect(served(calls).headers["Retry-After"]).toBe("60");
    expect(served(calls).body).toMatch(/Upgrading the database/);
    expect(served(calls).body).toMatch(/Back at 09:00 UTC\./);
  });
});

describe(maintenanceHtml, () => {
  it("escapes the copy", () => {
    const html = maintenanceHtml({
      message: 'a "quote" & an <img>',
      title: "<script>alert(1)</script>",
    });

    expect(!html.includes("<script>")).toBeTruthy();
    expect(html).toMatch(/&lt;script&gt;/);
    expect(html).toMatch(/&quot;quote&quot; &amp; an &lt;img&gt;/);
  });

  it("depends on no other request", () => {
    const html = maintenanceHtml({ message: "m", title: "t" });

    expect(!html.includes("<link")).toBeTruthy();
    expect(!html.includes("<script")).toBeTruthy();
  });
});
