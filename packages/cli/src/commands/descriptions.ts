// The one-line description of each command, in the lifecycle order a user walks
// (scaffold → compose → refresh → undo → browse), with the author-facing `doctor`
// last. It lives here rather than in
// `index.ts` because each command's own `--help` prints its description too, and
// importing the registry from a command module would close an import cycle
// (`index.ts` → `add.ts` → `index.ts`). `index.ts` reads this map to build the
// registry, so the order below is still the order help and the picker render.

export const DESCRIPTIONS = {
  init: "scaffold a new Saasaloy project (base: Astro landing + ui + config)",
  add: "apply a module into the current project (resolves dependsOn)",
  update:
    "re-apply modules at a newer ref, with a merge plan for anything you edited",
  remove: "undo a module's applied files via the manifest (offline)",
  list: "list the modules a registry offers, marking the ones installed here",
  doctor:
    "validate local module descriptors, or a project's saasaloy.json against its manifest",
} as const satisfies Record<string, string>;
