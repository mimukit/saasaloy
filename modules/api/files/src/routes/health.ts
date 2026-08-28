import { Hono } from "hono";

// Route module contract: export a Hono sub-app under a NAMED export matching the
// file, built as ONE chained expression. The chain is what carries the sub-app's
// types — break it into separate `health.get(...)` statements and the exported
// type forgets every route, which empties out `AppType` for the client.
//
// The export is named, not default, because that is what the `chained-route` patch
// a module registers itself with writes: `import { health } from "./routes/health"`.
// The codemod refuses to wire a link whose binding is a default import.
//
// Paths are RELATIVE TO THE MOUNT — this file mounts at `/health`, so `get("/")`
// serves `GET /health` (not `get("/health")`, which would be `/health/health`).
//
// Pass the status explicitly to `c.json`. `hc` infers the response type per status
// code, so an omitted `200` leaves the caller with a looser type than the route has.
export const health = new Hono().get("/", (c) => c.json({ status: "ok" }, 200));
