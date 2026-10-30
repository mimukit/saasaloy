// The module catalog's tier and grouping rules, kept free of file IO and of every import
// so that `node --test` runs it directly. ./module-registry.ts reads the registry at
// build time and hands the parsed descriptors to `catalogRows`.
//
// The rule, from the Module catalog row of
// docs/plans/0091-plan-public-site-and-brand-2026-10-26.md:
//   1. a module with a non-empty `conflictsWith` is a driver (exactly one installed,
//      chosen at `add` time; ADR 0026);
//   2. a module with a `plugin-array` patch into a `providers` array is a provider;
//   3. every other module takes its registry `type`.
// The driver check runs first, so a module that met both tests would read as a driver:
// the conflict is the stronger fact, because it limits what a project can install.
//
// The grouping, which the owner chose on 2026-10-29: the tabs are the registry `stage`,
// and a provider or a driver is a chip on its parent's tile rather than a tile of its own.

export const CATALOG_TIERS = [
  "capability",
  "feature",
  "provider",
  "driver",
] as const;

export type CatalogTier = (typeof CATALOG_TIERS)[number];

/** The tiers that get a tile of their own; the other two show inside their parent's. */
export type CatalogTileTier = "capability" | "feature";

/** The catalog tabs after "All", in the order a product reaches them: the `stage` field. */
export const CATALOG_STAGES = [
  "validate",
  "mvp",
  "teams",
  "money",
  "scale",
] as const;

export type CatalogStage = (typeof CATALOG_STAGES)[number];

/** The id of one catalog tab's radio, so a <label> elsewhere on the page can select it. */
export function catalogTabId(catalogId: string, tab: string): string {
  return `${catalogId}-stage-${tab}`;
}

/** The part of a `modules/<name>/registry-item.json` descriptor the catalog reads. */
export interface RegistryDescriptor {
  name: string;
  type: string;
  description?: string;
  stage?: string;
  dependsOn?: string[];
  conflictsWith?: string[];
  patches?: { kind: string; arrayProp?: string }[];
}

/** A provider or a driver, shown as a chip on its parent's tile. */
export interface CatalogVariant {
  name: string;
  /** The name without the parent's prefix: `cloudflare` for `email-cloudflare`. */
  label: string;
  tier: Exclude<CatalogTier, CatalogTileTier>;
}

export interface CatalogRow {
  name: string;
  description: string;
  tier: CatalogTileTier;
  stage: CatalogStage;
  /** The modules it needs that have a tile of their own, in `dependsOn` order. */
  needs: string[];
  /** Its providers and drivers, by name. */
  variants: CatalogVariant[];
}

const TYPE_TIERS: Record<string, CatalogTier> = {
  "saasaloy:capability": "capability",
  "saasaloy:feature": "feature",
};

/** The tier one descriptor shows in the catalog. Throws on a type the rule does not know. */
export function moduleTier(descriptor: RegistryDescriptor): CatalogTier {
  if ((descriptor.conflictsWith ?? []).length > 0) {
    return "driver";
  }
  const registersProvider = (descriptor.patches ?? []).some(
    (patch) => patch.kind === "plugin-array" && patch.arrayProp === "providers"
  );
  if (registersProvider) {
    return "provider";
  }
  const tier = TYPE_TIERS[descriptor.type];
  if (!tier) {
    throw new Error(
      `module-catalog: ${descriptor.name} has an unknown type "${descriptor.type}"`
    );
  }
  return tier;
}

function moduleStage(descriptor: RegistryDescriptor): CatalogStage {
  const stage = CATALOG_STAGES.find((known) => known === descriptor.stage);
  if (!stage) {
    throw new Error(
      `module-catalog: ${descriptor.name} has an unknown stage "${descriptor.stage}"`
    );
  }
  return stage;
}

/**
 * The module a provider or a driver belongs to: the `dependsOn` entry its name starts
 * with, so `email-cloudflare` belongs to `email` and `api-keys-user` to `api-keys`.
 */
function parentOf(descriptor: RegistryDescriptor): string {
  const [parent] = (descriptor.dependsOn ?? [])
    .filter((name) => descriptor.name.startsWith(`${name}-`))
    .toSorted((a, b) => b.length - a.length);
  if (!parent) {
    throw new Error(
      `module-catalog: ${descriptor.name} names no parent in dependsOn`
    );
  }
  return parent;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "en");

/**
 * One tile per capability and feature, in stage order, then capabilities before
 * features, then by name, so the build output does not depend on directory order. Each
 * provider and driver joins its parent's tile as a variant and takes the parent's stage.
 */
export function catalogRows(descriptors: RegistryDescriptor[]): CatalogRow[] {
  const rows = new Map<string, CatalogRow>();
  const variants: { parent: string; variant: CatalogVariant }[] = [];
  const dependsOn = new Map<string, string[]>();
  for (const descriptor of descriptors) {
    const tier = moduleTier(descriptor);
    if (tier === "provider" || tier === "driver") {
      const parent = parentOf(descriptor);
      variants.push({
        parent,
        variant: {
          name: descriptor.name,
          label: descriptor.name.slice(parent.length + 1),
          tier,
        },
      });
      continue;
    }
    rows.set(descriptor.name, {
      name: descriptor.name,
      description: descriptor.description ?? "",
      tier,
      stage: moduleStage(descriptor),
      needs: [],
      variants: [],
    });
    dependsOn.set(descriptor.name, descriptor.dependsOn ?? []);
  }
  for (const { parent, variant } of variants) {
    const row = rows.get(parent);
    if (!row) {
      throw new Error(
        `module-catalog: ${variant.name} belongs to ${parent}, which has no tile`
      );
    }
    row.variants.push(variant);
  }
  for (const row of rows.values()) {
    row.variants.sort(byName);
    // A provider or a driver it depends on (`logger-console`) has no tile to point at.
    row.needs = (dependsOn.get(row.name) ?? []).filter((name) =>
      rows.has(name)
    );
  }
  return [...rows.values()].toSorted(
    (a, b) =>
      CATALOG_STAGES.indexOf(a.stage) - CATALOG_STAGES.indexOf(b.stage) ||
      CATALOG_TIERS.indexOf(a.tier) - CATALOG_TIERS.indexOf(b.tier) ||
      byName(a, b)
  );
}

/** How many modules of each tier the rows hold, variants included. */
export function catalogCounts(rows: CatalogRow[]): Record<CatalogTier, number> {
  const counts: Record<CatalogTier, number> = {
    capability: 0,
    feature: 0,
    provider: 0,
    driver: 0,
  };
  for (const row of rows) {
    counts[row.tier] += 1;
    for (const variant of row.variants) {
      counts[variant.tier] += 1;
    }
  }
  return counts;
}
