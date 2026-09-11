// Tests for the resolver: the order the three levels are consulted in, what a reader is
// allowed to write, and the kill switch. Repo-only — the descriptor ships `define.ts`, never
// this file.
//
// One thing is faked and nothing else. `@repo/kv` is a bare specifier that only exists inside
// a scaffolded project, so the resolve hook below points it at the real `modules/kv` core —
// the same code a generated project gets, with no stub in between. The store underneath is
// the real `kv-memory` provider, wrapped in a counter so a test can assert how many reads and
// writes a call actually cost. The database is a plain object, which is the whole point of
// the `FlagSource` interface.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

const KV_CORE = new URL("../../../kv/files/src/index.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "@repo/kv"
      ? nextResolve(KV_CORE, context)
      : nextResolve(specifier, context);
  },
});

// Dynamic, and after the hook: a static import is hoisted above `registerHooks`, so
// `@repo/kv` would be resolved before the mapping exists.
const { kv } = await import(KV_CORE);
const { memory } = await import("../../../kv-memory/files/memory.ts");
const { defineFlag, defineFlags, KillSwitchError } =
  await import("./define.ts");
const { forgetCache } = await import("./cache.ts");

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

const registry = defineFlags({
  flags: [
    defineFlag({
      default: false,
      key: "billing.new-checkout",
      type: "boolean",
    }),
    defineFlag({ default: true, key: "kill.payments", type: "boolean" }),
    defineFlag({ default: false, key: "ui.redesign", type: "percentage" }),
  ],
});

/** A stand-in for the database. `global` and `tenants` are what the tables would hold. */
function source(
  global = {},
  tenants: Record<string, Record<string, unknown>> = {}
) {
  const loads = { global: 0, tenant: 0 };
  return {
    loads,
    source: {
      loadGlobal() {
        loads.global += 1;
        return Promise.resolve(global);
      },
      loadTenant(tenantId) {
        loads.tenant += 1;
        return Promise.resolve(tenants[tenantId] ?? {});
      },
    },
  };
}

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

    assert.equal(await client.flag("billing.new-checkout"), false);
    assert.equal(await client.flag("kill.payments"), true);
  });

  it("lets a global row beat the code default", async () => {
    const { source: db } = source({
      "billing.new-checkout": { enabled: true },
    });
    const client = registry.create(ENV, db);

    assert.equal(await client.flag("billing.new-checkout"), true);
  });

  it("lets a tenant override beat a global row", async () => {
    const { source: db } = source(
      { "billing.new-checkout": { enabled: false } },
      { "tenant-a": { "billing.new-checkout": { enabled: true } } }
    );
    const client = registry.create(ENV, db);

    assert.equal(
      await client.flag("billing.new-checkout", { tenantId: "tenant-a" }),
      true
    );
    // The same flag, no tenant: the global row still says false.
    assert.equal(await client.flag("billing.new-checkout"), false);
  });

  it("falls through to the global row for a tenant with no override", async () => {
    const { source: db } = source(
      { "billing.new-checkout": { enabled: true } },
      { "tenant-a": {} }
    );
    const client = registry.create(ENV, db);

    assert.equal(
      await client.flag("billing.new-checkout", { tenantId: "tenant-b" }),
      true
    );
  });

  it("refuses a key nobody registered", async () => {
    const { source: db } = source();
    const client = registry.create(ENV, db);

    await assert.rejects(
      () => client.flag("nope.not-a-flag"),
      /not registered/
    );
  });
});

describe("percentage flags", () => {
  it("is on for every subject at 100", async () => {
    const { source: db } = source({
      "ui.redesign": { enabled: true, percentage: 100 },
    });

    assert.equal(
      await registry
        .create(ENV, db)
        .flag("ui.redesign", { subjectId: "user-1" }),
      true
    );
  });

  it("is off for every subject at 0", async () => {
    const { source: db } = source({
      "ui.redesign": { enabled: true, percentage: 0 },
    });

    assert.equal(
      await registry
        .create(ENV, db)
        .flag("ui.redesign", { subjectId: "user-1" }),
      false
    );
  });

  it("is off with no subject to bucket", async () => {
    const { source: db } = source({
      "ui.redesign": { enabled: true, percentage: 50 },
    });

    assert.equal(await registry.create(ENV, db).flag("ui.redesign"), false);
  });

  it("stays off while the flag is disabled, whatever the share says", async () => {
    const { source: db } = source({
      "ui.redesign": { enabled: false, percentage: 100 },
    });

    assert.equal(
      await registry
        .create(ENV, db)
        .flag("ui.redesign", { subjectId: "user-1" }),
      false
    );
  });

  it("gives one subject the same answer on every request", async () => {
    const { source: db } = source({
      "ui.redesign": { enabled: true, percentage: 50 },
    });
    const client = registry.create(ENV, db);
    const first = await client.flag("ui.redesign", { subjectId: "user-7" });

    for (let index = 0; index < 50; index += 1) {
      assert.equal(
        await client.flag("ui.redesign", { subjectId: "user-7" }),
        first
      );
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
    assert.equal(counts.set, 1, "the first miss publishes the document");
    assert.equal(loads.global, 1);

    counts.get = 0;
    counts.set = 0;
    for (let index = 0; index < 20; index += 1) {
      assert.equal(await client.flag("billing.new-checkout"), true);
    }

    assert.equal(counts.set, 0, "a reader never writes on a hit");
    assert.equal(loads.global, 1, "and never reaches the database again");
    assert.equal(
      counts.get,
      20,
      "with the isolate cache off, one kv read each"
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

    assert.equal(counts.get, readsAfterFirst, "no further kv reads");
    assert.equal(counts.set, 1, "and no further writes");
  });

  it("republishes a scope on publish() and drops this isolate's copy", async () => {
    const values = { "billing.new-checkout": { enabled: false } };
    const db = {
      loadGlobal: () => Promise.resolve(values),
      loadTenant: () => Promise.resolve({}),
    };
    const client = registry.create(CACHED_ENV, db);

    assert.equal(await client.flag("billing.new-checkout"), false);

    // The admin route's move: write the database, then republish.
    values["billing.new-checkout"] = { enabled: true };
    await client.publish();

    // No TTL wait. `publish` forgets the local copy, so the isolate that toggled sees it now.
    assert.equal(await client.flag("billing.new-checkout"), true);
  });
});

describe("assertEnabled", () => {
  it("returns while the switch is on", async () => {
    const { source: db } = source({ "kill.payments": { enabled: true } });

    await registry.create(ENV, db).assertEnabled("payments");
  });

  it("returns on the code default, so a fresh deploy still charges", async () => {
    const { source: db } = source();

    await registry.create(ENV, db).assertEnabled("payments");
  });

  it("throws KillSwitchError once the switch is off", async () => {
    const { source: db } = source({ "kill.payments": { enabled: false } });
    const client = registry.create(ENV, db);

    await assert.rejects(
      () => client.assertEnabled("payments"),
      (error) => {
        assert.ok(error instanceof KillSwitchError);
        assert.equal(error.code, "kill_switch");
        assert.equal(error.integration, "payments");
        assert.match(error.message, /kill\.payments/);
        return true;
      }
    );
  });
});

describe("registration", () => {
  it("refuses a key that is not dotted and lower-case", () => {
    assert.throws(
      () => defineFlag({ default: false, key: "NewCheckout", type: "boolean" }),
      /must be lower-case and dotted/
    );
  });

  it("refuses the same key twice", () => {
    assert.throws(
      () =>
        defineFlags({
          flags: [
            defineFlag({ default: false, key: "a.b", type: "boolean" }),
            defineFlag({ default: true, key: "a.b", type: "boolean" }),
          ],
        }),
      /registered twice/
    );
  });
});

describe("all", () => {
  it("resolves every registered flag in one pass", async () => {
    const { source: db } = source({
      "billing.new-checkout": { enabled: true },
      "kill.payments": { enabled: false },
    });

    assert.deepEqual(await registry.create(ENV, db).all(), {
      "billing.new-checkout": true,
      "kill.payments": false,
      "ui.redesign": false,
    });
  });
});
