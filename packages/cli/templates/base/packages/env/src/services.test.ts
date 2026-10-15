import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findService,
  selectServices,
  SERVICES,
  serviceNames,
} from "./services.ts";
import type { Service } from "./services.ts";

/**
 * Add a row the base does not seed, so the section and selection rules are exercised
 * against more than one service.
 *
 * Idempotent, because `saasaloy add api` appends the same row with a `const-array` patch.
 * In a project that installed it, this run finds the row already there.
 */
function addService(service: Service): Service {
  const existing = SERVICES.find((row) => row.name === service.name);
  if (existing) {
    return existing;
  }
  SERVICES.push(service);
  return service;
}

addService({
  name: "api",
  file: "apps/api/.env",
  environment: "dev",
  omit: [],
});
addService({
  name: "infra",
  file: "infra/.env",
  environment: "prod",
  omit: ["DATABASE_URL"],
});

describe("the service table", () => {
  it("seeds web and takes the rows a const-array patch appends", () => {
    assert.deepEqual(serviceNames().toSorted(), ["api", "infra", "web"]);
    assert.equal(findService("infra")?.file, "infra/.env");
    assert.equal(findService("nope"), undefined);
  });
});

describe("selectServices", () => {
  it("writes every dev service when nothing is named", () => {
    assert.deepEqual(
      selectServices("dev")
        .map((service) => service.name)
        .toSorted(),
      ["api", "web"]
    );
  });

  it("refuses --env prod without --only", () => {
    assert.throws(() => selectServices("prod"), /writes one file only/);
  });

  it("writes the one prod service --only names", () => {
    assert.deepEqual(
      selectServices("prod", "infra").map((service) => service.name),
      ["infra"]
    );
  });

  it("refuses a service that does not belong to the environment", () => {
    assert.throws(() => selectServices("prod", "web"), /is not a prod service/);
    assert.throws(() => selectServices("dev", "nope"), /is not a dev service/);
  });
});
