---
name: saasaloy-notification
description: Runbook for the notification module, in-app notifications for apps/app. It owns the notifications and notification_opt_outs tables, notify() in apps/api/src/lib/notify.ts, the /notifications api routes, the bell in the app header, the sidebar badge, the /notifications page with Inbox and Preferences tabs, the notification config section, and the daily prune. Use when sending a notification from an api route, adding or changing a category, changing retention, debugging a badge or bell count that does not move, or removing the module.
---

# notification: in-app notifications for apps/app

`notification` is a **feature module** (`saasaloy:feature`). It depends on `api`, `database`, `auth`, `app`, `validators` and `shell`, which `add` resolves and installs first.

A signed-in user gets a bell in the `apps/app` header with an unread badge and a menu of the newest rows, a Notifications row in the sidebar with the same count, and a `/notifications` page with two tabs. Inbox lists every row with "Load more" and "Mark all read". Preferences shows one switch per category. Your api routes write a row with one call, `notify(db, { ... })`. Nothing is sent by email, SMS or push, and nothing is real time: the count refetches on a timer and on focus.

## What it installs

| File | What it holds |
|---|---|
| `packages/config/src/sections/notification.ts` | the `notification` config section: the categories, the menu and page sizes, and the two retention periods |
| `packages/db/src/schema/notifications.ts` | `notifications` and `notification_opt_outs`, in the dialect of the installed driver (`notifications.sqlite.ts` under `database-d1`, `notifications.pg.ts` under `database-postgres`) |
| `packages/db/src/repositories/notifications.ts` | every query the two tables take, `pruneNotifications` included |
| `packages/db/src/seed/slices/notifications.ts`, `notification-opt-outs.ts` | seed rows for `pnpm db:seed` |
| `packages/validators/src/notifications.ts` | the list query, the id param and the preferences body |
| `apps/api/src/lib/notify.ts` | `notify()`, the one function your routes call |
| `apps/api/src/lib/notification-href.ts` | `isAppPath()`, the `href` rule |
| `apps/api/src/routes/notifications.ts` | the six routes under `/notifications` |
| `apps/api/src/lib/notify.test.ts`, `apps/api/src/routes/notifications.test.ts` | tests, only while the testing mode is on |
| `apps/api/src/lib/notification-prune.ts` | the prune runner, only with `queue` installed |
| `packages/queue/src/jobs/notifications.ts` | the prune job and its daily schedule, only with `queue` installed |
| `packages/ui/src/lib/notification/format.ts` | `badgeText()` (`99+` above 99) and `relativeTime()` |
| `packages/ui/src/blocks/notification/notification-menu.tsx` | `NotificationMenu`: the bell, the badge and the menu |
| `packages/ui/src/blocks/notification/notification-list.tsx` | `NotificationList`: the Inbox tab |
| `packages/ui/src/blocks/notification/notification-preferences.tsx` | `NotificationPreferences`: the Preferences tab |
| `apps/app/src/lib/notifications.ts` | the query keys, `useUnreadCount`, `useMarkAllRead` and `useOpenNotification` |
| `apps/app/src/components/notification-extension.tsx` | `notificationExtension()`, the bell in the shell header |
| `apps/app/src/routes/notifications.tsx` | the `/notifications` page |

The three blocks are presentational. They take data and callbacks as props and import no api client. The two app files supply the behaviour.

## The tables

`notifications` holds one row per message: `id`, `user_id` (cascades when the user is deleted), `category`, `title`, `body`, `href`, `created_at` and `read_at`. `read_at` is null while the row is unread, and a second "mark read" keeps the first time. Two indexes serve the reads: `notifications_user_id_created_at_idx` for the list and `notifications_user_id_read_at_idx` for the count.

`notification_opt_outs` holds one row per category a user turned off, keyed on `(user_id, category)`. No row means the category is on, so a new category starts on for every user with no backfill.

Every query in `packages/db/src/repositories/notifications.ts` filters on the session user's id. That filter is the only boundary between two users' rows. Do not write a raw `db.select().from(notifications)` in a route. `pruneNotifications` is the one query across users, and only the scheduled job calls it.

## Send a notification from a route

Call `notify` inside `withDb`, with the recipient's id:

```ts
import { withDb } from "@repo/db/client";
import { notify } from "../lib/notify";

await withDb(c, (db) =>
  notify(db, {
    userId: session.user.id,
    category: "account",
    title: "Your password was changed",
    body: "If this was not you, reset it now.",
    href: "/settings",
  })
);
```

The input:

| Field | Rule |
|---|---|
| `userId` | the user who reads it. Always the recipient, never the actor. |
| `category` | an `id` from `config.notification.categories`. An unknown id throws, and the message lists the known ids. |
| `title` | the bold line. It is trimmed, and a blank title throws. |
| `body` | optional second line. A blank body is stored as null. |
| `href` | optional app path the row opens. It must start with `/` and not with `//`, and it must not hold a `\`. A full URL throws. |

`notify` stores the text as you pass it. Write the final words the user reads. The page never rewords an old row, and nothing translates it.

`notify` answers `{ written: true, id }`, or `{ written: false, reason: "opted_out" }` when the user turned the category off. An opt-out skips the write. It does not throw. A category with `required: true` is always written, whatever the user's opt-out rows say.

Every throw is a bug in the caller, so a test catches it. Do not wrap `notify` in a `try` that hides the error.

A row written for the user who made the request shows on the next count fetch, at most 60 s later. To show it at once, invalidate the count in the app after the mutation that caused it (see [The count](#the-count)).

## Add or change a category

The defaults live in `packages/config/src/sections/notification.ts`, and `saasaloy update` may rewrite that file. Change them in `packages/config/src/project.ts`, which is yours:

```ts
export const project: ProjectOverride = {
  notification: {
    categories: [
      { id: "account", label: "Account", description: "Sign-in, security, billing and membership changes.", required: true },
      { id: "product", label: "Product", description: "New features, finished exports and project activity.", required: false },
      { id: "comments", label: "Comments", description: "Replies to your comments.", required: false },
    ],
  },
};
```

The rules:

- An override replaces the `categories` list whole. Name `account` and `product` again if you keep them.
- `id` is stored on every row. Never rename an `id` that is in use. Add a new one instead.
- `label` and `description` are the switch's text on the Preferences tab.
- `required: true` makes the switch on and disabled, with "Required. These cannot be turned off." `notify` writes the category for every user, and `PUT /notifications/preferences` answers 400 to a body that turns it off.
- A removed category keeps its old rows. The page still lists them under the raw id, and the count still counts them until the prune deletes them.

The same section holds `menuSize` (5 rows under the bell), `pageSize` (20 rows a page), `readRetentionDays` (30) and `unreadRetentionDays` (180). Override them in `project.ts` the same way.

## The api routes

The `chained-route` patch mounts the sub-app at `/notifications`. Every route calls `requireSession`.

| Route | Answer |
|---|---|
| `GET /notifications?cursor=` | one page, newest first: `{ notifications, nextCursor }`. `nextCursor` is null on the last page. |
| `GET /notifications/unread-count` | `{ count }`, the shape `NAV_COUNTS` reads |
| `POST /notifications/read-all` | `{ ok, marked }` |
| `POST /notifications/:id/read` | `{ ok }`. Another user's row answers the same 404 as a missing row. |
| `GET /notifications/preferences` | `{ categories: [{ id, label, description, required, enabled }] }` |
| `PUT /notifications/preferences` | body `{ categories: { [id]: boolean } }`. An unknown id or a required category turned off answers 400 and writes nothing. |

## The count

The count is every unread row of the user, in every category. An opt-out stops new rows only. Rows written before the opt-out stay unread and stay in the count until the user reads them or the prune deletes them.

The bell and the sidebar badge read one query key, `["nav-count", "/notifications"]`. The module's `NAV_COUNTS` entry makes `AppShell` in `apps/app/src/components/app-shell.tsx` the one observer that fetches it. It refetches every 60 s while the tab is visible, on every window focus, and on a `pageshow` with `persisted` set (a back-forward cache restore). `useUnreadCount()` in `apps/app/src/lib/notifications.ts` reads the same key with `enabled: false` and no `queryFn`, so the bell and the badge always show the same number. Do not give it a `queryFn` or `skipToken`: the last observer's options become the query's own, and an invalidation then fetches nothing.

A failed fetch keeps the last count. A network error, a non-OK answer and a body without a numeric `count` all throw, and TanStack Query keeps the last `data`. The badge never drops to 0 because of a failure. While the menu is open, a failed row fetch shows "Could not load notifications" with "Try again".

A mutation that changes the count must invalidate the key, or the badge waits for the next interval:

```ts
await queryClient.invalidateQueries({ queryKey: ["nav-count", "/notifications"] });
```

The module's own mark-read and mark-all-read invalidate that key and the whole `["notifications"]` prefix, which covers the menu rows (`["notifications", "menu"]`), the Inbox pages (`["notifications", "list"]`) and the preferences (`["notifications", "preferences"]`). Use `UNREAD_COUNT_KEY` and `NOTIFICATIONS_KEY` from `@app/lib/notifications` rather than a copy of the array.

## Retention

`pruneNotifications(db, now, days?)` in `packages/db/src/repositories/notifications.ts` deletes, for every user, each read row written more than `readRetentionDays` ago and each row written more than `unreadRetentionDays` ago. It answers how many rows went. `days` defaults to the config section.

**With `queue` installed**, the module registers the job `notification.prune` and the schedule `notification.prune.daily`, cron `30 3 * * *` (03:30 UTC daily). The job runs through `apps/api/src/lib/notification-prune.ts`, which `worker.ts` lists as `notificationPruneHandlers()` in its `handlers` table. A run before that registration throws, so the message retries and lands in the dead-letter queue. It does not report a prune that did not run.

**Without `queue`**, nothing prunes and the table grows. Call the function from your own scheduled handler:

```ts
import { withDb } from "@repo/db/client";
import { pruneNotifications } from "@repo/db/repositories/notifications";

await withDb(scope, (db) => pruneNotifications(db, new Date()));
```

Add `queue` later and `saasaloy add queue` backfills the two prune files and the three queue patches. `saasaloy remove queue` takes them out again and leaves the rest of this module.

## Wire-up

No manual page edit is needed. The module's own app files import the three blocks: `notification-extension.tsx` renders `NotificationMenu` in the shell header, and `routes/notifications.tsx` renders `NotificationList` and `NotificationPreferences`. `saasaloy add` still prints "Manual wire-up needed ... on no page yet" for the three `@ui/blocks/notification/` files, because it flags every block target. For this module that line is wrong. Ignore it.

The patches did the wiring:

| Patch | File | Effect |
|---|---|---|
| `plugin-array` | `apps/app/src/components/shell-extensions.ts` | adds `notificationExtension()` to `extensions`, so the bell renders in the header |
| `nav-entry` | `apps/app/src/components/nav.ts` | adds Notifications (`BellIcon`, shortcut `G N`) to the Workspace group of the `/` area in `NAV_AREAS` |
| `const-array` | `apps/app/src/components/nav-counts.ts` | adds `{ to: "/notifications", path: "/notifications/unread-count" }` to `NAV_COUNTS`, so the row shows the live count |
| `chained-route` | `apps/api/src/index.ts` | mounts `notifications` at `/notifications` |
| `plugin-array` | `packages/config/src/sections.ts` | adds `notificationConfig()` to `sections` |
| `plugin-array` | `packages/queue/src/index.ts` | adds `pruneNotificationsJob()` to `jobs` and `pruneNotificationsSchedule()` to `schedules`, only with `queue` |
| `plugin-array` | `apps/api/src/worker.ts` | adds `notificationPruneHandlers()` to `handlers`, only with `queue` |

After `add`:

1. Run `pnpm db:generate` to write the migration for the two tables.
2. Apply the migration with your driver's command.
3. Run `pnpm db:seed` if you want the seed rows.
4. Run `pnpm dev`, sign in to `app`, and open `/notifications`. The router regenerates `routeTree.gen.ts` on the first start.

The seed does not reset `read_at` on a seed row. A seed row you marked read stays read after `pnpm db:seed`. For a clean start, run `pnpm db:drop`, then `pnpm db:setup`, then `pnpm db:seed`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `notify: unknown category "x"` | `x` is not in `config.notification.categories`. Add it in `project.ts`, or fix the typo. |
| `notify: href "..." is not an app-relative path` | `href` is a full URL, starts with `//`, or holds a `\`. Pass a path such as `/settings`. |
| `notify` answers `written: false` | the user turned that category off. Make the category `required` if it must always arrive. |
| The badge stays after a mark-read in your own screen | the screen does not invalidate `["nav-count", "/notifications"]` after its mutation. |
| The bell and the badge show the old number while the api is down | expected. A failed fetch keeps the last count. |
| The count includes rows of a category the user turned off | expected. An opt-out stops new rows only. |
| `notification.prune ran before apps/api registered its runner` | `apps/api/src/worker.ts` lost `notificationPruneHandlers()` from its `handlers`. |
| The table grows with no limit | `queue` is not installed, so nothing calls `pruneNotifications`. See [Retention](#retention). |

## What `remove` leaves behind

`saasaloy remove notification` deletes the files it wrote and reverses its patches: the shell extension, the nav row, the `NAV_COUNTS` entry, the api mount, the config section, and the queue and worker entries when they were applied. It leaves these for you:

- The `notifications` and `notification_opt_outs` tables. Run `pnpm db:generate`, read the drop migration, and apply it only when you want the rows gone.
- Every `notify()` call you added to your own routes. Its import of `../lib/notify` breaks the build. Search `apps/api` for `lib/notify` before you remove the module.
- Every override you wrote under `notification` in `packages/config/src/project.ts`. With the section gone, that key fails `pnpm typecheck`, so take it out.
- Any import of `@app/lib/notifications` or a notification block that you added to your own screens.

## Next

Run `saasaloy-app` to change the Notifications page or to add another screen beside it, and `saasaloy-queue` to change the prune schedule.
