import { declare, zValidator } from "../contract";
import { withDb } from "@repo/db/client";
import type { DbBindings } from "@repo/db/client";
import { waitlistEntries as waitlistTable } from "@repo/db/schema/waitlist";
import { errorBody } from "@repo/validators/common";
import { waitlistInput } from "@repo/validators/waitlist";
import { Hono } from "hono";

// Route module contract: export a Hono sub-app under a NAMED export matching the file,
// built as ONE chained expression. The chain carries the sub-app's types — split it into
// separate `waitlist.post(...)` statements and the exported type forgets the route, which
// empties it out of `AppType`. The name has to be an `export const`: the generated
// `routes.generated.ts` imports it by name, as
// `import { waitlist } from "./routes/waitlist"`.
//
// `modules/waitlist`'s `api.routes` row mounts this at `/waitlist`, so `post("/")`
// serves `POST /waitlist`. Paths here are relative to that mount.
//
// No CORS here. web and api are separate origins in dev (:3000 vs :4000) and in prod,
// but `modules/api`'s spine already applies the credentialed `CORS_ORIGINS` allowlist to
// `*` before this sub-app is mounted. A route-level `cors()` would run as an inner
// middleware and overwrite those headers with its own permissive defaults.
export const waitlist = new Hono<{ Bindings: DbBindings }>().post(
  "/",
  declare({
    name: "waitlist_join",
    description: "Put an email address on the launch waitlist.",
    agent: { callable: false, reason: "A public form for people, not agents." },
  }),
  // The third argument is the failure hook. Without it `zValidator` answers with Hono's
  // default body; with it, a rejected address gets the shared `{ error: { code, message } }`
  // envelope, and `hc` sees a 400 whose shape a caller can branch on.
  zValidator("json", waitlistInput, (result, c) => {
    if (!result.success) {
      const [issue] = result.error.issues;
      const message = issue
        ? `${issue.path.join(".")}: ${issue.message}`
        : "invalid request body";
      return c.json(errorBody("invalid_input", message), 400);
    }
  }),
  // `withDb` is the call shape the database driver exports. It opens a connection for the
  // request and closes it on `c.executionCtx.waitUntil`. Read what you need *inside* the
  // callback — the Postgres client starts closing the moment the callback settles, and
  // rejects every query issued after.
  //
  // The dialect only reaches the table declaration, which `modules/waitlist` ships in
  // `files/db/schema/waitlist.ts`.
  (c) =>
    withDb(c, async (db) => {
      const { email } = c.req.valid("json");

      // Idempotent: a duplicate email is a conflict Drizzle silently no-ops, not an error —
      // the visitor sees the same 201 response, no membership leak. A 409 here would tell an
      // unauthenticated caller whether an address is already on the list.
      await db
        .insert(waitlistTable)
        .values({ email, createdAt: new Date() })
        .onConflictDoNothing();

      // Pass the status explicitly. `hc` keys the response type by status code, so an
      // omitted `201` leaves the caller with a looser type than the route actually has.
      return c.json({ ok: true }, 201);
    })
);
