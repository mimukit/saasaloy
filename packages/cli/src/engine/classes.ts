import type { BaseDeclaration } from "../lib/base.js";
import { BASE_MODULE, ownedMatcher } from "../lib/base.js";

// The class of each rendered file (plan 0116, "File classes"). One function decides it,
// so `apply` never asks a second question about whether it may overwrite a path:
//
//   generated  the CLI writes it in full on every run
//   merged     a three-way merge of the old render, the new render and the disk
//   once       written when the path is new, then left alone
//
// Three spellings of "the owner rewrites this" all map to `once`: the base's `seedFiles`
// and `ownedFiles` (`_saasaloy-base.json`) and a module entry's `seed` flag (ADR 0060),
// except the base files in `INTERIM_MERGED`. Nothing is `generated` until the tables move
// in Phase 7.

export type FileClass = "generated" | "merged" | "once";

export const FILE_CLASSES: readonly FileClass[] = [
  "generated",
  "merged",
  "once",
];

/**
 * Owned base files classed `merged` during the build (plan 0116, re-grill Q1 and Q4): the
 * four that hold a registration table, so `add` can register a module in them until
 * Phase 7 moves each table to a generated file and drops this rule. `saasaloy.json` and
 * `packages/env/.env.example` are `merged` by the declaration itself (Q2, Q3): neither is
 * a seed or an owned file.
 */
export const INTERIM_MERGED: ReadonlySet<string> = new Set([
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
 * The class of one path. The base declaration speaks for base files only: a module file
 * under `packages/ui/src/blocks/` is the module's, and its own `seed` flag decides it.
 */
export function classOf(input: ClassInput): FileClass {
  return classifier(input.declaration)(input);
}
