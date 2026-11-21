import { describe, expect, it } from "vitest";
import {
  drizzleColumnInsertRefusal,
  insertDrizzleColumn,
} from "./drizzle-column.js";

// The shape the codemod is written against: `modules/auth`'s `users` table, trimmed to the
// columns that matter here. The `pg` twin below differs only in its builders, which is the
// case one patch has to serve without a second variant.
const SQLITE = `import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  email: text("email").notNull().unique(),
  id: text("id").primaryKey(),
  banned: integer("banned", { mode: "boolean" }).default(false),
});
`;

const PG = `import { boolean, pgTable, text } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  email: text("email").notNull().unique(),
  id: text("id").primaryKey(),
  banned: boolean("banned").default(false),
});
`;

const SUBSCRIPTION_CUSTOMER = {
  exportName: "users",
  column: "subscriptionCustomerId",
  value: 'text("subscription_customer_id")',
} as const;

describe(insertDrizzleColumn, () => {
  it("adds the column to the table's columns object", () => {
    const out = insertDrizzleColumn(SQLITE, SUBSCRIPTION_CUSTOMER);
    expect(out).toContain(
      'subscriptionCustomerId: text("subscription_customer_id")'
    );
    expect(out).toContain('id: text("id").primaryKey()');
  });

  it("serves both dialects from one patch when the builder is the same", () => {
    expect(insertDrizzleColumn(PG, SUBSCRIPTION_CUSTOMER)).toContain(
      'subscriptionCustomerId: text("subscription_customer_id")'
    );
  });

  it("is a byte-for-byte no-op on a second apply", () => {
    const once = insertDrizzleColumn(SQLITE, SUBSCRIPTION_CUSTOMER);
    expect(insertDrizzleColumn(once, SUBSCRIPTION_CUSTOMER)).toBe(once);
  });

  it("never clobbers a column the user already wrote under that key", () => {
    const edited = insertDrizzleColumn(SQLITE, {
      ...SUBSCRIPTION_CUSTOMER,
      value: 'text("subscription_customer_id").notNull()',
    });
    expect(insertDrizzleColumn(edited, SUBSCRIPTION_CUSTOMER)).toBe(edited);
  });

  it("leaves the source untouched when the export is absent", () => {
    expect(
      insertDrizzleColumn(SQLITE, {
        ...SUBSCRIPTION_CUSTOMER,
        exportName: "team",
      })
    ).toBe(SQLITE);
  });

  it("leaves the source untouched when the export is not a table call", () => {
    const notATable = 'export const users = "nope";\n';
    expect(insertDrizzleColumn(notATable, SUBSCRIPTION_CUSTOMER)).toBe(
      notATable
    );
  });

  it("adds a declared import that the file is missing", () => {
    const out = insertDrizzleColumn(SQLITE, {
      ...SUBSCRIPTION_CUSTOMER,
      column: "lockedAt",
      value: 'timestamp("locked_at")',
      import: { name: "timestamp", from: "drizzle-orm/pg-core" },
    });
    expect(out).toContain('import { timestamp } from "drizzle-orm/pg-core"');
    expect(out).toContain('lockedAt: timestamp("locked_at")');
  });

  it("does not duplicate an import the file already has", () => {
    const out = insertDrizzleColumn(SQLITE, {
      ...SUBSCRIPTION_CUSTOMER,
      import: { name: "text", from: "drizzle-orm/sqlite-core" },
    });
    expect(out.match(/from "drizzle-orm\/sqlite-core"/gu)).toHaveLength(1);
  });

  it("keeps the file's trailing newline", () => {
    expect(
      insertDrizzleColumn(SQLITE, SUBSCRIPTION_CUSTOMER).endsWith("\n")
    ).toBeTruthy();
  });

  it("writes nothing when the local name already binds a different import", () => {
    // Asked before the splice: `addImport` declining afterwards would leave the column
    // reading whatever the file's own `text` resolves to.
    const repointed = SQLITE.replace(
      'import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";',
      'import { integer, sqliteTable } from "drizzle-orm/sqlite-core";\nimport text from "./legacy.js";'
    );
    expect(
      insertDrizzleColumn(repointed, {
        ...SUBSCRIPTION_CUSTOMER,
        import: { name: "text", from: "drizzle-orm/sqlite-core" },
      })
    ).toBe(repointed);
  });

  it("throws on a value that is more than one expression", () => {
    expect(() =>
      insertDrizzleColumn(SQLITE, {
        ...SUBSCRIPTION_CUSTOMER,
        value: 'text("subscription_customer_id"); dropEverything()',
      })
    ).toThrow(/not a single expression/u);
  });
});

describe(drizzleColumnInsertRefusal, () => {
  it("names a missing export", () => {
    expect(
      drizzleColumnInsertRefusal(SQLITE, {
        ...SUBSCRIPTION_CUSTOMER,
        exportName: "team",
      })
    ).toMatch(/could not find an export named "team"/u);
  });

  it("names an export that is not a table call", () => {
    expect(
      drizzleColumnInsertRefusal(
        'export const users = "nope";\n',
        SUBSCRIPTION_CUSTOMER
      )
    ).toMatch(/not a Drizzle table call/u);
  });

  it("reports a column already holding something else", () => {
    const edited = insertDrizzleColumn(SQLITE, {
      ...SUBSCRIPTION_CUSTOMER,
      value: 'text("subscription_customer_id").notNull()',
    });
    expect(drizzleColumnInsertRefusal(edited, SUBSCRIPTION_CUSTOMER)).toMatch(
      /holds text\("subscription_customer_id"\)\.notNull\(\)/u
    );
  });

  it("reports a local name that binds a different import", () => {
    const repointed = SQLITE.replace(
      'import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";',
      'import { integer, sqliteTable } from "drizzle-orm/sqlite-core";\nimport text from "./legacy.js";'
    );
    expect(
      drizzleColumnInsertRefusal(repointed, {
        ...SUBSCRIPTION_CUSTOMER,
        import: { name: "text", from: "drizzle-orm/sqlite-core" },
      })
    ).toMatch(/would read the wrong builder/u);
  });

  it("has no objection to a clean apply", () => {
    expect(
      drizzleColumnInsertRefusal(SQLITE, SUBSCRIPTION_CUSTOMER)
    ).toBeUndefined();
  });
});
