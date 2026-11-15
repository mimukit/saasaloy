import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCheckIcon } from "lucide-react";
import { useState } from "react";

import { config } from "@repo/config";
import { NotificationList } from "@repo/ui/blocks/notification/notification-list";
import { NotificationPreferences } from "@repo/ui/blocks/notification/notification-preferences";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { Button } from "@repo/ui/components/shell/button";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@repo/ui/components/shell/tabs";
import { toastManager } from "@repo/ui/components/shell/toast";

import { api } from "@app/lib/api";
import {
  NOTIFICATIONS_KEY,
  fetchNotificationPage,
  toNotificationItem,
  useMarkAllRead,
  useOpenNotification,
  useUnreadCount,
} from "@app/lib/notifications";

/** The unread count in the app's locale, so 1284 reads "1,284" in English. */
const UNREAD_FORMAT = new Intl.NumberFormat(config.app.locale);

// The notifications page: the Inbox, every row newest first with "Load more", and the
// Preferences, one switch per category.
//
// It renders inside the page frame the root route provides, so it writes no width,
// padding or background of its own. The tab bar and the list run full bleed and align to
// the page gutter, the way PageHeader does. The markup lives in the three
// `@repo/ui/blocks/notification/*` blocks; this file owns the queries.

export const Route = createFileRoute("/notifications")({
  component: Notifications,
});

const LIST_KEY = [...NOTIFICATIONS_KEY, "list"] as const;
const PREFERENCES_KEY = [...NOTIFICATIONS_KEY, "preferences"] as const;

type Tab = "inbox" | "preferences";

function Notifications() {
  const [tab, setTab] = useState<Tab>("inbox");
  const unread = useUnreadCount();
  const markAllRead = useMarkAllRead();

  return (
    <Tabs
      value={tab}
      onValueChange={(value: Tab) => {
        setTab(value);
      }}
      className="min-h-0 flex-1 gap-0"
    >
      <PageHeader
        className="border-b-0"
        title="Notifications"
        description={`Newest first. Read rows are kept for ${config.notification.readRetentionDays} days.`}
        actions={
          tab === "inbox" && unread !== undefined && unread > 0 ? (
            <Button
              variant="outline"
              loading={markAllRead.isPending}
              onClick={() => {
                markAllRead.mutate();
              }}
            >
              <CheckCheckIcon />
              {/* Below 640 px the button shows only its icon. The name stays for screen readers. */}
              <span className="max-sm:sr-only">Mark all read</span>
            </Button>
          ) : undefined
        }
      />
      <div className="border-border border-b px-(--page-gutter)">
        <TabsList variant="underline" className="gap-x-4">
          <TabsTab value="inbox" className="grow-0 px-0">
            Inbox
            {unread !== undefined && unread > 0 ? (
              <span className="text-muted-foreground text-xs font-normal tabular-nums">
                {`${UNREAD_FORMAT.format(unread)} unread`}
              </span>
            ) : null}
          </TabsTab>
          <TabsTab value="preferences" className="grow-0 px-0">
            Preferences
          </TabsTab>
        </TabsList>
      </div>
      <TabsPanel value="inbox" className="min-h-0 overflow-auto">
        <Inbox />
      </TabsPanel>
      <TabsPanel value="preferences" className="min-h-0 overflow-auto">
        <Preferences />
      </TabsPanel>
    </Tabs>
  );
}

function Inbox() {
  const list = useInfiniteQuery({
    // queryFn before getNextPageParam: TypeScript infers the page type from the first.
    queryKey: LIST_KEY,
    queryFn: ({ pageParam }) => fetchNotificationPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((page) => page.notifications) ?? [];
  const openRow = useOpenNotification(rows);

  let state: "loading" | "error" | "ready" = "ready";
  if (list.data === undefined) {
    state = list.isError ? "error" : "loading";
  }

  return (
    <NotificationList
      items={rows.map((row) => toNotificationItem(row))}
      state={state}
      onSelect={openRow}
      hasMore={list.hasNextPage}
      loadingMore={list.isFetchingNextPage}
      onLoadMore={() => {
        void list.fetchNextPage();
      }}
      onRetry={() => {
        void list.refetch();
      }}
    />
  );
}

async function fetchPreferences() {
  const response = await api.notifications.preferences.$get();
  if (!response.ok) {
    throw new Error(`The preferences answered ${response.status}.`);
  }
  return response.json();
}

type PreferencesPayload = Awaited<ReturnType<typeof fetchPreferences>>;

function Preferences() {
  const queryClient = useQueryClient();
  const preferences = useQuery({
    queryFn: fetchPreferences,
    queryKey: PREFERENCES_KEY,
  });

  // The switch moves at once and the save follows. A refused save puts the old value
  // back and says why, so a click never looks like it did nothing.
  const save = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const response = await api.notifications.preferences.$put({
        json: { categories: { [id]: enabled } },
      });
      if (!response.ok) {
        throw new Error(`The api answered ${response.status}.`);
      }
      return response.json();
    },
    onError: (error, _input, previous) => {
      if (previous !== undefined) {
        queryClient.setQueryData(PREFERENCES_KEY, previous);
      }
      toastManager.add({
        description: error.message,
        title: "Could not save your preference",
        type: "error",
      });
    },
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: PREFERENCES_KEY });
      const previous =
        queryClient.getQueryData<PreferencesPayload>(PREFERENCES_KEY);
      if (previous !== undefined) {
        queryClient.setQueryData<PreferencesPayload>(PREFERENCES_KEY, {
          categories: previous.categories.map((category) =>
            category.id === id ? { ...category, enabled } : category
          ),
        });
      }
      return previous;
    },
    onSuccess: (body) => {
      queryClient.setQueryData(PREFERENCES_KEY, body);
    },
  });

  let state: "loading" | "error" | "ready" = "ready";
  if (preferences.data === undefined) {
    state = preferences.isError ? "error" : "loading";
  }

  return (
    <NotificationPreferences
      categories={preferences.data?.categories ?? []}
      state={state}
      saving={save.isPending}
      onChange={(id, enabled) => {
        save.mutate({ enabled, id });
      }}
      onRetry={() => {
        void preferences.refetch();
      }}
    />
  );
}
