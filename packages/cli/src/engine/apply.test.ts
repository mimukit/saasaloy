import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  EXIT_REFUSED,
  EXIT_WORK_PENDING,
  exitCodeFor,
  RefusalError,
} from "../lib/exit.js";
import { hashContent, pathExists } from "../lib/fs-utils.js";
import { loadLock } from "../lib/lock.js";
import { REGISTRY_ENV } from "../lib/registry.js";
import type { FileClass } from "./classes.js";
import {
  abortApply,
  apply,
  JOURNAL_FILE,
  planApply,
  scanPendingMerges,
} from "./apply.js";
import type { ApplySide, PathResult, PlanArgs } from "./apply.js";
import { emptyManifestV2, readManifestState } from "./manifest.js";
import type { ManifestV2 } from "./manifest.js";
import { loadPayload } from "./payload.js";
import type { Payload, PayloadModule } from "./payload.js";
import { render } from "./render.js";
import type { RenderedFile, RenderResult } from "./render.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const MODULES_DIR = join(REPO_ROOT, "modules");

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-apply-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

// --- Three sides of one path ---------------------------------------------------------

const PATH = "src/a.ts";
const LINES = ["one", "two", "three", "four", "five", ""].join("\n");

function rendered(files: RenderedFile[], skills: string[] = []): RenderResult {
  return {
    aliases: {},
    envVars: {},
    files: new Map(files.map((file) => [file.path, file])),
    order: [],
    removeWarnings: {},
    skills,
    testingMode: "off",
    warnings: [],
  };
}

function fileOf(
  content: string,
  extra: Partial<RenderedFile> = {}
): RenderedFile {
  return {
    class: "merged",
    content,
    from: "files/a.ts",
    module: "demo",
    path: PATH,
    ...extra,
  };
}

interface Sides {
  /** The render of the old lock. */
  base?: string;
  /** The new render. */
  theirs?: string;
  /** The disk. */
  mine?: string;
  /** What the manifest recorded; defaults to `base`. `null` records nothing. */
  recorded?: string | null;
  class?: FileClass;
  path?: string;
  transformed?: true;
  extra?: Partial<PlanArgs>;
}

async function planSides(
  sides: Sides
): Promise<{ result: PathResult; manifest: ManifestV2 }> {
  const path = sides.path ?? PATH;
  const fileClass = sides.class ?? "merged";
  const extra: Partial<RenderedFile> = {
    class: fileClass,
    path,
    ...(sides.transformed ? { transformed: true } : {}),
  };
  if (sides.mine !== undefined) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), sides.mine, "utf-8");
  }
  const manifest = emptyManifestV2();
  const recorded = sides.recorded === undefined ? sides.base : sides.recorded;
  if (recorded !== undefined && recorded !== null) {
    manifest.files[path] = {
      class: fileClass,
      from: "files/a.ts",
      hash: hashContent(recorded),
      module: "demo",
      version: "0.1.0",
    };
  }
  const plan = await planApply({
    base: rendered(sides.base === undefined ? [] : [fileOf(sides.base, extra)]),
    manifest,
    root,
    theirs: rendered(
      sides.theirs === undefined ? [] : [fileOf(sides.theirs, extra)]
    ),
    version: "0.2.0",
    ...sides.extra,
  });
  const result = plan.results.find((entry) => entry.path === path);
  if (!result) {
    throw new Error(`no result for ${path}`);
  }
  return { manifest: plan.manifest, result };
}

describe(planApply, () => {
  describe("the six result kinds of research 0013", () => {
    it("clean: merges an owner edit and an upstream edit in different lines", async () => {
      const { result, manifest } = await planSides({
        base: LINES,
        mine: LINES.replace("one", "ONE"),
        theirs: LINES.replace("five", "FIVE"),
      });
      expect(result).toMatchObject({
        action: "merge",
        conflicts: 0,
        kind: "clean",
      });
      expect(result.after).toBe(
        LINES.replace("one", "ONE").replace("five", "FIVE")
      );
      expect(manifest.files[PATH]?.hash).toBe(
        hashContent(LINES.replace("five", "FIVE"))
      );
      expect(manifest.pendingMerges).toStrictEqual([]);
    });

    it("already equal: the disk already holds the new render", async () => {
      const theirs = LINES.replace("two", "TWO");
      const { result, manifest } = await planSides({
        base: LINES,
        mine: theirs,
        theirs,
      });
      expect(result).toMatchObject({
        action: "leave",
        after: theirs,
        kind: "already-equal",
      });
      expect(manifest.files[PATH]).toMatchObject({
        hash: hashContent(theirs),
        version: "0.2.0",
      });
    });

    it("conflict: writes zdiff3 markers and lists the file in pendingMerges", async () => {
      const { result, manifest } = await planSides({
        base: LINES,
        mine: LINES.replace("three", "mine"),
        theirs: LINES.replace("three", "theirs"),
      });
      expect(result).toMatchObject({ action: "merge", kind: "conflict" });
      expect(result.conflicts).toBe(1);
      expect(result.after).toContain("<<<<<<< mine");
      expect(result.after).toContain("||||||| base");
      expect(result.after).toContain(">>>>>>> saasaloy 0.2.0");
      expect(manifest.pendingMerges).toStrictEqual([PATH]);
      // The record moves to the new render, so the next run merges from it.
      expect(manifest.files[PATH]?.hash).toBe(
        hashContent(LINES.replace("three", "theirs"))
      );
    });

    it("both sides with no base: two-way markers for a path with no record", async () => {
      const { result, manifest } = await planSides({
        mine: "export const a = 1;\n",
        recorded: null,
        theirs: "export const a = 2;\n",
      });
      expect(result).toMatchObject({ action: "merge", kind: "both-no-base" });
      expect(result.after).toContain("<<<<<<< mine");
      expect(result.after).not.toContain("|||||||");
      expect(manifest.pendingMerges).toStrictEqual([PATH]);
    });

    it("both sides with no base: a `once` path is left as it is", async () => {
      const mine = "the owner's file\n";
      const { result, manifest } = await planSides({
        class: "once",
        mine,
        recorded: null,
        theirs: "upstream\n",
      });
      expect(result).toMatchObject({
        action: "leave",
        after: mine,
        kind: "once-kept",
      });
      expect(manifest.pendingMerges).toStrictEqual([]);
    });

    it("upstream delete against an owner edit: keeps the file and drops its record", async () => {
      const mine = LINES.replace("one", "edited");
      const { result, manifest } = await planSides({ base: LINES, mine });
      expect(result).toMatchObject({
        action: "report",
        after: mine,
        kind: "upstream-deleted-owner-edited",
      });
      expect(manifest.files[PATH]).toBeUndefined();
    });

    it("no base found: no render matches the record, so two-way markers", async () => {
      const { result } = await planSides({
        base: LINES,
        mine: LINES.replace("one", "edited"),
        recorded: "something no render holds\n",
        theirs: LINES.replace("five", "FIVE"),
      });
      expect(result).toMatchObject({ action: "merge", kind: "no-base" });
      expect(result.after).toContain("<<<<<<< mine");
      expect(result.after).not.toContain("|||||||");
    });
  });

  describe("the plain actions", () => {
    it("leaves a file upstream did not change, with the owner's edit", async () => {
      const mine = LINES.replace("one", "edited");
      const { result, manifest } = await planSides({
        base: LINES,
        mine,
        theirs: LINES,
      });
      expect(result).toMatchObject({
        action: "leave",
        after: mine,
        kind: "unchanged",
      });
      expect(manifest.files[PATH]?.version).toBe("0.1.0");
    });

    it("writes the new render over a file the owner did not change", async () => {
      const theirs = LINES.replace("one", "new");
      const { result } = await planSides({ base: LINES, mine: LINES, theirs });
      expect(result).toMatchObject({
        action: "write",
        after: theirs,
        kind: "updated",
      });
    });

    it("writes a new path", async () => {
      const { result, manifest } = await planSides({ theirs: LINES });
      expect(result).toMatchObject({
        action: "write",
        after: LINES,
        before: undefined,
        kind: "new",
      });
      expect(manifest.files[PATH]).toStrictEqual({
        class: "merged",
        from: "files/a.ts",
        hash: hashContent(LINES),
        module: "demo",
        version: "0.2.0",
      });
    });

    it("deletes a file upstream dropped when the disk equals the record", async () => {
      const { result, manifest } = await planSides({
        base: LINES,
        mine: LINES,
      });
      expect(result).toMatchObject({
        action: "delete",
        after: undefined,
        kind: "deleted",
      });
      expect(manifest.files[PATH]).toBeUndefined();
    });

    it("keeps a tracked file the owner deleted, and restore writes it again", async () => {
      const theirs = LINES.replace("one", "new");
      const kept = await planSides({ base: LINES, theirs });
      expect(kept.result).toMatchObject({
        action: "report",
        after: undefined,
        kind: "kept-deleted",
      });
      const restored = await planSides({
        base: LINES,
        extra: { restore: [PATH] },
        theirs,
      });
      expect(restored.result).toMatchObject({
        action: "write",
        after: theirs,
        kind: "restored",
      });
    });

    it("merges by key for a package.json", async () => {
      const json = (scripts: Record<string, string>): string =>
        `${JSON.stringify({ name: "x", scripts }, null, 2)}\n`;
      const { result } = await planSides({
        base: json({ a: "1", b: "1" }),
        mine: json({ a: "mine", b: "1" }),
        path: "package.json",
        theirs: json({ a: "1", b: "theirs" }),
      });
      expect(result.kind).toBe("clean");
      expect(JSON.parse(result.after ?? "")).toStrictEqual({
        name: "x",
        scripts: { a: "mine", b: "theirs" },
      });
    });

    it("compares a patched file in the project's Prettier layout", async () => {
      const format = (_path: string, content: string): Promise<string> =>
        Promise.resolve(`${content}// formatted\n`);
      const theirs = LINES.replace("one", "new");
      const { result, manifest } = await planSides({
        base: LINES,
        extra: { format },
        mine: `${LINES}// formatted\n`,
        theirs,
        transformed: true,
      });
      expect(result).toMatchObject({
        after: `${theirs}// formatted\n`,
        kind: "updated",
      });
      // The record holds the raw render, never the formatted bytes.
      expect(manifest.files[PATH]?.hash).toBe(hashContent(theirs));
    });
  });

  describe("`once` files", () => {
    it("leaves a `once` file upstream changed, reports it, and keeps the version that wrote it", async () => {
      const mine = LINES.replace("one", "owner");
      const { result, manifest } = await planSides({
        base: LINES,
        class: "once",
        mine,
        theirs: LINES.replace("five", "FIVE"),
      });
      expect(result).toMatchObject({
        action: "report",
        after: mine,
        kind: "once-left",
      });
      expect(manifest.files[PATH]).toMatchObject({
        hash: hashContent(LINES),
        version: "0.1.0",
      });
    });

    it("leaves an unedited `once` file too", async () => {
      const { result } = await planSides({
        base: LINES,
        class: "once",
        mine: LINES,
        theirs: LINES.replace("five", "FIVE"),
      });
      expect(result).toMatchObject({ after: LINES, kind: "once-left" });
    });

    it("merges a `once` file named in `merge`", async () => {
      const { result, manifest } = await planSides({
        base: LINES,
        class: "once",
        extra: { merge: [PATH] },
        mine: LINES.replace("one", "owner"),
        theirs: LINES.replace("five", "FIVE"),
      });
      expect(result).toMatchObject({ kind: "clean" });
      expect(result.after).toBe(
        LINES.replace("one", "owner").replace("five", "FIVE")
      );
      expect(manifest.files[PATH]?.version).toBe("0.2.0");
    });

    it("on remove, deletes an unedited `once` file and keeps an edited one", async () => {
      const unedited = await planSides({
        base: LINES,
        class: "once",
        mine: LINES,
      });
      expect(unedited.result.kind).toBe("deleted");
      await rm(join(root, PATH));
      const edited = await planSides({
        base: LINES,
        class: "once",
        mine: "owner\n",
      });
      expect(edited.result.kind).toBe("upstream-deleted-owner-edited");
    });
  });

  describe("`generated` files", () => {
    it("writes an unedited generated file in full", async () => {
      const theirs = LINES.replace("one", "new");
      const { result } = await planSides({
        base: LINES,
        class: "generated",
        mine: LINES,
        theirs,
      });
      expect(result).toMatchObject({ after: theirs, kind: "updated" });
    });

    it("refuses with exit 2 and names an owner-edited generated file", async () => {
      const run = planSides({
        base: LINES,
        class: "generated",
        mine: "owner\n",
        theirs: LINES,
      });
      await expect(run).rejects.toThrow(RefusalError);
      await expect(run).rejects.toThrow(PATH);
    });

    it("overwrites an owner-edited generated file under force", async () => {
      const { result } = await planSides({
        base: LINES,
        class: "generated",
        extra: { force: true },
        mine: "owner\n",
        theirs: LINES,
      });
      expect(result).toMatchObject({
        after: LINES,
        kind: "generated-overwritten",
      });
    });
  });
});

describe(scanPendingMerges, () => {
  it("keeps a listed file with a marker line and clears the rest", async () => {
    await writeFile(
      join(root, "a.ts"),
      "<<<<<<< mine\na\n=======\nb\n>>>>>>> saasaloy 1\n"
    );
    await writeFile(join(root, "b.ts"), "resolved\n");
    await writeFile(join(root, "c.md"), "<<<<<<< mine\nnot listed\n");
    await expect(
      scanPendingMerges(root, ["a.ts", "b.ts", "gone.ts"])
    ).resolves.toStrictEqual(["a.ts"]);
  });
});

// --- A whole project ----------------------------------------------------------------

const AGENTS = [
  "# Agents",
  "<!-- saasaloy:testing -->",
  "placeholder",
  "<!-- /saasaloy:testing -->",
  "",
].join("\n");

const MERGED_V1 = [
  "// notes",
  "export const a = 1;",
  "export const b = 2;",
  "export const c = 3;",
  "",
].join("\n");
const MERGED_V2 = MERGED_V1.replace("c = 3", "c = 30");
const ONCE_V1 = "export const seed = 1;\n";
const ONCE_V2 = "export const seed = 2;\n";

function payloadOf(
  ref: string,
  files: { merged: string; once: string; added?: string }
): Payload {
  const added = files.added;
  const notes: PayloadModule = {
    files: new Map([
      ["files/notes.ts", files.merged],
      ["files/seed.ts", files.once],
      ...(added === undefined ? [] : [["files/added.ts", added] as const]),
    ]),
    item: {
      files: [
        { path: "files/notes.ts", target: "@web/notes.ts" },
        { path: "files/seed.ts", seed: true, target: "@web/seed.ts" },
        ...(added === undefined
          ? []
          : [{ path: "files/added.ts", target: "@web/added/new.ts" }]),
      ],
      name: "notes",
      type: "saasaloy:feature",
    },
    name: "notes",
  };
  return {
    base: {
      declaration: {
        ownedFiles: [],
        retiredSeedFiles: [],
        seedFiles: ["saasaloy.json"],
      },
      files: new Map([
        ["AGENTS.md", AGENTS],
        ["README.md", "# {{PROJECT_NAME}}\n"],
        ["_agents/skills/demo/SKILL.md", "# demo skill\n"],
        [
          "package.json",
          `${JSON.stringify({ name: "{{PROJECT_NAME}}", scripts: {} }, null, 2)}\n`,
        ],
        [
          "saasaloy.json",
          `${JSON.stringify({ aliases: { "@web": "apps/web/src" }, base: "web", installed: [] }, null, 2)}\n`,
        ],
      ]),
    },
    modules: new Map([["notes", notes]]),
    ref,
    source: "test",
  };
}

const V1: ApplySide = {
  options: { projectName: "demo", testingMode: "off" },
  payload: payloadOf("v0.1.0", { merged: MERGED_V1, once: ONCE_V1 }),
  requested: ["notes"],
};
const V2: ApplySide = {
  options: { projectName: "demo", testingMode: "off" },
  payload: payloadOf("v0.2.0", {
    added: "export const added = 1;\n",
    merged: MERGED_V2,
    once: ONCE_V2,
  }),
  requested: ["notes"],
};
const MERGED_PATH = "apps/web/src/notes.ts";
const ONCE_PATH = "apps/web/src/seed.ts";

/** Every file under the project, symlinks and backups left out, path to bytes. */
async function tree(dir: string, prefix = ""): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (rel === ".saasaloy/backups" || entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      for (const [path, content] of await tree(join(dir, entry.name), rel)) {
        out.set(path, content);
      }
    } else {
      out.set(rel, await readFile(join(dir, entry.name), "utf-8"));
    }
  }
  return out;
}

async function v2Manifest(): Promise<ManifestV2> {
  const state = await readManifestState(root);
  if (state.kind !== "v2") {
    throw new Error(`expected a version 2 manifest, got ${state.kind}`);
  }
  return state.manifest;
}

describe(apply, () => {
  it("writes a project from nothing, with a version 2 manifest and the requested list", async () => {
    const report = await apply({ next: V1, root, version: "0.1.0" });
    expect(report.exitCode).toBe(0);
    await expect(readFile(join(root, MERGED_PATH), "utf-8")).resolves.toBe(
      MERGED_V1
    );
    const manifest = await v2Manifest();
    expect(manifest.version).toBe(2);
    const v1 = render(V1);
    expect(Object.keys(manifest.files).toSorted()).toStrictEqual([
      ...v1.files.keys(),
    ]);
    for (const [path, file] of v1.files) {
      expect(manifest.files[path]).toStrictEqual({
        class: file.class,
        from: file.from,
        hash: hashContent(file.content),
        module: file.module,
        version: "0.1.0",
      });
    }
    expect(manifest.files[ONCE_PATH]?.class).toBe("once");
    expect(manifest.files[MERGED_PATH]?.class).toBe("merged");
    const lock = await loadLock(root);
    expect(lock.requested).toStrictEqual(["notes"]);
    expect(lock.modules.notes).toMatchObject({
      ref: "v0.1.0",
      resolved: "v0.1.0",
      source: "test",
    });
    await expect(pathExists(join(root, JOURNAL_FILE))).resolves.toBeFalsy();
    // The skill link from `RenderResult.skills`.
    expect(
      (await lstat(join(root, ".claude/skills/demo"))).isSymbolicLink()
    ).toBeTruthy();
  });

  it("merges an edited merged file, leaves an edited once file, and records the new render", async () => {
    await apply({ next: V1, root, version: "0.1.0" });
    const mergedEdit = `// owner line\n${MERGED_V1}`;
    const onceEdit = "export const seed = 'owner';\n";
    await writeFile(join(root, MERGED_PATH), mergedEdit);
    await writeFile(join(root, ONCE_PATH), onceEdit);

    const report = await apply({
      next: V2,
      previous: V1,
      root,
      version: "0.2.0",
    });

    expect(report.exitCode).toBe(0);
    await expect(readFile(join(root, MERGED_PATH), "utf-8")).resolves.toBe(
      `// owner line\n${MERGED_V2}`
    );
    expect(report.results.find((r) => r.path === MERGED_PATH)?.kind).toBe(
      "clean"
    );
    await expect(readFile(join(root, ONCE_PATH), "utf-8")).resolves.toBe(
      onceEdit
    );
    expect(report.onceChanged).toStrictEqual([ONCE_PATH]);
    expect(report.lines).toContain(
      `upstream changed  ${ONCE_PATH} (written once; \`saasaloy update --merge ${ONCE_PATH}\` merges it)`
    );
    expect(report.lines.at(-1)).toContain("pnpm check");

    const manifest = await v2Manifest();
    // Every record holds the hash of the new render, except the `once` file: it keeps
    // the record of the release that wrote it, so its base stays findable.
    const expected = Object.fromEntries(
      [...render(V2).files].map(([path, file]) => [
        path,
        {
          class: file.class,
          hash: hashContent(path === ONCE_PATH ? ONCE_V1 : file.content),
        },
      ])
    );
    const recorded = Object.fromEntries(
      Object.entries(manifest.files).map(([path, record]) => [
        path,
        { class: record.class, hash: record.hash },
      ])
    );
    expect(recorded).toStrictEqual(expected);
    expect(manifest.files[ONCE_PATH]?.version).toBe("0.1.0");
    expect(manifest.files[MERGED_PATH]?.version).toBe("0.2.0");
    expect((await loadLock(root)).modules.notes?.ref).toBe("v0.2.0");
  });

  it("keeps an owner-deleted seed absent when its upstream content changes", async () => {
    await apply({ next: V1, root, version: "0.1.0" });
    await rm(join(root, ONCE_PATH));

    const report = await apply({
      next: V2,
      previous: V1,
      root,
      version: "0.2.0",
    });

    expect(report.exitCode).toBe(0);
    expect(report.keptDeleted).toContain(ONCE_PATH);
    await expect(pathExists(join(root, ONCE_PATH))).resolves.toBeFalsy();
    expect((await v2Manifest()).files[ONCE_PATH]).toMatchObject({
      class: "once",
      hash: hashContent(ONCE_V2),
    });
  });

  it("writes markers on a conflict, still moves the lock and the manifest, and exits 3", async () => {
    await apply({ next: V1, root, version: "0.1.0" });
    await writeFile(
      join(root, MERGED_PATH),
      MERGED_V1.replace("c = 3", "c = 99")
    );

    const report = await apply({
      next: V2,
      previous: V1,
      root,
      version: "0.2.0",
    });

    expect(report.exitCode).toBe(EXIT_WORK_PENDING);
    expect(report.pendingMerges).toStrictEqual([MERGED_PATH]);
    await expect(readFile(join(root, MERGED_PATH), "utf-8")).resolves.toContain(
      ">>>>>>> saasaloy 0.2.0"
    );
    expect((await v2Manifest()).pendingMerges).toStrictEqual([MERGED_PATH]);
    expect((await loadLock(root)).modules.notes?.ref).toBe("v0.2.0");

    // The next run refuses until the markers are gone, then clears the entry.
    const blocked = apply({ next: V2, previous: V2, root, version: "0.2.0" });
    await expect(blocked).rejects.toThrow(RefusalError);
    await writeFile(
      join(root, MERGED_PATH),
      MERGED_V2.replace("c = 30", "c = 99")
    );
    const clear = await apply({
      next: V2,
      previous: V2,
      root,
      version: "0.2.0",
    });
    expect(clear.exitCode).toBe(0);
    expect((await v2Manifest()).pendingMerges).toStrictEqual([]);
  });

  it("removes a module: deletes its unedited files and keeps an edited one", async () => {
    await apply({ next: V1, root, version: "0.1.0" });
    await writeFile(join(root, ONCE_PATH), "owner\n");
    const report = await apply({
      next: { ...V1, requested: [] },
      previous: V1,
      root,
      version: "0.1.0",
    });
    await expect(pathExists(join(root, MERGED_PATH))).resolves.toBeFalsy();
    await expect(readFile(join(root, ONCE_PATH), "utf-8")).resolves.toBe(
      "owner\n"
    );
    expect(report.keptEdited).toStrictEqual([ONCE_PATH]);
    const manifest = await v2Manifest();
    expect(manifest.files[MERGED_PATH]).toBeUndefined();
    expect(manifest.files[ONCE_PATH]).toBeUndefined();
    expect((await loadLock(root)).requested).toStrictEqual([]);
  });

  it("refuses under the `touched` rule when a file to merge has uncommitted changes", async () => {
    await apply({ next: V1, root, version: "0.1.0" });
    const git = (...args: string[]): void => {
      execFileSync("git", args, { cwd: root, stdio: "ignore" });
    };
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    await writeFile(join(root, "untracked-note.md"), "new file\n");

    // A new untracked file elsewhere does not stop the run.
    const dry = await apply({
      cleanTree: "touched",
      dryRun: true,
      next: V2,
      previous: V1,
      root,
      version: "0.2.0",
    });
    expect(dry.exitCode).toBe(0);

    await writeFile(join(root, MERGED_PATH), `// owner line\n${MERGED_V1}`);
    const run = apply({
      cleanTree: "touched",
      next: V2,
      previous: V1,
      root,
      version: "0.2.0",
    });
    await expect(run).rejects.toThrow(MERGED_PATH);
    await expect(
      apply({
        cleanTree: "whole",
        dryRun: true,
        next: V2,
        previous: V1,
        root,
        version: "0.2.0",
      })
    ).rejects.toThrow(RefusalError);
    // `force` overrides the rule.
    const forced = await apply({
      cleanTree: "touched",
      force: true,
      next: V2,
      previous: V1,
      root,
      version: "0.2.0",
    });
    expect(forced.exitCode).toBe(0);
  });

  it("writes nothing on a dry run", async () => {
    const report = await apply({
      dryRun: true,
      next: V1,
      root,
      version: "0.1.0",
    });
    expect(report.changed).toContain(MERGED_PATH);
    await expect(readdir(root)).resolves.toStrictEqual([]);
  });

  it("refuses with exit 2 after an unfinished run, and abort restores the tree byte for byte", async () => {
    await apply({ next: V1, root, version: "0.1.0" });
    await writeFile(join(root, MERGED_PATH), `// owner line\n${MERGED_V1}`);
    const before = await tree(root);

    let writes = 0;
    await expect(
      apply({
        beforeWrite: () => {
          writes += 1;
          if (writes === 2) {
            throw new Error("killed mid-run");
          }
        },
        next: V2,
        previous: V1,
        root,
        version: "0.2.0",
      })
    ).rejects.toThrow("killed mid-run");
    await expect(pathExists(join(root, JOURNAL_FILE))).resolves.toBeTruthy();
    await expect(tree(root)).resolves.not.toStrictEqual(before);

    const next = apply({ next: V2, previous: V1, root, version: "0.2.0" });
    await expect(next).rejects.toThrow(RefusalError);
    expect(exitCodeFor(await next.catch((error: unknown) => error))).toBe(
      EXIT_REFUSED
    );

    await abortApply(root);
    await expect(pathExists(join(root, JOURNAL_FILE))).resolves.toBeFalsy();
    const after = await tree(root);
    expect([...after.keys()].toSorted()).toStrictEqual(
      [...before.keys()].toSorted()
    );
    for (const [path, content] of before) {
      expect({ content: after.get(path), path }).toStrictEqual({
        content,
        path,
      });
    }

    // With the journal gone, the run goes through.
    const report = await apply({
      next: V2,
      previous: V1,
      root,
      version: "0.2.0",
    });
    expect(report.exitCode).toBe(0);
  });
});

describe("apply over the real registry", () => {
  let side: ApplySide;

  beforeAll(async () => {
    const presets = JSON.parse(
      await readFile(join(REPO_ROOT, "scripts/play-presets.json"), "utf-8")
    ) as { full: { modules: string[] } };
    const requested = [...presets.full.modules, "database-postgres"];
    side = {
      options: { projectName: "real-app", testingMode: "off" },
      payload: await loadPayload({
        env: { [REGISTRY_ENV]: MODULES_DIR },
        ref: "local",
        requested,
      }),
      requested,
    };
  }, 60_000);

  it("re-applies the full preset with no change, and a remove then add gives the same tree", async () => {
    const first = await apply({ next: side, root, version: "0.10.0" });
    expect(first.exitCode).toBe(0);
    const start = await tree(root);

    const again = await apply({
      next: side,
      previous: side,
      root,
      version: "0.10.0",
    });
    expect(again.changed).toStrictEqual([]);

    const without: ApplySide = {
      ...side,
      requested: side.requested.filter((name) => name !== "waitlist"),
    };
    const removed = await apply({
      next: without,
      previous: side,
      root,
      version: "0.10.0",
    });
    expect(removed.exitCode).toBe(0);
    expect(removed.results.some((r) => r.kind === "deleted")).toBeTruthy();
    const back = await apply({
      next: side,
      previous: without,
      root,
      version: "0.10.0",
    });
    expect(back.exitCode).toBe(0);

    const end = await tree(root);
    const differing = [...new Set([...start.keys(), ...end.keys()])].filter(
      (path) => start.get(path) !== end.get(path)
    );
    expect(differing).toStrictEqual([]);
  }, 60_000);
});
