import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { catalogCounts, catalogRows, moduleTier } from "./module-catalog.ts";
import type { RegistryDescriptor } from "./module-catalog.ts";

const providersPatch = { kind: "plugin-array", arrayProp: "providers" };

function descriptor(fields: Partial<RegistryDescriptor>): RegistryDescriptor {
  return { name: "x", type: "saasaloy:feature", stage: "mvp", ...fields };
}

describe("moduleTier", () => {
  it("reads a module with conflictsWith as a driver", () => {
    assert.equal(
      moduleTier(descriptor({ conflictsWith: ["database-postgres"] })),
      "driver"
    );
  });

  it("reads a module that registers into a providers array as a provider", () => {
    assert.equal(
      moduleTier(descriptor({ patches: [providersPatch] })),
      "provider"
    );
  });

  it("does not read a plugin-array patch into another array as a provider", () => {
    assert.equal(
      moduleTier(
        descriptor({
          patches: [{ kind: "plugin-array", arrayProp: "plugins" }],
        })
      ),
      "feature"
    );
  });

  it("reads a plain saasaloy:capability as a capability", () => {
    assert.equal(
      moduleTier(descriptor({ type: "saasaloy:capability" })),
      "capability"
    );
  });

  it("reads a plain saasaloy:feature as a feature", () => {
    assert.equal(
      moduleTier(descriptor({ type: "saasaloy:feature" })),
      "feature"
    );
  });

  it("reads a module that is both a driver and a provider as a driver", () => {
    assert.equal(
      moduleTier(
        descriptor({ conflictsWith: ["other"], patches: [providersPatch] })
      ),
      "driver"
    );
  });

  it("throws on a type it does not know", () => {
    assert.throws(() => moduleTier(descriptor({ type: "saasaloy:other" })));
  });
});

describe("catalogRows", () => {
  it("orders tiles by stage, then capabilities first, then by name", () => {
    const rows = catalogRows([
      descriptor({ name: "z-feature", stage: "validate" }),
      descriptor({ name: "b-cap", type: "saasaloy:capability" }),
      descriptor({ name: "a-feature" }),
      descriptor({
        name: "y-cap",
        type: "saasaloy:capability",
        stage: "validate",
      }),
      descriptor({ name: "c-scale", stage: "scale" }),
    ]);
    assert.deepEqual(
      rows.map((row) => row.name),
      ["y-cap", "z-feature", "b-cap", "a-feature", "c-scale"]
    );
  });

  it("puts each provider and driver on its parent's tile, by name", () => {
    const rows = catalogRows([
      descriptor({ name: "email", type: "saasaloy:capability" }),
      descriptor({
        name: "email-plunk",
        dependsOn: ["email"],
        patches: [providersPatch],
      }),
      descriptor({
        name: "email-console",
        dependsOn: ["email"],
        patches: [providersPatch],
      }),
      descriptor({ name: "keys" }),
      descriptor({
        name: "keys-user",
        dependsOn: ["auth", "keys"],
        conflictsWith: ["keys-org"],
      }),
    ]);
    assert.deepEqual(rows, [
      {
        name: "email",
        description: "",
        tier: "capability",
        stage: "mvp",
        variants: [
          { name: "email-console", label: "console", tier: "provider" },
          { name: "email-plunk", label: "plunk", tier: "provider" },
        ],
      },
      {
        name: "keys",
        description: "",
        tier: "feature",
        stage: "mvp",
        variants: [{ name: "keys-user", label: "user", tier: "driver" }],
      },
    ]);
  });

  it("picks the longest dependsOn prefix as the parent", () => {
    const rows = catalogRows([
      descriptor({ name: "api" }),
      descriptor({ name: "api-keys" }),
      descriptor({
        name: "api-keys-user",
        dependsOn: ["api", "api-keys"],
        conflictsWith: ["api-keys-org"],
      }),
    ]);
    assert.equal(
      rows.find((row) => row.name === "api-keys")?.variants.length,
      1
    );
  });

  it("throws on a provider whose name matches no dependsOn entry", () => {
    assert.throws(() =>
      catalogRows([
        descriptor({ name: "email" }),
        descriptor({
          name: "mail-plunk",
          dependsOn: ["email"],
          patches: [providersPatch],
        }),
      ])
    );
  });

  it("throws on a provider whose parent is not in the registry", () => {
    assert.throws(() =>
      catalogRows([
        descriptor({
          name: "email-plunk",
          dependsOn: ["email"],
          patches: [providersPatch],
        }),
      ])
    );
  });

  it("throws on a stage it does not know", () => {
    assert.throws(() => catalogRows([descriptor({ stage: "later" })]));
  });
});

describe("catalogCounts", () => {
  it("counts the tiles and their variants by tier", () => {
    const rows = catalogRows([
      descriptor({ name: "email", type: "saasaloy:capability" }),
      descriptor({
        name: "email-plunk",
        dependsOn: ["email"],
        patches: [providersPatch],
      }),
      descriptor({ name: "teams" }),
    ]);
    assert.deepEqual(catalogCounts(rows), {
      capability: 1,
      feature: 1,
      provider: 1,
      driver: 0,
    });
  });
});

// The README's Modules table lists the providers and drivers by hand. The registry must
// produce the same two sets, or the page and the README disagree.
describe("the real registry", () => {
  const modulesDir = join(import.meta.dirname, "../../../../modules");
  const descriptors = readdirSync(modulesDir)
    .map((name) => join(modulesDir, name, "registry-item.json"))
    .filter((path) => existsSync(path))
    .map(
      (path) => JSON.parse(readFileSync(path, "utf-8")) as RegistryDescriptor
    );
  const rows = catalogRows(descriptors);
  const namesOf = (tier: string) =>
    rows
      .flatMap((row) => [row, ...row.variants])
      .filter((module) => module.tier === tier)
      .map((module) => module.name)
      .toSorted();

  it("shows every registry-item.json once, as a tile or a chip", () => {
    const counts = catalogCounts(rows);
    assert.equal(
      Object.values(counts).reduce((sum, n) => sum + n, 0),
      descriptors.length
    );
  });

  it("gives the README's 17 providers and 4 drivers", () => {
    assert.deepEqual(namesOf("provider"), [
      "billing-console",
      "billing-stripe",
      "email-cloudflare",
      "email-console",
      "email-plunk",
      "kv-cloudflare",
      "kv-memory",
      "kv-upstash",
      "logger-console",
      "payment-console",
      "payment-manual",
      "queue-cloudflare",
      "queue-memory",
      "sms-console",
      "sms-khudebarta",
      "storage-cloudflare",
      "storage-memory",
    ]);
    assert.deepEqual(namesOf("driver"), [
      "api-keys-organization",
      "api-keys-user",
      "database-d1",
      "database-postgres",
    ]);
  });
});
