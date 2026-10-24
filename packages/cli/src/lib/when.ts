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

/** Whether two conditions are the same, whatever the order of their `installed` names. */
export function sameWhen(a: When | undefined, b: When | undefined): boolean {
  const key = (when: When | undefined): string =>
    JSON.stringify([
      when?.testing === true,
      [...(when?.installed ?? [])].toSorted(),
    ]);
  return key(a) === key(b);
}

/**
 * Where an op writes: the container it targets and, for a kind whose items carry a
 * name, the item it names. A new revision of an op keeps its slot and changes its
 * payload: a script keeps its name and changes its command, a binding keeps its name and
 * changes its settings. A `plugin-array` call names no item of its own, so its slot is the
 * array alone.
 */
function patchSlot(op: RegistryPatch): unknown[] {
  switch (op.kind) {
    case "plugin-array": {
      return [op.exportName, op.arrayProp];
    }
    case "chained-route": {
      return [op.exportName, op.path];
    }
    case "drizzle-column": {
      return [op.exportName, op.column];
    }
    case "const-array": {
      return [op.constName, op.key, op.entry[op.key]];
    }
    case "nav-entry": {
      return [op.constName, op.area, op.group, op.entry.to];
    }
    case "wrangler-binding": {
      return [
        op.bindingType,
        typeof op.entry === "string"
          ? op.entry
          : op.entry[op.matchOn ?? "binding"],
      ];
    }
    case "package-json-dependency": {
      return [op.section, op.name];
    }
    default: {
      // `package-json-script`, the last kind: the union is exhausted above.
      return [op.name];
    }
  }
}

/** The slot key two ops share when one can be a revision of the other. */
function slotKey(op: RegistryPatch): string {
  return JSON.stringify([op.file, op.kind, patchSlot(op)]);
}

/**
 * Whether `module` already applied `op`. A tracked gated patch keeps shipping whatever its
 * `when` now says, the patch half of the rule that keeps a written gated file managed
 * (#242 Q1).
 *
 * The first test is the structural equality `remove` untracks with. It misses a new
 * revision of an applied op, because the record holds the old payload. So, given the
 * module's whole `siblings` list, a gated op also counts as tracked when it is the only
 * op of the module in its slot (same file, `kind`, target container and named item, see
 * `patchSlot`, and the same `when`) and the manifest records an op of that module in the
 * same slot: the record can only be its earlier revision. Two of the module's ops in one
 * slot are ambiguous (two `plugin-array` calls into one array), so those fall back to the
 * structural test rather than ship an op the project never took.
 */
export function isPatchTracked(
  manifest: Pick<Manifest, "patches">,
  module: string,
  op: RegistryPatch,
  siblings?: readonly RegistryPatch[]
): boolean {
  const entry = { file: op.file, module, patch: op };
  if (manifest.patches.some((existing) => samePatchEntry(existing, entry))) {
    return true;
  }
  if (op.when === undefined || siblings === undefined) {
    return false;
  }
  const slot = slotKey(op);
  const inSlot = (other: RegistryPatch): boolean =>
    slotKey(other) === slot && sameWhen(other.when, op.when);
  return (
    siblings.filter(inSlot).length === 1 &&
    manifest.patches.some(
      (existing) => existing.module === module && inSlot(existing.patch)
    )
  );
}
