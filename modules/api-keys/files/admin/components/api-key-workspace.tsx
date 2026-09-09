import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import { statements } from "@repo/auth/access";
import { allows } from "@repo/auth/rbac-rules";
import type { PrincipalLike } from "@repo/auth/rbac-rules";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { auth } from "@admin/lib/auth";

// The `/api-keys` screen's two panels: the organization's keys, and the form that issues
// one.
//
// EVERY CONTROL HERE IS COSMETIC. The picker offers only what the caller holds, and that
// is a courtesy, not the gate: `apiKeyScopeGuard()` on the api refuses an over-scoped
// request whatever arrived, and Better Auth checks `apiKey: [action]` on every endpoint
// below. A build of this file with the filter removed would leak nothing.

/** One day in seconds. `expiresIn` is seconds, and the plugin's floor is one day. */
const DAY_SECONDS = 60 * 60 * 24;

/** The plugin's ceiling on a client-set expiry, in days. */
const MAX_EXPIRY_DAYS = 365;

/** A key as the list endpoint returns it, narrowed to what the table renders. */
interface KeyRow {
  id: string;
  name: string | null;
  start: string | null;
  enabled: boolean;
  expiresAt: string | Date | null;
  lastRequest: string | Date | null;
  permissions?: Record<string, string[]> | null;
}

/** A scope map as the create endpoint takes it. */
type ScopeMap = Record<string, string[]>;

function formatDate(value: string | Date | null): string {
  if (!value) {
    return "—";
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function describeScope(scope: Record<string, string[]> | null | undefined) {
  const entries = Object.entries(scope ?? {}).filter(
    ([, actions]) => actions.length > 0
  );
  return entries.length === 0
    ? "No scope. This key reads nothing."
    : entries
        .map(([resource, actions]) => `${resource}:${actions.join(",")}`)
        .join("  ");
}

/**
 * Toggle one resource:action pair, returning a new map. Never mutates: the caller keeps
 * the draft in React state, and an in-place edit would not re-render. A resource with no
 * actions left is dropped rather than stored as `[]`.
 */
function toggleScope(
  value: ScopeMap,
  resource: string,
  action: string
): ScopeMap {
  const held = value[resource] ?? [];
  const next = held.includes(action)
    ? held.filter((candidate) => candidate !== action)
    : [...held, action];
  const draft: ScopeMap = { ...value };
  if (next.length === 0) {
    delete draft[resource];
  } else {
    draft[resource] = next;
  }
  return draft;
}

export function ApiKeyWorkspace({
  organizationId,
  principal,
}: {
  organizationId: string;
  /** The resolved caller from `GET /tenant`. It decides what the picker offers. */
  principal: PrincipalLike;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [scope, setScope] = useState<ScopeMap>({});

  // The plaintext key, held for exactly as long as this component is mounted. Navigating
  // away unmounts the route and the value goes with it, which is the whole storage policy:
  // the plugin returns the key once and has no endpoint that returns it again.
  const [issued, setIssued] = useState<string | null>(null);

  /**
   * Every resource:action pair the caller may put in a key, from `access.ts` filtered by
   * the same `can()` the api runs. A member holding `project: ["read"]` is offered that
   * one checkbox and no other, so the guard's 403 is a case they have to go around the
   * screen to reach.
   */
  const offered: readonly (readonly [string, readonly string[]])[] =
    Object.entries(statements)
      .map(
        ([resource, actions]) =>
          [
            resource,
            (actions as readonly string[]).filter((action) =>
              allows(principal, { [resource]: [action] })
            ),
          ] as const
      )
      .filter(([, actions]) => actions.length > 0);

  const canCreate = allows(principal, { apiKey: ["create"] });
  const canDelete = allows(principal, { apiKey: ["delete"] });

  const keysQuery = queryOptions({
    queryKey: ["organizations", organizationId, "api-keys"],
    queryFn: async () => {
      const result = await auth.apiKey.list({ query: { organizationId } });
      if (result.error) {
        throw new Error(result.error.message);
      }
      return (result.data ?? []) as unknown as KeyRow[];
    },
  });
  const keys = useQuery(keysQuery);

  const refreshKeys = () =>
    queryClient.invalidateQueries({ queryKey: keysQuery.queryKey });

  const createKey = useMutation({
    mutationFn: async () => {
      const days = Number(expiryDays);
      const result = await auth.apiKey.create({
        name: name.trim(),
        organizationId,
        // Omitted rather than sent as null when the field is blank: a key with no expiry
        // is the default this project ships, and it stays valid until it is revoked.
        ...(expiryDays.trim() !== "" && days > 0
          ? { expiresIn: Math.round(days * DAY_SECONDS) }
          : {}),
        ...(Object.keys(scope).length > 0 ? { permissions: scope } : {}),
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
      return result.data?.key ?? null;
    },
    onSuccess: async (plaintext) => {
      setIssued(plaintext);
      setName("");
      setExpiryDays("");
      setScope({});
      await refreshKeys();
    },
  });

  const revokeKey = useMutation({
    mutationFn: async (keyId: string) => {
      const result = await auth.apiKey.delete({ keyId });
      if (result.error) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: refreshKeys,
  });

  const submitNewKey = (event: FormEvent) => {
    event.preventDefault();
    createKey.mutate();
  };

  return (
    <div className="grid gap-6">
      {issued ? (
        <Card>
          <CardHeader>
            <CardTitle>Copy this key now</CardTitle>
            <CardDescription>
              It is shown once. Only a SHA-256 hash is stored, so nothing on
              this screen or in the api can show it again. Leave this page and
              it is gone.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <code className="border-border bg-muted overflow-x-auto rounded-lg border px-3 py-2 font-mono text-sm">
              {issued}
            </code>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 md:min-h-7"
                onClick={() => {
                  // The rejection is deliberately swallowed. A browser that refuses
                  // clipboard access still leaves the key selectable in the box above,
                  // and an error toast here would say nothing the operator can act on.
                  navigator.clipboard.writeText(issued).catch(() => {
                    // nothing to tell the operator; the key is on screen.
                  });
                }}
              >
                Copy
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 md:min-h-7"
                onClick={() => setIssued(null)}
              >
                I have it
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Keys</CardTitle>
          <CardDescription>
            A key&apos;s scope is fixed when it is issued. Editing a role later
            changes members and never keys, so reissue a key to change what it
            may do.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {keys.isPending ? (
            <p className="text-muted-foreground text-sm">Loading keys…</p>
          ) : null}
          {keys.error ? (
            <p className="text-destructive text-sm">{keys.error.message}</p>
          ) : null}
          {keys.data?.length === 0 ? (
            <div className="border-border rounded-lg border border-dashed p-4 text-sm">
              <p className="font-medium">No keys yet</p>
              <p className="text-muted-foreground mt-1">
                Issue one below to let a script or a deploy pipeline call the
                api.
              </p>
            </div>
          ) : null}

          {keys.data?.map((row) => (
            <div key={row.id} className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{row.name ?? "unnamed"}</p>
                <code className="text-muted-foreground font-mono text-xs">
                  {row.start ?? "—"}…
                </code>
                {row.enabled ? null : (
                  <Badge variant="secondary">Disabled</Badge>
                )}
                {canDelete ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto min-h-11 md:min-h-7"
                    disabled={revokeKey.isPending}
                    onClick={() => revokeKey.mutate(row.id)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
              <dl className="text-muted-foreground grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                <div>
                  <dt className="inline">Expires: </dt>
                  <dd className="inline">{formatDate(row.expiresAt)}</dd>
                </div>
                <div>
                  <dt className="inline">Last used: </dt>
                  <dd className="inline">{formatDate(row.lastRequest)}</dd>
                </div>
                <div className="sm:col-span-3">
                  <dt className="inline">Scope: </dt>
                  <dd className="inline font-mono">
                    {describeScope(row.permissions)}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </CardContent>
      </Card>

      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Issue a key</CardTitle>
            <CardDescription>
              The picker offers only what your own role holds. Asking for more
              is refused by the api, not just hidden here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={submitNewKey}>
              <div className="grid gap-2">
                <Label htmlFor="api-key-name">Name</Label>
                <Input
                  id="api-key-name"
                  value={name}
                  required
                  placeholder="deploy pipeline"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="api-key-expiry">Expires in (days)</Label>
                <Input
                  id="api-key-expiry"
                  type="number"
                  min={1}
                  max={MAX_EXPIRY_DAYS}
                  value={expiryDays}
                  placeholder="leave blank for no expiry"
                  onChange={(event) => setExpiryDays(event.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <p className="text-sm font-medium">Scope</p>
                {offered.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Your role holds no statements, so a key issued now would
                    read nothing.
                  </p>
                ) : null}
                {offered.map(([resource, actions]) => (
                  <div
                    key={resource}
                    className="border-border grid gap-2 rounded-lg border px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center"
                  >
                    <p className="text-sm font-medium">{resource}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {actions.map((action) => {
                        const id = `scope-${resource}-${action}`;
                        const checked =
                          scope[resource]?.includes(action) ?? false;
                        return (
                          <label
                            key={action}
                            htmlFor={id}
                            className="flex min-h-11 items-center gap-2 text-sm md:min-h-7"
                          >
                            <input
                              id={id}
                              type="checkbox"
                              className="border-border size-4 rounded"
                              checked={checked}
                              onChange={() =>
                                setScope((current) =>
                                  toggleScope(current, resource, action)
                                )
                              }
                            />
                            <span
                              className={checked ? "" : "text-muted-foreground"}
                            >
                              {action}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {createKey.error ? (
                <p className="text-destructive text-sm">
                  {createKey.error.message}
                </p>
              ) : null}

              <div>
                <Button
                  type="submit"
                  disabled={createKey.isPending || name.trim() === ""}
                >
                  {createKey.isPending ? "Issuing…" : "Issue key"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
