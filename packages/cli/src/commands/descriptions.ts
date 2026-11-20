// The one-line description of each command, in the lifecycle order a user walks
// (scaffold → compose → configure → inspect → refresh → undo → browse), with the
// author-facing `new` and `doctor`
// last. It lives here rather than in
// `index.ts` because each command's own `--help` prints its description too, and
// importing the registry from a command module would close an import cycle
// (`index.ts` → `add.ts` → `index.ts`). `index.ts` reads this map to build the
// registry, so the order below is still the order help and the picker render.

export const DESCRIPTIONS = {
  init: "scaffold a new Saasaloy project (base: Astro landing + ui + config)",
  add: "apply a module into the current project (resolves dependsOn)",
  env: "fill in the environment variables the installed modules declare (--check gates a deploy)",
  testing:
    "print the project's testing mode, or set it to off, tests-after or tdd",
  outdated:
    "report the base template and each installed module, current vs latest (--check gates CI)",
  update:
    "move the base template and modules to this CLI's release, merging your edits three ways",
  remove:
    "take a module out of the project, keeping the files you edited (--abort undoes it)",
  list: "list the modules a registry offers, marking the ones installed here",
  new: "scaffold a new module in a registry repo (descriptor + files/ + skill stub)",
  doctor:
    "validate local module descriptors, or a project's saasaloy.json against its manifest",
  skill:
    "print a base skill bundled with this CLI, or list them (the runbook that matches this version)",
} as const satisfies Record<string, string>;
