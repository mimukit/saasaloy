import { Hono } from "hono";

// Route module contract: default-export a Hono sub-app named after the service.
// Paths are RELATIVE TO THE MOUNT — this file mounts at `/health`, so `get("/")`
// serves `GET /health` (not `get("/health")`, which would be `/health/health`).
const health = new Hono();

health.get("/", (c) => c.json({ status: "ok" }));

export default health;
