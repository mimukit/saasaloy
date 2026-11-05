import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MessageSquareTextIcon,
  SendIcon,
} from "lucide-react";
import { useState } from "react";

import { DataTable } from "@repo/ui/blocks/shell/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/shell/data-table";
import { DetailPanel } from "@repo/ui/blocks/shell/detail-panel";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { FilterChips } from "@repo/ui/blocks/shell/filter-chips";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { Button } from "@repo/ui/components/shell/button";
import { StatusPill } from "@repo/ui/components/shell/status-pill";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";
import { errors } from "@repo/ui/content/errors";

import { api } from "@admin/lib/api";

// The SMS log, at `/sms`: every text the api logged with `logSms()`, newest first, 50 a
// page. Read only. The body is never stored, so a row names its template, and the api masks
// any code in a provider's error text before it answers. It renders inside the page frame
// the root route provides.

type Status = "sent" | "failed";

interface SmsRow {
  id: string;
  createdAt: string;
  error: string | null;
  provider: string;
  providerRef: string | null;
  purpose: string;
  status: Status;
  template: string;
  toPhone: string;
  userId: string | null;
}

interface SmsPage {
  messages: SmsRow[];
  page: number;
  pageSize: number;
  total: number;
}

interface SmsSearch {
  page: number;
  status?: Status;
}

function smsQuery(search: SmsSearch) {
  return queryOptions({
    queryKey: ["sms", search.page, search.status ?? "all"],
    queryFn: async (): Promise<SmsPage> => {
      const response = await api.admin.sms.$get({
        query: {
          page: String(search.page),
          ...(search.status === undefined ? {} : { status: search.status }),
        },
      });
      if (!response.ok) {
        throw new Error(`GET /admin/sms answered ${String(response.status)}.`);
      }
      return (await response.json()) as SmsPage;
    },
  });
}

export const Route = createFileRoute("/sms")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(smsQuery({ page: 1 })),
  component: Sms,
  errorComponent: SmsError,
});

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "sent", label: "Sent" },
  { id: "failed", label: "Failed" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["id"];

/** `password_reset` reads "Password reset". The caller owns the purpose, not this page. */
function purposeLabel(purpose: string): string {
  const words = purpose.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function SmsStatus({ status }: { status: Status }) {
  return status === "failed" ? (
    <StatusPill label="Failed" tone="bad" />
  ) : (
    <StatusPill label="Sent" tone="ok" />
  );
}

const COLUMNS: readonly DataTableColumn<SmsRow>[] = [
  {
    id: "recipient",
    header: "Recipient",
    value: (row) => row.toPhone,
    sortable: true,
    cell: (row) => (
      <span className="truncate font-medium tabular-nums">{row.toPhone}</span>
    ),
  },
  {
    id: "message",
    header: "Message",
    value: (row) => purposeLabel(row.purpose),
    sortable: true,
    cell: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate">{purposeLabel(row.purpose)}</span>
        <span className="text-muted-foreground truncate font-mono text-xs">
          {row.template}
        </span>
      </div>
    ),
  },
  {
    id: "status",
    header: "Status",
    card: "trailing",
    value: (row) => row.status,
    sortable: true,
    cell: (row) => <SmsStatus status={row.status} />,
  },
  {
    id: "provider",
    header: "Provider",
    value: (row) => row.provider,
    sortable: true,
  },
  {
    id: "sent",
    header: "Sent",
    value: (row) => new Date(row.createdAt),
    sortable: true,
    align: "end",
  },
];

function Sms() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const search: SmsSearch =
    statusFilter === "all" ? { page } : { page, status: statusFilter };
  // The previous page stays on screen while the next one loads, so the pager does not
  // flash an empty table.
  const { data } = useQuery({
    ...smsQuery(search),
    placeholderData: keepPreviousData,
  });

  const rows = data?.messages ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const selected = rows.find((row) => row.id === selectedId);

  return (
    <PageLayout
      detailLabel={selected?.toPhone}
      onDetailClose={() => {
        setSelectedId(null);
      }}
      detail={
        selected === undefined ? undefined : (
          <DetailPanel
            title={selected.toPhone}
            description={purposeLabel(selected.purpose)}
            status={<SmsStatus status={selected.status} />}
            onClose={() => {
              setSelectedId(null);
            }}
            attributes={[
              {
                label: "Sent",
                value: new Date(selected.createdAt).toLocaleString(),
              },
              { label: "Template", value: selected.template },
            ]}
            groups={[
              {
                id: "delivery",
                label: "Delivery",
                icon: SendIcon,
                items: [
                  { label: "Purpose", value: purposeLabel(selected.purpose) },
                  { label: "Provider", value: selected.provider },
                  { label: "Provider ref", value: selected.providerRef },
                  { label: "Error", value: selected.error },
                  { label: "Account", value: selected.userId },
                  { label: "Body", value: "Not kept" },
                ],
              },
            ]}
          />
        )
      }
    >
      <PageHeader
        title="SMS"
        count={data?.total}
        description="Every text the api logged, newest first. The body is never kept, and a code in a provider error shows masked."
      />

      <div className="border-border flex shrink-0 items-center gap-2 border-b px-(--page-gutter) py-2">
        <FilterChips
          chips={STATUS_FILTERS}
          selectedId={statusFilter}
          label="Filter texts by status"
          onSelect={(id) => {
            // Every chip id comes out of STATUS_FILTERS.
            setStatusFilter(id as StatusFilter);
            setPage(1);
            setSelectedId(null);
          }}
        />
      </div>

      <DataTable
        caption="Texts sent, with their recipient, purpose, status, provider and time."
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
            icon={MessageSquareTextIcon}
            title={statusFilter === "all" ? "No texts yet" : "No texts match"}
            description={
              statusFilter === "all"
                ? "A text appears here once the api sends one and logs it."
                : "No text has this status."
            }
          />
        }
      />

      {total === 0 ? null : (
        <nav
          aria-label="Pages"
          className="border-border flex shrink-0 items-center justify-end gap-2 border-t px-(--page-gutter) py-2"
        >
          <span className="text-muted-foreground text-xs tabular-nums">
            {`${String(first)}–${String(last)} of ${String(total)}`}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            title="Previous page"
            disabled={page <= 1}
            onClick={() => {
              setPage(page - 1);
              setSelectedId(null);
            }}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            title="Next page"
            disabled={page >= pages}
            onClick={() => {
              setPage(page + 1);
              setSelectedId(null);
            }}
          >
            <ChevronRightIcon />
          </Button>
        </nav>
      )}
    </PageLayout>
  );
}

function SmsError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="SMS" />
      <ErrorState
        code={errors.renderFailure.code}
        title="The SMS log did not load"
        description="GET /admin/sms answers 403 unless the signed-in account has an admin role, and 500 when the api fails."
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
