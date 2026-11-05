import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { config } from "@repo/config";
import type { NotificationItem } from "@repo/ui/blocks/notification/notification-menu";
import { toastManager } from "@repo/ui/components/shell/toast";
import { relativeTime } from "@repo/ui/lib/notification/format";

import { api } from "@app/lib/api";

// The queries and mutations the bell (components/notification-extension.tsx) and the
// page (routes/notifications.tsx) share, so the two read and write one cache.
//
// Query keys:
//
// - `["nav-count", "/notifications"]` is the unread count. The sidebar badge and the bell
//   read it, and app-shell.tsx owns its fetch through the NAV_COUNTS entry this module
//   patches in. Nothing here fetches it.
// - `["notifications", ...]` is every list: the menu's rows, the page's pages and the
//   preferences. A mark-read invalidates the whole prefix and the count, so every open
//   view follows at once.

/** The unread count's query key, shared with the sidebar badge. */
export const UNREAD_COUNT_KEY = ["nav-count", "/notifications"] as const;

/** The prefix of every notification list query. */
export const NOTIFICATIONS_KEY = ["notifications"] as const;

/** One row as `GET /notifications` answers it. */
export type NotificationPayload = Awaited<
  ReturnType<typeof fetchNotificationPage>
>["notifications"][number];

/** One page of the user's rows, newest first. `nextCursor` is null on the last page. */
export async function fetchNotificationPage(cursor?: string) {
  const response = await api.notifications.$get({
    query: cursor === undefined ? {} : { cursor },
  });
  if (!response.ok) {
    throw new Error(`The notification list answered ${response.status}.`);
  }
  return response.json();
}

/**
 * The unread count, read from the cache the sidebar badge fills.
 *
 * This observer is disabled and has no `queryFn`: app-shell.tsx's NAV_COUNTS query is the
 * one observer that fetches, on its 60 s interval, on focus and on a back-forward cache
 * restore. Both read one key, so the bell and the badge can never disagree, and a failed
 * fetch keeps the last number for both.
 *
 * Not `queryFn: skipToken`. The options of the last observer to render become the
 * query's own, and `invalidateQueries` fetches with those. With `skipToken` there, the
 * invalidation after a mark-read fetched nothing and the count stayed. With no `queryFn`,
 * TanStack Query takes the fetch from the observer that has one.
 */
export function useUnreadCount(): number | undefined {
  return useQuery<number>({ enabled: false, queryKey: UNREAD_COUNT_KEY }).data;
}

/** The category's label from the config section, or its id for a category since removed. */
function categoryLabel(id: string): string {
  return (
    config.notification.categories.find((category) => category.id === id)
      ?.label ?? id
  );
}

/** A payload row in the shape the blocks show, with its age and its category's label. */
export function toNotificationItem(
  row: NotificationPayload,
  now: Date = new Date()
): NotificationItem {
  return {
    body: row.body,
    category: categoryLabel(row.category),
    id: row.id,
    read: row.read,
    time: relativeTime(row.createdAt, now, config.app.locale),
    title: row.title,
  };
}

/** Refetch the count and every list after a write that changed them. */
function useInvalidateNotifications(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY }),
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
    ]);
  };
}

/** Mark every unread row read. A failure raises a toast; the count stays as it was. */
export function useMarkAllRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: async () => {
      const response = await api.notifications["read-all"].$post();
      if (!response.ok) {
        throw new Error(`The api answered ${response.status}.`);
      }
      return response.json();
    },
    onError: (error) => {
      toastManager.add({
        description: error.message,
        title: "Could not mark your notifications read",
        type: "error",
      });
    },
    onSettled: invalidate,
  });
}

/**
 * What a click on a row does: mark it read, then go to its `href` when it has one.
 *
 * The mark is sent first and the navigation does not wait for it. The mutation lives on
 * the app's QueryClient, so it finishes after the route changes and its invalidation
 * still lands. A row that is already read sends nothing. `rows` is the payload list the
 * items were made from, because only the payload carries `href`.
 */
export function useOpenNotification(
  rows: readonly NotificationPayload[],
  afterOpen?: () => void
): (item: NotificationItem) => void {
  const navigate = useNavigate();
  const invalidate = useInvalidateNotifications();
  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.notifications[":id"].read.$post({
        param: { id },
      });
      if (!response.ok) {
        throw new Error(`The api answered ${response.status}.`);
      }
    },
    onSettled: invalidate,
  });

  return (item) => {
    if (!item.read) {
      markRead.mutate(item.id);
    }
    const href = rows.find((row) => row.id === item.id)?.href ?? null;
    afterOpen?.();
    if (href !== null) {
      // `href` and not `to`: a stored path may carry a query string, and `notify` only
      // ever writes a path on this origin (`isAppPath`).
      void navigate({ href });
    }
  };
}
