import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";

import { config } from "@repo/config";
import { NotificationMenu } from "@repo/ui/blocks/notification/notification-menu";
import type { ShellExtension } from "@repo/ui/lib/shell/extensions";

import {
  NOTIFICATIONS_KEY,
  fetchNotificationPage,
  toNotificationItem,
  useMarkAllRead,
  useOpenNotification,
  useUnreadCount,
} from "@app/lib/notifications";

// The `notification` module's part of the app shell: the bell in the header and the menu
// it opens. The list in ./shell-extensions.ts gets a bare
// `notificationExtension()` call from this module's `plugin-array` patch.
//
// The bell's number is the sidebar badge's number: both read `["nav-count",
// "/notifications"]`, which app-shell.tsx fetches through the NAV_COUNTS entry. The menu
// fetches its rows only while it is open, and fetches them again on each open, so a row
// written since the last look is there.

/** The menu's query key, under the shared prefix that every mark-read invalidates. */
const MENU_KEY = [...NOTIFICATIONS_KEY, "menu"] as const;

/** The bell needs no context of its own, so its provider renders its children as they are. */
function NotificationProvider({ children }: { children: ReactNode }) {
  return children;
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const count = useUnreadCount();
  const markAllRead = useMarkAllRead();

  const menu = useQuery({
    enabled: open,
    queryFn: async () => {
      const page = await fetchNotificationPage();
      return page.notifications.slice(0, config.notification.menuSize);
    },
    queryKey: MENU_KEY,
    // Every open is a fresh look. The 30 s app default would show a stale list.
    staleTime: 0,
  });
  const rows = menu.data ?? [];
  const openRow = useOpenNotification(rows, () => {
    setOpen(false);
  });

  let state: "loading" | "error" | "ready" = "ready";
  if (menu.data === undefined) {
    state = menu.isError ? "error" : "loading";
  }

  return (
    <NotificationMenu
      count={count}
      items={rows.map((row) => toNotificationItem(row))}
      state={state}
      open={open}
      onOpenChange={setOpen}
      onSelect={openRow}
      onMarkAllRead={() => {
        markAllRead.mutate();
      }}
      markingAllRead={markAllRead.isPending}
      onRetry={() => {
        void menu.refetch();
      }}
      viewAllHref="/notifications"
      onViewAll={() => {
        setOpen(false);
        void navigate({ to: "/notifications" });
      }}
    />
  );
}

/**
 * The `notification` module's shell extension. The app appends a bare
 * `notificationExtension()` call to its `shellExtensions` list; this module's descriptor
 * writes it with a `plugin-array` patch.
 */
export function notificationExtension(): ShellExtension {
  return {
    Provider: NotificationProvider,
    header: NotificationBell,
    id: "notification",
  };
}
