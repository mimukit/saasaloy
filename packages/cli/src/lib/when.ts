import type { When } from "./schema.js";
import type { TestingMode } from "./testing.js";

// The `when` condition on a descriptor entry (#242, ADR 0054). `when` decides whether an
// optional entry ships: the render writes a gated file or applies a gated patch only
// while its condition holds (plan 0116).

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
