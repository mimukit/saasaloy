import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { CreditCardIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";

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

export const Route = createFileRoute("/billing")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(subscriptionQuery),
      context.queryClient.ensureQueryData(invoicesQuery),
    ]),
  component: Billing,
  errorComponent: BillingError,
});

function Billing() {
  const queryClient = useQueryClient();
  const subscription = useQuery(subscriptionQuery);
  const invoices = useQuery(invoicesQuery);

  const live = subscription.data?.subscription ?? null;
  const plan = subscription.data?.plan;
  const planList = subscription.data?.plans ?? [];

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
    onSuccess: (url) => {
      window.location.assign(url);
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
      window.location.assign(url);
    },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Billing</h1>
          <p className="text-muted-foreground text-sm">
            The plan this account is on, and the invoices behind it.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={subscription.isFetching}
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ["billing"] })
          }
        >
          <RefreshCwIcon data-icon="inline-start" />
          {subscription.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
            <CardDescription>
              Resolved from the latest live row in{" "}
              <code className="font-mono">billing_subscription</code>, falling
              back to the default plan when there is none.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{plan?.name ?? "—"}</span>
            <Badge variant={live ? "default" : "secondary"}>
              {live?.status ?? "no subscription"}
            </Badge>
            {live?.cancelAtPeriodEnd ? (
              <Badge variant="secondary">cancels at period end</Badge>
            ) : null}
            {live?.trialEnd ? (
              <span className="text-muted-foreground">
                trial ends {formatDate(live.trialEnd)}
              </span>
            ) : null}
            <div className="ms-auto">
              <Button
                variant="outline"
                size="sm"
                disabled={!live || portal.isPending}
                onClick={() => portal.mutate()}
              >
                <CreditCardIcon data-icon="inline-start" />
                {portal.isPending ? "Opening…" : "Manage billing"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plans</CardTitle>
            <CardDescription>
              Declared in{" "}
              <code className="font-mono">packages/billing/src/plans.ts</code>.
              The default plan carries no price ids, so it has nothing to buy.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {planList.map((candidate) => {
              const isCurrent = candidate.id === plan?.id;

              return (
                <div
                  key={candidate.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
                >
                  <span className="font-medium">{candidate.name}</span>
                  {candidate.trialDays ? (
                    <Badge variant="secondary">
                      {candidate.trialDays}-day trial
                    </Badge>
                  ) : null}
                  {isCurrent ? <Badge>current</Badge> : null}
                  <div className="ms-auto">
                    <Button
                      size="sm"
                      disabled={
                        isCurrent || candidate.isDefault || buy.isPending
                      }
                      onClick={() => buy.mutate(candidate.id)}
                    >
                      {live ? "Change to this plan" : "Subscribe"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>
              Read from the payment provider on each request. Nothing here is
              stored in this project&#39;s database.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {invoices.data?.invoices.length ? (
              invoices.data.invoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex flex-wrap items-center gap-3 border-b py-2 last:border-b-0"
                >
                  <span className="font-mono text-xs">
                    {invoice.number ?? invoice.id}
                  </span>
                  <span>{formatDate(invoice.createdAt)}</span>
                  <Badge variant="secondary">{invoice.status}</Badge>
                  <span className="ms-auto font-medium">
                    {formatAmount(invoice.amount, invoice.currency)}
                  </span>
                  {invoice.hostedUrl ? (
                    <a
                      href={invoice.hostedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    >
                      View
                      <ExternalLinkIcon className="size-3.5" />
                    </a>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No invoices yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {buy.error || portal.error ? (
        <p className="text-destructive mt-4 text-sm" role="alert">
          {(buy.error ?? portal.error)?.message}
        </p>
      ) : null}
    </main>
  );
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

function BillingError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Billing did not load</CardTitle>
          <CardDescription>
            {error.message} Check that{" "}
            <code className="font-mono">BILLING_PROVIDER</code> names an
            installed provider — it is required, and there is no default in
            either direction.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={reset}>
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
