import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathExists } from "./fs-utils.js";

// Merge a module's npm `dependencies[]` into the consumer project's root package.json
// (build spec §2.4 "apply files + npm deps"). A dep may be bare (`zod`) or pinned
// (`zod@3.23.8`); bare names land as "latest" and get resolved on the next install.
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
  /** Deps newly written into package.json. */
  added: DepChange[];
  /** Deps already present (left untouched). */
  skipped: string[];
  /** Human-readable version disagreements — the kept version won, the other was ignored. */
  conflicts: string[];
}

/** Compute which deps are new vs already declared, without touching disk. */
export function planDeps(pkg: PackageJson, deps: string[]): AddDepsResult {
  const existing = pkg.dependencies ?? {};
  const added: DepChange[] = [];
  const skipped: string[] = [];
  const conflicts: string[] = [];
  // First module to declare a dep wins (topological order); a later module pinning a
  // different version is a real disagreement worth surfacing, not silently dropping.
  const seen = new Map<string, string>();
  for (const spec of deps) {
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
      added.push({ name, version });
    }
  }
  return { added, skipped, conflicts };
}

export interface PackageJson {
  dependencies?: Record<string, string>;
  [key: string]: unknown;
}

export async function readRootPackageJson(root: string): Promise<PackageJson | null> {
  const file = join(root, "package.json");
  if (!(await pathExists(file))) return null;
  return JSON.parse(await readFile(file, "utf8")) as PackageJson;
}

/** Apply the planned additions to package.json on disk, keeping dependencies sorted. */
export async function writeDeps(
  root: string,
  pkg: PackageJson,
  added: DepChange[],
): Promise<void> {
  if (added.length === 0) return;
  const deps = { ...(pkg.dependencies ?? {}) };
  for (const { name, version } of added) {
    deps[name] = version;
  }
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(deps).sort()) {
    sorted[key] = deps[key]!;
  }
  pkg.dependencies = sorted;
  const file = join(root, "package.json");
  await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}
