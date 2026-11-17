import { useQuery } from "@tanstack/react-query";
import {
  Link,
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { ImageIcon, PackageIcon, PlusIcon } from "lucide-react";

import { config } from "@repo/config";
import { DataTable } from "@repo/ui/blocks/shell/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/shell/data-table";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { FilterChips } from "@repo/ui/blocks/shell/filter-chips";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { Button } from "@repo/ui/components/shell/button";
import { StatusPill } from "@repo/ui/components/shell/status-pill";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import { ProductStatusPill } from "@admin/components/shop/shop-pills";
import { useNow } from "@admin/lib/cms-now";
import { productsQuery } from "@admin/lib/shop-api";
import type { ProductFilter, ProductRow } from "@admin/lib/shop-api";
import { SHOP_LOCALE } from "@admin/lib/shop-dates";
import { relativeTime } from "@admin/lib/shop-format";
import { money } from "@admin/lib/shop-money";

// The Products list, at `/shop/products`. Each row shows the cover image, the title, the
// status, the price range of the active variants in the store currency, the stock that is
// free to sell, the variant count and the last update. Stock at or below the configured
// threshold takes the warn tone; none left takes the bad one. The filter chip and the page
// live in the search params, so a filtered list is a link.

const FILTERS: readonly { id: ProductFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "draft", label: "Draft" },
];

interface ListSearch {
  status: ProductFilter;
  page: number;
}

function parseSearch(search: Record<string, unknown>): ListSearch {
  const status = FILTERS.some((filter) => filter.id === search.status)
    ? (search.status as ProductFilter)
    : "all";
  const page = Number(search.page);
  return { page: Number.isInteger(page) && page > 1 ? page : 1, status };
}

const DEFAULT_SEARCH: ListSearch = { page: 1, status: "all" };

export const Route = createFileRoute("/shop/products/")({
  validateSearch: parseSearch,
  search: { middlewares: [stripSearchParams(DEFAULT_SEARCH)] },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(productsQuery(deps.status, deps.page)),
  component: ProductList,
  errorComponent: ProductListError,
});

/** "BDT 1,450.00 to BDT 1,850.00", one price, or a note when nothing is priced. */
function priceRange(row: ProductRow, currency: string) {
  if (row.minPrice === null || row.maxPrice === null) {
    return <span className="text-muted-foreground">No price</span>;
  }
  const low = money(row.minPrice, currency, SHOP_LOCALE);
  return row.minPrice === row.maxPrice
    ? low
    : `${low} to ${money(row.maxPrice, currency, SHOP_LOCALE)}`;
}

function stockCell(row: ProductRow) {
  if (row.available <= 0) {
    return <StatusPill label="Out of stock" tone="bad" />;
  }
  if (row.lowStock) {
    return <StatusPill label={`${String(row.available)} left`} tone="warn" />;
  }
  return <span className="tabular-nums">{row.available}</span>;
}

function columnsFor(
  currency: string,
  now: Date
): readonly DataTableColumn<ProductRow>[] {
  return [
    {
      id: "title",
      header: "Product",
      card: "title",
      value: (row) => row.title,
      sortable: true,
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-3">
          {row.image?.url ? (
            <img
              src={row.image.url}
              alt=""
              className="bg-muted size-9 shrink-0 rounded-md object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md"
            >
              <ImageIcon className="size-4" />
            </span>
          )}
          <span className="truncate font-medium">{row.title}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      card: "trailing",
      value: (row) => row.status,
      sortable: true,
      cell: (row) => <ProductStatusPill status={row.status} />,
    },
    {
      id: "price",
      header: "Price",
      card: "line",
      value: (row) => row.minPrice,
      sortable: true,
      cell: (row) => (
        <span className="tabular-nums">{priceRange(row, currency)}</span>
      ),
    },
    {
      id: "stock",
      header: "Stock",
      card: "line",
      value: (row) => row.available,
      sortable: true,
      cell: stockCell,
    },
    {
      id: "variants",
      header: "Variants",
      card: "line",
      value: (row) => row.variantCount,
      sortable: true,
      align: "end",
      cell: (row) => <span className="tabular-nums">{row.variantCount}</span>,
    },
    {
      id: "updated",
      header: "Updated",
      card: "line",
      value: (row) => new Date(row.updatedAt),
      sortable: true,
      align: "end",
      cell: (row) => (
        <span className="text-muted-foreground tabular-nums">
          {relativeTime(row.updatedAt, now, SHOP_LOCALE)}
        </span>
      ),
    },
  ];
}

function NewProductButton() {
  return (
    <Button size="sm" render={<Link to="/shop/products/new" />}>
      <PlusIcon />
      New product
    </Button>
  );
}

function ProductList() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useQuery(productsQuery(search.status, search.page));
  const currency = data?.currency ?? config.ecommerce.currency;
  const now = useNow();
  const columns = columnsFor(currency, now);

  return (
    <PageLayout>
      <PageHeader
        title="Products"
        count={data?.total}
        actions={<NewProductButton />}
      />
      <div className="border-border flex shrink-0 items-center gap-2 border-b px-(--page-gutter) py-2">
        <FilterChips
          label="Filter products by status"
          selectedId={search.status}
          onSelect={(id) => {
            void navigate({ search: { page: 1, status: id as ProductFilter } });
          }}
          chips={FILTERS.map((filter) => ({
            id: filter.id,
            label: filter.label,
          }))}
        />
      </div>
      <DataTable
        caption="Products, with their status, price range, stock free to sell, variant count and last update."
        columns={columns}
        rows={data?.products ?? []}
        rowId={(row) => row.id}
        initialSort={{ desc: true, id: "updated" }}
        onRowClick={(row) => {
          void navigate({
            params: { productId: row.id },
            to: "/shop/products/$productId",
          });
        }}
        emptyState={
          <EmptyState
            icon={PackageIcon}
            title={
              search.status === "all"
                ? "No products yet"
                : `No ${search.status} products`
            }
            description="Add a product, give it options and prices, then publish it to the shop."
            action={<NewProductButton />}
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

function ProductListError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Products" />
      <ErrorState
        code="500"
        title="The product list did not load"
        description="Check that the api is running and that you are signed in to the admin app."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{ label: "Try again", onClick: reset }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
