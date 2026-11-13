import { useQuery } from "@tanstack/react-query";
import {
  Link,
  createFileRoute,
  notFound,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { FileTextIcon, PlusIcon } from "lucide-react";

import { config } from "@repo/config";
import { slugPrefix } from "@repo/cms";
import { DataTable } from "@repo/ui/blocks/shell/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/shell/data-table";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { FilterChips } from "@repo/ui/blocks/shell/filter-chips";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { Avatar, AvatarFallback } from "@repo/ui/components/shell/avatar";
import { Button } from "@repo/ui/components/shell/button";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import { CmsStatusPill } from "@admin/components/cms/status-pill";
import { initialsOf } from "@admin/lib/initials";
import { useNow } from "@admin/lib/cms-now";
import { collectionFor, listQuery } from "@admin/lib/cms-api";
import type { CmsSummary } from "@admin/lib/cms-api";
import { LIST_FILTERS, chipCounts, relativeTime } from "@admin/lib/cms-format";
import type { CmsListFilter } from "@admin/lib/cms-format";

// The list of one collection's entries, at `/cms/<collection>`. Every registered
// collection gets this screen from the one route file: the `$collection` param picks the
// collection, and an unregistered name is a 404. The filter chip and the page live in the
// search params, so a filtered list is a link.

interface ListSearch {
  status: CmsListFilter;
  page: number;
}

function parseSearch(search: Record<string, unknown>): ListSearch {
  const status = LIST_FILTERS.some((filter) => filter.id === search.status)
    ? (search.status as CmsListFilter)
    : "current";
  const page = Number(search.page);
  return {
    page: Number.isInteger(page) && page > 1 ? page : 1,
    status,
  };
}

const DEFAULT_SEARCH: ListSearch = { page: 1, status: "current" };

export const Route = createFileRoute("/cms/$collection/")({
  validateSearch: parseSearch,
  // The defaults stay out of the address, so the nav row's `/cms/blog` is the list itself.
  search: { middlewares: [stripSearchParams(DEFAULT_SEARCH)] },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps, params }) => {
    if (!collectionFor(params.collection)) {
      throw notFound();
    }
    return context.queryClient.ensureQueryData(
      listQuery(params.collection, deps.status, deps.page)
    );
  },
  component: EntryList,
  errorComponent: EntryListError,
});

function columnsFor(
  prefix: string,
  now: Date
): readonly DataTableColumn<CmsSummary>[] {
  return [
    {
      id: "title",
      header: "Title",
      value: (row) => row.title,
      sortable: true,
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.title}</span>
          <span className="text-muted-foreground truncate text-xs">
            {prefix}
            {row.slug}
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
      cell: (row) => (
        <div className="flex items-center gap-2">
          <CmsStatusPill status={row.status} />
          {row.hasUnpublishedEdits ? (
            <span className="text-muted-foreground text-xs">
              Unpublished edits
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "author",
      header: "Author",
      value: (row) => row.authorName ?? "",
      sortable: true,
      cell: (row) =>
        row.authorName === null ? (
          <span className="text-muted-foreground">No author</span>
        ) : (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar className="size-6">
              <AvatarFallback className="text-[0.625rem]">
                {initialsOf(row.authorName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{row.authorName}</span>
          </div>
        ),
    },
    {
      id: "updated",
      header: "Updated",
      value: (row) => new Date(row.updatedAt),
      sortable: true,
      align: "end",
      cell: (row) => (
        <span className="text-muted-foreground tabular-nums">
          {relativeTime(row.updatedAt, now)}
        </span>
      ),
    },
  ];
}

function EntryList() {
  const { collection: name } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const now = useNow();
  const collection = collectionFor(name);
  const { data } = useQuery({
    ...listQuery(name, search.status, search.page),
    enabled: collection !== undefined,
  });
  if (!collection) {
    return null;
  }

  const counts = data ? chipCounts(data.counts) : undefined;
  const singular = collection.singular.toLowerCase();
  const columns = columnsFor(slugPrefix(name, config.cms.basePath), now);

  return (
    <PageLayout>
      <PageHeader
        title={collection.label}
        count={counts?.all}
        actions={
          <Button
            size="sm"
            render={
              <Link to="/cms/$collection/new" params={{ collection: name }} />
            }
          >
            <PlusIcon />
            New {singular}
          </Button>
        }
      />
      <div className="border-border flex shrink-0 items-center gap-2 border-b px-(--page-gutter) py-2">
        <FilterChips
          label={`Filter ${collection.label.toLowerCase()} by status`}
          selectedId={search.status}
          onSelect={(id) => {
            void navigate({
              search: { page: 1, status: id as CmsListFilter },
            });
          }}
          chips={LIST_FILTERS.map((filter) => ({
            count: counts?.[filter.id],
            id: filter.id,
            label: filter.label,
          }))}
        />
      </div>
      <DataTable
        caption={`${collection.label} entries, with their status, author and last update.`}
        columns={columns}
        rows={data?.entries ?? []}
        rowId={(row) => row.id}
        onRowClick={(row) => {
          void navigate({
            params: { collection: name, entryId: row.id },
            to: "/cms/$collection/$entryId",
          });
        }}
        emptyState={
          <EmptyState
            icon={FileTextIcon}
            title={
              search.status === "current" || search.status === "all"
                ? `No ${singular}s yet`
                : `No ${search.status} ${singular}s`
            }
            description={`Write the first ${singular}. It stays a draft until you publish it.`}
            action={
              <Button
                size="sm"
                render={
                  <Link
                    to="/cms/$collection/new"
                    params={{ collection: name }}
                  />
                }
              >
                <PlusIcon />
                New {singular}
              </Button>
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

function EntryListError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Content" />
      <ErrorState
        code="500"
        title="The list did not load"
        description="Check that the api is running and that you are signed in as an admin."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{ label: "Try again", onClick: reset }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
