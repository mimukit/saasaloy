import { Hono } from "hono";

// Route module contract: default-export a Hono sub-app built as ONE chained
// expression, named after the service. The chain is what carries the sub-app's
// types — break it into separate `health.get(...)` statements and the exported
// type forgets every route, which empties out `AppType` for the client.
//
// Paths are RELATIVE TO THE MOUNT — this file mounts at `/health`, so `get("/")`
// serves `GET /health` (not `get("/health")`, which would be `/health/health`).
//
// Pass the status explicitly to `c.json`. `hc` infers the response type per status
// code, so an omitted `200` leaves the caller with a looser type than the route has.
const health = new Hono().get("/", (c) => c.json({ status: "ok" }, 200));

export default health;
