import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RefusalError } from "../lib/exit.js";
import { hashContent } from "../lib/fs-utils.js";
import { loadLock } from "../lib/lock.js";
import { loadManifest, MANIFEST_FILE } from "../lib/manifest.js";
import { validateLock, validateManifest } from "../lib/schema.js";
import {
  emptyManifestV2,
  loadManifestV2,
  readManifestState,
  saveManifestV2,
  serializeManifestV2,
} from "./manifest.js";
import type { ManifestV2 } from "./manifest.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-manifest-v2-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

const SAMPLE: ManifestV2 = {
  ...emptyManifestV2(),
  files: {
    "apps/api/src/index.ts": {
      class: "merged",
      from: "files/src/index.ts",
      hash: hashContent("x"),
      module: "api",
      version: "0.10.0",
    },
  },
  pendingMerges: ["package.json"],
};

async function writeManifest(value: unknown): Promise<void> {
  await mkdir(join(root, ".saasaloy"), { recursive: true });
  await writeFile(join(root, MANIFEST_FILE), JSON.stringify(value));
}

describe("manifest version 2", () => {
  it("writes the plan's shape and reads it back", async () => {
    await saveManifestV2(root, SAMPLE);
    await expect(loadManifestV2(root)).resolves.toStrictEqual(SAMPLE);
    expect(
      Object.keys(JSON.parse(serializeManifestV2(SAMPLE)) as object)
    ).toStrictEqual([
      "version",
      "files",
      "pendingMerges",
      "pendingNotes",
      "doneNotes",
    ]);
  });

  it("reads a missing file as empty", async () => {
    await expect(loadManifestV2(root)).resolves.toStrictEqual(
      emptyManifestV2()
    );
  });

  it("refuses an unknown field and a record with no class", async () => {
    await writeManifest({ ...SAMPLE, adopted: true });
    await expect(loadManifestV2(root)).rejects.toThrow(RefusalError);
    const { class: _dropped, ...noClass } =
      SAMPLE.files["apps/api/src/index.ts"] ?? {};
    await writeManifest({ ...SAMPLE, files: { "a.ts": noClass } });
    await expect(loadManifestV2(root)).rejects.toThrow(/class/);
  });

  it("tells a version 1 manifest apart, and the engine refuses it until conversion", async () => {
    await writeManifest({
      links: {},
      managed: {},
      patches: [],
      removeWarnings: {},
    });
    await expect(readManifestState(root)).resolves.toStrictEqual({
      kind: "v1",
    });
    await expect(loadManifestV2(root)).rejects.toThrow(/version 1/);
  });

  it("is refused by the version 1 schema, so an older CLI stops on it", async () => {
    await saveManifestV2(root, SAMPLE);
    await expect(loadManifest(root)).rejects.toThrow(RefusalError);
    expect(
      (await validateManifest(JSON.parse(serializeManifestV2(SAMPLE)))).valid
    ).toBeFalsy();
  });
});

describe("the lock's requested list", () => {
  it("validates and survives a load", async () => {
    const lock = {
      lockfileVersion: 1,
      modules: { auth: { ref: "v1", resolved: "v1", source: "test" } },
      requested: ["auth"],
    };
    expect((await validateLock(lock)).valid).toBeTruthy();
    await writeFile(join(root, "saasaloy-lock.json"), JSON.stringify(lock));
    expect((await loadLock(root)).requested).toStrictEqual(["auth"]);
  });

  it("refuses a name that is not a module name", async () => {
    const lock = { lockfileVersion: 1, modules: {}, requested: ["Bad Name"] };
    expect((await validateLock(lock)).valid).toBeFalsy();
  });
});
