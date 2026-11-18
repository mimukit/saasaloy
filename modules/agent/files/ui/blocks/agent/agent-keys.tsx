import { CheckIcon, CopyIcon, KeyRoundIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import type { SubmitEvent } from "react";

import { DataTable } from "@repo/ui/blocks/shell/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/shell/data-table";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/ui/components/shell/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@repo/ui/components/shell/alert-dialog";
import { Badge } from "@repo/ui/components/shell/badge";
import { Button } from "@repo/ui/components/shell/button";
import {
  Card,
  CardAction,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@repo/ui/components/shell/card";
import { Checkbox } from "@repo/ui/components/shell/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@repo/ui/components/shell/dialog";
import { Field, FieldLabel } from "@repo/ui/components/shell/field";
import { Fieldset, FieldsetLegend } from "@repo/ui/components/shell/fieldset";
import { Input } from "@repo/ui/components/shell/input";
import { Label } from "@repo/ui/components/shell/label";
import { Spinner } from "@repo/ui/components/shell/spinner";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@repo/ui/components/shell/tabs";
import { PageBody } from "@repo/ui/containers/shell/page-body";
import { agent } from "@repo/ui/content/agent";
import {
  AGENT_CLIENTS,
  KEY_PLACEHOLDER,
  defaultScope,
  scopeChips,
  setupText,
  toggleScope,
} from "@repo/ui/lib/agent/keys";
import type { AgentClient, ScopeMap } from "@repo/ui/lib/agent/keys";
import { copyText } from "@repo/ui/lib/clipboard";
import { interpolate } from "@repo/ui/lib/interpolate";

// The Agents page in `apps/app`: the MCP address with the setup text for Cursor, Claude
// Code and Codex, the signed-in user's API keys, the dialog that creates one with its
// scopes, the one-time view of the new key, and the revoke confirmation.
//
// It takes its data and its callbacks as props and does no IO, so `@repo/ui` stays free
// of the auth client. `apps/app/src/routes/agents.tsx` owns the queries. Every word comes
// from `@repo/ui/content/agent`.
//
// THE PICKER IS A COURTESY, NOT THE GATE. It offers the project's key vocabulary, and
// `apiKeyScopeGuard()` on the api refuses a pair outside it whatever arrives.

/** A key as the page shows it. */
export interface AgentKeyRow {
  id: string;
  name: string | null;
  /** The first characters of the key, which the plugin stores in the clear. */
  start: string | null;
  scope: Readonly<Record<string, readonly string[]>> | null;
  createdAt: Date | null;
  lastUsedAt: Date | null;
}

/** What the create dialog submits. */
export interface CreateKeyInput {
  name: string;
  scope: ScopeMap;
}

export interface AgentKeysProps {
  /** The `/mcp` address on the api origin. */
  mcpAddress: string;
  /** The name the setup text lists the product under. */
  serverName: string;
  /** The project's key vocabulary, `API_KEY_SCOPES`. */
  vocabulary: ScopeMap;
  keys: readonly AgentKeyRow[];
  state: "loading" | "error" | "ready";
  errorMessage?: string;
  onRetry: () => void;
  /** Create a key. Resolve with its plaintext, or reject with a message to show. */
  onCreate: (input: CreateKeyInput) => Promise<string>;
  /** Revoke a key. Reject with a message to show. */
  onRevoke: (keyId: string) => Promise<void>;
  /** Format a date for a table cell, in the app's locale. */
  formatDate: (date: Date) => string;
}

export function AgentKeys({
  mcpAddress,
  serverName,
  vocabulary,
  keys,
  state,
  errorMessage,
  onRetry,
  onCreate,
  onRevoke,
  formatDate,
}: AgentKeysProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<AgentKeyRow | null>(null);

  const columns = keyColumns(formatDate, setRevoking);

  return (
    <>
      <PageHeader
        title={agent.page.title}
        description={agent.page.description}
      />
      <PageBody>
        <ConnectCard mcpAddress={mcpAddress} serverName={serverName} />

        <Card>
          <CardHeader>
            <CardTitle>{agent.keys.title}</CardTitle>
            {keys.length > 0 ? (
              <CardAction>
                <Button
                  size="sm"
                  onClick={() => {
                    setCreateOpen(true);
                  }}
                >
                  <PlusIcon />
                  {agent.keys.createLabel}
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardPanel>
            <DataTable
              caption={agent.keys.caption}
              columns={columns}
              rows={keys}
              rowId={(row) => row.id}
              initialSort={{ id: "created", desc: true }}
              emptyState={
                <KeysEmpty
                  state={state}
                  errorMessage={errorMessage}
                  onRetry={onRetry}
                  onCreate={() => {
                    setCreateOpen(true);
                  }}
                />
              }
            />
          </CardPanel>
        </Card>
      </PageBody>

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        vocabulary={vocabulary}
        onCreate={async (input) => {
          const plaintext = await onCreate(input);
          setCreateOpen(false);
          setIssued(plaintext);
        }}
      />

      <IssuedKeyDialog
        plaintext={issued}
        onDone={() => {
          setIssued(null);
        }}
      />

      <RevokeDialog
        row={revoking}
        onClose={() => {
          setRevoking(null);
        }}
        onRevoke={onRevoke}
      />
    </>
  );
}

/**
 * The key table's columns. Built outside the component so each cell renderer is a plain
 * function of its row; the two callbacks are the only state the table reaches.
 */
function keyColumns(
  formatDate: (date: Date) => string,
  onRevokeClick: (row: AgentKeyRow) => void
): readonly DataTableColumn<AgentKeyRow>[] {
  return [
    {
      id: "name",
      header: agent.keys.columns.name,
      value: (row) => row.name ?? agent.keys.unnamed,
      card: "title",
      grow: true,
      cell: (row) => (
        <span className="truncate">{row.name ?? agent.keys.unnamed}</span>
      ),
    },
    {
      id: "key",
      header: agent.keys.columns.key,
      value: (row) => row.start,
      cell: (row) =>
        row.start === null ? null : (
          <code className="font-mono text-sm">{`${row.start}…`}</code>
        ),
    },
    {
      id: "scopes",
      header: agent.keys.columns.scopes,
      value: (row) => scopeChips(row.scope).shown.join(" "),
      cell: (row) => <ScopeChips scope={row.scope} />,
    },
    {
      id: "created",
      header: agent.keys.columns.created,
      value: (row) => row.createdAt,
      cell: (row) =>
        row.createdAt === null ? null : formatDate(row.createdAt),
      sortable: true,
    },
    {
      id: "lastUsed",
      header: agent.keys.columns.lastUsed,
      value: (row) => row.lastUsedAt,
      cell: (row) =>
        row.lastUsedAt === null
          ? agent.keys.neverUsed
          : formatDate(row.lastUsedAt),
      sortable: true,
    },
    {
      id: "actions",
      header: <span className="sr-only">{agent.keys.columns.actions}</span>,
      value: () => null,
      card: "trailing",
      pin: "end",
      align: "end",
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive-foreground"
          onClick={() => {
            onRevokeClick(row);
          }}
        >
          {agent.keys.revokeLabel}
        </Button>
      ),
    },
  ];
}

/** A copy button that shows a check for two seconds after it copied. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={copied ? agent.connect.copied : label}
      onClick={() => {
        copyText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 2000);
          })
          .catch(() => {
            // The text stays on screen and selectable, so a refused clipboard needs no
            // message of its own.
          });
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

function ConnectCard({
  mcpAddress,
  serverName,
}: {
  mcpAddress: string;
  serverName: string;
}) {
  const [client, setClient] = useState<AgentClient>("claude-code");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{agent.connect.title}</CardTitle>
      </CardHeader>
      <CardPanel className="grid gap-4">
        <Field>
          <FieldLabel>{agent.connect.addressLabel}</FieldLabel>
          <div className="flex w-full items-center gap-2">
            <Input readOnly value={mcpAddress} className="font-mono" />
            <CopyButton
              text={mcpAddress}
              label={agent.connect.copyAddressLabel}
            />
          </div>
        </Field>

        <Tabs
          value={client}
          onValueChange={(value: AgentClient) => {
            setClient(value);
          }}
          className="gap-3"
        >
          <TabsList variant="underline" className="gap-x-4">
            {AGENT_CLIENTS.map((id) => (
              <TabsTab key={id} value={id} className="grow-0 px-0">
                {agent.connect.tabs[id]}
              </TabsTab>
            ))}
          </TabsList>
          {AGENT_CLIENTS.map((id) => {
            const text = setupText(id, serverName, mcpAddress);
            return (
              <TabsPanel key={id} value={id} className="grid gap-2">
                <div className="bg-muted relative rounded-lg border">
                  <pre className="overflow-x-auto p-3 pe-12 font-mono text-sm break-all whitespace-pre-wrap">
                    {text}
                  </pre>
                  <div className="absolute end-2 top-2">
                    <CopyButton
                      text={text}
                      label={agent.connect.copySetupLabel}
                    />
                  </div>
                </div>
                <p className="text-muted-foreground text-sm">
                  {interpolate(agent.connect.hints[id], {
                    placeholder: KEY_PLACEHOLDER,
                  })}
                </p>
              </TabsPanel>
            );
          })}
        </Tabs>
      </CardPanel>
    </Card>
  );
}

function ScopeChips({
  scope,
}: {
  scope: Readonly<Record<string, readonly string[]>> | null;
}) {
  const { shown, rest } = scopeChips(scope);
  if (shown.length === 0) {
    return <span className="text-muted-foreground">{agent.keys.noScope}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1 md:flex-nowrap md:whitespace-nowrap">
      {shown.map((pair) => (
        <Badge key={pair} variant="secondary" className="font-mono">
          {pair}
        </Badge>
      ))}
      {rest > 0 ? (
        <Badge variant="secondary">
          {interpolate(agent.keys.moreScopes, { count: rest })}
        </Badge>
      ) : null}
    </span>
  );
}

function KeysEmpty({
  state,
  errorMessage,
  onRetry,
  onCreate,
}: {
  state: AgentKeysProps["state"];
  errorMessage?: string;
  onRetry: () => void;
  onCreate: () => void;
}) {
  if (state === "loading") {
    return (
      <div className="flex justify-center py-10">
        <Spinner
          className="text-muted-foreground size-5"
          aria-label={agent.keys.loading}
        />
      </div>
    );
  }
  if (state === "error") {
    return (
      <EmptyState
        title={agent.keys.loadFailed}
        description={errorMessage}
        action={
          <Button variant="outline" size="sm" onClick={onRetry}>
            {agent.keys.retryLabel}
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={KeyRoundIcon}
      title={agent.keys.emptyTitle}
      description={agent.keys.emptyDescription}
      action={
        <Button size="sm" onClick={onCreate}>
          {agent.keys.createLabel}
        </Button>
      }
    />
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  vocabulary,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vocabulary: ScopeMap;
  onCreate: (input: CreateKeyInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ScopeMap>(() => defaultScope(vocabulary));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const resources = Object.entries(vocabulary).filter(
    ([, actions]) => actions.length > 0
  );

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    setPending(true);
    setFailure(null);
    onCreate({ name: name.trim(), scope })
      .then(() => {
        setName("");
        setScope(defaultScope(vocabulary));
      })
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        // A fresh dialog starts without the last attempt's error.
        if (next) {
          setFailure(null);
        }
      }}
    >
      <DialogPopup>
        <form className="contents" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{agent.create.title}</DialogTitle>
            <DialogDescription>{agent.create.description}</DialogDescription>
          </DialogHeader>

          <DialogPanel className="grid gap-4">
            <Field>
              <FieldLabel>{agent.create.nameLabel}</FieldLabel>
              <Input
                value={name}
                required
                placeholder={agent.create.namePlaceholder}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </Field>

            <Fieldset className="grid gap-2">
              <FieldsetLegend className="text-sm">
                {agent.create.scopesLabel}
              </FieldsetLegend>
              {resources.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {agent.create.noScopes}
                </p>
              ) : (
                <>
                  <div className="divide-border border-border divide-y rounded-lg border">
                    {resources.map(([resource, actions]) => (
                      <div
                        key={resource}
                        className="grid gap-2 px-3 py-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center"
                      >
                        <p className="text-sm font-medium">{resource}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {actions.map((action) => {
                            const checked =
                              scope[resource]?.includes(action) ?? false;
                            return (
                              // Base UI's checkbox is a span with a hidden input, so the
                              // wrapping label names it and makes the word a target.
                              <Label
                                key={action}
                                className="min-h-11 font-normal md:min-h-7"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => {
                                    setScope((current) =>
                                      toggleScope(
                                        current,
                                        vocabulary,
                                        resource,
                                        action
                                      )
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
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {agent.create.scopesHint}
                  </p>
                </>
              )}
            </Fieldset>

            {failure === null ? null : (
              <Alert variant="error">
                <AlertTitle>{agent.create.failedTitle}</AlertTitle>
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}
          </DialogPanel>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {agent.create.cancelLabel}
            </DialogClose>
            <Button
              type="submit"
              loading={pending}
              disabled={name.trim() === ""}
            >
              {agent.create.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function IssuedKeyDialog({
  plaintext,
  onDone,
}: {
  plaintext: string | null;
  onDone: () => void;
}) {
  return (
    <Dialog
      open={plaintext !== null}
      // The key shows once, so only "Done" closes it. The dialog is controlled, so a close
      // request from Escape or a click outside is cancelled and the key stays on screen
      // until the user has had the chance to copy it.
      disablePointerDismissal
      onOpenChange={(next, details) => {
        if (!next) {
          details.cancel();
        }
      }}
    >
      <DialogPopup showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{agent.created.title}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="grid gap-4">
          <div className="bg-muted flex items-start gap-2 rounded-lg border p-3">
            <code className="min-w-0 flex-1 font-mono text-sm break-all">
              {plaintext}
            </code>
            {plaintext === null ? null : (
              <CopyButton text={plaintext} label={agent.created.copyLabel} />
            )}
          </div>
          <Alert variant="warning">
            <KeyRoundIcon />
            <AlertDescription>{agent.created.warning}</AlertDescription>
          </Alert>
        </DialogPanel>
        <DialogFooter>
          <Button onClick={onDone}>{agent.created.doneLabel}</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function RevokeDialog({
  row,
  onClose,
  onRevoke,
}: {
  row: AgentKeyRow | null;
  onClose: () => void;
  onRevoke: (keyId: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <AlertDialog
      open={row !== null}
      onOpenChange={(next) => {
        if (!next) {
          setFailure(null);
          onClose();
        }
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {interpolate(agent.revoke.title, {
              name: row?.name ?? agent.keys.unnamed,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {agent.revoke.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure === null ? null : (
          <div className="px-6">
            <Alert variant="error">
              <AlertTitle>{agent.revoke.failedTitle}</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button variant="ghost" />}
            disabled={pending}
          >
            {agent.revoke.cancelLabel}
          </AlertDialogClose>
          <Button
            variant="destructive"
            loading={pending}
            onClick={() => {
              if (row === null) {
                return;
              }
              setPending(true);
              setFailure(null);
              onRevoke(row.id)
                .then(() => {
                  onClose();
                })
                .catch((error: unknown) => {
                  setFailure(
                    error instanceof Error ? error.message : String(error)
                  );
                })
                .finally(() => {
                  setPending(false);
                });
            }}
          >
            {agent.revoke.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
