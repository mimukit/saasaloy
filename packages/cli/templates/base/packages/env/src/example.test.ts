import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exampleKeys, selectExample } from "./example.ts";
import { SERVICES } from "./services.ts";
import type { Service } from "./services.ts";

// `selectExample` reads the service names out of the live `SERVICES` array, which the base
// seeds with `web` alone. These tests add the rows `saasaloy add api` and `add infra`
// append, so the section rules are exercised against more than one service.
function addService(service: Service): void {
  if (!SERVICES.some((row) => row.name === service.name)) {
    SERVICES.push(service);
  }
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
  omit: [],
});

const EXAMPLE = [
  "# banner",
  "# @services api web",
  "",
  "# what SHARED is",
  "SHARED=both",
  "",
  "# @services api",
  "# what SECRET is",
  "SECRET=",
];

describe("selectExample", () => {
  it("gives a service the keys its sections name, comments included", () => {
    assert.deepEqual(selectExample(EXAMPLE, "web"), [
      "# what SHARED is",
      "SHARED=both",
    ]);
  });

  it("gives a service every section that names it", () => {
    assert.deepEqual(selectExample(EXAMPLE, "api"), [
      "# what SHARED is",
      "SHARED=both",
      "",
      "# what SECRET is",
      "SECRET=",
    ]);
  });

  it("gives a service named by no section nothing", () => {
    assert.deepEqual(selectExample(EXAMPLE, "infra"), []);
  });

  it("refuses a key with no section above it", () => {
    assert.throws(() => selectExample(["A=1"], "web"), /no "# @services" line/);
  });

  it("refuses a section naming something that is not a service", () => {
    assert.throws(
      () => selectExample(["# @services nope", "A=1"], "web"),
      /which is not a service/
    );
  });

  it("refuses a section naming nothing", () => {
    assert.throws(
      () => selectExample(["# @services", "A=1"], "web"),
      /naming no service/
    );
  });
});

describe("exampleKeys", () => {
  it("lists every key whichever service takes it", () => {
    assert.deepEqual(exampleKeys(EXAMPLE), ["SHARED", "SECRET"]);
  });
});
