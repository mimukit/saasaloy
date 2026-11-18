import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { projectRoot } from "./project-root.ts";

const roots: string[] = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A folder with no git repository: `pnpm-workspace.yaml` at `project/`, and `outer/`. */
function tree(): { outer: string; project: string } {
  const outer = mkdtempSync(path.join(tmpdir(), "env-root-"));
  roots.push(outer);
  const project = path.join(outer, "project");
  mkdirSync(path.join(project, "packages", "env", "scripts"), {
    recursive: true,
  });
  writeFileSync(path.join(project, "pnpm-workspace.yaml"), "packages: []\n");
  return { outer, project };
}

describe("projectRoot", () => {
  it("finds the folder that holds pnpm-workspace.yaml, with no git repository", () => {
    const { project } = tree();

    assert.equal(
      projectRoot(path.join(project, "packages", "env", "scripts")),
      project
    );
  });

  it("stops at the nearest workspace, not an outer one", () => {
    const { outer, project } = tree();
    writeFileSync(path.join(outer, "pnpm-workspace.yaml"), "packages: []\n");

    assert.equal(projectRoot(path.join(project, "packages", "env")), project);
  });

  it("names the file it looked for when no folder holds it", () => {
    const { outer } = tree();

    assert.throws(
      () => projectRoot(outer),
      /No pnpm-workspace\.yaml in .* or any folder above it/
    );
  });
});
