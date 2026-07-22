import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalRegistrySource, parseCoordinate } from "./registry.js";

describe("parseCoordinate", () => {
  it("reads a bare name as a module against the default repo", () => {
    expect(parseCoordinate("waitlist")).toEqual({ module: "waitlist" });
  });

  it("reads owner/repo/module", () => {
    expect(parseCoordinate("acme/mods/billing")).toEqual({
      owner: "acme",
      repo: "mods",
      ref: undefined,
      module: "billing",
    });
  });

  it("reads a pinned ref on owner/repo@ref/module", () => {
    expect(parseCoordinate("acme/mods@v2/billing")).toEqual({
      owner: "acme",
      repo: "mods",
      ref: "v2",
      module: "billing",
    });
  });

  it("reads owner/repo with no module as a picker coordinate", () => {
    expect(parseCoordinate("acme/mods")).toEqual({ owner: "acme", repo: "mods", ref: undefined });
  });

  it("reads owner/repo@ref with no module", () => {
    expect(parseCoordinate("acme/mods@main")).toEqual({ owner: "acme", repo: "mods", ref: "main" });
  });

  it("treats no input as a picker over the default repo", () => {
    expect(parseCoordinate()).toEqual({});
  });

  it("rejects an empty ref", () => {
    expect(() => parseCoordinate("acme/mods@/billing")).toThrow(/empty ref/);
  });

  it("rejects too many path segments", () => {
    expect(() => parseCoordinate("a/b/c/d")).toThrow(/Malformed coordinate/);
  });

  it("rejects pinning a ref on the default repo (a ref needs an explicit owner/repo)", () => {
    // Documents the v1 limitation: `waitlist@v2` has no owner/repo to carry the ref.
    expect(() => parseCoordinate("waitlist@v2")).toThrow(/Malformed coordinate/);
  });
});

describe("LocalRegistrySource", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "saasaloy-localreg-"));
    await mkdir(join(dir, "hello", "files"), { recursive: true });
    await writeFile(
      join(dir, "hello", "registry-item.json"),
      JSON.stringify({ name: "hello", type: "saasaloy:capability" }),
    );
    // A stray directory with no descriptor must not be listed as a module.
    await mkdir(join(dir, "not-a-module"), { recursive: true });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a module descriptor by name with the folder as its dir", async () => {
    const source = new LocalRegistrySource(dir);
    const loaded = await source.readModule("hello");
    expect(loaded.item.name).toBe("hello");
    expect(loaded.dir).toBe(join(dir, "hello"));
  });

  it("lists only directories that carry a registry-item.json", async () => {
    const source = new LocalRegistrySource(dir);
    expect(await source.listModules()).toEqual(["hello"]);
  });

  it("reports a local provenance (no commit SHA)", () => {
    const source = new LocalRegistrySource(dir);
    expect(source.provenance()).toEqual({ source: "local", ref: "local", resolved: "local" });
  });

  it("errors clearly on an unknown module", async () => {
    const source = new LocalRegistrySource(dir);
    await expect(source.readModule("missing", "hello-widget")).rejects.toThrow(
      /Unknown module "missing" \(required by hello-widget\)/,
    );
  });

  it("errors when the registry directory does not exist", async () => {
    const source = new LocalRegistrySource(join(dir, "nope"));
    await expect(source.readModule("hello")).rejects.toThrow(/does not exist/);
  });
});
