import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { API_KEY_SCOPES } from "@repo/auth/api-key-scopes";
import { config } from "@repo/config";
import { AgentKeys } from "@repo/ui/blocks/agent/agent-keys";
import type { AgentKeyRow } from "@repo/ui/blocks/agent/agent-keys";
import { agent } from "@repo/ui/content/agent";
import { toastManager } from "@repo/ui/components/shell/toast";
import { mcpAddressOf, serverName } from "@repo/ui/lib/agent/keys";

import { apiBaseUrl, auth } from "@app/lib/auth";

// The Agents page: where a signed-in user connects a coding agent over MCP and makes the
// API key it signs in with. `add agent` installs it when `api-keys-user` is installed.
//
// The markup is `@repo/ui/blocks/agent/agent-keys`; this file owns the queries. Every
// call goes through the auth client's `apiKey.*` endpoints on `/auth`, which answer for
// the session user only, so the page can never list or revoke another user's key.
//
// `API_KEY_SCOPES` comes from `@repo/auth/api-key-scopes`, a file that imports nothing,
// so the vocabulary reaches the browser bundle without the auth server behind it.

export const Route = createFileRoute("/agents")({
  component: Agents,
});

const KEYS_QUERY = queryOptions({
  queryKey: ["api-keys"],
  queryFn: async (): Promise<AgentKeyRow[]> => {
    const result = await auth.apiKey.list();
    if (result.error) {
      throw new Error(result.error.message);
    }
    // The list endpoint answers `{ apiKeys, total }`, not a bare array.
    return (result.data?.apiKeys ?? []).map((row) => ({
      id: row.id,
      name: row.name ?? null,
      start: row.start ?? null,
      scope: row.permissions ?? null,
      createdAt: toDate(row.createdAt),
      lastUsedAt: toDate(row.lastRequest),
    }));
  },
});

/** The api sends dates as strings, or nothing. An unparseable value reads as no date. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DATE_FORMAT = new Intl.DateTimeFormat(config.app.locale, {
  dateStyle: "medium",
});

function Agents() {
  const queryClient = useQueryClient();
  const keys = useQuery(KEYS_QUERY);

  let state: "loading" | "error" | "ready" = "ready";
  if (keys.data === undefined) {
    state = keys.isError ? "error" : "loading";
  }

  return (
    <AgentKeys
      mcpAddress={mcpAddressOf(apiBaseUrl)}
      serverName={serverName(config.app.name)}
      vocabulary={API_KEY_SCOPES}
      keys={keys.data ?? []}
      state={state}
      errorMessage={keys.error?.message}
      onRetry={() => {
        void keys.refetch();
      }}
      formatDate={(date) => DATE_FORMAT.format(date)}
      onCreate={async ({ name, scope }) => {
        const result = await auth.apiKey.create({
          name,
          // `metadata.scope`, not `permissions`. The plugin refuses `permissions` on any
          // request that carries headers, so a browser cannot set it; the scope travels
          // here, `apiKeyScopeGuard()` checks it against `API_KEY_SCOPES`, and the
          // plugin's `defaultPermissions` writes it to the column.
          ...(Object.keys(scope).length > 0 ? { metadata: { scope } } : {}),
        });
        if (result.error) {
          throw new Error(result.error.message);
        }
        await queryClient.invalidateQueries({ queryKey: KEYS_QUERY.queryKey });
        return result.data.key;
      }}
      onRevoke={async (keyId) => {
        const result = await auth.apiKey.delete({ keyId });
        if (result.error) {
          throw new Error(result.error.message);
        }
        toastManager.add({ type: "success", title: agent.revoke.doneTitle });
        await queryClient.invalidateQueries({ queryKey: KEYS_QUERY.queryKey });
      }}
    />
  );
}
