import { drizzle } from "drizzle-orm/d1";
import { schema } from "./schema";

// The D1 client. `getDb` wraps a D1 binding in a Drizzle instance carrying the whole
// schema barrel, so callers get typed relational queries. A feature route reads its D1
// binding off Hono's `c.env.DB` (never `process.env` — bindings live on the Workers
// runtime) and hands it here:
//
//   const db = getDb(c.env.DB);
//
// `DbBindings` is the binding shape to compose into a route's Hono generic, so
// `c.env.DB` is typed without api's entry needing a code-level patch:
//
//   new Hono<{ Bindings: DbBindings }>()
export type DbBindings = { DB: D1Database };

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
