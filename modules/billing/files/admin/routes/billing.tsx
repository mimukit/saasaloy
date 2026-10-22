import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import {
  CreditCardIcon,
  DownloadIcon,
  ExternalLinkIcon,
  ReceiptIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { DataTable } from "@repo/ui/blocks/admin/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/admin/data-table";
import { DetailPanel } from "@repo/ui/blocks/admin/detail-panel";
import { EmptyState } from "@repo/ui/blocks/admin/empty-state";
import { ErrorState } from "@repo/ui/blocks/admin/error-state";
import { PageHeader } from "@repo/ui/blocks/admin/page-header";
import { Badge } from "@repo/ui/components/admin/badge";
import { Button, buttonVariants } from "@repo/ui/components/admin/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@repo/ui/components/admin/card";
import { toastManager } from "@repo/ui/components/admin/toast";
import { PageBody } from "@repo/ui/containers/admin/page-body";
import { PageLayout } from "@repo/ui/containers/admin/page-layout";
import { errors } from "@repo/ui/content/errors";

import { api } from "@admin/lib/api";

// The billing screen at `/billing`, shipped by `modules/billing` and reachable the moment
// the file lands: the router plugin wires it from the path, and the module's `const-array`
// patch adds the sidebar entry.
//
// It follows the convention `src/routes/index.tsx` sets out — `queryOptions`, prefetch in
// the loader, read with `useQuery`, invalidate by key — and it names no payment provider.
// Every call goes to `apps/api`'s `/billing` routes, which pick the provider from
// `BILLING_PROVIDER`. Swap Stripe for Polar and this file does not change.
//
// Checkout and the portal both answer with a url and the browser follows it. That is the
// whole client half: the vendor owns the payment form, and this project never sees a card.

const subscriptionQuery = queryOptions({
  queryKey: ["billing", "subscription"],
  queryFn: async () => {
    const res = await api.billing.subscription.$get();
    // `res.status === 200`, not `res.ok`. `hc` keys the response type by status code, so
    // the narrow is what drops the error envelope out of the union and leaves the body.
    if (res.status !== 200) {
      throw new Error(`The api answered ${String(res.status)}.`);
    }
    return res.json();
  },
});

const invoicesQuery = queryOptions({
  queryKey: ["billing", "invoices"],
  queryFn: async () => {
    const res = await api.billing.invoices.$get();
    if (res.status !== 200) {
      throw new Error(`The api answered ${String(res.status)}.`);
    }
    return res.json();
  },
});

/**
 * One invoice row, taken from the query's own return type rather than redeclared. It is
 * the JSON form of the provider's `Invoice`, so `createdAt` arrives as a string.
 */
type InvoiceRow = Awaited<
  ReturnType<NonNullable<(typeof invoicesQuery)["queryFn"]>>
>["invoices"][number];

export const Route = createFileRoute("/billing")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(subscriptionQuery),
      context.queryClient.ensureQueryData(invoicesQuery),
    ]),
  component: Billing,
  errorComponent: BillingError,
});

// Vendors report statuses in their own words, so only the two that every one of them
// shares get a colour: a paid invoice is settled, an open one is waiting on the customer.
// Everything else (draft, void, uncollectible, a vendor's own term) stays neutral.
function InvoiceStatus({ status }: { status: string }) {
  if (status === "paid") {
    return <Badge variant="success">{status}</Badge>;
  }

  if (status === "open") {
    return <Badge variant="warning">{status}</Badge>;
  }

  return <Badge variant="secondary">{status}</Badge>;
}

// The invoice table's shape, at module scope: it depends on no state, and hoisting it keeps
// the `cell` renderers out of the render pass.
const INVOICE_COLUMNS: readonly DataTableColumn<InvoiceRow>[] = [
  {
    id: "number",
    header: "Invoice",
    value: (invoice) => invoice.number ?? invoice.id,
    sortable: true,
    cell: (invoice) => (
      <span className="font-mono text-xs">{invoice.number ?? invoice.id}</span>
    ),
  },
  {
    id: "status",
    header: "Status",
    value: (invoice) => invoice.status,
    sortable: true,
    cell: (invoice) => <InvoiceStatus status={invoice.status} />,
  },
  {
    id: "created",
    header: "Date",
    // A Date, not the raw string: it is what sorts correctly and what DataTable formats
    // for the cell.
    value: (invoice) => new Date(invoice.createdAt),
    sortable: true,
  },
  {
    id: "amount",
    header: "Amount",
    // The minor-unit number sorts; the cell shows it formatted. Mixed currencies sort by
    // the raw number, which is the best a list with no exchange rate can do.
    value: (invoice) => invoice.amount,
    sortable: true,
    align: "end",
    cell: (invoice) => (
      <span className="font-medium tabular-nums">
        {formatAmount(invoice.amount, invoice.currency)}
      </span>
    ),
  },
];

function Billing() {
  const queryClient = useQueryClient();
  const subscription = useQuery(subscriptionQuery);
  const invoices = useQuery(invoicesQuery);

  // The open invoice belongs to this route, not to DataTable or DetailPanel: the table
  // reports a click and the panel reports a close, and this state decides what both mean.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const live = subscription.data?.subscription ?? null;
  const plan = subscription.data?.plan;
  const planList = subscription.data?.plans ?? [];
  const invoiceRows = useMemo(
    () => invoices.data?.invoices ?? [],
    [invoices.data]
  );
  const selected = invoiceRows.find((invoice) => invoice.id === selectedId);
  // A vendor may send either link as null, undefined or an empty string; all three mean
  // "no page to open", so they collapse to null once, here.
  const hostedUrl = linkOrNull(selected?.hostedUrl);
  const pdfUrl = linkOrNull(selected?.pdfUrl);

  // Checkout and change-plan are the same gesture from here: buy when nothing is live,
  // move when something is. The api refuses a second live subscription either way, so the
  // branch is about which endpoint to call and nothing more.
  const buy = useMutation({
    mutationFn: async (planId: string) => {
      const json = {
        cancelUrl: `${window.location.origin}/billing`,
        interval: "monthly" as const,
        planId,
        successUrl: `${window.location.origin}/billing`,
      };
      const res = live
        ? await api.billing["change-plan"].$post({ json })
        : await api.billing.checkout.$post({ json });
      const body = await res.json();
      if (res.status !== 200 || !("url" in body)) {
        throw new Error(
          "error" in body ? body.error.message : "Checkout failed."
        );
      }
      return body.url;
    },
    // The success toast is brief on purpose: the very next line leaves the page for the
    // vendor's checkout, so it only covers the moment before the browser navigates.
    onSuccess: (url) => {
      toastManager.add({
        type: "success",
        title: live ? "Opening the plan change" : "Opening checkout",
      });
      window.location.assign(url);
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: live ? "The plan did not change" : "Checkout did not open",
        description: error.message,
      });
    },
  });

  const portal = useMutation({
    mutationFn: async () => {
      const res = await api.billing.portal.$post({
        json: { returnUrl: `${window.location.origin}/billing` },
      });
      const body = await res.json();
      if (res.status !== 200 || !("url" in body)) {
        throw new Error(
          "error" in body ? body.error.message : "The portal did not open."
        );
      }
      return body.url;
    },
    onSuccess: (url) => {
      toastManager.add({
        type: "success",
        title: "Opening the billing portal",
      });
      window.location.assign(url);
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "The billing portal did not open",
        description: error.message,
      });
    },
  });

  return (
    <PageLayout
      detailLabel={selected?.number ?? selected?.id}
      onDetailClose={() => {
        setSelectedId(null);
      }}
      detail={
        selected === undefined ? undefined : (
          <DetailPanel
            title={selected.number ?? selected.id}
            description={formatAmount(selected.amount, selected.currency)}
            onClose={() => {
              setSelectedId(null);
            }}
            attributes={[
              {
                label: "Status",
                value: <InvoiceStatus status={selected.status} />,
              },
              {
                label: "Amount",
                value: formatAmount(selected.amount, selected.currency),
              },
              { label: "Currency", value: selected.currency.toUpperCase() },
              {
                label: "Created",
                value: new Date(selected.createdAt).toLocaleString(),
              },
              { label: "Number", value: selected.number },
              { label: "Invoice id", value: selected.id },
            ]}
            // Both links point at the vendor's own pages, so they are plain anchors in the
            // button's look rather than buttons. A vendor that issues neither leaves the
            // panel with no actions, rather than with two dead buttons.
            actions={
              hostedUrl === null && pdfUrl === null ? undefined : (
                <div className="flex flex-wrap gap-2">
                  {hostedUrl === null ? null : (
                    <a
                      href={hostedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      <ExternalLinkIcon />
                      View invoice
                    </a>
                  )}
                  {pdfUrl === null ? null : (
                    <a
                      href={pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      <DownloadIcon />
                      Download PDF
                    </a>
                  )}
                </div>
              )
            }
          />
        )
      }
    >
      {/* The count is the invoices the provider returned. Refresh stays in the header, so
          its live state is visible whichever part of the page is scrolled into view. */}
      <PageHeader
        title="Billing"
        count={invoices.data?.invoices.length}
        description="The plan this account is on, and the invoices behind it."
        actions={
          <Button
            variant="outline"
            size="sm"
            loading={subscription.isFetching || invoices.isFetching}
            // One prefix key covers both queries, so a single invalidation refreshes the
            // plan and the invoices together.
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["billing"] });
            }}
          >
            <RefreshCwIcon />
            Refresh
          </Button>
        }
      />

      {/* One scroll for the whole page. The cards sit in PageBody with its gutter, and the
          invoice table runs full bleed under them, aligning its own first column to the
          same gutter. Without the shared scroll the cards would squeeze the table to
          nothing on a short screen. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <PageBody className="flex-none overflow-visible">
          <Card>
            <CardHeader>
              <CardTitle>Current plan</CardTitle>
              <CardDescription>
                Resolved from the latest live row in{" "}
                <code className="font-mono">billing_subscriptions</code>,
                falling back to the default plan when there is none.
              </CardDescription>
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!live}
                  loading={portal.isPending}
                  onClick={() => {
                    portal.mutate();
                  }}
                >
                  <CreditCardIcon />
                  Manage billing
                </Button>
              </CardAction>
            </CardHeader>
            <CardPanel className="flex flex-wrap items-center gap-2 pt-0 text-sm">
              <span className="font-medium">{plan?.name ?? "—"}</span>
              <Badge variant={live ? "info" : "secondary"}>
                {live?.status ?? "no subscription"}
              </Badge>
              {live?.cancelAtPeriodEnd === true ? (
                <Badge variant="warning">cancels at period end</Badge>
              ) : null}
              {live?.trialEnd === undefined || live.trialEnd === null ? null : (
                <span className="text-muted-foreground">
                  trial ends {formatDate(live.trialEnd)}
                </span>
              )}
            </CardPanel>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Plans</CardTitle>
              <CardDescription>
                Declared in{" "}
                <code className="font-mono">packages/billing/src/plans.ts</code>
                . The default plan carries no price ids, so it has nothing to
                buy.
              </CardDescription>
            </CardHeader>
            <CardPanel className="px-0 pt-0 pb-2">
              <ul className="divide-border divide-y">
                {planList.map((candidate) => {
                  const isCurrent = candidate.id === plan?.id;

                  return (
                    <li
                      key={candidate.id}
                      className="flex flex-wrap items-center gap-2 px-6 py-2.5 text-sm"
                    >
                      <span className="font-medium">{candidate.name}</span>
                      {(candidate.trialDays ?? 0) > 0 ? (
                        <Badge variant="secondary">
                          {candidate.trialDays}-day trial
                        </Badge>
                      ) : null}
                      {isCurrent ? <Badge variant="info">current</Badge> : null}
                      <Button
                        className="ms-auto"
                        size="sm"
                        variant={isCurrent ? "outline" : "default"}
                        disabled={
                          isCurrent || candidate.isDefault || buy.isPending
                        }
                        // Only the pressed row spins; every other row stays disabled
                        // while a checkout is in flight, so a second press cannot race it.
                        loading={
                          buy.isPending && buy.variables === candidate.id
                        }
                        onClick={() => {
                          buy.mutate(candidate.id);
                        }}
                      >
                        {live ? "Change to this plan" : "Subscribe"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </CardPanel>
          </Card>
        </PageBody>

        <div className="border-border flex items-baseline gap-2 border-y px-(--page-gutter) py-2.5">
          <h2 className="text-sm font-semibold">Invoices</h2>
          <p className="text-muted-foreground truncate text-xs">
            Read from the payment provider on each request. Nothing here is
            stored in this project&#39;s database.
          </p>
        </div>

        <DataTable
          className="flex-none"
          caption="Invoices from the payment provider, with their number, status, date and amount."
          columns={INVOICE_COLUMNS}
          rows={invoiceRows}
          rowId={(invoice) => invoice.id}
          selectedId={selectedId}
          onRowClick={(invoice) => {
            setSelectedId(invoice.id);
          }}
          // The table has no filter, so there is one empty case: the provider has issued
          // nothing to this account yet.
          emptyState={
            <EmptyState
              icon={ReceiptIcon}
              title="No invoices yet"
              description={
                live
                  ? "The provider lists an invoice here once it bills this subscription."
                  : "Subscribe to a paid plan and its invoices appear here."
              }
            />
          }
        />
      </div>
    </PageLayout>
  );
}

function linkOrNull(url: string | null | undefined): string | null {
  return url === undefined || url === null || url === "" ? null : url;
}

function formatDate(value: string | number | Date) {
  return new Date(value).toLocaleDateString();
}

// Vendors report totals in the currency's minor unit, so scale down rather than rendering
// "999900" at a customer. The exponent comes from the currency, not a hard 100: JPY, KRW and
// VND have no minor unit, and dividing those by 100 would render ¥9900 as ¥99.
function formatAmount(amount: number, currency: string) {
  const format = new Intl.NumberFormat(undefined, {
    currency: currency.toUpperCase(),
    style: "currency",
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** digits);
}

// The route keeps its own error screen because the likeliest cause is specific to this
// module: `BILLING_PROVIDER` unset or naming a provider that is not installed. The
// router's default would retry just as well, but it could not name the variable.
function BillingError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Billing" />
      <ErrorState
        code={errors.renderFailure.code}
        title="Billing did not load"
        description="Check that BILLING_PROVIDER names an installed provider. It is required, and there is no default in either direction."
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
