// Tests for the pure parts of the seed engine: ./id.ts, ./order.ts and ./plan.ts. This file
// is NOT in the descriptor's `scaffolds[].files` list, so `add database` never copies it
// into a project. It runs here with `pnpm test:modules`, on plain table shapes, because
// this repo's root `node_modules` carries no Drizzle. `./table.ts`, which reads those shapes
// off a real Drizzle table, is exercised on a generated project by the completeness test.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seedId } from "./id.ts";
import { SeedCycleError, orderTables } from "./order.ts";
import {
  SeedPlanError,
  conflictTarget,
  missingSlices,
  planSeed,
} from "./plan.ts";
import type { ColumnShape, TableShape } from "./plan.ts";

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

describe("seedId", () => {
  it("is a version 5 UUID", () => {
    assert.match(seedId("users", "superadmin"), UUID);
  });

  it("is stable across calls", () => {
    assert.equal(seedId("users", "superadmin"), seedId("users", "superadmin"));
  });

  // Pinned, so a change to the namespace or the hashing shows up as a red test rather
  // than as every developer's seeded ids moving under their hand-made rows. The value
  // matches Python's `uuid.uuid5(namespace, "users:superadmin")`.
  it("keeps the value it had when it shipped", () => {
    assert.equal(
      seedId("users", "superadmin"),
      "f36f96b0-839e-5d8a-97b2-0c6c22a61fab"
    );
  });

  it("differs by table and by slug", () => {
    assert.notEqual(seedId("users", "a"), seedId("users", "b"));
    assert.notEqual(seedId("users", "a"), seedId("members", "a"));
  });
});

describe("orderTables", () => {
  it("puts a table after every table it references", () => {
    const order = orderTables([
      { after: ["users", "organizations"], name: "members" },
      { after: [], name: "users" },
      { after: [], name: "organizations" },
    ]);
    assert.deepEqual(order, ["organizations", "users", "members"]);
  });

  it("ignores a reference to a table outside the set, and to itself", () => {
    assert.deepEqual(
      orderTables([{ after: ["sessions", "users"], name: "users" }]),
      ["users"]
    );
  });

  it("names every table in a cycle", () => {
    assert.throws(
      () =>
        orderTables([
          { after: ["b"], name: "a" },
          { after: ["a"], name: "b" },
          { after: [], name: "c" },
        ]),
      (error: unknown) =>
        error instanceof SeedCycleError &&
        error.tables.join(",") === "a,b" &&
        /a, b/.test(error.message)
    );
  });
});

describe("conflictTarget", () => {
  it("uses a single text primary key", () => {
    assert.deepEqual(conflictTarget(users, { rows: {}, table: "users" }), [
      "id",
    ]);
  });

  it("uses the slice's key for a generated primary key", () => {
    assert.deepEqual(
      conflictTarget(waitlist, {
        key: ["email"],
        rows: {},
        table: "waitlist_entries",
      }),
      ["email"]
    );
  });

  it("uses a composite primary key with nothing extra", () => {
    assert.deepEqual(
      conflictTarget(events, { rows: {}, table: "billing_events" }),
      ["provider", "providerEventId"]
    );
  });

  it("refuses a generated primary key with no key", () => {
    assert.throws(
      () => conflictTarget(waitlist, { rows: {}, table: "waitlist_entries" }),
      (error: unknown) =>
        error instanceof SeedPlanError &&
        /generated primary key/.test(error.message)
    );
  });

  it("refuses a key naming a column the table lacks", () => {
    assert.throws(
      () =>
        conflictTarget(waitlist, {
          key: ["mail"],
          rows: {},
          table: "waitlist_entries",
        }),
      /no such column/
    );
  });
});

describe("planSeed", () => {
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

    assert.deepEqual(
      plan.map((step) => step.table),
      ["organizations", "users", "members"]
    );
    const [ada] = plan[1]?.rows ?? [];
    assert.equal(ada?.values.id, seedId("users", "ada"));
    assert.deepEqual(ada?.update, ["email"]);
  });

  it("keeps an id the slice wrote", () => {
    const plan = planSeed(tables, [
      { rows: { ada: { email: "a@x.test", id: "fixed" } }, table: "users" },
    ]);
    assert.equal(plan[0]?.rows[0]?.values.id, "fixed");
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
    assert.deepEqual(step?.target, ["email"]);
    assert.deepEqual(step?.rows[0]?.values, { email: "first@example.test" });
    assert.deepEqual(step?.rows[0]?.update, []);
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
    assert.deepEqual(plan[0]?.rows[0]?.update, ["type"]);
  });

  it("writes rows in slug order", () => {
    const plan = planSeed(tables, [
      {
        rows: { zed: { email: "z@x.test" }, amy: { email: "a@x.test" } },
        table: "users",
      },
    ]);
    assert.deepEqual(
      plan[0]?.rows.map((row) => row.slug),
      ["amy", "zed"]
    );
  });

  it("adds an `after` edge to the foreign-key order", () => {
    const plan = planSeed(tables, [
      { after: ["users"], rows: {}, table: "organizations" },
      { rows: {}, table: "users" },
    ]);
    assert.deepEqual(
      plan.map((step) => step.table),
      ["users", "organizations"]
    );
  });

  it("refuses a slice for a table the schema lacks", () => {
    assert.throws(
      () => planSeed(tables, [{ rows: {}, table: "ghosts" }]),
      /no table by that name/
    );
  });

  it("refuses two slices for one table", () => {
    assert.throws(
      () =>
        planSeed(tables, [
          { rows: {}, table: "users" },
          { rows: {}, table: "users" },
        ]),
      /Two slices/
    );
  });

  it("refuses a row naming a column the table lacks", () => {
    assert.throws(
      () =>
        planSeed(tables, [
          { rows: { ada: { mail: "a@x.test" } }, table: "users" },
        ]),
      /no such column/
    );
  });

  it("refuses a row missing part of a composite key", () => {
    assert.throws(
      () =>
        planSeed(tables, [
          { rows: { paid: { provider: "console" } }, table: "billing_events" },
        ]),
      /conflict key/
    );
  });

  it("refuses a reference to a row whose id the database generates", () => {
    assert.throws(
      () =>
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
        ]),
      /generated by the database/
    );
  });

  it("refuses a cycle before anything is planned", () => {
    const a: TableShape = { ...users, name: "a", references: ["b"] };
    const b: TableShape = { ...users, name: "b", references: ["a"] };
    assert.throws(
      () =>
        planSeed(
          [a, b],
          [
            { rows: {}, table: "a" },
            { rows: {}, table: "b" },
          ]
        ),
      SeedCycleError
    );
  });
});

describe("missingSlices", () => {
  it("names each table no slice fills, sorted", () => {
    assert.deepEqual(
      missingSlices(
        [{ name: "users" }, { name: "accounts" }, { name: "sessions" }],
        [{ table: "users" }]
      ),
      ["accounts", "sessions"]
    );
  });

  it("is empty for a schema with no tables", () => {
    assert.deepEqual(missingSlices([], []), []);
  });
});
