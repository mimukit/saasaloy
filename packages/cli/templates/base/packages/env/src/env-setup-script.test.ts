import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

// `pnpm env:setup --example`, the CI-only mode `pnpm ci:prepare:env` runs. The script runs
// from a copy of this package inside a temporary project, so it writes nothing in this
// checkout.

function makeProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "env-setup-example-"));
  const pkg = path.join(import.meta.dirname, "..");
  for (const folder of ["scripts", "src"]) {
    cpSync(path.join(pkg, folder), path.join(dir, "packages/env", folder), {
      recursive: true,
    });
  }
  writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "packages: []\n");
  writeFileSync(
    path.join(dir, "packages/env/.env.example"),
    [
      "# @services web",
      "PUBLIC_SITE_URL=http://localhost:3000",
      "",
      "# no default",
      "PUBLIC_SECRET_THING=",
      "",
    ].join("\n")
  );
  return dir;
}

function run(dir: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [path.join(dir, "packages/env/scripts/env-setup.ts"), ...args],
    { cwd: dir, encoding: "utf-8" }
  );
}

describe("scripts/env-setup.ts --example", () => {
  const dirs: string[] = [];
  after(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes each service's .env from the example and refuses a blank key nowhere", () => {
    const dir = makeProject();
    dirs.push(dir);
    const result = run(dir, ["--example"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Created apps\/web\/\.env from the example/);
    const written = readFileSync(path.join(dir, "apps/web/.env"), "utf-8");
    assert.match(written, /^PUBLIC_SITE_URL=http:\/\/localhost:3000$/m);
    assert.match(written, /^PUBLIC_SECRET_THING=$/m);
    // No dev:ports run, so no `.env.local`.
    assert.equal(existsSync(path.join(dir, "apps/web/.env.local")), false);
  });

  it("refuses --env prod", () => {
    const dir = makeProject();
    dirs.push(dir);
    const result = run(dir, ["--example", "--env", "prod", "--only", "web"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--example .* does not take --env prod/);
  });
});
