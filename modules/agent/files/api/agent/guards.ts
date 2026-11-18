import type { MiddlewareHandler } from "hono";

/** Identity, so `agentGuards` keeps the call shape the `plugin-array` codemod reads. */
function defineAgentGuards(config: { guards: MiddlewareHandler[] }) {
  return config;
}

// The guard patch point for `/mcp`. A module appends a factory call here with a
// `plugin-array` patch (`exportName: "agentGuards"`, `arrayProp: "guards"`), and the call
// returns a Hono middleware that runs on every `/mcp` request after the key check and
// before the body is read. `agent` itself appends `mcpRateLimit()` from `./ratelimit`
// when the `ratelimit` module is installed, and nothing when it is not. Keep the line in
// this exact shape and never omit `guards`.
//
// The array is read once, when the route module loads.
export const agentGuards = defineAgentGuards({ guards: [] });
