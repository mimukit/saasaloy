import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isRefusal } from "./exit.js";
import { LocalRegistrySource, parseCoordinate } from "./registry.js";

describe(parseCoordinate, () => {
  it("reads a bare name as a module against the default repo", () => {
    expect(parseCoordinate("waitlist")).toStrictEqual({ module: "waitlist" });
  });

  it("reads owner/repo/module", () => {
    expect(parseCoordinate("acme/mods/billing")).toStrictEqual({
      module: "billing",
      owner: "acme",
      ref: undefined,
      repo: "mods",
    });
  });

  it("reads a pinned ref on owner/repo@ref/module", () => {
    expect(parseCoordinate("acme/mods@v2/billing")).toStrictEqual({
      module: "billing",
      owner: "acme",
      ref: "v2",
      repo: "mods",
    });
  });

  it("reads owner/repo with no module as a picker coordinate", () => {
    expect(parseCoordinate("acme/mods")).toStrictEqual({
      owner: "acme",
      ref: undefined,
      repo: "mods",
    });
  });

  it("reads owner/repo@ref with no module", () => {
    expect(parseCoordinate("acme/mods@main")).toStrictEqual({
      owner: "acme",
      ref: "main",
      repo: "mods",
    });
  });

  it("treats no input as a picker over the default repo", () => {
    expect(parseCoordinate()).toStrictEqual({});
  });

  it("rejects an empty ref", () => {
    expect(() => parseCoordinate("acme/mods@/billing")).toThrow(/empty ref/);
  });

  it("rejects too many path segments", () => {
    expect(() => parseCoordinate("a/b/c/d")).toThrow(/Malformed coordinate/);
  });

  it("rejects pinning a ref on the default repo (a ref needs an explicit owner/repo)", () => {
    // Documents the v1 limitation: `waitlist@v2` has no owner/repo to carry the ref.
    expect(() => parseCoordinate("waitlist@v2")).toThrow(
      /Malformed coordinate/
    );
  });
});

describe(LocalRegistrySource, () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "saasaloy-localreg-"));
    await mkdir(join(dir, "hello", "files"), { recursive: true });
    await writeFile(
      join(dir, "hello", "registry-item.json"),
      JSON.stringify({ name: "hello", type: "saasaloy:capability" })
    );
    // A stray directory with no descriptor must not be listed as a module.
    await mkdir(join(dir, "not-a-module"), { recursive: true });
  });

  afterAll(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("reads a module descriptor by name with the folder as its dir", async () => {
    const source = new LocalRegistrySource(dir);
    const loaded = await source.readModule("hello");
    expect(loaded.item.name).toBe("hello");
    expect(loaded.dir).toBe(join(dir, "hello"));
  });

  it("lists only directories that carry a registry-item.json", async () => {
    const source = new LocalRegistrySource(dir);
    await expect(source.listModules()).resolves.toStrictEqual(["hello"]);
  });

  it("reports a local provenance (no commit SHA)", () => {
    const source = new LocalRegistrySource(dir);
    expect(source.provenance()).toStrictEqual({
      ref: "local",
      resolved: "local",
      source: "local",
    });
  });

  // `update` asks every source for a SHA and for intent; a working copy has neither,
  // which is what stamps its merge plan "no merge base — local install" (issue #48).
  it("resolves to the `local` sentinel instead of a commit SHA", async () => {
    const source = new LocalRegistrySource(dir);
    await expect(source.resolveSha()).resolves.toBe("local");
  });

  it("has no commit subjects to report", async () => {
    const source = new LocalRegistrySource(dir);
    await expect(
      source.commitSubjects("modules/hello", "local", "local")
    ).resolves.toStrictEqual([]);
  });

  it("errors clearly on an unknown module", async () => {
    const source = new LocalRegistrySource(dir);
    await expect(source.readModule("missing", "hello-widget")).rejects.toThrow(
      /Unknown module "missing" \(required by hello-widget\)/
    );
  });

  // A truncated descriptor used to escape as a bare SyntaxError, which named no module
  // and exited 1 — a code that tells a wrapper script to retry a file that cannot heal.
  it("refuses a descriptor that is not valid JSON, naming the module", async () => {
    // Its own directory, so the listModules expectation above stays a one-module registry.
    const broken = await mkdtemp(join(tmpdir(), "saasaloy-badjson-"));
    await mkdir(join(broken, "torn"), { recursive: true });
    await writeFile(join(broken, "torn", "registry-item.json"), '{"name": ');
    const source = new LocalRegistrySource(broken);
    let thrown: unknown;
    try {
      await source.readModule("torn");
    } catch (error) {
      thrown = error;
    }
    expect(isRefusal(thrown)).toBeTruthy();
    expect((thrown as Error).message).toMatch(
      /Module "torn" has an unreadable descriptor/
    );
    expect((thrown as Error).cause).toBeInstanceOf(SyntaxError);
    await rm(broken, { force: true, recursive: true });
  });

  it("errors when the registry directory does not exist", async () => {
    const source = new LocalRegistrySource(join(dir, "nope"));
    await expect(source.readModule("hello")).rejects.toThrow(/does not exist/);
  });
});
