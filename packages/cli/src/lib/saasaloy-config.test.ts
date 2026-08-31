import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RefusalError } from "./exit.js";
import { loadConfig, migrateBase, saveConfig } from "./saasaloy-config.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-config-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

async function write(config: unknown): Promise<void> {
  await writeFile(
    join(root, "saasaloy.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}

// The base app used to sit in `installed[]`, which forced every engine to carry a branch
// for the one name in that list it could say nothing about (#98).
describe(migrateBase, () => {
  it("lifts a legacy `web` out of installed and into `base`", () => {
    const migrated = migrateBase({
      aliases: {},
      installed: ["web", "api", "auth"],
    });
    expect(migrated.base).toBe("web");
    expect(migrated.installed).toStrictEqual(["api", "auth"]);
  });

  it("leaves a config that already declares a base alone", () => {
    const config = { aliases: {}, base: "web", installed: ["api"] };
    expect(migrateBase(config)).toBe(config);
  });

  it("leaves a config with no legacy entry alone", () => {
    const config = { aliases: {}, installed: ["api"] };
    expect(migrateBase(config)).toBe(config);
  });
});

describe(loadConfig, () => {
  it("migrates on load, so the next save persists the corrected shape", async () => {
    await write({ aliases: { "@web": "apps/web/src" }, installed: ["web"] });
    const config = await loadConfig(root);
    expect(config).toStrictEqual({
      aliases: { "@web": "apps/web/src" },
      base: "web",
      installed: [],
    });
  });

  it("accepts the field the template now ships", async () => {
    await write({ aliases: {}, base: "web", installed: ["api"] });
    await expect(loadConfig(root)).resolves.toMatchObject({ base: "web" });
  });

  // An invalid state file is saasaloy declining to act, not saasaloy breaking, so the
  // command above it exits 2 rather than 1.
  it("refuses an invalid config with a RefusalError", async () => {
    await write({ aliases: {}, base: "Not A Module", installed: [] });
    await expect(loadConfig(root)).rejects.toBeInstanceOf(RefusalError);
  });

  it("refuses a missing config with a RefusalError", async () => {
    await expect(loadConfig(root)).rejects.toBeInstanceOf(RefusalError);
  });

  it("round-trips the base field through a save", async () => {
    await write({ aliases: {}, installed: ["web", "api"] });
    const config = await loadConfig(root);
    await saveConfig(root, config);
    await expect(loadConfig(root)).resolves.toStrictEqual(config);
  });
});
