import { z } from "zod";

// One file per feature, directly under `src/`, imported as `@repo/validators/notifications`
// (the package exports `"./*": "./src/*.ts"`).
//
// Isomorphic on purpose: no Workers types, no `@repo/db`, no `@repo/config`. The api route
// validates against it with `zValidator`, and `apps/app` gets the same shapes through
// `hc<AppType>`.
//
// What is NOT here: the list of categories. It lives in `config.notification.categories`,
// and the route checks a preferences body against it, so a project that adds a category
// edits one file and this schema stays the same.

/** Query of `GET /notifications`. `cursor` is the opaque `nextCursor` of the last page. */
export const notificationListQuery = z.object({
  cursor: z.string().min(1).max(256).optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuery>;

/** Params of `POST /notifications/:id/read`. */
export const notificationParam = z.object({
  id: z.string().min(1).max(128),
});
export type NotificationParam = z.infer<typeof notificationParam>;

/**
 * Body of `PUT /notifications/preferences`: a map of category id to on or off, such as
 * `{ "categories": { "product": false } }`.
 *
 * A map, not a full list, so the switch on the Preferences tab sends the one category it
 * changed. A category the body leaves out keeps its state. The route answers 400 for an
 * unknown id, and for a required category set to `false`.
 */
export const notificationPreferencesInput = z.object({
  categories: z.record(z.string().min(1).max(64), z.boolean()),
});
export type NotificationPreferencesInput = z.infer<
  typeof notificationPreferencesInput
>;
