import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { catalogRows, moduleTier } from "./module-catalog.ts";
import type { RegistryDescriptor } from "./module-catalog.ts";

const providersPatch = { kind: "plugin-array", arrayProp: "providers" };

function descriptor(fields: Partial<RegistryDescriptor>): RegistryDescriptor {
  return { name: "x", type: "saasaloy:feature", ...fields };
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
  it("orders rows by tier, then by name", () => {
    const rows = catalogRows([
      descriptor({ name: "b-driver", conflictsWith: ["a"] }),
      descriptor({ name: "z-cap", type: "saasaloy:capability" }),
      descriptor({ name: "a-provider", patches: [providersPatch] }),
      descriptor({ name: "a-cap", type: "saasaloy:capability" }),
      descriptor({ name: "a-feature" }),
    ]);
    assert.deepEqual(
      rows.map((row) => row.name),
      ["a-cap", "z-cap", "a-feature", "a-provider", "b-driver"]
    );
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
      .filter((row) => row.tier === tier)
      .map((row) => row.name)
      .toSorted();

  it("gives one row per registry-item.json", () => {
    assert.equal(rows.length, descriptors.length);
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
