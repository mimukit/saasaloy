import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { SERVICES } from "./services.ts";
import { defineSources, EnvError, local } from "./sources.ts";
import type { EnvSource } from "./sources.ts";

// The base seeds `web` alone; `saasaloy add api` appends this row with a `const-array`
// patch. Adding it here lets a `# @services api` section resolve.
if (!SERVICES.some((row) => row.name === "api")) {
  SERVICES.push({
    name: "api",
    file: "apps/api/.env",
    environment: "dev",
    omit: [],
  });
}

const roots: string[] = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const EXAMPLE = "# @services api\nA=\nB=\n";

function makeRoot(contents?: string, example = EXAMPLE): string {
  const root = mkdtempSync(path.join(tmpdir(), "env-source-"));
  roots.push(root);
  mkdirSync(path.join(root, "packages/env"), { recursive: true });
  writeFileSync(path.join(root, "packages/env/.env.example"), example);
  if (contents !== undefined) {
    writeFileSync(path.join(root, "packages/env/.env"), contents);
  }
  return root;
}

const service = {
  name: "api",
  file: "apps/api/.env",
  environment: "dev" as const,
  omit: [],
};

const request = (root: string) => ({
  root,
  service,
  environment: "dev" as const,
  processEnv: {},
});

describe("the local source", () => {
  it("reads the gitignored packages/env/.env", async () => {
    const values = await local.load(request(makeRoot("A=one\n# c\nB=two\n")));
    assert.deepEqual(
      [...values],
      [
        ["A", "one"],
        ["B", "two"],
      ]
    );
  });

  it("answers with the keys the example lists for this service, and no others", async () => {
    const root = makeRoot(
      "A=one\nB=two\nSECRET=shh\n",
      "# @services api\nA=\n\n# @services web\nSECRET=\n"
    );

    assert.deepEqual([...(await local.load(request(root)))], [["A", "one"]]);
  });

  it("says the project is not set up when the file is missing", async () => {
    await assert.rejects(local.load(request(makeRoot())), (error: unknown) => {
      assert.ok(error instanceof EnvError);
      assert.equal(error.code, "not_configured");
      assert.equal(error.retryable, false);
      return true;
    });
  });
});

describe("defineSources", () => {
  const other: EnvSource = {
    name: "infisical",
    load: async () => await Promise.resolve(new Map()),
  };

  it("selects local when ENV_SOURCE is unset", () => {
    assert.equal(defineSources({ sources: [] }).select(), local);
  });

  it("selects a registered source by name", () => {
    assert.equal(
      defineSources({ sources: [other] }).select("infisical"),
      other
    );
  });

  it("refuses a source that is not installed, naming the ones that are", () => {
    assert.throws(
      () => defineSources({ sources: [other] }).select("doppler"),
      /Installed: local, infisical/
    );
  });
});

describe("EnvError", () => {
  it("calls an unreachable source retryable and a refusal not", () => {
    assert.equal(new EnvError("x", { code: "unreachable" }).retryable, true);
    assert.equal(new EnvError("x", { code: "denied" }).retryable, false);
  });

  it("keeps the vendor's own code", () => {
    const error = new EnvError("x", { code: "denied", providerCode: "403" });
    assert.equal(error.providerCode, "403");
  });
});
