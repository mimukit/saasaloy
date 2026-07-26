import { zValidator } from "@hono/zod-validator";
import { getDb, type DbBindings } from "@repo/db/client";
import { waitlist as waitlistTable } from "@repo/db/schema/waitlist";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

// Route module contract: default-export a Hono sub-app named after the file. This one
// mounts at `/waitlist`, so `post("/")` serves `POST /waitlist`.
const waitlist = new Hono<{ Bindings: DbBindings }>();

// web and api are separate origins in dev (:3000 vs :4000) and in prod — CORS is
// mounted here, route-level, rather than touching the shared api entry.
waitlist.use("*", cors());

const submitSchema = z.object({ email: z.email() });

waitlist.post("/", zValidator("json", submitSchema), async (c) => {
  const { email } = c.req.valid("json");
  const db = getDb(c.env.DB);

  // Idempotent: a duplicate email is a conflict Drizzle silently no-ops, not an error —
  // the visitor sees the same "you're on the list" response, no membership leak.
  await db.insert(waitlistTable).values({ email, createdAt: new Date() }).onConflictDoNothing();

  return c.json({ ok: true });
});

export default waitlist;
