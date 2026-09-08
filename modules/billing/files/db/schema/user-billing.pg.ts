import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";

// The customer link: which customer, at the payment provider, this user is. Postgres half,
// selected by `onlyWith: "database-postgres"`; the SQLite twin is `user-billing.sqlite.ts`.
//
// WHY THIS IS A SEPARATE TABLE AND NOT A COLUMN ON `user`
//
// The plan calls this "`user.billingCustomerId`", and a column on `user` is what it wants
// to be. A module cannot ship one. `packages/db` merges every `src/schema/*.ts` into one
// object and drizzle-kit reads the same glob, so a second file declaring
// `pgTable("user", …)` collides with `auth.pg.ts` in both. The applier has no patch kind
// that adds a property to a Drizzle table literal either — `plugin-array`, `const-array`,
// `chained-route`, `package-json-*` and `wrangler-binding` are the whole set
// (packages/cli/src/lib/patch/index.ts). A one-to-one side table keyed by `user_id` is the
// shape a *file* can carry, and it holds the same fact.
//
// The consequence lands in Phase 3, and it is open: `@better-auth/stripe` writes its
// customer id onto the `user` model through `schema.user.fields`, and it cannot be pointed
// at another table. Settle it there — either the CLI gains a patch kind that adds a column
// to a Drizzle table, or `billing-stripe` keeps the customer id only in
// `billing_subscription.provider_customer_id` and this table is dropped. Nothing in the
// core reads this table today.

const timestamptz = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const userBilling = pgTable(
  "user_billing",
  {
    /** The provider's own customer id, verbatim. Vendor-blind name, vendor-owned value. */
    billingCustomerId: text("billing_customer_id").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    /** Which provider minted it, so a vendor swap can leave the old row in place. */
    provider: text("provider").notNull(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("user_billing_customer_id_uidx").on(
      table.provider,
      table.billingCustomerId
    ),
  ]
);
