// Tests for the pure parts of the seed engine: ./id.ts, ./order.ts and ./plan.ts. It ships
// as `engine.test.ts` when testing is on, and `pnpm test:modules` runs it in place on
// Vitest in the saasaloy repo. It works on plain table shapes, because this repo's root
// `node_modules` carries no Drizzle. `./table.ts`, which reads those shapes off a real
// Drizzle table, is exercised on a generated project by the completeness test.

import { describe, expect, it } from "vitest";
import { seedId } from "./id";
import { SeedCycleError, orderTables } from "./order";
import { SeedPlanError, conflictTarget, missingSlices, planSeed } from "./plan";
import type { ColumnShape, TableShape } from "./plan";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function column(key: string, over: Partial<ColumnShape> = {}): ColumnShape {
  return { generated: false, key, name: key, text: true, ...over };
}

/** `users`: a text id the slug fills. */
const users: TableShape = {
  columns: [column("id"), column("email")],
  name: "users",
  primaryKey: ["id"],
  references: [],
};

/** `members`: a text id, pointing at users and organizations. */
const members: TableShape = {
  columns: [column("id"), column("userId"), column("organizationId")],
  name: "members",
  primaryKey: ["id"],
  references: ["users", "organizations"],
};

const organizations: TableShape = {
  columns: [column("id"), column("name")],
  name: "organizations",
  primaryKey: ["id"],
  references: [],
};

/** `waitlist_entries`: an identity id, so its slice must name a key. */
const waitlist: TableShape = {
  columns: [column("id", { generated: true, text: false }), column("email")],
  name: "waitlist_entries",
  primaryKey: ["id"],
  references: [],
};

/** `billing_events`: a composite primary key. */
const events: TableShape = {
  columns: [column("provider"), column("providerEventId"), column("type")],
  name: "billing_events",
  primaryKey: ["provider", "providerEventId"],
  references: [],
};

describe(seedId, () => {
  it("is a version 5 UUID", () => {
    expect(seedId("users", "superadmin")).toMatch(UUID);
  });

  it("is stable across calls", () => {
    expect(seedId("users", "superadmin")).toBe(seedId("users", "superadmin"));
  });

  // Pinned, so a change to the namespace or the hashing shows up as a red test rather
  // than as every developer's seeded ids moving under their hand-made rows. The value
  // matches Python's `uuid.uuid5(namespace, "users:superadmin")`.
  it("keeps the value it had when it shipped", () => {
    expect(seedId("users", "superadmin")).toBe(
      "f36f96b0-839e-5d8a-97b2-0c6c22a61fab"
    );
  });

  it("differs by table and by slug", () => {
    expect(seedId("users", "a")).not.toBe(seedId("users", "b"));
    expect(seedId("users", "a")).not.toBe(seedId("members", "a"));
  });
});

describe(orderTables, () => {
  it("puts a table after every table it references", () => {
    const order = orderTables([
      { after: ["users", "organizations"], name: "members" },
      { after: [], name: "users" },
      { after: [], name: "organizations" },
    ]);
    expect(order).toStrictEqual(["organizations", "users", "members"]);
  });

  it("ignores a reference to a table outside the set, and to itself", () => {
    expect(
      orderTables([{ after: ["sessions", "users"], name: "users" }])
    ).toStrictEqual(["users"]);
  });

  it("names every table in a cycle", () => {
    expect(() =>
      orderTables([
        { after: ["b"], name: "a" },
        { after: ["a"], name: "b" },
        { after: [], name: "c" },
      ])
    ).toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof SeedCycleError &&
          error.tables.join(",") === "a,b" &&
          /a, b/.test(error.message)
      )
    );
  });
});

describe(conflictTarget, () => {
  it("uses a single text primary key", () => {
    expect(conflictTarget(users, { rows: {}, table: "users" })).toStrictEqual([
      "id",
    ]);
  });

  it("uses the slice's key for a generated primary key", () => {
    expect(
      conflictTarget(waitlist, {
        key: ["email"],
        rows: {},
        table: "waitlist_entries",
      })
    ).toStrictEqual(["email"]);
  });

  it("uses a composite primary key with nothing extra", () => {
    expect(
      conflictTarget(events, { rows: {}, table: "billing_events" })
    ).toStrictEqual(["provider", "providerEventId"]);
  });

  it("refuses a generated primary key with no key", () => {
    expect(() =>
      conflictTarget(waitlist, { rows: {}, table: "waitlist_entries" })
    ).toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof SeedPlanError &&
          /generated primary key/.test(error.message)
      )
    );
  });

  it("refuses a key naming a column the table lacks", () => {
    expect(() =>
      conflictTarget(waitlist, {
        key: ["mail"],
        rows: {},
        table: "waitlist_entries",
      })
    ).toThrow(/no such column/);
  });
});

describe(planSeed, () => {
  const tables = [users, members, organizations, waitlist, events];

  it("orders the steps by foreign key and fills ids from slugs", () => {
    const plan = planSeed(tables, [
      {
        rows: {
          owner: {
            organizationId: seedId("organizations", "acme"),
            userId: seedId("users", "ada"),
          },
        },
        table: "members",
      },
      { rows: { ada: { email: "ada@example.test" } }, table: "users" },
      { rows: { acme: { name: "Acme" } }, table: "organizations" },
    ]);

    expect(plan.map((step) => step.table)).toStrictEqual([
      "organizations",
      "users",
      "members",
    ]);
    const [ada] = plan[1]?.rows ?? [];
    expect(ada?.values.id).toBe(seedId("users", "ada"));
    expect(ada?.update).toStrictEqual(["email"]);
  });

  it("keeps an id the slice wrote", () => {
    const plan = planSeed(tables, [
      { rows: { ada: { email: "a@x.test", id: "fixed" } }, table: "users" },
    ]);
    expect(plan[0]?.rows[0]?.values.id).toBe("fixed");
  });

  it("upserts a generated-key table on its key and does nothing for a key-only row", () => {
    const plan = planSeed(tables, [
      {
        key: ["email"],
        rows: { first: { email: "first@example.test" } },
        table: "waitlist_entries",
      },
    ]);
    const [step] = plan;
    expect(step?.target).toStrictEqual(["email"]);
    expect(step?.rows[0]?.values).toStrictEqual({
      email: "first@example.test",
    });
    expect(step?.rows[0]?.update).toStrictEqual([]);
  });

  it("never updates the primary key of a text-id table upserted on another key", () => {
    const plan = planSeed(tables, [
      {
        key: ["email"],
        rows: { ada: { email: "ada@example.test" } },
        table: "users",
      },
    ]);
    const [ada] = plan[0]?.rows ?? [];
    expect(ada?.values.id).toBe(seedId("users", "ada"));
    expect(ada?.update).toStrictEqual([]);
  });

  it("plans a composite-key table", () => {
    const plan = planSeed(tables, [
      {
        rows: {
          paid: { provider: "console", providerEventId: "evt_1", type: "paid" },
        },
        table: "billing_events",
      },
    ]);
    expect(plan[0]?.rows[0]?.update).toStrictEqual(["type"]);
  });

  it("writes rows in slug order", () => {
    const plan = planSeed(tables, [
      {
        rows: { zed: { email: "z@x.test" }, amy: { email: "a@x.test" } },
        table: "users",
      },
    ]);
    expect(plan[0]?.rows.map((row) => row.slug)).toStrictEqual(["amy", "zed"]);
  });

  it("adds an `after` edge to the foreign-key order", () => {
    const plan = planSeed(tables, [
      { after: ["users"], rows: {}, table: "organizations" },
      { rows: {}, table: "users" },
    ]);
    expect(plan.map((step) => step.table)).toStrictEqual([
      "users",
      "organizations",
    ]);
  });

  it("refuses a slice for a table the schema lacks", () => {
    expect(() => planSeed(tables, [{ rows: {}, table: "ghosts" }])).toThrow(
      /no table by that name/
    );
  });

  it("refuses two slices for one table", () => {
    expect(() =>
      planSeed(tables, [
        { rows: {}, table: "users" },
        { rows: {}, table: "users" },
      ])
    ).toThrow(/Two slices/);
  });

  it("refuses a row naming a column the table lacks", () => {
    expect(() =>
      planSeed(tables, [
        { rows: { ada: { mail: "a@x.test" } }, table: "users" },
      ])
    ).toThrow(/no such column/);
  });

  it("refuses a row missing part of a composite key", () => {
    expect(() =>
      planSeed(tables, [
        { rows: { paid: { provider: "console" } }, table: "billing_events" },
      ])
    ).toThrow(/conflict key/);
  });

  it("refuses a reference to a row whose id the database generates", () => {
    expect(() =>
      planSeed(tables, [
        {
          key: ["email"],
          rows: { first: { email: "first@example.test" } },
          table: "waitlist_entries",
        },
        {
          rows: { ada: { email: seedId("waitlist_entries", "first") } },
          table: "users",
        },
      ])
    ).toThrow(/generated by the database/);
  });

  it("refuses a cycle before anything is planned", () => {
    const a: TableShape = { ...users, name: "a", references: ["b"] };
    const b: TableShape = { ...users, name: "b", references: ["a"] };
    expect(() =>
      planSeed(
        [a, b],
        [
          { rows: {}, table: "a" },
          { rows: {}, table: "b" },
        ]
      )
    ).toThrow(SeedCycleError);
  });
});

describe(missingSlices, () => {
  it("names each table no slice fills, sorted", () => {
    expect(
      missingSlices(
        [{ name: "users" }, { name: "accounts" }, { name: "sessions" }],
        [{ table: "users" }]
      )
    ).toStrictEqual(["accounts", "sessions"]);
  });

  it("is empty for a schema with no tables", () => {
    expect(missingSlices([], [])).toStrictEqual([]);
  });
});
