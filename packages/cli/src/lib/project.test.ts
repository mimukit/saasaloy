import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findProjectRoot } from "./project.js";

// Commands work from any subdirectory, like git. What matters is that the walk stops at
// `saasaloy.json` and at nothing else — a monorepo has a `package.json` in every package,
// so taking that as a marker would stop at the nearest one instead of the project root.

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "saasaloy-root-"));
  await mkdir(join(dir, "project", "apps", "web", "src"), { recursive: true });
  await writeFile(
    join(dir, "project", "saasaloy.json"),
    JSON.stringify({ aliases: {}, installed: [] }),
    "utf-8"
  );
  await writeFile(
    join(dir, "project", "apps", "web", "package.json"),
    "{}",
    "utf-8"
  );
  await mkdir(join(dir, "loose"), { recursive: true });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("findProjectRoot — walking up to the marker", () => {
  it("returns the directory that holds saasaloy.json", async () => {
    await expect(findProjectRoot(join(dir, "project"))).resolves.toBe(
      join(dir, "project")
    );
  });

  it("walks up from a nested subdirectory", async () => {
    await expect(
      findProjectRoot(join(dir, "project", "apps", "web", "src"))
    ).resolves.toBe(join(dir, "project"));
  });

  it("walks past a package.json rather than stopping at it", async () => {
    await expect(
      findProjectRoot(join(dir, "project", "apps", "web"))
    ).resolves.toBe(join(dir, "project"));
  });

  it("falls back to the starting directory when there is no marker above it", async () => {
    await expect(findProjectRoot(join(dir, "loose"))).resolves.toBe(
      join(dir, "loose")
    );
  });
});
