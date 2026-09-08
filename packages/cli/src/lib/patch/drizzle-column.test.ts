import { describe, expect, it } from "vitest";
import {
  drizzleColumnInsertRefusal,
  drizzleColumnRemoveRefusal,
  insertDrizzleColumn,
  removeDrizzleColumn,
} from "./drizzle-column.js";

// The shape the codemod is written against: `modules/auth`'s `user` table, trimmed to the
// columns that matter here. The `pg` twin below differs only in its builders, which is the
// case one patch has to serve without a second variant.
const SQLITE = `import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  email: text("email").notNull().unique(),
  id: text("id").primaryKey(),
  banned: integer("banned", { mode: "boolean" }).default(false),
});
`;

const PG = `import { boolean, pgTable, text } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  email: text("email").notNull().unique(),
  id: text("id").primaryKey(),
  banned: boolean("banned").default(false),
});
`;

const BILLING_CUSTOMER = {
  exportName: "user",
  column: "billingCustomerId",
  value: 'text("billing_customer_id")',
} as const;

describe(insertDrizzleColumn, () => {
  it("adds the column to the table's columns object", () => {
    const out = insertDrizzleColumn(SQLITE, BILLING_CUSTOMER);
    expect(out).toContain('billingCustomerId: text("billing_customer_id")');
    expect(out).toContain('id: text("id").primaryKey()');
  });

  it("serves both dialects from one patch when the builder is the same", () => {
    expect(insertDrizzleColumn(PG, BILLING_CUSTOMER)).toContain(
      'billingCustomerId: text("billing_customer_id")'
    );
  });

  it("is a byte-for-byte no-op on a second apply", () => {
    const once = insertDrizzleColumn(SQLITE, BILLING_CUSTOMER);
    expect(insertDrizzleColumn(once, BILLING_CUSTOMER)).toBe(once);
  });

  it("never clobbers a column the user already wrote under that key", () => {
    const edited = insertDrizzleColumn(SQLITE, {
      ...BILLING_CUSTOMER,
      value: 'text("billing_customer_id").notNull()',
    });
    expect(insertDrizzleColumn(edited, BILLING_CUSTOMER)).toBe(edited);
  });

  it("leaves the source untouched when the export is absent", () => {
    expect(
      insertDrizzleColumn(SQLITE, { ...BILLING_CUSTOMER, exportName: "team" })
    ).toBe(SQLITE);
  });

  it("leaves the source untouched when the export is not a table call", () => {
    const notATable = 'export const user = "nope";\n';
    expect(insertDrizzleColumn(notATable, BILLING_CUSTOMER)).toBe(notATable);
  });

  it("adds a declared import that the file is missing", () => {
    const out = insertDrizzleColumn(SQLITE, {
      ...BILLING_CUSTOMER,
      column: "lockedAt",
      value: 'timestamp("locked_at")',
      import: { name: "timestamp", from: "drizzle-orm/pg-core" },
    });
    expect(out).toContain('import { timestamp } from "drizzle-orm/pg-core"');
    expect(out).toContain('lockedAt: timestamp("locked_at")');
  });

  it("does not duplicate an import the file already has", () => {
    const out = insertDrizzleColumn(SQLITE, {
      ...BILLING_CUSTOMER,
      import: { name: "text", from: "drizzle-orm/sqlite-core" },
    });
    expect(out.match(/from "drizzle-orm\/sqlite-core"/gu)).toHaveLength(1);
  });

  it("keeps the file's trailing newline", () => {
    expect(
      insertDrizzleColumn(SQLITE, BILLING_CUSTOMER).endsWith("\n")
    ).toBeTruthy();
  });
});

describe(removeDrizzleColumn, () => {
  it("round-trips to the byte-identical original", () => {
    const added = insertDrizzleColumn(SQLITE, BILLING_CUSTOMER);
    expect(added).not.toBe(SQLITE);
    expect(removeDrizzleColumn(added, BILLING_CUSTOMER)).toBe(SQLITE);
  });

  it("round-trips the pg twin too", () => {
    const added = insertDrizzleColumn(PG, BILLING_CUSTOMER);
    expect(removeDrizzleColumn(added, BILLING_CUSTOMER)).toBe(PG);
  });

  it("takes a declared import back out with the column", () => {
    const patch = {
      ...BILLING_CUSTOMER,
      column: "lockedAt",
      value: 'timestamp("locked_at")',
      import: { name: "timestamp", from: "drizzle-orm/pg-core" },
    };
    expect(removeDrizzleColumn(insertDrizzleColumn(SQLITE, patch), patch)).toBe(
      SQLITE
    );
  });

  it("keeps an import the file still references elsewhere", () => {
    const patch = {
      ...BILLING_CUSTOMER,
      import: { name: "text", from: "drizzle-orm/sqlite-core" },
    };
    const out = removeDrizzleColumn(insertDrizzleColumn(SQLITE, patch), patch);
    expect(out).toContain("import { integer, sqliteTable, text }");
  });

  it("is a no-op when the column is already gone", () => {
    expect(removeDrizzleColumn(SQLITE, BILLING_CUSTOMER)).toBe(SQLITE);
  });

  it("refuses to delete a column the user has since edited", () => {
    const edited = insertDrizzleColumn(SQLITE, {
      ...BILLING_CUSTOMER,
      value: 'text("billing_customer_id").notNull()',
    });
    expect(removeDrizzleColumn(edited, BILLING_CUSTOMER)).toBe(edited);
  });

  it("refuses when the local name now binds a different import", () => {
    const patch = {
      ...BILLING_CUSTOMER,
      column: "lockedAt",
      value: 'timestamp("locked_at")',
      import: { name: "timestamp", from: "drizzle-orm/pg-core" },
    };
    const repointed = insertDrizzleColumn(SQLITE, patch).replace(
      '"drizzle-orm/pg-core"',
      '"./my-columns"'
    );
    expect(removeDrizzleColumn(repointed, patch)).toBe(repointed);
  });
});

describe(drizzleColumnInsertRefusal, () => {
  it("names a missing export", () => {
    expect(
      drizzleColumnInsertRefusal(SQLITE, {
        ...BILLING_CUSTOMER,
        exportName: "team",
      })
    ).toMatch(/could not find an export named "team"/u);
  });

  it("names an export that is not a table call", () => {
    expect(
      drizzleColumnInsertRefusal(
        'export const user = "nope";\n',
        BILLING_CUSTOMER
      )
    ).toMatch(/not a Drizzle table call/u);
  });

  it("reports a column already holding something else", () => {
    const edited = insertDrizzleColumn(SQLITE, {
      ...BILLING_CUSTOMER,
      value: 'text("billing_customer_id").notNull()',
    });
    expect(drizzleColumnInsertRefusal(edited, BILLING_CUSTOMER)).toMatch(
      /holds text\("billing_customer_id"\)\.notNull\(\)/u
    );
  });

  it("has no objection to a clean apply", () => {
    expect(
      drizzleColumnInsertRefusal(SQLITE, BILLING_CUSTOMER)
    ).toBeUndefined();
  });
});

describe(drizzleColumnRemoveRefusal, () => {
  it("stays quiet when the column is already gone", () => {
    expect(
      drizzleColumnRemoveRefusal(SQLITE, BILLING_CUSTOMER)
    ).toBeUndefined();
  });

  it("stays quiet on a clean removal", () => {
    const added = insertDrizzleColumn(SQLITE, BILLING_CUSTOMER);
    expect(drizzleColumnRemoveRefusal(added, BILLING_CUSTOMER)).toBeUndefined();
  });

  it("explains an edited column", () => {
    const edited = insertDrizzleColumn(SQLITE, {
      ...BILLING_CUSTOMER,
      value: 'text("billing_customer_id").notNull()',
    });
    expect(drizzleColumnRemoveRefusal(edited, BILLING_CUSTOMER)).toMatch(
      /reads text\("billing_customer_id"\)\.notNull\(\) now/u
    );
  });
});
