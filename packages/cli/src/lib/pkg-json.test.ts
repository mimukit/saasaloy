import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PackageJson, parseDep, planDeps, writeDeps } from "./pkg-json.js";

// The applier merges a module's descriptor deps into the consumer's package.json.
// Descriptors now ship exact `name@version` pins (schema-enforced), split across a
// runtime `dependencies` and a dev `devDependencies` bucket — planDeps routes each to
// the right bucket, dedups across both (dependencies wins), and writeDeps persists them.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-pkgjson-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writePkg(pkg: PackageJson): Promise<void> {
  await writeFile(join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

async function readPkg(): Promise<PackageJson> {
  return JSON.parse(await readFile(join(root, "package.json"), "utf8")) as PackageJson;
}

describe("parseDep", () => {
  it("splits an exact pin, keeping a scoped name intact", () => {
    expect(parseDep("zod@4.0.5")).toEqual({ name: "zod", version: "4.0.5" });
    expect(parseDep("@types/node@26.1.1")).toEqual({ name: "@types/node", version: "26.1.1" });
  });
});

describe("planDeps + writeDeps — dependencies bucket", () => {
  it("writes an exact name@version verbatim into dependencies", async () => {
    const pkg: PackageJson = { name: "app", dependencies: {} };
    const { added } = planDeps(pkg, ["zod@4.0.5"]);
    expect(added).toEqual([{ name: "zod", version: "4.0.5" }]);
    await writePkg(pkg);
    await writeDeps(root, pkg, added);
    const written = await readPkg();
    expect(written.dependencies).toEqual({ zod: "4.0.5" });
  });

  it("skips a dep already present in package.json", async () => {
    const pkg: PackageJson = { name: "app", dependencies: { zod: "4.0.5" } };
    const { added, skipped } = planDeps(pkg, ["zod@4.0.5"]);
    expect(added).toEqual([]);
    expect(skipped).toEqual(["zod"]);
  });
});

describe("planDeps + writeDeps — devDependencies bucket", () => {
  it("routes devDependencies into the devDependencies bucket", async () => {
    const pkg: PackageJson = { name: "app" };
    const { added, devAdded } = planDeps(pkg, ["zod@4.0.5"], ["@types/node@26.1.1"]);
    expect(added).toEqual([{ name: "zod", version: "4.0.5" }]);
    expect(devAdded).toEqual([{ name: "@types/node", version: "26.1.1" }]);
    await writePkg(pkg);
    await writeDeps(root, pkg, added, devAdded);
    const written = await readPkg();
    expect(written.dependencies).toEqual({ zod: "4.0.5" });
    expect(written.devDependencies).toEqual({ "@types/node": "26.1.1" });
  });

  it("keeps a name in both buckets in dependencies only (dependencies wins)", () => {
    const pkg: PackageJson = { name: "app" };
    const { added, devAdded } = planDeps(pkg, ["zod@4.0.5"], ["zod@4.0.5"]);
    expect(added).toEqual([{ name: "zod", version: "4.0.5" }]);
    expect(devAdded).toEqual([]);
  });

  it("skips a devDependency already present in package.json devDependencies", () => {
    const pkg: PackageJson = { name: "app", devDependencies: { "@types/node": "26.1.1" } };
    const { devAdded, skipped } = planDeps(pkg, [], ["@types/node@26.1.1"]);
    expect(devAdded).toEqual([]);
    expect(skipped).toEqual(["@types/node"]);
  });
});
