import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathExists } from "./fs-utils.js";

// Merge a module's npm deps into the consumer project's root package.json (build spec
// §2.4 "apply files + npm deps"). Descriptors carry two buckets — `dependencies[]` and
// `devDependencies[]` — each an exact-pinned `name@version` (schema-enforced). A bare
// name still parses (falling back to "latest"), but descriptors no longer author them.
//
// Scope note: v1 adds deps at the project root. Routing each dep to the specific
// workspace it belongs to (apps/api vs packages/db) needs the capability modules'
// workspace conventions (issues #8/#9), which don't exist yet — root placement is
// deterministic, reversible, and hoists across the pnpm workspace until then.

/** Split `name@version` into parts, keeping the leading `@` of a scoped name intact. */
export function parseDep(spec: string): { name: string; version: string } {
  const at = spec.lastIndexOf("@");
  if (at > 0) {
    return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  }
  return { name: spec, version: "latest" };
}

export interface DepChange {
  name: string;
  version: string;
}

export interface AddDepsResult {
  /** Deps newly written into `dependencies`. */
  added: DepChange[];
  /** Deps newly written into `devDependencies`. */
  devAdded: DepChange[];
  /** Deps already present in either bucket (left untouched). */
  skipped: string[];
  /** Human-readable version disagreements — the kept version won, the other was ignored. */
  conflicts: string[];
}

/**
 * Compute which deps are new vs already declared, without touching disk. `dependencies`
 * is planned first and claims a name across both buckets: a package can't land in both,
 * and `dependencies` wins (a `devDependencies` entry for an already-claimed name is
 * dropped). Within a bucket, the first module to declare a dep wins (topological order).
 */
export function planDeps(pkg: PackageJson, deps: string[], devDeps: string[] = []): AddDepsResult {
  const conflicts: string[] = [];
  const skipped: string[] = [];
  // Name → chosen version across both buckets, so a later module — or the dev bucket —
  // pinning a different version is a real disagreement worth surfacing, not silently dropping.
  const seen = new Map<string, string>();

  function planBucket(specs: string[], existing: Record<string, string>): DepChange[] {
    const out: DepChange[] = [];
    for (const spec of specs) {
      const { name, version } = parseDep(spec);
      const prior = seen.get(name);
      if (prior !== undefined) {
        if (prior !== version) {
          conflicts.push(`${name}: keeping ${prior}, ignoring ${version}`);
        }
        continue;
      }
      seen.set(name, version);
      const current = existing[name];
      if (current !== undefined) {
        if (version !== "latest" && current !== version) {
          conflicts.push(`${name}: package.json already has ${current}, ignoring ${version}`);
        }
        skipped.push(name);
      } else {
        out.push({ name, version });
      }
    }
    return out;
  }

  const added = planBucket(deps, pkg.dependencies ?? {});
  const devAdded = planBucket(devDeps, pkg.devDependencies ?? {});
  return { added, devAdded, skipped, conflicts };
}

export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export async function readRootPackageJson(root: string): Promise<PackageJson | null> {
  const file = join(root, "package.json");
  if (!(await pathExists(file))) return null;
  return JSON.parse(await readFile(file, "utf8")) as PackageJson;
}

/** Merge additions into an existing bucket, keeping keys sorted. */
function mergeSorted(
  existing: Record<string, string> | undefined,
  added: DepChange[],
): Record<string, string> {
  const merged = { ...(existing ?? {}) };
  for (const { name, version } of added) {
    merged[name] = version;
  }
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(merged).sort()) {
    sorted[key] = merged[key]!;
  }
  return sorted;
}

/** Apply the planned additions to package.json on disk, keeping each bucket sorted. */
export async function writeDeps(
  root: string,
  pkg: PackageJson,
  added: DepChange[],
  devAdded: DepChange[] = [],
): Promise<void> {
  if (added.length === 0 && devAdded.length === 0) return;
  if (added.length > 0) pkg.dependencies = mergeSorted(pkg.dependencies, added);
  if (devAdded.length > 0) pkg.devDependencies = mergeSorted(pkg.devDependencies, devAdded);
  const file = join(root, "package.json");
  await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}
