import { config } from "@repo/config";
import {
  insertNotification,
  isOptedOut,
} from "@repo/db/repositories/notifications";
import { isAppPath } from "./notification-href";
import type { Db } from "@repo/db/client";

// The one function the rest of the api calls to tell a user something happened:
//
//   await withDb(c, (db) =>
//     notify(db, {
//       userId: session.user.id,
//       category: "account",
//       title: "Your password was changed",
//       href: "/settings",
//     })
//   );
//
// It stores rendered text. Write the title and body the user should read, in full; the
// page shows them as they are and never rewords an old row.
//
// A bad call throws rather than writing nothing quietly, because every rule below is a
// bug in the caller that a test should catch: a category the config does not list, an
// empty title, or a link that leaves the app.

export interface NotifyInput {
  /** The user who reads it. Always the recipient, never the actor. */
  userId: string;
  /** A category id from `config.notification.categories`. */
  category: string;
  /** The line the menu and the page show in bold. Must not be blank. */
  title: string;
  /** An optional second line. */
  body?: string;
  /** An app-relative path the row opens when clicked, such as `/settings/billing`. */
  href?: string;
}

/** What `notify` did: wrote a row with this id, or skipped it for an opt-out. */
export type NotifyResult =
  | { readonly written: true; readonly id: string }
  | { readonly written: false; readonly reason: "opted_out" };

/**
 * Write one notification, unless the user turned its category off.
 *
 * A required category is always written. Throws on an unknown category, a blank title, or
 * an `href` that is not an app-relative path (see `./notification-href.ts`).
 */
export async function notify(
  db: Db,
  input: NotifyInput
): Promise<NotifyResult> {
  const category = config.notification.categories.find(
    (candidate) => candidate.id === input.category
  );
  if (!category) {
    const known = config.notification.categories
      .map((candidate) => candidate.id)
      .join(", ");
    throw new Error(
      `notify: unknown category "${input.category}". Add it to config.notification.categories in packages/config/src/project.ts, or use one of: ${known}.`
    );
  }
  const title = input.title.trim();
  if (title.length === 0) {
    throw new Error(
      "notify: the title is empty. Pass the text the user reads."
    );
  }
  if (input.href !== undefined && !isAppPath(input.href)) {
    throw new Error(
      `notify: href "${input.href}" is not an app-relative path. Pass a path that starts with "/" and not "//", such as "/settings".`
    );
  }

  if (!category.required && (await isOptedOut(db, input.userId, category.id))) {
    return { reason: "opted_out", written: false };
  }

  const id = await insertNotification(db, {
    // A blank body is no body, so the page draws no empty second line.
    body: input.body?.trim() ? input.body : null,
    category: category.id,
    href: input.href ?? null,
    title,
    userId: input.userId,
  });
  return { id, written: true };
}
