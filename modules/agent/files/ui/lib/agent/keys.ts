// The rules behind the Agents page in `apps/app`: which scopes a new key starts with, how
// a click changes the picked set, how a key's scope reads in one table cell, and the setup
// text each coding agent takes.
//
// It imports nothing, so the page's block and its route both read it, and a test runs it
// on `node:test` with no project around it.

/** A scope map: resource to the actions a key holds on it, as `metadata.scope` takes it. */
export type ScopeMap = Readonly<Record<string, readonly string[]>>;

/**
 * The actions a new key starts with. Plan 0110 settles read and write on, and every other
 * action off until the user ticks it: a delete, and any word a project adds later, such as
 * `send`, is the user's call and never a default.
 */
export const DEFAULT_ACTIONS: readonly string[] = ["read", "write"];

/** The scope a new key starts with: the default actions the vocabulary offers, per resource. */
export function defaultScope(vocabulary: ScopeMap): ScopeMap {
  const scope: Record<string, readonly string[]> = {};
  for (const [resource, actions] of Object.entries(vocabulary)) {
    const picked = actions.filter((action) => DEFAULT_ACTIONS.includes(action));
    if (picked.length > 0) {
      scope[resource] = picked;
    }
  }
  return scope;
}

/**
 * Add `action` to `resource` when it is off, and take it away when it is on. A resource
 * left with no action leaves the map, so the create call never sends an empty list.
 * The actions keep the vocabulary's order, so the request reads the same as the picker.
 */
export function toggleScope(
  scope: ScopeMap,
  vocabulary: ScopeMap,
  resource: string,
  action: string
): ScopeMap {
  const current = scope[resource] ?? [];
  const on = current.includes(action);
  const order = vocabulary[resource] ?? [];
  const next = (
    on ? current.filter((held) => held !== action) : [...current, action]
  ).toSorted((left, right) => order.indexOf(left) - order.indexOf(right));
  const { [resource]: _dropped, ...rest } = scope;
  return next.length === 0 ? rest : { ...rest, [resource]: next };
}

/** Every `resource:action` pair a scope holds, in the map's order. */
export function scopePairs(
  scope: Readonly<Record<string, readonly string[]>> | null | undefined
): string[] {
  return Object.entries(scope ?? {}).flatMap(([resource, actions]) =>
    actions.map((action) => `${resource}:${action}`)
  );
}

/**
 * The pairs one table cell shows, and how many it leaves out. A key with many scopes
 * would push the row wide, so the cell shows the first `max` and a `+N` count.
 */
export function scopeChips(
  scope: Readonly<Record<string, readonly string[]>> | null | undefined,
  max = 2
): { shown: string[]; rest: number } {
  const pairs = scopePairs(scope);
  return { shown: pairs.slice(0, max), rest: Math.max(0, pairs.length - max) };
}

/**
 * The name an agent lists this product under: the app name in kebab case, so
 * `claude mcp add` and a TOML table header both take it unquoted. A name with no letter
 * or digit falls back to `app`.
 */
export function serverName(appName: string): string {
  const slug = appName
    .normalize("NFKD")
    // NFKD splits an accented letter into the letter and a combining mark. Drop the mark,
    // or the slug breaks "Müller" into "mu-ller".
    .replaceAll(/\p{M}+/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug === "" ? "app" : slug;
}

/** The placeholder the setup text shows where the user's key goes. */
export const KEY_PLACEHOLDER = "<your key>";

/** The coding agents the page gives setup text for, in tab order. */
export const AGENT_CLIENTS = ["cursor", "claude-code", "codex"] as const;

export type AgentClient = (typeof AGENT_CLIENTS)[number];

/**
 * The setup text for each coding agent, the same three forms the `saasaloy-agent` skill
 * documents. Codex reads the key from an environment variable rather than from its config
 * file, so its text names the variable and the line that sets it.
 */
export function setupText(
  client: AgentClient,
  name: string,
  mcpAddress: string
): string {
  if (client === "cursor") {
    return JSON.stringify(
      {
        mcpServers: {
          [name]: {
            url: mcpAddress,
            headers: { Authorization: `Bearer ${KEY_PLACEHOLDER}` },
          },
        },
      },
      null,
      2
    );
  }
  if (client === "claude-code") {
    return `claude mcp add --transport http ${name} ${mcpAddress} --header "Authorization: Bearer ${KEY_PLACEHOLDER}"`;
  }
  // A shell variable cannot start with a digit, so "3d-studio" becomes MCP_3D_STUDIO_KEY.
  const stem = name.toUpperCase().replaceAll("-", "_");
  const variable = `${/^\d/.test(stem) ? "MCP_" : ""}${stem}_KEY`;
  return [
    `[mcp_servers.${name}]`,
    `url = "${mcpAddress}"`,
    `bearer_token_env_var = "${variable}"`,
    "",
    `# then, in your shell: export ${variable}="${KEY_PLACEHOLDER}"`,
  ].join("\n");
}

/** The MCP address on the api origin. A trailing slash on the origin is dropped. */
export function mcpAddressOf(apiOrigin: string): string {
  return `${apiOrigin.replace(/\/+$/, "")}/mcp`;
}
