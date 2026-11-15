import { AUDIENCE_HEADER } from "@repo/auth/server";
import { testDatabase } from "@repo/db/testing";
import { describe, expect, it } from "vitest";
import app from "../index";

// The admin gate test. Every `/admin/*` route the api registers, from every installed
// module, must answer a caller with no session with a 401, and with nothing else.
//
// It reads the route table from `app.routes` rather than from a list written here, so a
// route a module or a project adds later is checked with no edit to this file. Each
// request carries no cookie, a malformed JSON body and a junk query string. A route whose
// validator runs before `adminGate` answers that request with a 400 naming the field it
// rejected, and this test fails on it. The fix is to list `adminGate` first on the route.
//
// Two kinds of path are left out. `/admin/auth/*` is Better Auth's own handler for the
// admin session, where a sign-in has to work with no session. Method `ALL` is how Hono
// records `.use()` middleware and `.all()` forwards, which serve no request of their own.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();

/** A value for every `:param` in a path. The gate refuses before any lookup uses it. */
const PLACEHOLDER = "x";

/** A query string every validator in the api rejects. */
const JUNK_QUERY = "?status=__bad__&limit=__bad__";

/** `METHOD path` for every admin route, once each, with its params filled in. */
const checked = [
  ...new Set(
    app.routes
      .filter(
        (route) =>
          route.path.startsWith("/admin/") &&
          !route.path.startsWith("/admin/auth/") &&
          route.method !== "ALL"
      )
      .map(
        (route) =>
          `${route.method} ${route.path.replaceAll(/:[^/]+/g, PLACEHOLDER)}`
      )
  ),
].toSorted();

describe("the admin gate", () => {
  it("finds admin routes to check", () => {
    expect(checked.length).toBeGreaterThan(0);
  });

  it.each(checked)("%s answers 401 with no session", async (route) => {
    const [method = "GET", path = "/"] = route.split(" ");
    const withBody = method !== "GET" && method !== "HEAD";
    const res = await app.request(
      `${path}${JUNK_QUERY}`,
      {
        body: withBody ? "{bad" : undefined,
        headers: {
          [AUDIENCE_HEADER]: "admin",
          ...(withBody ? { "content-type": "application/json" } : {}),
        },
        method,
      },
      database.env
    );
    expect(res.status).toBe(401);
  });
});
