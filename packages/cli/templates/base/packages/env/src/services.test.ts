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
  name: "ops",
  file: "ops/.env",
  environment: "prod",
  omit: ["DATABASE_URL"],
});

// A module appends its own row (`saasaloy add admin` adds `admin`), so these tests never
// pin the whole table. They check the rows the base seeds and the two added above, and
// derive anything else from the table itself.
describe("the service table", () => {
  it("seeds web and deploy, and takes the rows a const-array patch appends", () => {
    const names = serviceNames();
    for (const name of ["web", "deploy", "api", "ops"]) {
      assert.ok(names.includes(name), `${name} is in the table`);
    }
    assert.equal(
      new Set(names).size,
      names.length,
      "no service is listed twice"
    );
    assert.equal(findService("web")?.file, "apps/web/.env");
    assert.equal(findService("ops")?.file, "ops/.env");
    assert.equal(findService("deploy")?.file, undefined);
    assert.equal(findService("nope"), undefined);
  });
});

describe("selectServices", () => {
  it("writes every dev service when nothing is named", () => {
    const selected = selectServices("dev").map((service) => service.name);
    const expected = SERVICES.filter(
      (service) => service.environment === "dev" && service.file !== undefined
    ).map((service) => service.name);
    assert.deepEqual(selected.toSorted(), expected.toSorted());
    assert.ok(selected.includes("web"));
    assert.ok(selected.includes("api"));
    assert.ok(
      !selected.includes("ops"),
      "a prod service is never a dev default"
    );
    assert.ok(
      !selected.includes("deploy"),
      "a row with no file is never written"
    );
  });

  it("refuses --env prod without --only", () => {
    assert.throws(() => selectServices("prod"), /writes one file only/);
  });

  it("writes the one prod service --only names", () => {
    assert.deepEqual(
      selectServices("prod", "ops").map((service) => service.name),
      ["ops"]
    );
  });

  it("refuses a service with no file to write", () => {
    assert.throws(() => selectServices("prod", "deploy"), /no \.env file/);
  });

  it("refuses a service that does not belong to the environment", () => {
    assert.throws(() => selectServices("prod", "web"), /is not a prod service/);
    assert.throws(() => selectServices("dev", "nope"), /is not a dev service/);
  });
});
