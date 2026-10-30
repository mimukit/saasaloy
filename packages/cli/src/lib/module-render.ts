import { readFile } from "node:fs/promises";
import type { LoadedModule } from "./registry.js";
import { applyVars } from "./scaffold.js";
import type { TemplateVars } from "./scaffold.js";

// `{{PROJECT_NAME}}` in a module, rendered the way `init` renders the base (#197).
//
// A module ships account-scoped names: the `api` Worker, the D1 database, the queues. Copied
// verbatim, two projects in one Cloudflare account deploy over each other's Workers and bind
// to each other's data. So a module's files and its patch entries carry `{{PROJECT_NAME}}`,
// and the module is rendered once, as it enters a plan. Every later step — the manifest hash,
// `update`'s three-way compare, the recorded patch `remove` reverses — then sees the rendered
// bytes, which is what keeps `update` from reporting a change nobody made.

/**
 * `mod` with its patch entries rendered and `vars` recorded for `readModuleFile`. Rendering a
 * rendered module is a no-op, so a caller that cannot tell need not ask.
 */
export function renderModule(
  mod: LoadedModule,
  vars: TemplateVars
): LoadedModule {
  const { patches } = mod.item;
  return {
    ...mod,
    vars,
    item: {
      ...mod.item,
      ...(patches === undefined
        ? {}
        : { patches: patches.map((op) => renderValue(op, vars)) }),
    },
  };
}

/** Every module in `modules`, rendered, in a new map under the same keys. */
export function renderModules(
  modules: ReadonlyMap<string, LoadedModule>,
  vars: TemplateVars
): Map<string, LoadedModule> {
  return new Map(
    [...modules].map(([name, mod]) => [name, renderModule(mod, vars)])
  );
}

/** One of `mod`'s files, as the project receives it. */
export async function readModuleFile(
  mod: LoadedModule,
  abs: string
): Promise<string> {
  const raw = await readFile(abs, "utf-8");
  return mod.vars === undefined ? raw : applyVars(raw, mod.vars);
}

function renderValue<T>(value: T, vars: TemplateVars): T {
  if (typeof value === "string") {
    return applyVars(value, vars) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => renderValue(item, vars)) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderValue(item, vars)])
    ) as T;
  }
  return value;
}
