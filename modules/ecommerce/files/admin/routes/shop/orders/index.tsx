import { useQuery } from "@tanstack/react-query";
import {
  Link,
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { PlusIcon, ShoppingCartIcon } from "lucide-react";

import { DataTable } from "@repo/ui/blocks/shell/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/shell/data-table";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { FilterChips } from "@repo/ui/blocks/shell/filter-chips";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { Button } from "@repo/ui/components/shell/button";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import {
  MethodTag,
  OrderStatusPill,
  PaymentStatusPill,
} from "@admin/components/shop/shop-pills";
import { useNow } from "@admin/lib/cms-now";
import { ordersQuery } from "@admin/lib/shop-api";
import type { OrderFilter, OrderListRow } from "@admin/lib/shop-api";
import { SHOP_LOCALE, shownDateTime } from "@admin/lib/shop-dates";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABEL,
  money,
  relativeTime,
} from "@admin/lib/shop-format";

// The Orders screen at `/shop/orders`: every order, newest first, with a chip per status
// and the COD tag on each cash-on-delivery row. The sidebar's badge on this row counts the
// placed COD orders waiting for a call. The status chip and the page live in the search
// params, so a filtered list is a link. A row opens the order page.

interface OrdersSearch {
  status: OrderFilter;
  page: number;
}

const FILTERS: readonly { id: OrderFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...ORDER_STATUSES.map((status) => ({
    id: status,
    label: ORDER_STATUS_LABEL[status],
  })),
];

function parseSearch(search: Record<string, unknown>): OrdersSearch {
  const status = FILTERS.some((filter) => filter.id === search.status)
    ? (search.status as OrderFilter)
    : "all";
  const page = Number(search.page);
  return { page: Number.isInteger(page) && page > 1 ? page : 1, status };
}

const DEFAULT_SEARCH: OrdersSearch = { page: 1, status: "all" };

export const Route = createFileRoute("/shop/orders/")({
  validateSearch: parseSearch,
  search: { middlewares: [stripSearchParams(DEFAULT_SEARCH)] },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(ordersQuery(deps.status, deps.page)),
  component: Orders,
  errorComponent: OrdersError,
});

function columnsFor(now: Date): readonly DataTableColumn<OrderListRow>[] {
  return [
    {
      id: "order",
      header: "Order",
      card: "title",
      value: (row) => row.number,
      sortable: true,
      cell: (row) => (
        <span className="font-medium tabular-nums">{row.label}</span>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      card: "line",
      value: (row) => row.contactName,
      sortable: true,
      grow: true,
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{row.contactName}</span>
          <span className="text-muted-foreground truncate text-xs tabular-nums">
            {row.contactPhone}
          </span>
        </span>
      ),
    },
    {
      id: "items",
      header: "Items",
      card: "line",
      value: (row) => row.itemCount,
      sortable: true,
      align: "end",
      cell: (row) => <span className="tabular-nums">{row.itemCount}</span>,
    },
    {
      id: "total",
      header: "Total",
      card: "trailing",
      value: (row) => row.total,
      sortable: true,
      align: "end",
      cell: (row) => (
        <span className="tabular-nums">
          {money(row.total, row.currency, SHOP_LOCALE)}
        </span>
      ),
    },
    {
      id: "payment",
      header: "Payment",
      card: "line",
      value: (row) => row.paymentMethod,
      cell: (row) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <MethodTag method={row.paymentMethod} />
          {row.paymentStatus === null ? null : (
            <PaymentStatusPill status={row.paymentStatus} />
          )}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      card: "line",
      value: (row) => row.status,
      sortable: true,
      cell: (row) => <OrderStatusPill status={row.status} />,
    },
    {
      id: "placed",
      header: "Placed",
      card: "line",
      value: (row) => new Date(row.createdAt),
      sortable: true,
      align: "end",
      cell: (row) => (
        <span
          className="text-muted-foreground tabular-nums"
          title={shownDateTime(row.createdAt)}
        >
          {relativeTime(row.createdAt, now, SHOP_LOCALE)}
        </span>
      ),
    },
  ];
}

function Orders() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const now = useNow(60_000);
  const { data } = useQuery(ordersQuery(search.status, search.page));
  const counts: Record<string, number> = data?.counts ?? {};
  const all = Object.values(counts).reduce((sum, n) => sum + n, 0);

  const newOrder = (
    <Button size="sm" render={<Link to="/shop/orders/new" />}>
      <PlusIcon />
      New order
    </Button>
  );

  return (
    <PageLayout>
      <PageHeader
        title="Orders"
        count={data ? all : undefined}
        actions={newOrder}
      />
      <div className="border-border flex shrink-0 items-center gap-2 overflow-x-auto border-b px-(--page-gutter) py-2">
        <FilterChips
          label="Filter orders by status"
          selectedId={search.status}
          onSelect={(id) => {
            void navigate({ search: { page: 1, status: id as OrderFilter } });
          }}
          chips={FILTERS.map((filter) => ({
            count: data
              ? filter.id === "all"
                ? all
                : (counts[filter.id] ?? 0)
              : undefined,
            id: filter.id,
            label: filter.label,
          }))}
        />
      </div>
      <DataTable
        caption="Orders, with the buyer, the total, the payment and the status."
        columns={columnsFor(now)}
        rows={data?.orders ?? []}
        rowId={(row) => row.id}
        onRowClick={(row) => {
          void navigate({
            params: { orderId: row.id },
            to: "/shop/orders/$orderId",
          });
        }}
        emptyState={
          <EmptyState
            icon={ShoppingCartIcon}
            title={
              search.status === "all"
                ? "No orders yet"
                : `No ${ORDER_STATUS_LABEL[search.status].toLowerCase()} orders`
            }
            description="Orders from the shop appear here. Take one by phone with New order."
            action={newOrder}
          />
        }
      />
      {data && data.pageCount > 1 ? (
        <nav
          aria-label="Pages"
          className="border-border flex shrink-0 items-center justify-between gap-2 border-t px-(--page-gutter) py-2 text-sm"
        >
          <span className="text-muted-foreground tabular-nums">
            Page {data.page} of {data.pageCount}
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={data.page <= 1}
              onClick={() => {
                void navigate({ search: { ...search, page: data.page - 1 } });
              }}
            >
              Newer
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={data.page >= data.pageCount}
              onClick={() => {
                void navigate({ search: { ...search, page: data.page + 1 } });
              }}
            >
              Older
            </Button>
          </span>
        </nav>
      ) : null}
    </PageLayout>
  );
}

function OrdersError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Orders" />
      <ErrorState
        code="500"
        title="The orders did not load"
        description="Check that the api is running and that you are signed in to the admin app."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{ label: "Try again", onClick: reset }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
