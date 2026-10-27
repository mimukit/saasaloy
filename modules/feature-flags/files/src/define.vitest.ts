// Tests for the resolver: the order the three levels are consulted in, what a reader is
// allowed to write, and the kill switch. It ships as `src/define.test.ts` when testing is
// on, and `pnpm test:modules` runs it in place in the saasaloy repo.
//
// One thing is faked and nothing else. `@repo/kv` is the real core: the project's
// workspace, or in the saasaloy repo the `modules/kv` files the module layout of
// `pnpm test:modules` resolves it to. The store underneath is the real `kv-memory`
// provider, wrapped in a counter so a test can assert how many reads and writes a call
// actually cost. The database is a plain object, which is the whole point of the
// `FlagSource` interface.

import { kv } from "@repo/kv";
import { memory } from "@repo/kv/providers/memory";
import { beforeEach, describe, expect, it } from "vitest";
import { forgetCache } from "./cache";
import { defineFlag, defineFlags, KillSwitchError } from "./define";
import type { FlagValue } from "./document";
import type { FlagSource } from "./source";

// The real memory provider, wrapped so every read and write through the store is counted.
// `kv.providers` is the array `saasaloy add kv-memory` appends to, so registering here is
// exactly what an install does.
const store = memory();
const counts = { get: 0, set: 0 };

kv.providers.push({
  ...store,
  name: "counting",
  get(env, key) {
    counts.get += 1;
    return store.get(env, key);
  },
  set(env, key, value, options) {
    counts.set += 1;
    return store.set(env, key, value, options);
  },
});

/** No isolate cache, so every test measures the kv layer rather than a leftover `Map`. */
const ENV = { FLAGS_ISOLATE_TTL_SECONDS: "0", KV_PROVIDER: "counting" };
/** The default 10 second cache, for the tests that are about the cache itself. */
const CACHED_ENV = { KV_PROVIDER: "counting" };

// Declared apart from `defineFlags` and `as const`: inline, the array takes the contextual
// type `FlagDefinition<string>[]`, the keys widen to `string` and `assertEnabled` takes `never`.
const FLAGS = [
  defineFlag({
    default: false,
    key: "billing.new-checkout",
    type: "boolean",
  }),
  defineFlag({ default: true, key: "kill.payments", type: "boolean" }),
  defineFlag({ default: false, key: "ui.redesign", type: "percentage" }),
] as const;

const registry = defineFlags({ flags: FLAGS });

/** A stand-in for the database. `global` and `tenants` are what the tables would hold. */
function source(
  global: Record<string, FlagValue> = {},
  tenants: Record<string, Record<string, FlagValue>> = {}
) {
  const loads = { global: 0, tenant: 0 };
  const db: FlagSource = {
    loadGlobal() {
      loads.global += 1;
      return Promise.resolve(global);
    },
    loadTenant(tenantId) {
      loads.tenant += 1;
      return Promise.resolve(tenants[tenantId] ?? {});
    },
  };
  return { loads, source: db };
}

describe("feature flag registry", () => {
  beforeEach(() => {
    store.reset();
    forgetCache();
    counts.get = 0;
    counts.set = 0;
  });

  describe("resolution order", () => {
    it("returns the code default when no row exists anywhere", async () => {
      const { source: db } = source();
      const client = registry.create(ENV, db);

      await expect(client.flag("billing.new-checkout")).resolves.toBeFalsy();
      await expect(client.flag("kill.payments")).resolves.toBeTruthy();
    });

    it("lets a global row beat the code default", async () => {
      const { source: db } = source({
        "billing.new-checkout": { enabled: true },
      });
      const client = registry.create(ENV, db);

      await expect(client.flag("billing.new-checkout")).resolves.toBeTruthy();
    });

    it("lets a tenant override beat a global row", async () => {
      const { source: db } = source(
        { "billing.new-checkout": { enabled: false } },
        { "tenant-a": { "billing.new-checkout": { enabled: true } } }
      );
      const client = registry.create(ENV, db);

      await expect(
        client.flag("billing.new-checkout", { tenantId: "tenant-a" })
      ).resolves.toBeTruthy();
      // The same flag, no tenant: the global row still says false.
      await expect(client.flag("billing.new-checkout")).resolves.toBeFalsy();
    });

    it("falls through to the global row for a tenant with no override", async () => {
      const { source: db } = source(
        { "billing.new-checkout": { enabled: true } },
        { "tenant-a": {} }
      );
      const client = registry.create(ENV, db);

      await expect(
        client.flag("billing.new-checkout", { tenantId: "tenant-b" })
      ).resolves.toBeTruthy();
    });

    it("refuses a key nobody registered", async () => {
      const { source: db } = source();
      const client = registry.create(ENV, db);

      // @ts-expect-error -- an unregistered key is a type error; this pins the runtime refusal too
      await expect(() => client.flag("nope.not-a-flag")).rejects.toThrow(
        /not registered/
      );
    });
  });

  describe("percentage flags", () => {
    it("is on for every subject at 100", async () => {
      const { source: db } = source({
        "ui.redesign": { enabled: true, percentage: 100 },
      });

      await expect(
        registry.create(ENV, db).flag("ui.redesign", { subjectId: "user-1" })
      ).resolves.toBeTruthy();
    });

    it("is off for every subject at 0", async () => {
      const { source: db } = source({
        "ui.redesign": { enabled: true, percentage: 0 },
      });

      await expect(
        registry.create(ENV, db).flag("ui.redesign", { subjectId: "user-1" })
      ).resolves.toBeFalsy();
    });

    it("is off with no subject to bucket", async () => {
      const { source: db } = source({
        "ui.redesign": { enabled: true, percentage: 50 },
      });

      await expect(
        registry.create(ENV, db).flag("ui.redesign")
      ).resolves.toBeFalsy();
    });

    it("stays off while the flag is disabled, whatever the share says", async () => {
      const { source: db } = source({
        "ui.redesign": { enabled: false, percentage: 100 },
      });

      await expect(
        registry.create(ENV, db).flag("ui.redesign", { subjectId: "user-1" })
      ).resolves.toBeFalsy();
    });

    it("gives one subject the same answer on every request", async () => {
      const { source: db } = source({
        "ui.redesign": { enabled: true, percentage: 50 },
      });
      const client = registry.create(ENV, db);
      const first = await client.flag("ui.redesign", { subjectId: "user-7" });

      for (let index = 0; index < 50; index += 1) {
        await expect(
          client.flag("ui.redesign", { subjectId: "user-7" })
        ).resolves.toBe(first);
      }
    });
  });

  describe("writes", () => {
    it("publishes once on the first miss and never writes on a hit", async () => {
      const { loads, source: db } = source({
        "billing.new-checkout": { enabled: true },
      });
      const client = registry.create(ENV, db);

      await client.flag("billing.new-checkout");
      expect(counts.set, "the first miss publishes the document").toBe(1);
      expect(loads.global).toBe(1);

      counts.get = 0;
      counts.set = 0;
      for (let index = 0; index < 20; index += 1) {
        await expect(client.flag("billing.new-checkout")).resolves.toBeTruthy();
      }

      expect(counts.set, "a reader never writes on a hit").toBe(0);
      expect(loads.global, "and never reaches the database again").toBe(1);
      expect(counts.get, "with the isolate cache off, one kv read each").toBe(
        20
      );
    });

    it("serves the isolate cache without a kv read while it is warm", async () => {
      const { source: db } = source({
        "billing.new-checkout": { enabled: true },
      });
      const client = registry.create(CACHED_ENV, db);

      await client.flag("billing.new-checkout");
      const readsAfterFirst = counts.get;

      for (let index = 0; index < 20; index += 1) {
        await client.flag("billing.new-checkout");
      }

      expect(counts.get, "no further kv reads").toBe(readsAfterFirst);
      expect(counts.set, "and no further writes").toBe(1);
    });

    it("republishes a scope on publish() and drops this isolate's copy", async () => {
      const values = { "billing.new-checkout": { enabled: false } };
      const db = {
        loadGlobal: () => Promise.resolve(values),
        loadTenant: () => Promise.resolve({}),
      };
      const client = registry.create(CACHED_ENV, db);

      await expect(client.flag("billing.new-checkout")).resolves.toBeFalsy();

      // The admin route's move: write the database, then republish.
      values["billing.new-checkout"] = { enabled: true };
      await client.publish();

      // No TTL wait. `publish` forgets the local copy, so the isolate that toggled sees it now.
      await expect(client.flag("billing.new-checkout")).resolves.toBeTruthy();
    });
  });

  describe("assertEnabled", () => {
    it("returns while the switch is on", async () => {
      const { source: db } = source({ "kill.payments": { enabled: true } });

      await expect(
        registry.create(ENV, db).assertEnabled("payments")
      ).resolves.toBeUndefined();
    });

    it("returns on the code default, so a fresh deploy still charges", async () => {
      const { source: db } = source();

      await expect(
        registry.create(ENV, db).assertEnabled("payments")
      ).resolves.toBeUndefined();
    });

    it("throws KillSwitchError once the switch is off", async () => {
      const { source: db } = source({ "kill.payments": { enabled: false } });
      const client = registry.create(ENV, db);

      await expect(() => client.assertEnabled("payments")).rejects.toThrow(
        expect.toSatisfy((error: KillSwitchError) => {
          expect(error).toBeInstanceOf(KillSwitchError);
          expect(error.code).toBe("kill_switch");
          expect(error.integration).toBe("payments");
          expect(error.message).toMatch(/kill\.payments/);
          return true;
        })
      );
    });
  });

  describe("registration", () => {
    it("refuses a key that is not dotted and lower-case", () => {
      expect(() =>
        defineFlag({ default: false, key: "NewCheckout", type: "boolean" })
      ).toThrow(/must be lower-case and dotted/);
    });

    it("refuses the same key twice", () => {
      expect(() =>
        defineFlags({
          flags: [
            defineFlag({ default: false, key: "a.b", type: "boolean" }),
            defineFlag({ default: true, key: "a.b", type: "boolean" }),
          ],
        })
      ).toThrow(/registered twice/);
    });
  });

  describe("all", () => {
    it("resolves every registered flag in one pass", async () => {
      const { source: db } = source({
        "billing.new-checkout": { enabled: true },
        "kill.payments": { enabled: false },
      });

      await expect(registry.create(ENV, db).all()).resolves.toStrictEqual({
        "billing.new-checkout": true,
        "kill.payments": false,
        "ui.redesign": false,
      });
    });
  });
});
