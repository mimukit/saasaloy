import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { listModuleFiles } from "../../src/lib/applier.js";
import {
  detectCollisions,
  formatCollisions,
} from "../../src/lib/collisions.js";
import { LocalRegistrySource } from "../../src/lib/registry.js";
import type { LoadedModule, RegistrySource } from "../../src/lib/registry.js";
import { detectMissingRequirements } from "../../src/lib/requires.js";
import { mergeGraph, resolveGraph } from "../../src/lib/resolve.js";
import type { Graph } from "../../src/lib/resolve.js";
import { loadConfig } from "../../src/lib/saasaloy-config.js";
import { baseTemplateDir } from "../../src/lib/scaffold.js";
import { repoModulesDir } from "../support/cli.js";

// The signature failure mode of a module system is *module A plus module B*: two
// descriptors writing the same file, two scaffolds claiming one alias for different
// directories, or two modules pinning one npm package to different versions. Nothing
// tested that, and the module count keeps growing.
//
// The matrix is derived, never maintained: it reads `modules/*/registry-item.json` off
// disk, so a new module joins by existing. Each pair is its own `it`, named by both
// modules, so a failure says which two disagree rather than which index failed.
//
// Depth here is the conflict report only (plan, 2026-09-01). Typechecking a scaffolded
// project per pair needs an installed workspace and the `^build` chain, which is too
// heavy for 120+ pairs in a PR gate; the nightly full run owns that, and it can be
// promoted here if the timing turns out to be cheap.

const MODULES_DIR = repoModulesDir();

// A module can require its way around in a circle in theory; the same cap `add` uses
// stops this from looping if one ever does.
const MAX_REQUIREMENT_ROUNDS = 8;

/**
 * `LocalRegistrySource`, reading each descriptor once. The matrix resolves the same
 * modules hundreds of times, and every uncached read re-parses and re-validates the JSON.
 */
function cachingSource(dir: string): RegistrySource {
  const inner = new LocalRegistrySource(dir);
  const cache = new Map<string, Promise<LoadedModule>>();
  return {
    label: inner.label,
    commitSubjects: inner.commitSubjects.bind(inner),
    listModules: inner.listModules.bind(inner),
    provenance: inner.provenance.bind(inner),
    resolveSha: inner.resolveSha.bind(inner),
    readModule(name: string, requiredBy?: string) {
      const hit = cache.get(name);
      if (hit) {
        return hit;
      }
      const read = inner.readModule(name, requiredBy);
      cache.set(name, read);
      return read;
    },
  };
}

const source = cachingSource(MODULES_DIR);

let names: string[];
let baseAliases: Record<string, string>;

beforeAll(async () => {
  names = await source.listModules();
  baseAliases = (await loadConfig(await baseTemplateDir())).aliases;
});

/**
 * The graph `add` would build for this set: both modules, their prerequisites, and a
 * driver for every unmet `requiresOneOf`. The first option is what the prompt offers
 * first, so it is what an operator most often picks.
 */
async function resolveSet(modules: string[]): Promise<Graph> {
  let graph: Graph = { modules: new Map(), order: [] };
  for (const name of modules) {
    graph = mergeGraph(graph, await resolveGraph(source, name));
  }
  const config = { aliases: {}, installed: [] };
  for (let round = 0; round < MAX_REQUIREMENT_ROUNDS; round++) {
    const unmet = detectMissingRequirements({ config, graph });
    const first = unmet[0]?.options[0];
    if (!first) {
      break;
    }
    graph = mergeGraph(graph, await resolveGraph(source, first));
  }
  return graph;
}

/** Every module in the graph that another one refuses to sit beside. */
function declaredConflicts(graph: Graph): string[] {
  const present = new Set(graph.order);
  const found: string[] = [];
  for (const name of graph.order) {
    for (const other of graph.modules.get(name)?.item.conflictsWith ?? []) {
      if (present.has(other) && name < other) {
        found.push(`${name} + ${other}`);
      }
    }
  }
  return found;
}

interface AliasClash {
  alias: string;
  paths: string[];
}

/** Two scaffolds registering one alias for different directories. */
function aliasClashes(
  graph: Graph,
  base: Record<string, string>
): AliasClash[] {
  const seen = new Map<string, Set<string>>();
  for (const [alias, path] of Object.entries(base)) {
    seen.set(alias, new Set([path]));
  }
  for (const name of graph.order) {
    for (const scaffold of graph.modules.get(name)?.item.scaffolds ?? []) {
      for (const [alias, path] of Object.entries(scaffold.aliases ?? {})) {
        const paths = seen.get(alias) ?? new Set<string>();
        paths.add(path);
        seen.set(alias, paths);
      }
    }
  }
  return [...seen]
    .filter(([, paths]) => paths.size > 1)
    .map(([alias, paths]) => ({ alias, paths: [...paths] }));
}

interface DepClash {
  pkg: string;
  pins: string[];
}

/** One npm package pinned to two versions by two modules in the same set. */
function dependencyClashes(graph: Graph): DepClash[] {
  const pins = new Map<string, Map<string, string[]>>();
  for (const name of graph.order) {
    const item = graph.modules.get(name)?.item;
    for (const dep of [
      ...(item?.dependencies ?? []),
      ...(item?.devDependencies ?? []),
    ]) {
      const at = dep.lastIndexOf("@");
      const pkg = dep.slice(0, at);
      const version = dep.slice(at + 1);
      const byVersion = pins.get(pkg) ?? new Map<string, string[]>();
      byVersion.set(version, [...(byVersion.get(version) ?? []), name]);
      pins.set(pkg, byVersion);
    }
  }
  return [...pins]
    .filter(([, byVersion]) => byVersion.size > 1)
    .map(([pkg, byVersion]) => ({
      pins: [...byVersion].map(
        ([version, modules]) => `${version} (${modules.join(", ")})`
      ),
      pkg,
    }));
}

/** Every illegal same-run file overlap, using the applier's own rule. */
async function fileCollisions(graph: Graph): Promise<string> {
  const aliases = { ...baseAliases };
  for (const name of graph.order) {
    for (const scaffold of graph.modules.get(name)?.item.scaffolds ?? []) {
      Object.assign(aliases, scaffold.aliases ?? {});
    }
  }
  const installed = new Set(graph.order);
  const planned = [];
  for (const name of graph.order) {
    const mod = graph.modules.get(name);
    if (!mod) {
      continue;
    }
    const files = await listModuleFiles(mod, aliases, installed);
    planned.push({ module: name, targets: [...files.keys()] });
  }
  const collisions = detectCollisions({ modules: graph.modules, planned });
  return collisions.length === 0 ? "" : formatCollisions(collisions);
}

/** Every finding against one set of modules, as lines a failure message can print. */
async function findings(modules: string[]): Promise<string[]> {
  const graph = await resolveSet(modules);

  const conflicts = declaredConflicts(graph);
  if (conflicts.length > 0) {
    // A declared `conflictsWith` pair is a refusal by design: `add` stops before writing
    // anything, so there is nothing left to check about how they would combine.
    return [];
  }

  const lines: string[] = [];
  for (const clash of aliasClashes(graph, baseAliases)) {
    lines.push(
      `alias ${clash.alias} is registered for ${clash.paths.join(" and ")}`
    );
  }
  for (const clash of dependencyClashes(graph)) {
    lines.push(`${clash.pkg} is pinned to ${clash.pins.join(" and ")}`);
  }
  const collisions = await fileCollisions(graph);
  if (collisions) {
    lines.push(collisions);
  }
  return lines;
}

describe("the module matrix is derived from disk", () => {
  it("finds the modules this repo ships", () => {
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain("api");
  });
});

describe("every module applies on its own", () => {
  it.each(nameCases())("$name", async ({ name }) => {
    await expect(findings([name])).resolves.toStrictEqual([]);
  });
});

describe("every pair of modules applies together", () => {
  it.each(pairCases())("$a + $b", async ({ a, b }) => {
    await expect(findings([a, b])).resolves.toStrictEqual([]);
  });
});

// vitest builds an `it.each` table at collection time, before any hook runs, so the case
// list is read off disk synchronously here rather than from the `names` the hook resolves.
function moduleNamesSync(): string[] {
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(MODULES_DIR, entry.name, "registry-item.json"))
    )
    .map((entry) => entry.name)
    .toSorted();
}

function nameCases(): { name: string }[] {
  return moduleNamesSync().map((name) => ({ name }));
}

function pairCases(): { a: string; b: string }[] {
  const all = moduleNamesSync();
  const pairs: { a: string; b: string }[] = [];
  for (const [index, a] of all.entries()) {
    for (const b of all.slice(index + 1)) {
      pairs.push({ a, b });
    }
  }
  return pairs;
}
