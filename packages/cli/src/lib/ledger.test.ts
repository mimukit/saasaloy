import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistLedger } from "./ledger.js";
import { emptyLock } from "./lock.js";
import type { Lockfile } from "./lock.js";
import { emptyManifest } from "./manifest.js";
import type { Manifest } from "./manifest.js";

// #150. These are the failure-injection tests `persistState` carried in commands/add.test.ts,
// moved down to the function that now owns the rule for all three commands: the saves run in
// sequence, every save runs even after an earlier one fails, and nothing throws or prints.

const HASH = "a".repeat(64);

let root: string;

function input(): Parameters<typeof persistLedger>[0] {
  const manifest = emptyManifest();
  manifest.managed["apps/web/widget.ts"] = {
    from: "files/widget.ts",
    hash: HASH,
    module: "widget",
  };
  const lock = emptyLock();
  lock.modules.widget = {
    ref: "main",
    resolved: "c".repeat(40),
    source: "acme/kit",
  };
  return {
    config: { aliases: { "@web": "apps/web" }, installed: ["widget"] },
    lock,
    manifest,
    root,
  };
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(root, name), "utf-8")) as T;
}

/** The manifest's keys carry dots, which `toHaveProperty` reads as a path. */
async function managedModule(): Promise<string | undefined> {
  const manifest = await readJson<Manifest>(join(".saasaloy", "manifest.json"));
  return manifest.managed["apps/web/widget.ts"]?.module;
}

/** A regular file where a state file's directory belongs: `mkdir`/`writeFile` refuse it. */
async function blockManifest(): Promise<void> {
  await writeFile(join(root, ".saasaloy"), "not a directory\n", "utf-8");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-ledger-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe(persistLedger, () => {
  it("writes all three files when nothing is wrong", async () => {
    const failures = await persistLedger(input());

    expect(failures).toStrictEqual([]);
    await expect(managedModule()).resolves.toBe("widget");
    await expect(
      readJson<{ installed: string[] }>("saasaloy.json")
    ).resolves.toHaveProperty("installed", ["widget"]);
    await expect(
      readJson<Lockfile>("saasaloy-lock.json")
    ).resolves.toHaveProperty("modules.widget.source", "acme/kit");
  });

  it("writes the config and the lock when the manifest cannot be written", async () => {
    await blockManifest();

    const failures = await persistLedger(input());

    expect(failures).toHaveLength(1);
    expect(failures[0]?.file).toContain("manifest.json");
    await expect(
      readJson<{ installed: string[] }>("saasaloy.json")
    ).resolves.toHaveProperty("installed", ["widget"]);
    await expect(
      readJson<Lockfile>("saasaloy-lock.json")
    ).resolves.toHaveProperty("modules.widget.source", "acme/kit");
  });

  it("reports every failure and throws none", async () => {
    await blockManifest();
    await mkdir(join(root, "saasaloy.json"));
    await mkdir(join(root, "saasaloy-lock.json"));

    const failures = await persistLedger(input());

    expect(failures.map((failure) => failure.file)).toStrictEqual([
      join(".saasaloy", "manifest.json"),
      "saasaloy.json",
      "saasaloy-lock.json",
    ]);
    for (const failure of failures) {
      expect(failure.error).toBeInstanceOf(Error);
    }
  });

  it("prints nothing — the command owns the wording", async () => {
    await blockManifest();
    const lines: string[] = [];
    const write = (chunk: string): boolean => {
      lines.push(chunk);
      return true;
    };
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = write;
    process.stderr.write = write;
    try {
      await persistLedger(input());
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }

    expect(lines).toStrictEqual([]);
  });
});
