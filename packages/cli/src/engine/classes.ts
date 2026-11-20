import type { BaseDeclaration } from "../lib/base.js";
import { BASE_MODULE, ownedMatcher } from "../lib/base.js";

// The class of each rendered file (plan 0116, "File classes"). One function decides it,
// so `apply` never asks a second question about whether it may overwrite a path:
//
//   generated  the CLI writes it in full on every run
//   merged     a three-way merge of the old render, the new render and the disk
//   once       written when the path is new, then left alone
//
// Today's three spellings of "the owner rewrites this" all map to `once`: the base's
// `seedFiles` and `ownedFiles` (`_saasaloy-base.json`) and a module entry's `seed` flag
// (ADR 0060), except the base files in `INTERIM_MERGED`. Nothing is `generated` until the tables move in Phase 7.

export type FileClass = "generated" | "merged" | "once";

export const FILE_CLASSES: readonly FileClass[] = [
  "generated",
  "merged",
  "once",
];

/**
 * Base files the declaration lists as seed or owned, classed `merged` during the build
 * (plan 0116, re-grill Q1 to Q4). The old engine still reads `_saasaloy-base.json`, so
 * the exceptions live here:
 *
 * - `saasaloy.json` merges by key, so the module aliases and `installed` stay true and an
 *   owner's own alias survives (Q3). Phase 6 drops it from `seedFiles`.
 * - `packages/env/.env.example` merges three ways: the owner's values stay, a new
 *   module's keys arrive, and a removed module's unedited keys go (Q2). Phase 6 drops it
 *   from `ownedFiles`.
 * - The four owned files that hold a registration table, so `add` can register a module
 *   in them until Phase 7 moves each table to a generated file and drops this rule (Q1).
 */
export const INTERIM_MERGED: ReadonlySet<string> = new Set([
  "saasaloy.json",
  "packages/env/.env.example",
  "packages/env/src/services.ts",
  "packages/env/src/sources.ts",
  "packages/tooling/src/targets.ts",
  "packages/ui/src/blocks/navbar.tsx",
]);

export interface ClassInput {
  /** Project-relative POSIX path of the rendered file. */
  path: string;
  /** The module that wrote the file: a module name, or `base` for the template. */
  module: string;
  /** The base template's `_saasaloy-base.json`. */
  declaration: BaseDeclaration;
  /** The descriptor entry that wrote a module file. Absent for a base file. */
  entry?: { seed?: boolean };
}

/** A class function bound to one declaration, so the globs compile once per render. */
export function classifier(
  declaration: BaseDeclaration
): (input: Omit<ClassInput, "declaration">) => FileClass {
  const owned = ownedMatcher(declaration);
  const seeds = new Set(declaration.seedFiles);
  return ({ path, module, entry }) => {
    if (module === BASE_MODULE) {
      if (INTERIM_MERGED.has(path)) {
        return "merged";
      }
      return seeds.has(path) || owned(path) ? "once" : "merged";
    }
    return entry?.seed === true ? "once" : "merged";
  };
}

/**
 * The class of one path. The base declaration speaks for base files only, as it does in
 * the old engine: a module file under `packages/ui/src/blocks/` is the module's, and its
 * own `seed` flag decides it.
 */
export function classOf(input: ClassInput): FileClass {
  return classifier(input.declaration)(input);
}
