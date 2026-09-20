import type { Composed, ConfigOverride } from "./define";
import { defineSections } from "./define";
import { app } from "./sections/app";
import { plans } from "./sections/plans";

// The section registry, and the one patch point in this package. `saasaloy add auth` adds
// an import of `./sections/auth` and appends `authConfig()` to the array below; `remove`
// takes both back out. The install is idempotent, so re-running it changes nothing.
//
// Keep this line in exactly this shape: `export const sections = defineSections({
// sections: [...] })` with a real array literal. The codemod behind the `plugin-array`
// patch kind (packages/cli/src/lib/patch/ts-module.ts) has nothing to push into
// otherwise, and the install fails silently. Never omit `sections`, even while it is
// empty.
//
// A module's section file lands here, under `src/sections/`, rather than inside the
// capability's own package. `@repo/config` is the leaf of the dependency graph: it imports
// nothing, so that every app and every capability can import it — including the ones it
// would otherwise have to import back.
export const sections = defineSections({ sections: [app(), plans()] });

/** What `./project.ts` may override: any leaf of any registered section. */
export type ProjectOverride = ConfigOverride<Composed<typeof sections>>;
