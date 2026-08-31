import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyManifest, loadManifest, saveManifest } from "./manifest.js";
import type { ManifestPatch } from "./manifest.js";
import { PATCH_KINDS } from "./patch/index.js";

// #98 Phase 5. `.saasaloy/manifest.json` decides whether a file is safe to overwrite, so
// a corrupted one is the difference between a clean update and a clobbered hand edit.
// `loadManifest` used to trust whatever JSON it found; it now runs the same validator the
// schema already shipped and refuses with the validator's own error text.

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

describe("loadManifest — validation on load", () => {
  it("returns an empty manifest when the file is missing", async () => {
    const missing = await mkdtemp(join(tmpdir(), "saasaloy-manifest-none-"));
    try {
      await expect(loadManifest(missing)).resolves.toStrictEqual(
        emptyManifest()
      );
    } finally {
      await rm(missing, { recursive: true, force: true });
    }
  });

  it("refuses a managed entry with no content hash, naming the property", async () => {
    await writeManifest({
      managed: { "apps/api/src/x.ts": { module: "email" } },
    });
    await expect(loadManifest(root)).rejects.toThrow(/"hash"/);
  });

  it("refuses a hash that isn't a sha256 digest", async () => {
    await writeManifest({
      managed: { "apps/api/src/x.ts": { module: "email", hash: "nope" } },
    });
    await expect(loadManifest(root)).rejects.toThrow(
      /manifest\.json is invalid/
    );
  });

  it("refuses a property the schema doesn't know", async () => {
    await writeManifest({ managed: {}, surprise: true });
    await expect(loadManifest(root)).rejects.toThrow(/"surprise"/);
  });

  it("round-trips a valid manifest", async () => {
    const manifest = emptyManifest();
    manifest.managed["apps/api/src/x.ts"] = {
      module: "email",
      hash: HASH,
      from: "files/x.ts",
    };
    await saveManifest(root, manifest);
    await expect(loadManifest(root)).resolves.toStrictEqual(manifest);
  });

  // The applier records whatever kind a descriptor authored. Until the fix round the
  // manifest schema listed two of the five, so the first `add` that applied a
  // `package-json-dependency` wrote a file the next `add`/`remove`/`update` refused.
  // Every kind now survives save → load (#98).
  it.each(PATCH_KINDS)("round-trips a recorded %s patch", async (kind) => {
    const manifest = emptyManifest();
    manifest.patches.push({
      module: "database",
      file: "apps/api/package.json",
      patch: { file: "apps/api/package.json", kind } as ManifestPatch["patch"],
    });
    await saveManifest(root, manifest);
    await expect(loadManifest(root)).resolves.toStrictEqual(manifest);
  });
});
