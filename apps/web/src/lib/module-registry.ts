// Reads every `modules/*/registry-item.json` at build time and turns it into catalog rows.
//
// `import.meta.glob` rather than `node:fs`: Vite resolves the pattern against this file's
// own location, so the path holds whatever directory `astro build` starts in (apps/web,
// or the repo root under turbo). It also works in `astro dev`, which renders pages inside
// workerd, where `node:fs` does not see the repository. The JSON is inlined into the
// prerender bundle only; no descriptor reaches the browser beyond the rendered rows.

import { catalogRows } from "@web/lib/module-catalog";
import type { CatalogRow, RegistryDescriptor } from "@web/lib/module-catalog";

const descriptors = import.meta.glob<RegistryDescriptor>(
  "../../../../modules/*/registry-item.json",
  { eager: true, import: "default" }
);

/** Every module in the registry, one catalog row each, in catalog order. */
export function loadModuleCatalog(): CatalogRow[] {
  return catalogRows(Object.values(descriptors));
}
