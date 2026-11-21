import { readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { readIfPresent } from "./fs-utils.js";
import { BASE_DECLARATION, renderedName } from "./scaffold.js";
import { TABLE_SHAPES } from "./schema.js";
import type { RegistryTable } from "./schema.js";

export { BASE_DECLARATION } from "./scaffold.js";

// The base template as the render reads it (#120, ADR 0032, plan 0116). The template ships
// inside the CLI package, and its files record in the manifest under the reserved module
// name `base`. `_saasaloy-base.json` declares which of its files the owner is meant to
// rewrite: `seedFiles` and the `ownedFiles` globs are written once (`engine/classes.ts`).

/** The reserved module name base files record under. Never in `saasaloy.json`'s `installed`. */
export const BASE_MODULE = "base";

export interface BaseDeclaration {
  /**
   * Project-relative POSIX paths the owner is meant to rewrite; written once. Includes
   * `retiredSeedFiles`, so every caller that skips a seed skips those too.
   */
  seedFiles: string[];
  /**
   * Seed paths the template no longer ships, because the seed moved: the root
   * `DESIGN.md` that moved to `apps/web/DESIGN.md` is the case. Folded into `seedFiles`.
   */
  retiredSeedFiles: string[];
  /**
   * Globs for files the template ships once and the project owns afterwards — the blocks,
   * the components, `globals.css`, the favicon. Each one is written once: created when
   * the path is new, then left to the project. `**` matches any number of segments, `*`
   * one.
   */
  ownedFiles: string[];
  /**
   * The registration tables the template's own files hold (plan 0116, Phase 7), in the
   * descriptor's `tables` form. Each one renders as a generated file beside the file
   * that spreads it.
   */
  tables?: RegistryTable[];
}

/**
 * A `*`/`**` glob compiled against project-relative POSIX targets. Deliberately small:
 * the declaration is ours, so the patterns are the handful this file documents rather
 * than arbitrary user input.
 */
export function compileGlob(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map((segment) =>
      segment === "**"
        ? "[^\0]*"
        : segment
            .replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
            .replaceAll("*", "[^/]*")
    )
    .join("/")
    .replaceAll("[^\0]*/", "(?:[^\0]*/)?");
  return new RegExp(`^${source}$`);
}

/** Whether a target is one of the project's owned files rather than the template's. */
export function ownedMatcher(
  declaration: BaseDeclaration
): (target: string) => boolean {
  const patterns = declaration.ownedFiles.map(compileGlob);
  return (target: string) => patterns.some((re) => re.test(target));
}

/** One file the template ships, before and after the `_` → `.` rename. */
export interface TemplateFile {
  /** Template-relative POSIX source path — the manifest's `from`. */
  from: string;
  /** Project-relative POSIX path once rendered — the manifest key. */
  target: string;
  /** Absolute path of the source file inside the template. */
  abs: string;
}

/**
 * Read `_saasaloy-base.json` off a template. A template with none has no seed files. The
 * declaration ships inside this package, so a malformed one is a build error worth a
 * plain throw rather than a refusal aimed at the user.
 */
export async function readBaseDeclaration(
  templateDir: string
): Promise<BaseDeclaration> {
  const raw = await readIfPresent(join(templateDir, BASE_DECLARATION));
  if (raw === undefined) {
    return { seedFiles: [], retiredSeedFiles: [], ownedFiles: [] };
  }
  const parsed = JSON.parse(raw) as {
    seedFiles?: unknown;
    retiredSeedFiles?: unknown;
    ownedFiles?: unknown;
    tables?: unknown;
  };
  const seedFiles = parsed.seedFiles;
  if (
    !Array.isArray(seedFiles) ||
    !seedFiles.every((entry) => typeof entry === "string" && entry !== "")
  ) {
    throw new Error(
      `${BASE_DECLARATION} must declare "seedFiles" as a list of project-relative paths.`
    );
  }
  const retiredSeedFiles = parsed.retiredSeedFiles ?? [];
  if (
    !Array.isArray(retiredSeedFiles) ||
    !retiredSeedFiles.every(
      (entry) => typeof entry === "string" && entry !== ""
    )
  ) {
    throw new Error(
      `${BASE_DECLARATION} must declare "retiredSeedFiles" as a list of project-relative paths.`
    );
  }
  const ownedFiles = parsed.ownedFiles ?? [];
  if (
    !Array.isArray(ownedFiles) ||
    !ownedFiles.every((entry) => typeof entry === "string" && entry !== "")
  ) {
    throw new Error(
      `${BASE_DECLARATION} must declare "ownedFiles" as a list of project-relative globs.`
    );
  }
  const tables = parsed.tables ?? [];
  if (!Array.isArray(tables) || !tables.every(isTable)) {
    throw new Error(
      `${BASE_DECLARATION} must declare "tables" as a list of { id, file, shape } objects.`
    );
  }
  return {
    seedFiles: [...(seedFiles as string[]), ...(retiredSeedFiles as string[])],
    retiredSeedFiles: retiredSeedFiles as string[],
    ownedFiles: ownedFiles as string[],
    ...(tables.length > 0 ? { tables } : {}),
  };
}

function isTable(value: unknown): value is RegistryTable {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const table = value as Partial<Record<keyof RegistryTable, unknown>>;
  return (
    typeof table.id === "string" &&
    typeof table.file === "string" &&
    (TABLE_SHAPES as readonly unknown[]).includes(table.shape)
  );
}

/**
 * Whether a template file is the render of a generated table (plan 0116, Phase 7). The
 * template holds one for each of its tables, the render with no module rows, so the
 * template's own tests can import the file that spreads it. It never ships: the render
 * writes each generated file itself.
 */
export function isGeneratedFile(name: string): boolean {
  return name.endsWith(".generated.ts");
}

/** Every file the template ships, sorted by target, the declaration and the generated tables excluded. */
export async function listTemplateFiles(
  templateDir: string
): Promise<TemplateFile[]> {
  const out: TemplateFile[] = [];
  const walk = async (
    dir: string,
    fromPrefix: string,
    targetPrefix: string,
    isRoot: boolean
  ): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (isRoot && entry.name === BASE_DECLARATION) {
        continue;
      }
      const from = posix.join(fromPrefix, entry.name);
      const target = posix.join(targetPrefix, renderedName(entry.name));
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, from, target, false);
      } else if (entry.isFile() && !isGeneratedFile(entry.name)) {
        out.push({ from, target, abs });
      }
    }
  };
  await walk(templateDir, "", "", true);
  return out.toSorted((a, b) => (a.target < b.target ? -1 : 1));
}
