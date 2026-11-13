import { defineSection } from "@repo/config/define";

// `notification`'s config section, installed by `saasaloy add notification`.
//
// It lands in `packages/config/src/sections/` rather than beside the routes, because
// `@repo/config` imports nothing and so everything may import it: the api reads the
// categories to check a `notify` call and a preferences write, and `apps/app` reads the
// same list to draw one switch per category.
//
// These are `config` values and not `env` values. Two deployments of one project agree on
// which kinds of notification exist and how long a row is kept, so the list is checked
// into the repo (ADR 0052).

/** One kind of notification a user can be told about, and may turn off. */
export interface NotificationCategory {
  /** Stored on every row, and what `notify({ category })` names. Never rename one in use. */
  readonly id: string;
  /** The switch's label on the Preferences tab. */
  readonly label: string;
  /** One line under the label saying what the category covers. */
  readonly description: string;
  /**
   * A required category cannot be turned off. `notify` always writes it, and
   * `PUT /notifications/preferences` answers 400 to a body that turns it off.
   */
  readonly required: boolean;
}

/** The `notification` section. Override any key in `packages/config/src/project.ts`. */
export function notificationConfig() {
  return defineSection("notification", {
    /**
     * Every category a `notify` call may name. An unknown one throws, so a typo fails the
     * first test that sends it rather than writing a row nothing can filter.
     *
     * The list is replaced whole by an override, so name every category there, the two
     * shipped ones included if you keep them. Removing a category leaves its old rows in
     * the table: the page still lists them and the count still counts them until the
     * prune deletes them.
     */
    categories: [
      {
        description: "Sign-in, security, billing and membership changes.",
        id: "account",
        label: "Account",
        required: true,
      },
      {
        description: "New features, finished exports and project activity.",
        id: "product",
        label: "Product",
        required: false,
      },
    ] as readonly NotificationCategory[],
    /** Rows the menu under the bell shows, newest first. */
    menuSize: 5,
    /** Rows one `GET /notifications` page answers. "Load more" asks for the next page. */
    pageSize: 20,
    /** Days a read row is kept, counted from when it was written. */
    readRetentionDays: 30,
    /** Days an unread row is kept, counted from when it was written. */
    unreadRetentionDays: 180,
  });
}
