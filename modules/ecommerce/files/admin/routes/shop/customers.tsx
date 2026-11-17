import { useQuery } from "@tanstack/react-query";
import {
  Link,
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import {
  ContactIcon,
  MapPinIcon,
  ReceiptTextIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { config } from "@repo/config";
import { DataTable } from "@repo/ui/blocks/shell/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/shell/data-table";
import { DetailPanel } from "@repo/ui/blocks/shell/detail-panel";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { Button } from "@repo/ui/components/shell/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/ui/components/shell/input-group";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import { OrderStatusPill } from "@admin/components/shop/shop-pills";
import { customerQuery, customersQuery } from "@admin/lib/shop-api";
import type { Customer, CustomerRow } from "@admin/lib/shop-api";
import { SHOP_LOCALE, shownDay } from "@admin/lib/shop-dates";
import { addressLines, relativeTime } from "@admin/lib/shop-format";
import { money } from "@admin/lib/shop-money";
import { useNow } from "@admin/lib/cms-now";

// The shop's Customers screen at `/shop/customers`. A customer is a client user with one or
// more orders (plan 0106, "Customers"); every figure is computed from `orders` by the api.
// The search and the page live in the search params, so a filtered list is a link. A row
// opens the customer in the detail column: contact, saved addresses and their orders.

interface CustomersSearch {
  q: string;
  page: number;
}

const DEFAULT_SEARCH: CustomersSearch = { page: 1, q: "" };

function parseSearch(search: Record<string, unknown>): CustomersSearch {
  const page = Number(search.page);
  return {
    page: Number.isInteger(page) && page > 1 ? page : 1,
    q: typeof search.q === "string" ? search.q.slice(0, 120) : "",
  };
}

export const Route = createFileRoute("/shop/customers")({
  validateSearch: parseSearch,
  search: { middlewares: [stripSearchParams(DEFAULT_SEARCH)] },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(customersQuery(deps.q, deps.page)),
  component: Customers,
  errorComponent: CustomersError,
});

const CURRENCY = config.ecommerce.currency;

/** A phone-only account carries a made-up address from auth-phone; it is not an email. */
function realEmail(email: string): string | null {
  return email.endsWith("@phone.invalid") ? null : email;
}

function columnsFor(now: Date): readonly DataTableColumn<CustomerRow>[] {
  return [
    {
      id: "name",
      header: "Name",
      card: "title",
      value: (row) => row.name,
      sortable: true,
      cell: (row) => <span className="truncate font-medium">{row.name}</span>,
    },
    {
      id: "phone",
      header: "Phone",
      card: "line",
      value: (row) => row.phoneNumber ?? "",
      cell: (row) => (
        <span className="tabular-nums">{row.phoneNumber ?? "No phone"}</span>
      ),
    },
    {
      id: "orders",
      header: "Orders",
      card: "line",
      align: "end",
      value: (row) => row.orderCount,
      sortable: true,
      cell: (row) => <span className="tabular-nums">{row.orderCount}</span>,
    },
    {
      id: "spent",
      header: "Total spent",
      card: "trailing",
      align: "end",
      value: (row) => row.totalSpent,
      sortable: true,
      cell: (row) => (
        <span className="tabular-nums">
          {money(row.totalSpent, CURRENCY, SHOP_LOCALE)}
        </span>
      ),
    },
    {
      id: "refusals",
      header: "COD refused",
      card: "line",
      align: "end",
      value: (row) => row.codRefusals,
      sortable: true,
      cell: (row) => (
        <span
          className={
            row.codRefusals > 0
              ? "text-status-bad-foreground font-medium tabular-nums"
              : "text-muted-foreground tabular-nums"
          }
        >
          {row.codRefusals}
        </span>
      ),
    },
    {
      id: "last",
      header: "Last order",
      card: "line",
      align: "end",
      value: (row) =>
        row.lastOrderAt === null ? null : new Date(row.lastOrderAt),
      sortable: true,
      cell: (row) =>
        row.lastOrderAt === null ? null : (
          <span className="text-muted-foreground">
            {relativeTime(row.lastOrderAt, now, SHOP_LOCALE)}
          </span>
        ),
    },
  ];
}

function CustomerDetail({
  row,
  detail,
  onClose,
}: {
  row: CustomerRow;
  detail: Customer | undefined;
  onClose: () => void;
}) {
  const email = realEmail(detail?.email ?? row.email);
  const addresses = detail?.addresses ?? [];
  const orders = detail?.orders ?? [];

  return (
    <DetailPanel
      title={row.name}
      onClose={onClose}
      className="flex-1"
      attributes={[
        { label: "Phone", value: row.phoneNumber },
        { label: "Email", value: email },
        { label: "Customer since", value: shownDay(row.createdAt) },
        {
          label: "Total spent",
          value: money(row.totalSpent, CURRENCY, SHOP_LOCALE),
        },
      ]}
      groups={[
        {
          id: "addresses",
          label: "Saved addresses",
          icon: MapPinIcon,
          items: [
            {
              label: "Addresses",
              value:
                detail === undefined ? (
                  <span className="text-muted-foreground">Loading…</span>
                ) : addresses.length === 0 ? (
                  <span className="text-muted-foreground">
                    No saved addresses
                  </span>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {addresses.map((address) => (
                      <li
                        key={address.id}
                        className="border-border rounded-lg border p-2.5 text-sm"
                      >
                        <p className="font-medium">
                          {address.name}
                          {address.isDefault ? (
                            <span className="text-muted-foreground font-normal">
                              {" "}
                              · Default
                            </span>
                          ) : null}
                        </p>
                        {addressLines(address).map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </li>
                    ))}
                  </ul>
                ),
            },
          ],
        },
        {
          id: "orders",
          label: "Orders",
          icon: ReceiptTextIcon,
          items: [
            {
              label: "Orders",
              value:
                detail === undefined ? (
                  <span className="text-muted-foreground">Loading…</span>
                ) : orders.length === 0 ? (
                  <span className="text-muted-foreground">No orders</span>
                ) : (
                  <ul className="flex flex-col">
                    {orders.map((order) => (
                      <li key={order.id}>
                        <Link
                          to="/shop/orders/$orderId"
                          params={{ orderId: order.id }}
                          className="hover:bg-accent focus-visible:ring-ring flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm outline-none focus-visible:ring-2"
                        >
                          <span className="font-medium tabular-nums">
                            {order.label}
                          </span>
                          <OrderStatusPill status={order.status} />
                          <span className="ml-auto tabular-nums">
                            {money(order.total, order.currency, SHOP_LOCALE)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ),
            },
          ],
        },
      ]}
    />
  );
}

function Customers() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const now = useNow();
  const [text, setText] = useState(search.q);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The search box writes the address 300 ms after the last key, so a typed name is one
  // request, not one per letter.
  useEffect(() => {
    if (text === search.q) {
      return;
    }
    const timer = setTimeout(() => {
      void navigate({ search: { page: 1, q: text.trim() } });
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [text, search.q, navigate]);

  const { data } = useQuery(customersQuery(search.q, search.page));
  const rows = data?.customers ?? [];
  const selected = rows.find((row) => row.id === selectedId);
  const detail = useQuery({
    ...customerQuery(selectedId ?? ""),
    enabled: selectedId !== null,
  });

  return (
    <PageLayout
      detailLabel={selected?.name}
      onDetailClose={() => {
        setSelectedId(null);
      }}
      detail={
        selected === undefined ? undefined : (
          <CustomerDetail
            row={selected}
            detail={detail.data}
            onClose={() => {
              setSelectedId(null);
            }}
          />
        )
      }
    >
      <PageHeader title="Customers" count={data?.total} />
      <div className="border-border flex shrink-0 items-center gap-2 border-b px-(--page-gutter) py-2">
        <InputGroup className="max-w-md">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search customers by name, phone or email"
            placeholder="Search by name, phone or email"
            value={text}
            maxLength={120}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        </InputGroup>
      </div>
      <DataTable
        caption="Customers with one or more orders, with their order count, total spent and COD refusals."
        columns={columnsFor(now)}
        rows={rows}
        rowId={(row) => row.id}
        selectedId={selectedId}
        onRowClick={(row) => {
          setSelectedId(row.id);
        }}
        emptyState={
          <EmptyState
            icon={ContactIcon}
            title={
              search.q === ""
                ? "No customers yet"
                : `No customer matches ${search.q}`
            }
            description={
              search.q === ""
                ? "A buyer appears here after their first order."
                : "Search by a name, a phone number or an email."
            }
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
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={data.page >= data.pageCount}
              onClick={() => {
                void navigate({ search: { ...search, page: data.page + 1 } });
              }}
            >
              Next
            </Button>
          </span>
        </nav>
      ) : null}
    </PageLayout>
  );
}

function CustomersError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Customers" />
      <ErrorState
        code="500"
        title="The customer list did not load"
        description="Check that the api is running and that you are signed in to the admin app."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{ label: "Try again", onClick: reset }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
