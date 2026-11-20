import { readdirSync } from "node:fs";
import { lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { apply, planApply } from "../../src/engine/apply.js";
import type { ApplySide } from "../../src/engine/apply.js";
import {
  emptyManifestV2,
  serializeManifestV2,
} from "../../src/engine/manifest.js";
import type { ManifestV2 } from "../../src/engine/manifest.js";
import {
  readPayloadBase,
  readPayloadModules,
} from "../../src/engine/payload.js";
import type { Payload } from "../../src/engine/payload.js";
import { closure, render } from "../../src/engine/render.js";
import type { RenderResult } from "../../src/engine/render.js";
import { baseTemplateDir } from "../../src/lib/scaffold.js";
import { repoModulesDir } from "../support/cli.js";

// The registry round trip of plan 0116, Phase 4, on the render engine:
//
//   1. for each module in `modules/`, `add` on a fresh base and then `remove` gives the
//      starting tree byte for byte;
//   2. for each pair of modules with no dependency edge between them and no
//      `conflictsWith`, both add orders give the same tree.
//
// Both run the engine in process. Part 1 runs the real `apply` on a temp folder, the
// path `saasaloy add` and `saasaloy remove` take. Part 2 is
// about 1,500 pairs and four applies each, so it runs `planApply`, the decision `apply`
// makes, on in-memory trees: the same code decides every path, and only the disk writes
// are left out.
//
// A module with a `requiresOneOf` choice takes the first option, as the combinations
// matrix does; a pair takes the drivers its union needs, in both orders and both steps.

const MODULES_DIR = repoModulesDir();
const PROJECT = "round-trip";
const VERSION = "0.0.0-test";
const OPTIONS = { projectName: PROJECT, testingMode: "off" } as const;
const MAX_REQUIREMENT_ROUNDS = 8;

let payload: Payload;
let names: string[];

beforeAll(async () => {
  names = (await readdir(MODULES_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  payload = {
    base: await readPayloadBase(await baseTemplateDir()),
    modules: await readPayloadModules(MODULES_DIR, names),
    ref: "local",
    source: "local",
  };
}, 120_000);

/**
 * `modules` plus an option of every `requiresOneOf` the set leaves unmet: one in
 * `prefer` when the choice offers one, else the first.
 */
function withDrivers(
  modules: readonly string[],
  prefer: ReadonlySet<string> = new Set()
): string[] {
  const set = [...modules];
  for (let round = 0; round < MAX_REQUIREMENT_ROUNDS; round++) {
    const unmet = firstUnmet(closure(payload, set));
    if (unmet === undefined) {
      return set;
    }
    set.push(unmet.find((option) => prefer.has(option)) ?? unmet[0] ?? "");
  }
  return set;
}

/** The first `requiresOneOf` list the set meets with none of its options. */
function firstUnmet(members: ReadonlySet<string>): string[] | undefined {
  return [...members]
    .toSorted()
    .map((name) => payload.modules.get(name)?.item.requiresOneOf ?? [])
    .find(
      (options) =>
        options.length > 0 && !options.some((option) => members.has(option))
    );
}

function side(requested: readonly string[]): ApplySide {
  return { options: OPTIONS, payload, requested };
}

/** Every file under `root` but the run's backups, as path to bytes. Links by target. */
async function snapshot(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split(sep).join("/");
      if (rel === ".saasaloy/backups") {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(abs);
      } else if ((await lstat(abs)).isSymbolicLink()) {
        files.set(rel, "<link>");
      } else {
        files.set(rel, await readFile(abs, "utf-8"));
      }
    }
  };
  await walk(root);
  return files;
}

/** The first paths where two trees differ, for a failure message that says where. */
function differences(
  a: ReadonlyMap<string, string>,
  b: ReadonlyMap<string, string>
): string[] {
  const out: string[] = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(path) !== b.get(path)) {
      out.push(
        `${path}: ${a.has(path) ? "present" : "absent"} / ${b.has(path) ? "present" : "absent"}`
      );
    }
  }
  return out.toSorted().slice(0, 20);
}

describe("registry round trip — add then remove gives the starting tree", () => {
  // Collected at import time, so each module is its own `it`.
  const modules = readdirSyncNames();

  it.each(modules)(
    "%s",
    async (name) => {
      const root = await mkdtemp(join(tmpdir(), "saasaloy-round-trip-"));
      try {
        const set = withDrivers([name]);
        const format = noFormat;
        await apply({ format, next: side([]), root, version: VERSION });
        const start = await snapshot(root);
        const added = await apply({
          format,
          next: side(set),
          previous: side([]),
          root,
          version: VERSION,
        });
        expect(added.pendingMerges).toStrictEqual([]);
        expect(added.changed.length).toBeGreaterThan(0);
        const removed = await apply({
          format,
          next: side([]),
          previous: side(set),
          root,
          version: VERSION,
        });
        expect(removed.pendingMerges).toStrictEqual([]);
        const end = await snapshot(root);
        expect(differences(start, end)).toStrictEqual([]);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
    60_000
  );
});

function readdirSyncNames(): string[] {
  // `it.each` needs the list before `beforeAll` runs.
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

/** Some module of the set names another one in its `conflictsWith`. */
function holdsConflict(set: ReadonlySet<string>): boolean {
  return [...set].some((name) =>
    (payload.modules.get(name)?.item.conflictsWith ?? []).some((other) =>
      set.has(other)
    )
  );
}

// --- Pairs, in memory -------------------------------------------------------------------

interface Tree {
  files: Map<string, string>;
  manifest: ManifestV2;
}

/** No Prettier: the raw render is what lands. */
function noFormat(): Promise<string | undefined> {
  // oxlint-disable-next-line unicorn/no-useless-undefined -- the formatter's contract is `string | undefined`
  return Promise.resolve(undefined);
}

const noMerge = {
  merge: (): never => {
    throw new Error("a fresh base must not need a merge");
  },
};

/** One apply on an in-memory tree, decided by `planApply`. */
async function step(
  tree: Tree,
  from: RenderResult | undefined,
  to: RenderResult
): Promise<Tree> {
  const plan = await planApply({
    format: noFormat,
    manifest: tree.manifest,
    merger: noMerge,
    read: (path) => Promise.resolve(tree.files.get(path)),
    root: "/round-trip-in-memory",
    theirs: to,
    version: VERSION,
    ...(from === undefined ? {} : { base: from }),
  });
  const files = new Map(tree.files);
  for (const result of plan.results) {
    if (result.after === undefined) {
      files.delete(result.path);
    } else {
      files.set(result.path, result.after);
    }
  }
  return { files, manifest: plan.manifest };
}

function treeKey(tree: Tree): Map<string, string> {
  return new Map([
    ...tree.files,
    [".saasaloy/manifest.json", serializeManifestV2(tree.manifest)],
  ]);
}

describe("registry round trip — both add orders give the same tree", () => {
  it("holds for every pair with no dependency edge and no conflictsWith", async () => {
    const renders = new Map<string, RenderResult>();
    const renderOf = (set: readonly string[]): RenderResult => {
      const key = [...new Set(set)].toSorted().join(",");
      let hit = renders.get(key);
      if (hit === undefined) {
        hit = render(side(set));
        renders.set(key, hit);
      }
      return hit;
    };
    const empty = renderOf([]);
    const init = await step(
      { files: new Map(), manifest: emptyManifestV2() },
      undefined,
      empty
    );

    const closures = new Map(
      names.map((name) => [name, closure(payload, [name])])
    );
    const conflicts = (a: string, b: string): boolean => {
      const union = new Set([
        ...(closures.get(a) ?? []),
        ...(closures.get(b) ?? []),
      ]);
      return holdsConflict(union);
    };

    const failures: string[] = [];
    let checked = 0;
    for (const [i, a] of names.entries()) {
      for (const b of names.slice(i + 1)) {
        if (
          closures.get(a)?.has(b) ||
          closures.get(b)?.has(a) ||
          conflicts(a, b)
        ) {
          continue;
        }
        const drivers = withDrivers([a, b]).slice(2);
        const unionSet = closure(payload, [a, b, ...drivers]);
        if (holdsConflict(unionSet)) {
          continue;
        }
        // Each first step takes the drivers it needs, from the pair's own choice.
        const chosen = new Set([...unionSet, a, b]);
        const both = renderOf([a, b, ...drivers]);
        const onlyA = renderOf(withDrivers([a, ...drivers], chosen));
        const onlyB = renderOf(withDrivers([b, ...drivers], chosen));
        const ab = await step(await step(init, empty, onlyA), onlyA, both);
        const ba = await step(await step(init, empty, onlyB), onlyB, both);
        const diff = differences(treeKey(ab), treeKey(ba));
        if (diff.length > 0) {
          failures.push(`${a} + ${b}: ${diff.join("; ")}`);
        }
        checked++;
        // A render holds the whole project; keep the cache to the pair at hand.
        if (renders.size > 200) {
          renders.clear();
          renders.set("", empty);
        }
      }
    }
    expect(failures).toStrictEqual([]);
    expect(checked).toBeGreaterThan(500);
    console.log(`round trip: ${String(checked)} pairs, both orders equal`);
  }, 1_200_000);
});
