import type { MiddlewareHandler } from "hono";
import { agentRouteGuards } from "./guards.generated";

/** Identity, so `agentGuards` reads as a registry call like every other table. */
function defineAgentGuards(config: { guards: MiddlewareHandler[] }) {
  return config;
}

// The guard table for `/mcp`. A module adds a factory call as a row of the
// `agent.routeGuards` table, which the CLI writes into `./guards.generated.ts`, and the
// call returns a Hono middleware that runs on every `/mcp` request after the key check and
// before the body is read. `agent` itself adds an `mcpRateLimit()` row from `./ratelimit`
// when the `ratelimit` module is installed, and nothing when it is not. A guard of your
// own goes after the spread.
//
// The array is read once, when the route module loads.
export const agentGuards = defineAgentGuards({ guards: [...agentRouteGuards] });
