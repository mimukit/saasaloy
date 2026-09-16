import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RefusalError } from "./exit.js";
import {
  emptyManifest,
  loadManifest,
  recordLink,
  recordManagedFile,
  recordPatch,
  saveManifest,
  untrackLink,
  untrackManagedFile,
  untrackPatch,
} from "./manifest.js";
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

  // A half-written file parses as nothing at all. Left to `JSON.parse`, the SyntaxError
  // reaches `exitCodeFor` as a plain failure (1) and never names the file.
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

  it("loads an old manifest with an empty removal warning map", async () => {
    await writeManifest({ managed: {}, links: {}, patches: [] });
    await expect(loadManifest(root)).resolves.toMatchObject({
      removeWarnings: {},
    });
  });

  it("round-trips stored removal warnings", async () => {
    const manifest = emptyManifest();
    manifest.removeWarnings.teams = [
      "The organization tables survive removal.",
    ];
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

// #150. The record half. Seven sites used to build these entries inline, in four shapes;
// `applier` wrote a managed entry without `adopted` while `base` wrote one with it, and
// the patch dedupe was copied into `applier` and `updater` word for word. These tests own
// the shapes now, so a new write site inherits them instead of re-deriving them.

function patchEntry(module: string, file: string): ManifestPatch {
  return {
    file,
    module,
    patch: { file, kind: "package-json-dependency" } as ManifestPatch["patch"],
  };
}

describe(recordManagedFile, () => {
  it("writes module, hash and from", () => {
    const manifest = emptyManifest();

    recordManagedFile(manifest, {
      from: "files/x.ts",
      hash: HASH,
      module: "email",
      target: "apps/api/src/x.ts",
    });

    expect(manifest.managed["apps/api/src/x.ts"]).toStrictEqual({
      from: "files/x.ts",
      hash: HASH,
      module: "email",
    });
  });

  // The drop rule from the `ManagedEntry` comment, made structural: `adopted` exists only
  // where it is passed `true`, so a real write cannot carry it forward by accident.
  it("keeps adopted only when it is true", () => {
    const manifest = emptyManifest();

    recordManagedFile(manifest, {
      adopted: true,
      hash: HASH,
      module: "base",
      target: "apps/web/astro.config.mjs",
    });

    expect(manifest.managed["apps/web/astro.config.mjs"]).toStrictEqual({
      adopted: true,
      hash: HASH,
      module: "base",
    });
  });

  it.each([undefined, false])("drops adopted when it is %s", (adopted) => {
    const manifest = emptyManifest();

    recordManagedFile(manifest, {
      adopted,
      hash: HASH,
      module: "base",
      target: "apps/web/astro.config.mjs",
    });

    expect(manifest.managed["apps/web/astro.config.mjs"]).not.toHaveProperty(
      "adopted"
    );
  });

  // The tool writes the file it once adopted, so the recorded hash finally describes
  // template output and the entry earns the `overwrite` verdict again.
  it("drops adopted when a real write replaces an adopted entry", () => {
    const manifest = emptyManifest();
    const target = "apps/web/astro.config.mjs";
    recordManagedFile(manifest, {
      adopted: true,
      hash: HASH,
      module: "base",
      target,
    });

    recordManagedFile(manifest, {
      hash: "b".repeat(64),
      module: "base",
      target,
    });

    expect(manifest.managed[target]).toStrictEqual({
      hash: "b".repeat(64),
      module: "base",
    });
  });

  it("omits from rather than storing undefined", () => {
    const manifest = emptyManifest();

    recordManagedFile(manifest, {
      hash: HASH,
      module: "email",
      target: "apps/api/src/x.ts",
    });

    expect(manifest.managed["apps/api/src/x.ts"]).not.toHaveProperty("from");
  });
});

describe(untrackManagedFile, () => {
  it("drops the entry and leaves the others alone", () => {
    const manifest = emptyManifest();
    recordManagedFile(manifest, {
      hash: HASH,
      module: "email",
      target: "a.ts",
    });
    recordManagedFile(manifest, {
      hash: HASH,
      module: "email",
      target: "b.ts",
    });

    untrackManagedFile(manifest, "a.ts");

    expect(Object.keys(manifest.managed)).toStrictEqual(["b.ts"]);
  });

  it("is a no-op for an entry that was never tracked", () => {
    const manifest = emptyManifest();

    untrackManagedFile(manifest, "gone.ts");

    expect(manifest.managed).toStrictEqual({});
  });
});

describe(recordPatch, () => {
  it("appends the entry", () => {
    const manifest = emptyManifest();

    recordPatch(manifest, patchEntry("database", "apps/api/package.json"));

    expect(manifest.patches).toHaveLength(1);
  });

  // A `--force` re-apply lands the same op again. Recorded twice, `remove` would reverse
  // it twice — the dedupe is what keeps the record one-to-one with disk.
  it("dedupes a structurally equal entry", () => {
    const manifest = emptyManifest();

    recordPatch(manifest, patchEntry("database", "apps/api/package.json"));
    recordPatch(manifest, patchEntry("database", "apps/api/package.json"));

    expect(manifest.patches).toHaveLength(1);
  });

  it("keeps two entries that differ by module", () => {
    const manifest = emptyManifest();

    recordPatch(manifest, patchEntry("database", "apps/api/package.json"));
    recordPatch(manifest, patchEntry("email", "apps/api/package.json"));

    expect(manifest.patches.map((patch) => patch.module)).toStrictEqual([
      "database",
      "email",
    ]);
  });
});

describe(untrackPatch, () => {
  it("drops the structurally equal entry only", () => {
    const manifest = emptyManifest();
    recordPatch(manifest, patchEntry("database", "apps/api/package.json"));
    recordPatch(manifest, patchEntry("email", "apps/api/package.json"));

    untrackPatch(manifest, patchEntry("database", "apps/api/package.json"));

    expect(manifest.patches.map((patch) => patch.module)).toStrictEqual([
      "email",
    ]);
  });

  // `remove` walks a plan loaded separately from the manifest it edits, so the two sides
  // are never the same object. Structural equality is the whole point.
  it("matches a separately built equal entry, not reference identity", () => {
    const manifest = emptyManifest();
    manifest.patches.push(patchEntry("database", "apps/api/package.json"));

    untrackPatch(manifest, patchEntry("database", "apps/api/package.json"));

    expect(manifest.patches).toStrictEqual([]);
  });
});

describe("recordLink and untrackLink", () => {
  it("records source to link, then drops it", () => {
    const manifest = emptyManifest();

    recordLink(manifest, ".agents/skills/email", ".claude/skills/email");
    expect(manifest.links).toStrictEqual({
      ".agents/skills/email": ".claude/skills/email",
    });

    untrackLink(manifest, ".agents/skills/email");
    expect(manifest.links).toStrictEqual({});
  });
});
