import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { KeyRoundIcon, SendIcon } from "lucide-react";
import { useState } from "react";

import { DataTable } from "@repo/ui/blocks/shell/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/shell/data-table";
import { DetailPanel } from "@repo/ui/blocks/shell/detail-panel";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { StatusPill } from "@repo/ui/components/shell/status-pill";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";
import { errors } from "@repo/ui/content/errors";

import { api } from "@admin/lib/api";
import { contactOf } from "@admin/lib/contact";

// The login codes screen, at `/login-codes`: every phone code the api sent in the last 30
// minutes, newest first, with its state and the tries left, so support can tell a
// customer whether the code they hold still works. Read only, and it never shows a code:
// the api answer holds none. It renders inside the page frame the root route provides.

type State = "live" | "expired" | "ended";
type Purpose = "sign_up" | "password_reset";

interface LoginCodeRow {
  id: string;
  account: { id: string; name: string; email: string } | null;
  error: string | null;
  phone: string;
  purpose: Purpose;
  sendStatus: "sent" | "failed";
  sentAt: string;
  state: State;
  triesLeft: number | null;
}

interface LoginCodes {
  codes: LoginCodeRow[];
  windowMinutes: number;
}

const loginCodesQuery = queryOptions({
  queryKey: ["login-codes"],
  queryFn: async (): Promise<LoginCodes> => {
    const response = await api.admin["login-codes"].$get();
    if (!response.ok) {
      throw new Error(
        `GET /admin/login-codes answered ${String(response.status)}.`
      );
    }
    return (await response.json()) as LoginCodes;
  },
});

export const Route = createFileRoute("/login-codes")({
  loader: ({ context }) => context.queryClient.ensureQueryData(loginCodesQuery),
  component: LoginCodesPage,
  errorComponent: LoginCodesError,
});

const PURPOSE_LABELS: Record<Purpose, string> = {
  password_reset: "Password reset",
  sign_up: "Sign-up",
};

function CodeState({ state }: { state: State }) {
  switch (state) {
    case "live": {
      return <StatusPill label="Live" tone="ok" />;
    }
    case "expired": {
      return <StatusPill label="Expired" tone="neutral" />;
    }
    default: {
      return <StatusPill label="Ended" tone="neutral" />;
    }
  }
}

/** The account a code's phone belongs to, by its phone for a phone sign-up. */
function accountLabel(row: LoginCodeRow): string {
  return row.account === null ? "No account yet" : contactOf(row.account.email);
}

const COLUMNS: readonly DataTableColumn<LoginCodeRow>[] = [
  {
    id: "phone",
    header: "Phone",
    value: (row) => row.phone,
    sortable: true,
    cell: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium tabular-nums">{row.phone}</span>
        <span className="text-muted-foreground truncate text-xs">
          {accountLabel(row)}
        </span>
      </div>
    ),
  },
  {
    id: "purpose",
    header: "Purpose",
    value: (row) => PURPOSE_LABELS[row.purpose],
    sortable: true,
  },
  {
    id: "state",
    header: "State",
    card: "trailing",
    value: (row) => row.state,
    sortable: true,
    cell: (row) => <CodeState state={row.state} />,
  },
  {
    id: "tries",
    header: "Tries left",
    value: (row) => row.triesLeft,
    sortable: true,
    align: "end",
  },
  {
    id: "send",
    header: "Send",
    value: (row) => row.sendStatus,
    sortable: true,
    cell: (row) =>
      row.sendStatus === "failed" ? (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <StatusPill label="Failed" tone="bad" />
          {row.error === null ? null : (
            <span className="text-muted-foreground truncate text-xs">
              {row.error}
            </span>
          )}
        </div>
      ) : (
        <StatusPill label="Sent" tone="ok" />
      ),
  },
  {
    id: "sent",
    header: "Sent",
    value: (row) => new Date(row.sentAt),
    sortable: true,
    align: "end",
  },
];

function LoginCodesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data } = useQuery(loginCodesQuery);

  const rows = data?.codes ?? [];
  const minutes = String(data?.windowMinutes ?? 30);
  const selected = rows.find((row) => row.id === selectedId);

  return (
    <PageLayout
      detailLabel={selected?.phone}
      onDetailClose={() => {
        setSelectedId(null);
      }}
      detail={
        selected === undefined ? undefined : (
          <DetailPanel
            title={selected.phone}
            description={PURPOSE_LABELS[selected.purpose]}
            status={<CodeState state={selected.state} />}
            onClose={() => {
              setSelectedId(null);
            }}
            attributes={[
              {
                label: "Sent",
                value: new Date(selected.sentAt).toLocaleString(),
              },
              {
                label: "Tries left",
                value:
                  selected.triesLeft === null
                    ? null
                    : String(selected.triesLeft),
              },
            ]}
            groups={[
              {
                id: "send",
                label: "Send",
                icon: SendIcon,
                items: [
                  {
                    label: "Status",
                    value: selected.sendStatus === "failed" ? "Failed" : "Sent",
                  },
                  { label: "Error", value: selected.error },
                  { label: "Account", value: accountLabel(selected) },
                  { label: "Code", value: "Never shown" },
                ],
              },
            ]}
          />
        )
      }
    >
      <PageHeader
        title="Login codes"
        count={data?.codes.length}
        description={`Phone codes sent in the last ${minutes} minutes, newest first. A code is live until it is used, runs out of tries, expires, or a newer code replaces it. The code itself is never shown.`}
      />

      <DataTable
        caption="Login codes sent, with their phone, purpose, state, tries left, send result and time."
        columns={COLUMNS}
        rows={rows}
        rowId={(row) => row.id}
        selectedId={selectedId}
        onRowClick={(row) => {
          setSelectedId(row.id);
        }}
        onDismiss={() => {
          setSelectedId(null);
        }}
        emptyState={
          <EmptyState
            icon={KeyRoundIcon}
            title={`No codes in the last ${minutes} minutes`}
            description="A code appears here once a customer asks for a sign-up or a reset code."
          />
        }
      />
    </PageLayout>
  );
}

function LoginCodesError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Login codes" />
      <ErrorState
        code={errors.renderFailure.code}
        title="The login codes did not load"
        description="GET /admin/login-codes answers 403 unless the signed-in account has an admin role, and 500 when the api fails."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{
          label: errors.renderFailure.retryLabel,
          onClick: reset,
        }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
