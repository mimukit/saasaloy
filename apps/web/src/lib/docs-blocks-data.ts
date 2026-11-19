// The facts the two `saasaloy-*` docs blocks show, built from the module descriptors. Pure
// and import-free apart from module-catalog.ts, so the remark plugin (which runs in Node at
// build time), the React islands (which run in the browser) and `node --test` all load it.
// The plugin serialises one `GraphData` or `ProvidersData` into the block's markup, and the
// island reads it back, so the two never read the registry on their own.

import { catalogRows } from "./module-catalog.ts";
import type { CatalogVariant, RegistryDescriptor } from "./module-catalog.ts";

/** The part of a descriptor the blocks read, on top of what the catalog reads. */
export interface BlockDescriptor extends RegistryDescriptor {
  envVars?: Record<string, string>;
}

/** One tile of the catalog and its neighbours. */
export interface GraphModule {
  name: string;
  tier: "capability" | "feature";
  description: string;
  /** The modules it depends on, in `dependsOn` order. */
  needs: string[];
  /** The modules that depend on it, by name. */
  usedBy: string[];
  /** Its providers and drivers. */
  variants: CatalogVariant[];
}

export interface GraphData {
  /** Every tile, in catalog order. */
  modules: GraphModule[];
  /** The module the block opens on. */
  selected: string;
}

export interface ProviderOption {
  name: string;
  /** The value of the selector variable that picks this provider. */
  value: string;
  description: string;
}

export interface ProvidersData {
  capability: string;
  description: string;
  /** The env var that picks one provider at runtime, such as `EMAIL_PROVIDER`. */
  selector: string;
  /**
   * True when the selector takes a comma list in priority order (`PAYMENT_PROVIDER`), as its
   * `envVars` description says, rather than one name.
   */
  list: boolean;
  providers: ProviderOption[];
}

/** Every module of the graph and the module the block opens on. Throws on an unknown focus. */
export function graphData(
  descriptors: readonly BlockDescriptor[],
  focus?: string
): GraphData {
  const rows = catalogRows([...descriptors]);
  const modules: GraphModule[] = rows.map((row) => ({
    name: row.name,
    tier: row.tier,
    description: row.description,
    needs: row.needs,
    usedBy: rows
      .filter((other) => other.needs.includes(row.name))
      .map((other) => other.name),
    variants: row.variants,
  }));
  const [first] = modules;
  if (!first) {
    throw new Error("saasaloy-graph: the registry holds no module");
  }
  if (focus !== undefined && !modules.some((item) => item.name === focus)) {
    throw new Error(
      `saasaloy-graph: focus=${focus} is not a module with a tile. Use a capability or feature name such as email.`
    );
  }
  return { modules, selected: focus ?? first.name };
}

/** One capability, its providers and its selector variable. Throws when it has none. */
export function providersData(
  descriptors: readonly BlockDescriptor[],
  capability: string
): ProvidersData {
  const row = catalogRows([...descriptors]).find(
    (item) => item.name === capability
  );
  const descriptor = descriptors.find((item) => item.name === capability);
  const providers = (row?.variants ?? []).filter(
    (variant) => variant.tier === "provider"
  );
  if (!row || !descriptor || providers.length === 0) {
    throw new Error(
      `saasaloy-providers: capability=${capability} is not a module that takes providers.`
    );
  }
  const selector = Object.keys(descriptor.envVars ?? {}).find((key) =>
    key.endsWith("_PROVIDER")
  );
  if (selector === undefined) {
    throw new Error(
      `saasaloy-providers: ${capability} declares no *_PROVIDER variable in envVars.`
    );
  }
  return {
    capability,
    description: row.description,
    selector,
    list: /comma list/i.test(descriptor.envVars?.[selector] ?? ""),
    providers: providers.map((variant) => ({
      name: variant.name,
      value: variant.label,
      description:
        descriptors.find((item) => item.name === variant.name)?.description ??
        "",
    })),
  };
}

/** The `key=value` words after the language of a fenced block, such as `focus=email`. */
export function parseBlockArgs(
  meta: string | null | undefined,
  allowed: readonly string[],
  language: string
): Record<string, string> {
  const args: Record<string, string> = {};
  for (const word of (meta ?? "").split(/\s+/).filter(Boolean)) {
    const [key, value, ...rest] = word.split("=");
    if (!key || !value || rest.length > 0 || !allowed.includes(key)) {
      throw new Error(
        `${language}: cannot read "${word}". The block takes ${
          allowed.length === 0
            ? "no argument"
            : allowed.map((name) => `${name}=<name>`).join(" ")
        }.`
      );
    }
    args[key] = value;
  }
  return args;
}
