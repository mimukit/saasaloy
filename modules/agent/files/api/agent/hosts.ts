// The hostnames `/mcp` answers on, from the api's own origin.
//
// `@modelcontextprotocol/hono` checks the `Host` header against a list, to stop a DNS
// rebinding attack, and the `Origin` header when a browser sends one. Its default list is
// the loopback names, so without this every deployed call would get 403 `Invalid Host`.
// The list comes from the environment the api already has:
//
// - `BETTER_AUTH_URL` is the api's own origin (the `auth` module declares it), so its
//   hostname is the host `/mcp` answers on. The loopback names are always allowed too,
//   so `localhost` and `127.0.0.1` both work in dev; Cloudflare routes a deployed Worker
//   by its own hostname, so a loopback `Host` never reaches it from outside.
// - `CORS_ORIGINS` lists the frontends a browser may call from, so their hostnames are
//   the origins `/mcp` admits. A request with no `Origin`, which is what an MCP client
//   sends, always passes.

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** The two lists, as hostnames: the form the adapter compares, port ignored. */
export interface McpHostnames {
  hosts: string[];
  origins: string[];
}

function hostnameOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  try {
    return new URL(value.trim()).hostname;
  } catch {
    return undefined;
  }
}

/** The allowed hosts and origins for this environment. */
export function mcpHostnames(
  env: Readonly<Record<string, unknown>>
): McpHostnames {
  const own = hostnameOf(env.BETTER_AUTH_URL);
  // Unset, the list is the adapter's own default: loopback only. A deployed api with no
  // `BETTER_AUTH_URL` answers 403 on `/mcp`, which the skill's checklist names.
  const hosts = [
    ...new Set([...(own === undefined ? [] : [own]), ...LOOPBACK]),
  ];
  const frontends =
    typeof env.CORS_ORIGINS === "string"
      ? env.CORS_ORIGINS.split(",").map(hostnameOf)
      : [];
  const origins = [
    ...new Set(
      [...hosts, ...frontends].filter(
        (name): name is string => name !== undefined
      )
    ),
  ];
  return { hosts, origins };
}
