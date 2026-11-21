import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_REFUSED, exitCodeFor, RefusalError } from "../lib/exit.js";
import { hashContent } from "../lib/fs-utils.js";
import { abortApply, apply } from "./apply.js";
import type { ApplySide } from "./apply.js";
import {
  assertConvertible,
  convertProject,
  LAST_OLD_ENGINE_CLI,
  searchedReleases,
  writeConversion,
} from "./convert.js";
import type { CandidateLoader, Conversion } from "./convert.js";
import { readManifestState } from "./manifest.js";
import type { Payload, PayloadModule } from "./payload.js";
import { render } from "./render.js";
import type { RenderOptions } from "./render.js";

// The conversion of a version 1 project (plan 0116, Phase 5): each tracked file finds its
// base by its recorded hash across the lock's release and the old releases, and becomes a
// version 2 record with the class, the hash of the whole render and the release that
// matched. A file with no base becomes a file on both sides.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-convert-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

// --- Three releases of a small registry --------------------------------------------------

const NOTES = {
  "0.1.0": ["a = 1", "b = 2", "c = 3", "d = 4", "e = 5", ""].join("\n"),
  "0.2.0": ["a = 1", "b = 2", "c = 3", "d = 4", "e = 50", ""].join("\n"),
  "0.3.0": ["a = 1", "b = 2", "c = 3", "d = 4", "e = 500", ""].join("\n"),
} as const;
type Release = keyof typeof NOTES;

const DB_SQLITE = "// the database\nexport const db = 'sqlite';\n\n// end\n";
const DB_PG = "// the database\nexport const db = 'pg';\n\n// end\n";
const OWNER_DB = `${DB_SQLITE}export const mine = 1;\n`;

function payloadAt(release: Release): Payload {
  const notes: PayloadModule = {
    files: new Map([
      ["files/notes.ts", NOTES[release]],
      ["files/seed.ts", `export const seed = "${release}";\n`],
      ["files/extra.ts", "export const extra = 1;\n"],
      ["files/db.sqlite.ts", DB_SQLITE],
      ["files/db.pg.ts", DB_PG],
      ["files/old.ts", "export const old = 1;\n"],
    ]),
    item: {
      // A dependency whose pin moves: the root `package.json` renders differently at
      // each release while its template source stays the same.
      dependencies: [release === "0.1.0" ? "zod@4.0.0" : "zod@4.1.0"],
      files: [
        { path: "files/notes.ts", target: "@web/notes.ts" },
        { path: "files/seed.ts", seed: true, target: "@web/seed.ts" },
        { path: "files/extra.ts", target: "@web/extra.ts" },
        {
          onlyWith: "drv-sqlite",
          path: "files/db.sqlite.ts",
          target: "@web/db.ts",
        },
        { onlyWith: "drv-pg", path: "files/db.pg.ts", target: "@web/db.ts" },
        { path: "files/old.ts", target: "@web/old.ts" },
      ],
      name: "notes",
      type: "saasaloy:feature",
    },
    name: "notes",
  };
  // Two drivers that exclude each other, as `database-postgres` and `database-d1` do.
  const driver = (name: string, other: string): PayloadModule => ({
    files: new Map([["files/driver.ts", `export const driver = "${name}";\n`]]),
    item: {
      conflictsWith: [other],
      files: [{ path: "files/driver.ts", target: "@web/driver.ts" }],
      name,
      type: "saasaloy:capability",
    },
    name,
  });
  return {
    base: {
      declaration: {
        ownedFiles: [],
        retiredSeedFiles: [],
        seedFiles: ["saasaloy.json", "README.md"],
      },
      files: new Map([
        ["AGENTS.md", "# {{PROJECT_NAME}}\n\nAgents read this.\n"],
        [
          "README.md",
          release === "0.1.0"
            ? "# {{PROJECT_NAME}}\n"
            : "# {{PROJECT_NAME}}\n\nMore.\n",
        ],
        [
          "package.json",
          `${JSON.stringify({ name: "{{PROJECT_NAME}}", private: true }, null, 2)}\n`,
        ],
        [
          "saasaloy.json",
          `${JSON.stringify({ aliases: { "@web": "apps/web/src" }, base: "web", installed: [] }, null, 2)}\n`,
        ],
      ]),
    },
    modules: new Map([
      ["notes", notes],
      ["drv-pg", driver("drv-pg", "drv-sqlite")],
      ["drv-sqlite", driver("drv-sqlite", "drv-pg")],
    ]),
    ref: `v${release}`,
    source: "test",
  };
}

const OPTIONS: RenderOptions = { projectName: "demo", testingMode: "off" };
const REQUESTED = ["drv-pg", "notes"];

function sideAt(release: Release): ApplySide {
  return {
    options: OPTIONS,
    payload: payloadAt(release),
    requested: REQUESTED,
  };
}

/** The side with the old driver, which renders `db.sqlite.ts`. */
function sqliteSideAt(release: Release): ApplySide {
  return {
    options: OPTIONS,
    payload: payloadAt(release),
    requested: ["drv-sqlite", "notes"],
  };
}

const RELEASES: readonly Release[] = ["0.1.0", "0.2.0", "0.3.0"];

/** Loads the fixture releases; a release this test does not ship cannot load. */
const load: CandidateLoader = (version, requested, options) => {
  const release = RELEASES.find((name) => name === version);
  if (release === undefined) {
    return Promise.reject(new Error(`no release ${version} in this test`));
  }
  const payload = payloadAt(release);
  return Promise.resolve({
    options,
    payload,
    requested: requested.filter((name) => payload.modules.has(name)),
  });
};

/** No Prettier: a patched file is compared as rendered. */
const noFormat = (_path: string, content: string): Promise<string> =>
  Promise.resolve(content);

async function write(path: string, content: string): Promise<void> {
  const abs = join(root, path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

const sha = hashContent;
const rendered = {
  "0.1.0": render(sideAt("0.1.0")),
  "0.2.0": render(sideAt("0.2.0")),
};
function contentAt(release: "0.1.0" | "0.2.0", path: string): string {
  const file = rendered[release].files.get(path);
  if (file === undefined) {
    throw new Error(`${path} is not in the ${release} render`);
  }
  return file.content;
}

const OWNER_NOTES = NOTES["0.1.0"].replace("a = 1", "a = 100");
const OWNER_README = "# demo\n\nThe owner's own words.\n";

/**
 * A project the old engine wrote: the base at 0.2.0, `notes` added at 0.1.0 and its seed
 * file written again at 0.2.0, then edits, a deletion, a file adopted off disk, and a
 * driver variant recorded from before a move to Postgres.
 */
async function writeVersion1Project(
  managed: Record<string, Record<string, unknown>>
): Promise<void> {
  await write("AGENTS.md", contentAt("0.2.0", "AGENTS.md"));
  await write("README.md", OWNER_README);
  await write("package.json", contentAt("0.1.0", "package.json"));
  await write("saasaloy.json", contentAt("0.2.0", "saasaloy.json"));
  await write("apps/web/src/notes.ts", OWNER_NOTES);
  await write("apps/web/src/seed.ts", 'export const seed = "0.2.0";\n');
  await write("apps/web/src/extra.ts", "export const extra = 'mine';\n");
  await write("apps/web/src/db.ts", OWNER_DB);
  await write("apps/web/src/driver.ts", 'export const driver = "drv-pg";\n');
  await write(
    ".saasaloy/manifest.json",
    `${JSON.stringify(
      {
        links: {},
        managed,
        patches: [],
        pendingNotes: [
          { body: "Do it.\n", id: "notes/0001-move", title: "Move" },
        ],
        removeWarnings: {},
      },
      null,
      2
    )}\n`
  );
  await write(
    "saasaloy-lock.json",
    `${JSON.stringify(
      {
        base: {
          cliVersion: "0.2.0",
          name: "web",
          templateHash: "0".repeat(64),
        },
        lockfileVersion: 1,
        modules: {
          "drv-pg": {
            ref: "v0.2.0",
            resolved: "v0.2.0",
            source: "mimukit/saasaloy",
          },
          notes: {
            ref: "main",
            resolved: "1".repeat(40),
            source: "mimukit/saasaloy",
          },
        },
      },
      null,
      2
    )}\n`
  );
}

function copied(release: Release, from: string): string {
  const raw = payloadAt(release).modules.get("notes")?.files.get(from) ?? "";
  return raw;
}

const MANAGED: Record<string, Record<string, unknown>> = {
  "AGENTS.md": {
    from: "AGENTS.md",
    hash: sha(contentAt("0.2.0", "AGENTS.md")),
    module: "base",
  },
  "README.md": {
    from: "README.md",
    hash: sha("# demo\n"),
    module: "base",
  },
  "apps/web/src/db.ts": {
    from: "files/db.sqlite.ts",
    hash: sha(copied("0.1.0", "files/db.sqlite.ts")),
    module: "notes",
  },
  "apps/web/src/driver.ts": {
    from: "files/driver.ts",
    hash: sha('export const driver = "drv-pg";\n'),
    module: "drv-pg",
  },
  "apps/web/src/extra.ts": {
    adopted: true,
    from: "files/extra.ts",
    hash: sha("export const extra = 'mine';\n"),
    module: "notes",
  },
  "apps/web/src/old.ts": {
    from: "files/old.ts",
    hash: sha("export const old = 0;\n"),
    module: "notes",
  },
  "apps/web/src/gone.ts": {
    from: "files/gone.ts",
    hash: sha("export const gone = 1;\n"),
    module: "notes",
  },
  "apps/web/src/notes.ts": {
    from: "files/notes.ts",
    hash: sha(NOTES["0.1.0"]),
    module: "notes",
  },
  "apps/web/src/seed.ts": {
    from: "files/seed.ts",
    hash: sha('export const seed = "0.2.0";\n'),
    module: "notes",
    seed: true,
  },
  "package.json": {
    from: "package.json",
    hash: sha(`${JSON.stringify({ name: "demo", private: true }, null, 2)}\n`),
    module: "base",
  },
  "saasaloy.json": {
    from: "saasaloy.json",
    hash: sha("an init the conversion cannot render\n"),
    module: "base",
  },
};

async function convert(): Promise<Conversion> {
  return convertProject({
    format: noFormat,
    load,
    releases: ["0.1.0", "0.2.0", "0.3.0"],
    root,
  });
}

describe(convertProject, () => {
  it("writes version 2 records: the class, the hash of the render that matched, and its release", async () => {
    await writeVersion1Project(MANAGED);
    const conversion = await convert();
    const files = conversion.manifest.files;

    // The lock's own release is tried first, then the releases newest first.
    expect(conversion.searched.slice(0, 4)).toStrictEqual([
      "0.2.0",
      "0.3.0",
      "0.1.0",
      "1".repeat(40),
    ]);
    expect(conversion.warnings).toContain(
      `${"1".repeat(40)}: could not load — no release ${"1".repeat(40)} in this test`
    );

    // A file every release ships alike takes the lock's release.
    expect(files["AGENTS.md"]).toStrictEqual({
      class: "merged",
      from: "AGENTS.md",
      hash: sha(contentAt("0.2.0", "AGENTS.md")),
      module: "base",
      version: "0.2.0",
    });
    // Only 0.1.0 shipped these bytes; the seed and once classes come from classes.ts.
    expect(files["README.md"]).toMatchObject({
      class: "once",
      version: "0.1.0",
    });
    expect(files["apps/web/src/notes.ts"]).toStrictEqual({
      class: "merged",
      from: "files/notes.ts",
      hash: sha(NOTES["0.1.0"]),
      module: "notes",
      version: "0.1.0",
    });
    expect(files["apps/web/src/seed.ts"]).toMatchObject({
      class: "once",
      version: "0.2.0",
    });

    // The template source of `package.json` is the same in every release, and the render
    // is not: the conversion takes the render nearest the disk, and records its hash.
    expect(files["package.json"]).toStrictEqual({
      class: "merged",
      from: "package.json",
      hash: sha(contentAt("0.1.0", "package.json")),
      module: "base",
      version: "0.1.0",
    });
    expect(files["package.json"]?.hash).not.toBe(MANAGED["package.json"]?.hash);

    // A driver variant: the project's set renders `db.pg.ts` at the path, and only a
    // side with the old driver renders the recorded `db.sqlite.ts`. Its render's hash
    // equals the record, so it is the base.
    expect(files["apps/web/src/db.ts"]).toStrictEqual({
      class: "merged",
      from: "files/db.sqlite.ts",
      hash: sha(DB_SQLITE),
      module: "notes",
      version: "0.2.0",
    });

    // No render holds the recorded bytes: the file becomes a file on both sides.
    expect(files["apps/web/src/extra.ts"]).toBeUndefined();
    expect(files["saasaloy.json"]).toBeUndefined();
    // A deleted file with no base keeps a record so it stays deleted, and the record
    // holds a render's own hash, never the version 1 hash no render produced.
    expect(files["apps/web/src/old.ts"]).toStrictEqual({
      class: "merged",
      from: "files/old.ts",
      hash: sha("export const old = 1;\n"),
      module: "notes",
      version: "0.2.0",
    });
    expect(
      conversion.files.find((file) => file.path === "apps/web/src/old.ts")
        ?.version
    ).toBeUndefined();
    // A deleted file no candidate renders keeps no record.
    expect(files["apps/web/src/gone.ts"]).toBeUndefined();
    // No record holds a hash that no render of the candidates produced.
    for (const record of Object.values(files)) {
      expect(record.hash).not.toBe(MANAGED["apps/web/src/old.ts"]?.hash);
    }

    const found = conversion.files.filter((file) => file.version !== undefined);
    expect(found).toHaveLength(7);
    expect(conversion.files).toHaveLength(11);

    // The lock gains the requested list; the base keeps its release.
    expect(conversion.lock.requested).toStrictEqual(["drv-pg", "notes"]);
    expect(conversion.lock.base?.cliVersion).toBe("0.2.0");
    expect(
      conversion.manifest.pendingNotes.map((note) => note.id)
    ).toStrictEqual(["notes/0001-move"]);
    expect(conversion.manifest.pendingMerges).toStrictEqual([]);
  });

  it("writes nothing until asked, then a manifest the render engine reads", async () => {
    await writeVersion1Project(MANAGED);
    const conversion = await convert();
    await expect(readManifestState(root)).resolves.toStrictEqual({
      kind: "v1",
    });
    await writeConversion(root, conversion);
    const state = await readManifestState(root);
    expect(state.kind).toBe("v2");
    const lock = JSON.parse(
      await readFile(join(root, "saasaloy-lock.json"), "utf-8")
    ) as { requested?: string[] };
    expect(lock.requested).toStrictEqual(["drv-pg", "notes"]);
  });

  it("refuses a manifest with no source path or no hash, and names the last old-engine CLI", async () => {
    await writeVersion1Project({
      ...MANAGED,
      "apps/web/src/notes.ts": { hash: sha(NOTES["0.1.0"]), module: "notes" },
    });
    const refusal = convert();
    await expect(refusal).rejects.toThrow(RefusalError);
    await expect(refusal).rejects.toThrow(
      `pnpm dlx saasaloy@${LAST_OLD_ENGINE_CLI} update`
    );
    await expect(refusal).rejects.toThrow("apps/web/src/notes.ts");
    await expect(readManifestState(root)).resolves.toStrictEqual({
      kind: "v1",
    });

    let caught: unknown;
    try {
      assertConvertible({
        managed: { "a.ts": { from: "files/a.ts", module: "x" } },
      });
    } catch (error) {
      caught = error;
    }
    expect(exitCodeFor(caught)).toBe(EXIT_REFUSED);
  });

  it("searches the old-engine releases up to the running CLI", () => {
    expect(searchedReleases("0.5.1", {})).toStrictEqual([
      "0.1.0",
      "0.1.1",
      "0.2.0",
      "0.3.0",
      "0.4.0",
      "0.5.0",
      "0.5.1",
    ]);
    expect(
      searchedReleases("0.9.0", { SAASALOY_REGISTRY_DIR: "/x" })
    ).toStrictEqual([]);
  });
});

describe("an update after the conversion", () => {
  it("finds the base of a file an older release wrote, and merges it clean", async () => {
    await writeVersion1Project(MANAGED);
    const conversion = await convert();
    const state = { lock: conversion.lock, manifest: conversion.manifest };
    const run = (bases?: Map<string, ApplySide[]>) =>
      apply({
        dryRun: true,
        format: noFormat,
        next: sideAt("0.3.0"),
        previous: sideAt("0.2.0"),
        root,
        state,
        version: "0.3.0",
        ...(bases === undefined ? {} : { bases }),
      });

    // The record names 0.1.0. With its render as a base, the owner's edit and the
    // upstream change both land.
    const withBase = await run(
      new Map([
        ["0.1.0", [sideAt("0.1.0")]],
        ["0.2.0", [sqliteSideAt("0.2.0")]],
      ])
    );
    const notes = withBase.results.find(
      (result) => result.path === "apps/web/src/notes.ts"
    );
    expect(notes?.kind).toBe("clean");
    expect(notes?.after).toBe(OWNER_NOTES.replace("e = 5", "e = 500"));
    // The version 1 files on disk are untouched by a dry run.
    await expect(readManifestState(root)).resolves.toStrictEqual({
      kind: "v1",
    });

    // With the old lock's render alone, the same file has no base.
    const without = await run();
    expect(
      without.results.find((result) => result.path === "apps/web/src/notes.ts")
        ?.kind
    ).toBe("no-base");

    // The variant base: the owner's line and the move to the pg source both land.
    const db = withBase.results.find(
      (result) => result.path === "apps/web/src/db.ts"
    );
    expect(db?.kind).toBe("clean");
    expect(db?.after).toBe(`${DB_PG}export const mine = 1;\n`);

    // The files with no base go to the plan's "both sides" rule; the once paths keep.
    const kinds = Object.fromEntries(
      withBase.results.map((result) => [result.path, result.kind])
    );
    expect(kinds["apps/web/src/extra.ts"]).toBe("both-no-base");
    // No base either, and the disk already holds the new render.
    expect(kinds["saasaloy.json"]).toBe("already-equal");
    // The owner deleted it and upstream did not change it: it stays deleted.
    expect(kinds["apps/web/src/old.ts"]).toBe("unchanged");
    expect(
      withBase.results.find((result) => result.path === "apps/web/src/old.ts")
        ?.after
    ).toBeUndefined();
  });

  it("writes the conversion with the run, after the backup, so a later abort restores version 1", async () => {
    await writeVersion1Project(MANAGED);
    const before = await readFile(
      join(root, ".saasaloy/manifest.json"),
      "utf-8"
    );
    const conversion = await convert();
    const report = await apply({
      bases: new Map([["0.1.0", [sideAt("0.1.0")]]]),
      format: noFormat,
      next: sideAt("0.3.0"),
      previous: sideAt("0.2.0"),
      root,
      state: { lock: conversion.lock, manifest: conversion.manifest },
      version: "0.3.0",
    });
    expect(report.backup).toBeDefined();
    const state = await readManifestState(root);
    expect(state.kind).toBe("v2");
    await abortApply(root);
    await expect(
      readFile(join(root, ".saasaloy/manifest.json"), "utf-8")
    ).resolves.toBe(before);
  });
});
