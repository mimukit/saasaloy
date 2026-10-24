import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { KeyRoundIcon, PlusIcon, ShieldIcon } from "lucide-react";
import { useState } from "react";
import type { SubmitEvent } from "react";

import { statements } from "@repo/auth/access";
import { allows } from "@repo/auth/permission-rules";
import type { PrincipalLike } from "@repo/auth/permission-rules";
import { DataTable } from "@repo/ui/blocks/admin/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/admin/data-table";
import { DetailPanel } from "@repo/ui/blocks/admin/detail-panel";
import { EmptyState } from "@repo/ui/blocks/admin/empty-state";
import { PageHeader } from "@repo/ui/blocks/admin/page-header";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@repo/ui/components/admin/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/components/admin/alert-dialog";
import { Button } from "@repo/ui/components/admin/button";
import { Checkbox } from "@repo/ui/components/admin/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/admin/dialog";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/ui/components/admin/field";
import { Fieldset, FieldsetLegend } from "@repo/ui/components/admin/fieldset";
import { Input } from "@repo/ui/components/admin/input";
import { Label } from "@repo/ui/components/admin/label";
import { Spinner } from "@repo/ui/components/admin/spinner";
import { StatusPill } from "@repo/ui/components/admin/status-pill";
import { toastManager } from "@repo/ui/components/admin/toast";
import { PageLayout } from "@repo/ui/containers/admin/page-layout";

import { auth } from "@admin/lib/auth";

// The `/api-keys` screen: a header with the key count and a "New key" button, the
// one-time banner for a key just issued, the organization's keys in a table, a detail
// panel for the selected key with its scope and its revoke action, and the dialog that
// issues a key.
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

/**
 * The api sends dates as strings, or nothing. A Date is what DataTable sorts and formats,
 * and `null` is what it renders as the em dash, so an unparseable value goes to `null`
 * rather than to "Invalid Date".
 */
function toDate(value: string | Date | null): Date | null {
  if (value === null || value === "") {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | Date | null): string | undefined {
  return toDate(value)?.toLocaleDateString();
}

/** The resource:action pairs a key holds, with empty resources dropped. */
function scopeEntries(scope: Record<string, string[]> | null | undefined) {
  return Object.entries(scope ?? {}).filter(
    ([, actions]) => actions.length > 0
  );
}

/** The key's visible prefix. The plugin stores the first few characters for this. */
function prefixOf(row: KeyRow): string {
  return `${row.start ?? ""}…`;
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

// An enabled key is live and takes the `ok` tone; a disabled one is switched off on
// purpose, so it stays neutral rather than reading as a fault.
function KeyStatus({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <StatusPill label="Enabled" tone="ok" />
  ) : (
    <StatusPill label="Disabled" tone="neutral" />
  );
}

// The table's shape, at module scope: it reads no state, so it stays one constant array
// and its `cell` renderers stay out of the render pass. The scope is not a column. It is
// too wide for a row, so it lives in the detail panel.
const COLUMNS: readonly DataTableColumn<KeyRow>[] = [
  {
    id: "name",
    header: "Name",
    value: (row) => row.name ?? "unnamed",
    sortable: true,
    cell: (row) => (
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{row.name ?? "unnamed"}</span>
        <code className="text-muted-foreground font-mono text-xs">
          {prefixOf(row)}
        </code>
      </div>
    ),
  },
  {
    id: "status",
    header: "Status",
    card: "trailing",
    value: (row) => row.enabled,
    sortable: true,
    cell: (row) => <KeyStatus enabled={row.enabled} />,
  },
  {
    id: "expires",
    header: "Expires",
    value: (row) => toDate(row.expiresAt),
    sortable: true,
    align: "end",
  },
  {
    id: "last-used",
    header: "Last used",
    value: (row) => toDate(row.lastRequest),
    sortable: true,
    align: "end",
  },
];

export function ApiKeyWorkspace({
  organizationId,
  organizationName,
  principal,
}: {
  organizationId: string;
  /** The organization's name, for the header. The id stays for the api calls. */
  organizationName: string;
  /** The resolved caller from `GET /tenant`. It decides what the picker offers. */
  principal: PrincipalLike;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [scope, setScope] = useState<ScopeMap>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The plaintext key, held for exactly as long as this component is mounted. Navigating
  // away unmounts the route and the value goes with it, which is the whole storage policy:
  // the plugin returns the key once and has no endpoint that returns it again. It shows
  // in a banner on the page rather than inside the create dialog, so an Escape press or a
  // backdrop click cannot throw it away before the operator has copied it.
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
      // The list endpoint answers `{ apiKeys, total }`, not a bare array.
      const rows: readonly KeyRow[] = result.data?.apiKeys ?? [];
      return rows;
    },
  });
  const keys = useQuery(keysQuery);

  const refreshKeys = async () => {
    await queryClient.invalidateQueries({ queryKey: keysQuery.queryKey });
  };

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
        // `metadata.scope`, not `permissions`. The plugin refuses `permissions` on any
        // request that carries headers, so a browser cannot set it at all; the scope
        // travels here instead, `apiKeyScopeGuard()` checks it against this caller's own
        // statements, and the plugin's `defaultPermissions` writes it to the column. See
        // the long note on `API_KEY_OPTIONS` in `@auth/plugins/api-key-options.ts`.
        ...(Object.keys(scope).length > 0 ? { metadata: { scope } } : {}),
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
      setCreateOpen(false);
      toastManager.add({
        type: "success",
        title: "Key issued",
        description: "Copy it from the banner now. It is shown once.",
      });
      await refreshKeys();
    },
    // The dialog stays open on a failure, with the message inline under the form, so the
    // operator can fix the name or the scope and submit again without retyping.
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "The key was not issued",
        description: error.message,
      });
    },
  });

  const revokeKey = useMutation({
    mutationFn: async (keyId: string) => {
      const result = await auth.apiKey.delete({ keyId });
      if (result.error) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async (_data, keyId) => {
      setRevokeOpen(false);
      // The revoked row leaves the list, so its panel closes with it.
      setSelectedId((current) => (current === keyId ? null : current));
      toastManager.add({
        type: "success",
        title: "Key revoked",
        description: "The api refuses it from now on.",
      });
      await refreshKeys();
    },
    onError: (error) => {
      setRevokeOpen(false);
      toastManager.add({
        type: "error",
        title: "The key was not revoked",
        description: error.message,
      });
    },
  });

  const submitNewKey = (event: SubmitEvent) => {
    event.preventDefault();
    createKey.mutate();
  };

  const rows = keys.data ?? [];
  const selected = rows.find((row) => row.id === selectedId);
  const selectedScope = scopeEntries(selected?.permissions);

  return (
    <PageLayout
      detailLabel={selected?.name ?? undefined}
      onDetailClose={() => {
        setSelectedId(null);
      }}
      detail={
        selected === undefined ? undefined : (
          <DetailPanel
            title={selected.name ?? "unnamed"}
            description={
              <code className="font-mono">{prefixOf(selected)}</code>
            }
            status={<KeyStatus enabled={selected.enabled} />}
            onClose={() => {
              setSelectedId(null);
            }}
            attributes={[
              { label: "Expires", value: formatDate(selected.expiresAt) },
              { label: "Last used", value: formatDate(selected.lastRequest) },
              { label: "Key id", value: selected.id },
            ]}
            groups={[
              {
                id: "scope",
                label: "Scope",
                icon: ShieldIcon,
                // A key's scope is fixed when it is issued. Editing a role later changes
                // members and never keys, so the panel shows it and offers no edit.
                items:
                  selectedScope.length === 0
                    ? [
                        {
                          label: "Scope",
                          value: "No scope. This key reads nothing.",
                        },
                      ]
                    : selectedScope.map(([resource, actions]) => ({
                        label: resource,
                        value: (
                          <span className="font-mono">
                            {actions.join(", ")}
                          </span>
                        ),
                      })),
              },
            ]}
            actions={
              canDelete ? (
                <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
                  <AlertDialogTrigger
                    render={<Button variant="destructive-outline" size="sm" />}
                  >
                    Revoke key
                  </AlertDialogTrigger>
                  <AlertDialogPopup>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Revoke {selected.name ?? "this key"}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Every caller using it stops working at once. A revoked
                        key cannot be restored; issue a new one instead.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogClose
                        render={<Button variant="ghost" />}
                        disabled={revokeKey.isPending}
                      >
                        Cancel
                      </AlertDialogClose>
                      <Button
                        variant="destructive"
                        loading={revokeKey.isPending}
                        onClick={() => {
                          revokeKey.mutate(selected.id);
                        }}
                      >
                        Revoke
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogPopup>
                </AlertDialog>
              ) : undefined
            }
          />
        )
      }
    >
      <PageHeader
        title="API keys"
        count={keys.data?.length}
        description={
          <>
            Machine credentials for {organizationName}, sent as{" "}
            <code>Authorization: Bearer</code>. A key&apos;s scope is fixed when
            it is issued.
          </>
        }
        actions={
          canCreate ? (
            <Dialog
              open={createOpen}
              onOpenChange={(open) => {
                setCreateOpen(open);
                // A fresh dialog starts without the last attempt's error.
                if (open) {
                  createKey.reset();
                }
              }}
            >
              <DialogTrigger render={<Button size="sm" />}>
                <PlusIcon />
                New key
              </DialogTrigger>
              <DialogPopup>
                <form className="contents" onSubmit={submitNewKey}>
                  <DialogHeader>
                    <DialogTitle>Issue a key</DialogTitle>
                    <DialogDescription>
                      The picker offers only what your own role holds. Asking
                      for more is refused by the api, not just hidden here.
                    </DialogDescription>
                  </DialogHeader>

                  <DialogPanel className="grid gap-4">
                    <Field>
                      <FieldLabel>Name</FieldLabel>
                      <Input
                        value={name}
                        required
                        placeholder="deploy pipeline"
                        onChange={(event) => {
                          setName(event.target.value);
                        }}
                      />
                    </Field>

                    <Field>
                      <FieldLabel>Expires in (days)</FieldLabel>
                      <Input
                        type="number"
                        min={1}
                        max={MAX_EXPIRY_DAYS}
                        value={expiryDays}
                        placeholder="leave blank for no expiry"
                        onChange={(event) => {
                          setExpiryDays(event.target.value);
                        }}
                      />
                      <FieldDescription>
                        One to {MAX_EXPIRY_DAYS} days. Blank keeps the key valid
                        until it is revoked.
                      </FieldDescription>
                    </Field>

                    <Fieldset className="grid gap-2">
                      <FieldsetLegend className="text-sm">Scope</FieldsetLegend>
                      {offered.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          Your role holds no statements, so a key issued now
                          would read nothing.
                        </p>
                      ) : null}
                      {offered.map(([resource, actions]) => (
                        <div
                          key={resource}
                          className="border-border grid gap-2 rounded-lg border px-3 py-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center"
                        >
                          <p className="text-sm font-medium">{resource}</p>
                          <div className="flex flex-wrap gap-x-4 gap-y-2">
                            {actions.map((action) => {
                              const checked =
                                scope[resource]?.includes(action) ?? false;
                              return (
                                // Base UI's checkbox is a span with a hidden input, so
                                // the wrapping label is what names it and what makes
                                // the word a click target.
                                <Label
                                  key={action}
                                  className="min-h-11 font-normal md:min-h-7"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => {
                                      setScope((current) =>
                                        toggleScope(current, resource, action)
                                      );
                                    }}
                                  />
                                  <span
                                    className={
                                      checked ? "" : "text-muted-foreground"
                                    }
                                  >
                                    {action}
                                  </span>
                                </Label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </Fieldset>

                    {createKey.error ? (
                      <p className="text-destructive-foreground text-sm">
                        {createKey.error.message}
                      </p>
                    ) : null}
                  </DialogPanel>

                  <DialogFooter>
                    <DialogClose render={<Button variant="ghost" />}>
                      Cancel
                    </DialogClose>
                    <Button
                      type="submit"
                      loading={createKey.isPending}
                      disabled={name.trim() === ""}
                    >
                      Issue key
                    </Button>
                  </DialogFooter>
                </form>
              </DialogPopup>
            </Dialog>
          ) : undefined
        }
      />

      {issued === null ? null : (
        <div className="border-border shrink-0 border-b px-(--page-gutter) py-3">
          <Alert variant="warning">
            <KeyRoundIcon />
            <AlertTitle>Copy this key now</AlertTitle>
            <AlertDescription>
              <span>
                It is shown once. Only a SHA-256 hash is stored, so nothing on
                this screen or in the api can show it again. Leave this page and
                it is gone.
              </span>
              <code className="border-border bg-muted text-foreground overflow-x-auto rounded-lg border px-3 py-2 font-mono text-sm">
                {issued}
              </code>
            </AlertDescription>
            <AlertAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // The rejection is deliberately swallowed. A browser that refuses
                  // clipboard access still leaves the key selectable in the box,
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
                onClick={() => {
                  setIssued(null);
                }}
              >
                I have it
              </Button>
            </AlertAction>
          </Alert>
        </div>
      )}

      <DataTable
        caption="API keys, with their status, expiry and last use."
        columns={COLUMNS}
        rows={rows}
        rowId={(row) => row.id}
        selectedId={selectedId}
        onRowClick={(row) => {
          setSelectedId(row.id);
        }}
        // The table has no filter, so its empty slot covers three cases: the first load,
        // a failed load, and an organization with no keys yet.
        emptyState={
          keys.isPending ? (
            <div className="flex justify-center py-10">
              <Spinner className="text-muted-foreground size-5" />
            </div>
          ) : keys.error ? (
            <EmptyState
              title="Keys did not load"
              description={keys.error.message}
            />
          ) : (
            <EmptyState
              icon={KeyRoundIcon}
              title="No keys yet"
              description={
                canCreate
                  ? "Issue one to let a script or a deploy pipeline call the api."
                  : "Ask someone who may issue keys in this organization to create one."
              }
            />
          )
        }
      />
    </PageLayout>
  );
}
