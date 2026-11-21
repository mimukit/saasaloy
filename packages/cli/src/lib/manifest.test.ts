import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RefusalError } from "./exit.js";
import { loadManifest } from "./manifest.js";

// A version 1 `.saasaloy/manifest.json` is read only by the conversion the first `update`
// runs (plan 0116, Phase 5). It still runs the schema's validator and refuses with its
// error text (#98), so a corrupted file never reaches the conversion as a typed object.

const HASH = "a".repeat(64);

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-manifest-"));
  await mkdir(join(root, ".saasaloy"), { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeManifest(data: unknown): Promise<void> {
  await writeFile(
    join(root, ".saasaloy", "manifest.json"),
    JSON.stringify(data),
    "utf-8"
  );
}

describe("loadManifest — a version 1 manifest", () => {
  it("returns an empty manifest when the file is missing", async () => {
    const missing = await mkdtemp(join(tmpdir(), "saasaloy-manifest-none-"));
    try {
      await expect(loadManifest(missing)).resolves.toStrictEqual({
        managed: {},
      });
    } finally {
      await rm(missing, { recursive: true, force: true });
    }
  });

  it("refuses a manifest that isn't valid JSON, as a refusal", async () => {
    await writeFile(
      join(root, ".saasaloy", "manifest.json"),
      '{"managed": {',
      "utf-8"
    );
    await expect(loadManifest(root)).rejects.toThrow(RefusalError);
    await expect(loadManifest(root)).rejects.toThrow(
      /manifest\.json is invalid/
    );
  });

  it("refuses a managed entry with no content hash, naming the property", async () => {
    await writeManifest({
      managed: { "apps/api/src/x.ts": { module: "email" } },
    });
    await expect(loadManifest(root)).rejects.toThrow(/"hash"/);
  });

  it("refuses a property the schema doesn't know", async () => {
    await writeManifest({ managed: {}, surprise: true });
    await expect(loadManifest(root)).rejects.toThrow(/"surprise"/);
  });

  it("reads the managed files and the notes", async () => {
    const note = { body: "Do it.\n", id: "base/0001-x", title: "X" };
    await writeManifest({
      doneNotes: ["base/0002-y"],
      links: {},
      managed: {
        "apps/api/src/x.ts": {
          from: "files/x.ts",
          hash: HASH,
          module: "email",
        },
      },
      patches: [],
      pendingNotes: [note],
    });
    await expect(loadManifest(root)).resolves.toStrictEqual({
      doneNotes: ["base/0002-y"],
      managed: {
        "apps/api/src/x.ts": {
          from: "files/x.ts",
          hash: HASH,
          module: "email",
        },
      },
      pendingNotes: [note],
    });
  });
});
