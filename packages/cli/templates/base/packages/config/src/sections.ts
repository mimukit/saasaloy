import type { Composed, ConfigOverride } from "./define";
import { defineSections } from "./define";
import { app } from "./sections/app";
import { configSections } from "./sections.generated";

// The section registry. The sections of the installed modules come from
// `./sections.generated.ts`, which the CLI writes on every run: `saasaloy add auth` adds
// `authConfig()` there, and `remove` takes it back out. A section of your own goes after
// the spread.
//
// A module's section file lands here, under `src/sections/`, rather than inside the
// capability's own package. `@repo/config` is the leaf of the dependency graph: it imports
// nothing, so that every app and every capability can import it — including the ones it
// would otherwise have to import back.
export const sections = defineSections({
  sections: [app(), ...configSections],
});

/** What `./project.ts` may override: any leaf of any registered section. */
export type ProjectOverride = ConfigOverride<Composed<typeof sections>>;
