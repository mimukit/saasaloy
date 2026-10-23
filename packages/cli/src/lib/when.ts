import { samePatchEntry } from "./manifest.js";
import type { Manifest } from "./manifest.js";
import type { RegistryPatch, When } from "./schema.js";
import type { TestingMode } from "./testing.js";

// The `when` condition on a descriptor entry (#242, ADR 0054). `when` decides whether an
// optional entry ships at all, and only on its first write: once a gated file sits in
// `manifest.managed`, or a gated patch in `manifest.patches`, it stays managed in every
// mode (#242 Q1). `onlyWith` is a different question, which variant of a required target
// ships, and the applier asks it only of the entries `when` kept (#242 Q2).

/** What a `when` is tested against: the project's mode and its resolved install set. */
export interface WhenContext {
  testingMode: TestingMode;
  /** This run's resolved install set plus what the project already holds. */
  installed: ReadonlySet<string>;
}

/**
 * Whether an entry's condition holds. The keys combine with AND: `testing` asks for any
 * mode but `off`, and every name in `installed` has to be present. No condition holds.
 */
export function whenHolds(when: When | undefined, ctx: WhenContext): boolean {
  if (when === undefined) {
    return true;
  }
  if (when.testing === true && ctx.testingMode === "off") {
    return false;
  }
  return (when.installed ?? []).every((name) => ctx.installed.has(name));
}

/**
 * Whether `module` already applied `op`, by the same structural equality `remove` untracks
 * with. A tracked gated patch keeps shipping whatever its `when` now says, the patch half
 * of the rule that keeps a written gated file managed (#242 Q1).
 */
export function isPatchTracked(
  manifest: Pick<Manifest, "patches">,
  module: string,
  op: RegistryPatch
): boolean {
  const entry = { file: op.file, module, patch: op };
  return manifest.patches.some((existing) => samePatchEntry(existing, entry));
}
