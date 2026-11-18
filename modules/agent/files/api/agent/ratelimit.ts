import type { MiddlewareHandler } from "hono";
import { rateLimit } from "../middleware/ratelimit";

// `/mcp` under the `ratelimit` module. `agent` ships this file, and the `plugin-array`
// patch that appends `mcpRateLimit()` to `agentGuards` in `./guards.ts`, only when
// `ratelimit` is installed. `saasaloy add ratelimit` later brings both in, and `remove
// ratelimit` takes both out, so `agent` never depends on `ratelimit`.
//
// One budget for the whole endpoint, on the `default` policy (100 requests a minute per
// client address on `kv-memory`; `apps/api/wrangler.jsonc` sets the deployed number). A
// session of `initialize`, `tools/list` and a few calls spends a handful. A 429 is api's
// envelope with `Retry-After`, sent before the body is read and before any tool runs.

/** The rate limit `/mcp` runs, registered in `agentGuards`. */
export function mcpRateLimit(): MiddlewareHandler {
  return rateLimit({ policy: "default" });
}
