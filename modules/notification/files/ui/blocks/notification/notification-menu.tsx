import { BellIcon, CheckCheckIcon, CircleAlertIcon } from "lucide-react";
import type * as React from "react";

import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { Button, buttonVariants } from "@repo/ui/components/shell/button";
import {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "@repo/ui/components/shell/popover";
import { Skeleton } from "@repo/ui/components/shell/skeleton";
import { badgeText } from "@repo/ui/lib/notification/format";
import { cn } from "@repo/ui/lib/utils";

// The bell in the shell header and the menu it opens: the newest few notifications, a
// "Mark all read" action and a way to the full page.
//
// It is presentational. The app's shell extension (@app/components/notification-extension)
// owns the queries and passes the count, the rows, the menu state and every action down.
// The words are prop defaults, so a project can change one without forking the file.

/** One row as the blocks show it. The app formats the time and the category label. */
export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  /** The row's age, already formatted, such as "4 minutes ago". */
  time: string;
  /** The category's label, such as "Account". */
  category: string;
}

/** What the menu's body shows: skeleton rows, a failure, or the rows (none is the empty state). */
export type NotificationMenuState = "loading" | "error" | "ready";

const DEFAULT_COPY = {
  bellLabel: "Notifications",
  title: "Notifications",
  markAllRead: "Mark all read",
  viewAll: "View all notifications",
  emptyTitle: "No notifications yet",
  emptyDescription: "When something needs your attention, it shows here.",
  errorTitle: "Could not load notifications",
  errorDescription: "Check your connection and try again.",
  retry: "Try again",
  unread: "Unread",
};

export type NotificationMenuCopy = typeof DEFAULT_COPY;

/** A plain left click, which the app turns into a client-side navigation. */
function isPlainClick(event: React.MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/** The bell's count badge: none at 0 or before the count is known, `99+` above 99. */
function BellBadge({ count }: { count: number | undefined }) {
  const text = badgeText(count);
  if (text === null) {
    return null;
  }
  return (
    <span
      aria-hidden
      data-slot="notification-badge"
      className="bg-destructive ring-background pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.625rem] leading-none font-semibold text-white tabular-nums ring-2"
    >
      {text}
    </span>
  );
}

function MenuRow({
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
        className="hover:bg-accent focus-visible:bg-accent data-unread:bg-muted/56 data-unread:hover:bg-accent grid w-full cursor-pointer grid-cols-[0.5rem_minmax(0,1fr)] gap-x-3 px-4 py-3 text-left outline-none"
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
              "truncate text-sm",
              item.read ? "font-normal" : "font-semibold"
            )}
          >
            {item.read ? null : (
              <span className="sr-only">{`${unreadLabel}: `}</span>
            )}
            {item.title}
          </span>
          {item.body === null ? null : (
            <span className="text-muted-foreground truncate text-sm">
              {item.body}
            </span>
          )}
          <span className="text-muted-foreground text-xs">
            {item.time} · {item.category}
          </span>
        </span>
      </button>
    </li>
  );
}

function MenuSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-4 p-4">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-[70%]" />
          <Skeleton className="h-3.5 w-[95%]" />
        </div>
      ))}
    </div>
  );
}

export function NotificationMenu({
  count,
  items,
  state,
  open,
  onOpenChange,
  onSelect,
  onMarkAllRead,
  markingAllRead = false,
  onRetry,
  viewAllHref = "/notifications",
  onViewAll,
  copy: copyOverrides,
}: {
  /** The unread count on the bell. `undefined` is "not known yet", which shows no badge. */
  count: number | undefined;
  /** The newest rows, already cut to the menu's size. */
  items: readonly NotificationItem[];
  state: NotificationMenuState;
  open?: boolean;
  /** Called when the menu opens or closes. The app fetches the rows on open. */
  onOpenChange?: (open: boolean) => void;
  /** A row was clicked. The app marks it read, then follows its link if it has one. */
  onSelect: (item: NotificationItem) => void;
  onMarkAllRead: () => void;
  markingAllRead?: boolean;
  onRetry: () => void;
  /** The full page. The footer is a real link, so a new tab still works. */
  viewAllHref?: string;
  /** A plain click on the footer link. The app navigates in place and closes the menu. */
  onViewAll?: () => void;
  copy?: Partial<NotificationMenuCopy>;
}): React.ReactElement {
  const copy = { ...DEFAULT_COPY, ...copyOverrides };
  const badge = badgeText(count);
  const hasUnread = items.some((item) => !item.read) || badge !== null;

  let body: React.ReactNode;
  if (state === "loading") {
    body = <MenuSkeleton />;
  } else if (state === "error") {
    body = (
      <EmptyState
        className="py-8 md:py-8"
        icon={CircleAlertIcon}
        title={copy.errorTitle}
        description={copy.errorDescription}
        action={
          <Button variant="outline" size="sm" onClick={onRetry}>
            {copy.retry}
          </Button>
        }
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        className="py-8 md:py-8"
        title={copy.emptyTitle}
        description={copy.emptyDescription}
      />
    );
  } else {
    body = (
      <ul className="divide-border divide-y">
        {items.map((item) => (
          <MenuRow
            key={item.id}
            item={item}
            onSelect={onSelect}
            unreadLabel={copy.unread}
          />
        ))}
      </ul>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              badge === null
                ? copy.bellLabel
                : `${copy.bellLabel}, ${badge} unread`
            }
          />
        }
      >
        <BellIcon />
        <BellBadge count={count} />
      </PopoverTrigger>
      <PopoverPopup
        align="end"
        className="w-[min(24rem,calc(100vw-1rem))] *:data-[slot=popover-viewport]:p-0"
      >
        <div className="flex flex-col">
          <div className="border-border flex h-12 items-center justify-between gap-2 border-b ps-4 pe-2">
            <PopoverTitle className="text-sm font-semibold">
              {copy.title}
            </PopoverTitle>
            {state === "ready" && hasUnread ? (
              <Button
                variant="ghost"
                size="sm"
                loading={markingAllRead}
                onClick={onMarkAllRead}
              >
                <CheckCheckIcon />
                {copy.markAllRead}
              </Button>
            ) : null}
          </div>
          {body}
          <div className="border-border border-t p-1">
            <a
              href={viewAllHref}
              className={buttonVariants({
                variant: "ghost",
                className: "w-full",
              })}
              onClick={(event) => {
                if (onViewAll && isPlainClick(event)) {
                  event.preventDefault();
                  onViewAll();
                }
              }}
            >
              {copy.viewAll}
            </a>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
