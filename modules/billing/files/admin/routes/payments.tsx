import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { BanknoteIcon, RefreshCwIcon, UserIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@repo/ui/components/button";

import { DataTable } from "@admin/components/data-table";
import type { DataTableColumn } from "@admin/components/data-table";
import { DetailPanel } from "@admin/components/detail-panel";
import { FilterChips } from "@admin/components/filter-chips";
import { PageHeader } from "@admin/components/page-header";
import { PageLayout } from "@admin/components/page-layout";
import { StatusPill } from "@admin/components/status-pill";
import { api } from "@admin/lib/api";

// The Payments queue at `/payments`, shipped by `modules/billing` and reachable the moment
// the file lands: the router plugin wires it from the path, and the module's `const-array`
// patch adds the nav entry.
//
// It is an operations inbox, not the per-subject Billing page. A submission here is a claim
// that somebody sent money to a wallet or an account this project does not own an API for,
// and the only way to check it is to read the receiving account's own statement. The screen
// exists to make that comparison quick: the figure quoted at checkout beside the figure the
// subject claims, the transaction reference, and a flag when the sender's number changed.
//
// **Nothing on this screen is verified.** Approving grants a period on the operator's word.

const STATUS_FILTERS = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "withdrawn", label: "Withdrawn" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["id"];

const submissionsQuery = (status: StatusFilter) =>
  queryOptions({
    queryKey: ["admin", "billing", "submissions", status],
    queryFn: async () => {
      const res = await api.admin.billing.submissions.$get({
        query: { status },
      });
      if (res.status !== 200) {
        throw new Error(`The api answered ${String(res.status)}.`);
      }
      return res.json();
    },
  });

export const Route = createFileRoute("/payments")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(submissionsQuery("pending")),
  component: Payments,
  errorComponent: PaymentsError,
});

/**
 * One queue row, taken from the query's own return type rather than redeclared. Writing the
 * fields out by hand would compile happily after the api dropped one of them.
 */
type Submission = Awaited<
  ReturnType<NonNullable<ReturnType<typeof submissionsQuery>["queryFn"]>>
>["submissions"][number];

/** A minor-unit figure, rendered in its currency. `49900` BDT reads as `৳499.00`. */
function money(amount: number, currency: string) {
  const format = new Intl.NumberFormat(undefined, {
    currency: currency.toUpperCase(),
    style: "currency",
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** digits);
}

/**
 * What the subject says they paid, when the provider asked for it, or a dash.
 *
 * Read out of `fields` rather than off a column: what a provider collects is the provider's
 * business, and the core stores it as a map for exactly that reason.
 */
function claimed(row: Submission): string {
  const value = (row.fields as Record<string, string>).amount;
  return value ?? "—";
}

const TONES: Record<string, "open" | "neutral"> = {
  approved: "open",
  pending: "open",
};

const COLUMNS: readonly DataTableColumn<Submission>[] = [
  {
    id: "subject",
    header: "Subject",
    value: (row) => row.referenceId,
    sortable: true,
    cell: (row) => (
      <span className="truncate font-mono text-xs">{row.referenceId}</span>
    ),
  },
  {
    id: "plan",
    header: "Plan",
    value: (row) => row.plan,
    sortable: true,
  },
  {
    id: "expected",
    header: "Quoted",
    // The figure the subject was shown at checkout, stored on the row. It is deliberately
    // not recomputed from plans.ts: a price change must not make a correct payment look
    // short at review time.
    value: (row) => row.expectedAmount,
    sortable: true,
    align: "end",
    cell: (row) => <span>{money(row.expectedAmount, row.currency)}</span>,
  },
  {
    id: "claimed",
    header: "Claimed",
    value: claimed,
    align: "end",
  },
  {
    id: "reference",
    header: "Reference",
    value: (row) => row.transactionRef ?? "",
    sortable: true,
    cell: (row) => (
      <span className="font-mono text-xs">{row.transactionRef ?? "—"}</span>
    ),
  },
  {
    id: "flag",
    header: "Sender",
    value: (row) => (row.rememberedChanged ? "changed" : "same"),
    cell: (row) =>
      row.rememberedChanged ? (
        <StatusPill label="changed" tone="neutral" />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "created",
    header: "Submitted",
    value: (row) => new Date(row.createdAt),
    sortable: true,
    align: "end",
  },
];

function Payments() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const { data, isFetching } = useQuery(submissionsQuery(status));
  const rows = useMemo(() => data?.submissions ?? [], [data]);
  const selected = rows.find((row) => row.id === selectedId);

  const review = useMutation({
    mutationFn: async (input: { id: string; decision: string }) => {
      const res = await api.admin.billing.submissions[":id"].review.$post({
        json: { decision: input.decision, note },
        param: { id: input.id },
      });
      const body = await res.json();
      if (res.status !== 200) {
        throw new Error(
          "error" in body
            ? body.error.message
            : "The review did not go through."
        );
      }
      return body;
    },
    onSuccess: async () => {
      setSelectedId(null);
      setNote("");
      await queryClient.invalidateQueries({
        queryKey: ["admin", "billing", "submissions"],
      });
    },
  });

  return (
    <PageLayout
      detailLabel={selected?.transactionRef ?? undefined}
      onDetailClose={() => {
        setSelectedId(null);
      }}
      detail={
        selected === undefined ? undefined : (
          <DetailPanel
            title={selected.transactionRef ?? selected.id}
            onClose={() => {
              setSelectedId(null);
            }}
            attributes={[
              {
                label: "Status",
                value: (
                  <StatusPill
                    label={selected.status}
                    tone={TONES[selected.status] ?? "neutral"}
                  />
                ),
              },
              {
                label: "Quoted",
                value: money(selected.expectedAmount, selected.currency),
              },
            ]}
            groups={[
              {
                id: "payment",
                label: "Payment",
                icon: BanknoteIcon,
                items: [
                  { label: "Plan", value: selected.plan },
                  { label: "Interval", value: selected.billingInterval },
                  {
                    label: "Quoted at checkout",
                    value: money(selected.expectedAmount, selected.currency),
                  },
                  { label: "Claimed by subject", value: claimed(selected) },
                  {
                    label: "Transaction reference",
                    value: selected.transactionRef ?? "—",
                  },
                  { label: "Provider", value: selected.provider },
                ],
              },
              {
                id: "subject",
                label: "Subject",
                icon: UserIcon,
                items: [
                  { label: "Reference id", value: selected.referenceId },
                  { label: "Type", value: selected.customerType },
                  {
                    label: "Sender number changed",
                    value: selected.rememberedChanged ? "Yes" : "No",
                  },
                  ...Object.entries(
                    selected.fields as Record<string, string>
                  ).map(([key, value]) => ({ label: key, value })),
                ],
              },
            ]}
            tabs={[
              {
                id: "review",
                label: "Review",
                content: (
                  <div className="flex flex-col gap-3 p-4 text-sm">
                    <p className="text-muted-foreground">
                      Check this transaction reference against the receiving
                      account&#39;s own statement before you approve. Nothing
                      here has been verified for you.
                    </p>
                    <label
                      className="flex flex-col gap-1"
                      htmlFor="review-note"
                    >
                      <span className="font-medium">Note</span>
                      <textarea
                        id="review-note"
                        className="border-border min-h-20 rounded-lg border p-2"
                        value={note}
                        placeholder="What you checked, or why you are refusing it. The subject reads this on a rejection."
                        onChange={(occasion) => {
                          setNote(occasion.target.value);
                        }}
                      />
                    </label>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={
                          review.isPending || selected.status !== "pending"
                        }
                        onClick={() => {
                          review.mutate({
                            decision: "approve",
                            id: selected.id,
                          });
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          review.isPending || selected.status !== "pending"
                        }
                        onClick={() => {
                          review.mutate({
                            decision: "reject",
                            id: selected.id,
                          });
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                    {review.error ? (
                      <p className="text-destructive" role="alert">
                        {review.error.message}
                      </p>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        )
      }
    >
      <PageHeader
        title="Payments"
        count={rows.length}
        description="Payments subjects say they made, waiting for someone to check them against the receiving account."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => {
              void queryClient.invalidateQueries({
                queryKey: ["admin", "billing", "submissions"],
              });
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      <div className="border-border flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <FilterChips
          chips={STATUS_FILTERS.map((filter) => ({
            id: filter.id,
            label: filter.label,
          }))}
          selectedId={status}
          label="Filter payment submissions by status"
          onSelect={(id) => {
            setSelectedId(null);
            setStatus(id as StatusFilter);
          }}
        />
      </div>

      <DataTable
        caption="Payment submissions, with the figure quoted at checkout beside the one the subject claims."
        columns={COLUMNS}
        rows={rows}
        rowId={(row) => row.id}
        selectedId={selectedId}
        onRowClick={(row) => {
          setNote("");
          setSelectedId(row.id);
        }}
        emptyState={
          status === "pending"
            ? "Nothing waiting. Payments appear here once a subject submits a transaction reference."
            : `No ${status} submissions.`
        }
      />
    </PageLayout>
  );
}

// A 403 is a real answer here, not only a down api: both routes are role-gated on the
// server as well as in the shell.
function PaymentsError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader
        title="Payments"
        description="The payment queue did not load."
        actions={
          <Button variant="outline" size="sm" onClick={reset}>
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div
          role="alert"
          className="border-border text-muted-foreground max-w-2xl rounded-xl border p-4 text-sm"
        >
          {error.message} GET /admin/billing/submissions answers 403 unless the
          signed-in account has the admin role.
        </div>
      </div>
    </PageLayout>
  );
}
