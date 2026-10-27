// The module catalog's tier rule, kept free of file IO and of every import so that
// `node --test` runs it directly. ./module-registry.ts reads the registry at build time
// and hands the parsed descriptors to `catalogRows`.
//
// The rule, from the Module catalog row of
// docs/plans/0091-plan-public-site-and-brand-2026-10-26.md:
//   1. a module with a non-empty `conflictsWith` is a driver (exactly one installed,
//      chosen at `add` time; ADR 0026);
//   2. a module with a `plugin-array` patch into a `providers` array is a provider;
//   3. every other module takes its registry `type`.
// The driver check runs first, so a module that met both tests would read as a driver:
// the conflict is the stronger fact, because it limits what a project can install.

export const CATALOG_TIERS = [
  "capability",
  "feature",
  "provider",
  "driver",
] as const;

export type CatalogTier = (typeof CATALOG_TIERS)[number];

/** The part of a `modules/<name>/registry-item.json` descriptor the catalog reads. */
export interface RegistryDescriptor {
  name: string;
  type: string;
  description?: string;
  conflictsWith?: string[];
  patches?: { kind: string; arrayProp?: string }[];
}

export interface CatalogRow {
  name: string;
  description: string;
  tier: CatalogTier;
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

/**
 * One row per descriptor, in tier order (capability, feature, provider, driver) and by
 * name inside a tier, so the build output does not depend on directory order.
 */
export function catalogRows(descriptors: RegistryDescriptor[]): CatalogRow[] {
  return descriptors
    .map((descriptor) => ({
      name: descriptor.name,
      description: descriptor.description ?? "",
      tier: moduleTier(descriptor),
    }))
    .toSorted(
      (a, b) =>
        CATALOG_TIERS.indexOf(a.tier) - CATALOG_TIERS.indexOf(b.tier) ||
        a.name.localeCompare(b.name, "en")
    );
}
