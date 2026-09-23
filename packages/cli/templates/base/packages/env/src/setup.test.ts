import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { readEnvFile } from "./env-file.ts";
import { SERVICES } from "./services.ts";
import type { Service } from "./services.ts";
import { setupServices } from "./setup.ts";
import { EnvError } from "./sources.ts";
import type { EnvSource } from "./sources.ts";

// Every write lands in a temp directory, and the value source is a fake. Nothing here
// opens a connection or touches a file outside `roots`.

/** Idempotent, because `saasaloy add api` appends the same row with a `const-array` patch. */
function addService(service: Service): Service {
  const existing = SERVICES.find((row) => row.name === service.name);
  if (existing) {
    return existing;
  }
  SERVICES.push(service);
  return service;
}

const api = addService({
  name: "api",
  file: "apps/api/.env",
  environment: "dev",
  omit: [],
});
const infra = addService({
  name: "infra",
  file: "infra/.env",
  environment: "prod",
  omit: ["DATABASE_URL"],
});

const roots: string[] = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const EXAMPLE = [
  "# @services api",
  "",
  "# what A is",
  "A=local",
  "",
  "# Blank on purpose",
  "B=",
  "",
  "# the branch database",
  "DATABASE_URL=",
  "",
].join("\n");

function makeRoot(example = EXAMPLE): string {
  const root = mkdtempSync(path.join(tmpdir(), "env-setup-"));
  roots.push(root);
  mkdirSync(path.join(root, "packages/env"), { recursive: true });
  writeFileSync(path.join(root, "packages/env/.env.example"), example);
  return root;
}

function fakeSource(values: Record<string, string>): EnvSource {
  return {
    name: "fake",
    load: async () => await Promise.resolve(new Map(Object.entries(values))),
  };
}

function unreachable(): EnvSource {
  return {
    name: "fake",
    load: async () => {
      await Promise.resolve();
      throw new EnvError("The value source did not answer.", {
        code: "unreachable",
      });
    },
  };
}

const processEnv: Record<string, string | undefined> = {};

describe("setupServices", () => {
  it("writes a service's file from the example and the source", async () => {
    const root = makeRoot();
    const report = await setupServices({
      root,
      environment: "dev",
      services: [api],
      source: fakeSource({ A: "from-source", DATABASE_URL: "postgres://x" }),
      processEnv,
    });
    assert.equal(report.kind, "written");
    assert.deepEqual(
      report.services.map((service) => ({
        file: service.file,
        created: service.created,
      })),
      [{ file: "apps/api/.env", created: true }]
    );
    const written = readFileSync(path.join(root, "apps/api/.env"), "utf-8");
    assert.match(written, /# what A is\nA=from-source/);
    assert.match(written, /B=\n/);
  });

  it("keeps a checkout-owned key this checkout already set", async () => {
    const root = makeRoot();
    mkdirSync(path.join(root, "apps/api"), { recursive: true });
    writeFileSync(
      path.join(root, "apps/api/.env"),
      "A=old\nB=\nDATABASE_URL=postgres://branch\n"
    );
    await setupServices({
      root,
      environment: "dev",
      services: [api],
      source: fakeSource({
        A: "from-source",
        DATABASE_URL: "postgres://shared",
      }),
      processEnv,
    });
    const { values } = readEnvFile(path.join(root, "apps/api/.env"));
    assert.equal(values.get("DATABASE_URL"), "postgres://branch");
    assert.equal(values.get("A"), "from-source");
  });

  it("carries a leftover .dev.vars across and deletes it", async () => {
    const root = makeRoot();
    mkdirSync(path.join(root, "apps/api"), { recursive: true });
    writeFileSync(
      path.join(root, "apps/api/.dev.vars"),
      "A=typed-by-hand\nDATABASE_URL=postgres://branch\n"
    );
    const report = await setupServices({
      root,
      environment: "dev",
      services: [api],
      source: fakeSource({ DATABASE_URL: "postgres://shared" }),
      processEnv,
    });
    assert.equal(
      report.kind === "written" && report.services[0]?.migrated,
      true
    );
    assert.equal(existsSync(path.join(root, "apps/api/.dev.vars")), false);
    const { values } = readEnvFile(path.join(root, "apps/api/.env"));
    assert.equal(values.get("A"), "typed-by-hand");
    assert.equal(values.get("DATABASE_URL"), "postgres://branch");
  });

  it("names every key with no value and writes nothing", async () => {
    const root = makeRoot();
    await assert.rejects(
      setupServices({
        root,
        environment: "dev",
        services: [api],
        source: fakeSource({}),
        processEnv,
      }),
      /has no value for A, DATABASE_URL/
    );
    assert.equal(existsSync(path.join(root, "apps/api/.env")), false);
  });

  it("refuses to write production values under apps/", async () => {
    const root = makeRoot();
    await assert.rejects(
      setupServices({
        root,
        environment: "prod",
        services: [api],
        source: fakeSource({ A: "x", DATABASE_URL: "y" }),
        processEnv,
      }),
      /Refusing to write production values/
    );
  });

  it("omits a key the service must never carry", async () => {
    const root = makeRoot("# @services infra\nA=local\nDATABASE_URL=\n");
    await setupServices({
      root,
      environment: "prod",
      services: [infra],
      source: fakeSource({ A: "x", DATABASE_URL: "secret" }),
      processEnv,
    });
    const { values } = readEnvFile(path.join(root, "infra/.env"));
    assert.equal(values.get("DATABASE_URL"), "");
  });

  it("keeps a complete file when the source does not answer", async () => {
    const root = makeRoot();
    mkdirSync(path.join(root, "apps/api"), { recursive: true });
    writeFileSync(
      path.join(root, "apps/api/.env"),
      "A=kept\nB=\nDATABASE_URL=postgres://branch\n"
    );
    const report = await setupServices({
      root,
      environment: "dev",
      services: [api],
      source: unreachable(),
      processEnv,
    });
    assert.equal(report.kind, "kept");
    assert.equal(
      readEnvFile(path.join(root, "apps/api/.env")).values.get("A"),
      "kept"
    );
  });

  it("fails when the source does not answer and a file is incomplete", async () => {
    const root = makeRoot();
    await assert.rejects(
      setupServices({
        root,
        environment: "dev",
        services: [api],
        source: unreachable(),
        processEnv,
      }),
      /nothing safe to keep/
    );
  });
});
