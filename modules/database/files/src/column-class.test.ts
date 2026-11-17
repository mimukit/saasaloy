// Tests for the column class checks. This file is NOT in the descriptor's
// `scaffolds[].files` list, so `add database` never copies it into a project. It runs here
// with `pnpm test:modules`, and it imports `./column-class-check.ts` rather than
// `./column-class.ts`, because this repo's root `node_modules` carries no Drizzle.
// `defineColumnClasses` itself, which reads a real Drizzle table, is exercised on a
// generated project by `column-classes.vitest.ts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  brandColumnClasses,
  classificationProblems,
  collectColumnClasses,
  piiColumnNames,
  secretColumns,
  toSqlNames,
} from "./column-class-check.ts";
import type { TableClasses } from "./column-class-check.ts";

const users: TableClasses = {
  columns: { email: "pii", id: "plain", password_hash: "secret" },
  table: "users",
};
const sessions: TableClasses = {
  columns: { id: "plain", ip_address: "pii", token: "secret" },
  table: "sessions",
};

describe("classificationProblems", () => {
  const schema = [
    { columns: ["id", "email", "password_hash"], table: "users" },
    { columns: ["id", "token", "ip_address"], table: "sessions" },
  ];

  it("finds nothing when the classes match the schema", () => {
    assert.deepEqual(classificationProblems(schema, [users, sessions]), []);
  });

  it("reports a table with no classes", () => {
    assert.deepEqual(classificationProblems(schema, [users]), [
      "sessions: table has no column classes",
    ]);
  });

  it("reports a column with no class", () => {
    const grown = [
      { columns: ["id", "email", "password_hash", "phone"], table: "users" },
      schema[1] ?? { columns: [], table: "" },
    ];
    assert.deepEqual(classificationProblems(grown, [users, sessions]), [
      "users.phone: column has no class",
    ]);
  });

  it("reports a classified column the schema lacks", () => {
    const shrunk = [
      { columns: ["id", "email"], table: "users" },
      schema[1] ?? { columns: [], table: "" },
    ];
    assert.deepEqual(classificationProblems(shrunk, [users, sessions]), [
      "users.password_hash: classified, but not in the schema",
    ]);
  });

  it("reports a classified table the schema lacks", () => {
    assert.deepEqual(
      classificationProblems(schema.slice(0, 1), [users, sessions]),
      ["sessions: classified, but not in the schema"]
    );
  });

  it("reports a table classified twice", () => {
    assert.deepEqual(classificationProblems(schema, [users, sessions, users]), [
      "users: classified in more than one file",
    ]);
  });
});

describe("collectColumnClasses", () => {
  it("keeps only class exports, sorted by table", () => {
    const collected = collectColumnClasses({
      // Out of order on purpose: the result is sorted by table, not by file.
      "./column-classes/users.ts": {
        // Shaped like one, but not made by `defineColumnClasses`: left out.
        lookalike: { ...users, table: "aaa" },
        users: brandColumnClasses({ ...users }),
      },
      "./column-classes/sessions.ts": {
        note: "not a class export",
        sessions: brandColumnClasses({ ...sessions }),
      },
    });
    assert.deepEqual(
      collected.map((entry) => entry.table),
      ["sessions", "users"]
    );
  });

  it("is empty for an empty folder", () => {
    assert.deepEqual(collectColumnClasses({}), []);
  });
});

describe("toSqlNames", () => {
  const columns = {
    emailVerified: { name: "email_verified" },
    id: { name: "id" },
  };

  it("rekeys each property key to its SQL column name", () => {
    assert.deepEqual(
      toSqlNames("users", columns, { emailVerified: "plain", id: "plain" }),
      { email_verified: "plain", id: "plain" }
    );
  });

  it("throws on a key the table lacks", () => {
    assert.throws(
      () => toSqlNames("users", columns, { phone: "pii" }),
      /users has no column with the key "phone"/
    );
  });
});

describe("piiColumnNames and secretColumns", () => {
  it("lists pii columns by SQL name", () => {
    assert.deepEqual([...piiColumnNames([users, sessions])].toSorted(), [
      "email",
      "ip_address",
    ]);
  });

  it("lists secret columns as table.column, sorted", () => {
    assert.deepEqual(secretColumns([users, sessions]), [
      "sessions.token",
      "users.password_hash",
    ]);
  });
});
