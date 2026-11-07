import {
  listNotifications,
  setPreference,
} from "@repo/db/repositories/notifications";
import { withDb } from "@repo/db/client";
import { testDatabase } from "@repo/db/testing";
import { seedId } from "@repo/db/seed/id";
import { describe, expect, it } from "vitest";
import { notify } from "./notify";
import type { Db } from "@repo/db/client";

// What `notify` promises the routes that call it: it skips an opted-out optional
// category, it always writes a required one, and it throws on a call that could only be a
// bug. It runs on the seeded test database, so `member` starts with four rows and no
// opt-out.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules` does not
// collect it. The descriptor renames it.

const database = testDatabase();

const member = seedId("users", "member");

/**
 * Run `body` on this file's test database as the `Db` a route holds. `database.db` is a
 * transaction under Postgres, which `notify` does not take as a `Db`; `withDb` over
 * `database.env` hands back the same transaction under the type every repository takes.
 */
function inDb<T>(body: (db: Db) => Promise<T>): Promise<T> {
  return withDb({ env: database.env, executionCtx: { waitUntil: noop } }, body);
}

function noop(): void {
  // A test has no request to keep alive; the transaction closes with the test.
}

async function rowCount(): Promise<number> {
  const page = await inDb((db) =>
    listNotifications(db, member, undefined, 100)
  );
  return page.rows.length;
}

describe(notify, () => {
  it("writes a row the user's page lists first", async () => {
    const result = await inDb((db) =>
      notify(db, {
        body: "Two of three files went through.",
        category: "product",
        href: "/files",
        title: "Your upload finished",
        userId: member,
      })
    );

    const page = await inDb((db) => listNotifications(db, member));
    expect(result).toMatchObject({ written: true });
    expect(page.rows[0]).toMatchObject({
      body: "Two of three files went through.",
      category: "product",
      href: "/files",
      readAt: null,
      title: "Your upload finished",
    });
  });

  it("writes nothing for an optional category the user turned off", async () => {
    await inDb((db) => setPreference(db, member, "product", false));

    const result = await inDb((db) =>
      notify(db, {
        category: "product",
        title: "New: dark mode",
        userId: member,
      })
    );

    expect(result).toStrictEqual({ reason: "opted_out", written: false });
    await expect(rowCount()).resolves.toBe(4);
  });

  it("writes a required category even with an opt-out row for it", async () => {
    await inDb((db) => setPreference(db, member, "account", false));

    const result = await inDb((db) =>
      notify(db, {
        category: "account",
        title: "Your password was changed",
        userId: member,
      })
    );

    expect(result).toMatchObject({ written: true });
    await expect(rowCount()).resolves.toBe(5);
  });

  it("throws on an unknown category and writes nothing", async () => {
    await expect(
      inDb((db) =>
        notify(db, {
          category: "marketing",
          title: "Spring sale",
          userId: member,
        })
      )
    ).rejects.toThrow(/unknown category "marketing"/);
    await expect(rowCount()).resolves.toBe(4);
  });

  it("throws on a blank title", async () => {
    await expect(
      inDb((db) =>
        notify(db, { category: "account", title: "  ", userId: member })
      )
    ).rejects.toThrow(/title is empty/);
  });

  it.each(["https://evil.example/", "//evil.example/", "settings"])(
    "throws on the href %s and writes nothing",
    async (href) => {
      await expect(
        inDb((db) =>
          notify(db, {
            category: "account",
            href,
            title: "Open this",
            userId: member,
          })
        )
      ).rejects.toThrow(/not an app-relative path/);
      await expect(rowCount()).resolves.toBe(4);
    }
  );
});
