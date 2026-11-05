import { CircleAlertIcon } from "lucide-react";
import type * as React from "react";

import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { Badge } from "@repo/ui/components/shell/badge";
import { Button } from "@repo/ui/components/shell/button";
import { Skeleton } from "@repo/ui/components/shell/skeleton";
import { cn } from "@repo/ui/lib/utils";

import type { NotificationItem } from "@repo/ui/blocks/notification/notification-menu";

// The Inbox tab of the notifications page: every row, newest first, with "Load more" at
// the foot while the api has an older page.
//
// It is presentational. The page (@app/routes/notifications) owns the paged query and the
// mark-read mutation and passes the rows and the actions down. The rows run full bleed
// and align their text to the page gutter, so the list sits outside PageBody.

const DEFAULT_COPY = {
  loadMore: "Load more",
  emptyTitle: "No notifications yet",
  emptyDescription: "When something needs your attention, it shows here.",
  errorTitle: "Could not load notifications",
  errorDescription: "Check your connection and try again.",
  retry: "Try again",
  unread: "Unread",
};

export type NotificationListCopy = typeof DEFAULT_COPY;

/** What the list shows: skeleton rows, a failure, or the rows (none is the empty state). */
export type NotificationListState = "loading" | "error" | "ready";

function ListRow({
  item,
  onSelect,
  unreadLabel,
}: {
  item: NotificationItem;
  onSelect: (item: NotificationItem) => void;
  unreadLabel: string;
}) {
  return (
    <li>
      <button
        type="button"
        data-unread={item.read ? undefined : ""}
        className="hover:bg-accent focus-visible:bg-accent data-unread:bg-muted/56 data-unread:hover:bg-accent grid w-full cursor-pointer grid-cols-[0.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-(--page-gutter) py-3 text-left outline-none sm:grid-cols-[0.5rem_minmax(0,1fr)_auto]"
        onClick={() => {
          onSelect(item);
        }}
      >
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 rounded-full",
            item.read ? "bg-transparent" : "bg-info"
          )}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            className={cn(
              "text-sm",
              item.read ? "font-normal" : "font-semibold"
            )}
          >
            {item.read ? null : (
              <span className="sr-only">{`${unreadLabel}: `}</span>
            )}
            {item.title}
          </span>
          {item.body === null ? null : (
            <span className="text-muted-foreground text-sm">{item.body}</span>
          )}
        </span>
        {/* Below 640 px the time and the category drop under the text; above it they
            stand at the right of the row. */}
        <span className="text-muted-foreground col-start-2 flex items-center gap-2 text-xs sm:col-start-3 sm:flex-col sm:items-end sm:gap-1.5">
          <span>{item.time}</span>
          <Badge variant="secondary" className="text-muted-foreground">
            {item.category}
          </Badge>
        </span>
      </button>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy className="flex flex-col">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="border-border flex flex-col gap-2 border-b px-(--page-gutter) py-4"
        >
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function NotificationList({
  items,
  state,
  onSelect,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onRetry,
  copy: copyOverrides,
}: {
  items: readonly NotificationItem[];
  state: NotificationListState;
  /** A row was clicked. The page marks it read, then follows its link if it has one. */
  onSelect: (item: NotificationItem) => void;
  /** Whether the api holds an older page. "Load more" shows only then. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  copy?: Partial<NotificationListCopy>;
}): React.ReactElement {
  const copy = { ...DEFAULT_COPY, ...copyOverrides };

  if (state === "loading") {
    return <ListSkeleton />;
  }
  if (state === "error") {
    return (
      <EmptyState
        icon={CircleAlertIcon}
        title={copy.errorTitle}
        description={copy.errorDescription}
        action={
          <Button variant="outline" onClick={onRetry}>
            {copy.retry}
          </Button>
        }
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
    );
  }

  return (
    <div className="flex flex-col">
      <ul className="divide-border border-border divide-y border-b">
        {items.map((item) => (
          <ListRow
            key={item.id}
            item={item}
            onSelect={onSelect}
            unreadLabel={copy.unread}
          />
        ))}
      </ul>
      {hasMore ? (
        <div className="flex justify-center px-(--page-gutter) py-4">
          <Button variant="outline" loading={loadingMore} onClick={onLoadMore}>
            {copy.loadMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
