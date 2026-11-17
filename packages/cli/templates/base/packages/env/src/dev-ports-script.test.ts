import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

// `pnpm dev:ports` in a project with no git repository (`saasaloy init --no-git`). The
// script runs from a copy of this package inside a temporary project, so it writes
// nothing in this checkout, and GIT_CEILING_DIRECTORIES keeps git from finding any
// repository above it.

describe("scripts/dev-ports.ts with no git repository", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dev-ports-nogit-"));
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const pkg = path.join(import.meta.dirname, "..");
  for (const folder of ["scripts", "src"]) {
    cpSync(path.join(pkg, folder), path.join(dir, "packages/env", folder), {
      recursive: true,
    });
  }
  writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "packages: []\n");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CEILING_DIRECTORIES: path.dirname(dir),
  };
  delete env.DEV_PORTS_BLOCK;
  const result = spawnSync(
    process.execPath,
    [path.join(dir, "packages/env/scripts/dev-ports.ts")],
    { cwd: dir, encoding: "utf-8", env }
  );

  it("takes the pinned ports, as a main checkout does", () => {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Main checkout: the pinned ports\./);
  });

  it("prints nothing from git on stderr", () => {
    assert.equal(result.stderr, "");
  });
});
