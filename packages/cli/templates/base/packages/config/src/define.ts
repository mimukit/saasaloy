// The composition core of `@repo/config` (ADR 0039). Three functions and two type
// helpers, no runtime dependency and no I/O: a section is a plain object, the registry is
// an array literal, and the composed config is frozen at module load.
//
// `config` is the channel for values a project checks into its repo and ships identically
// to every environment. `env` is the channel for values the platform supplies per
// deployment. The test a value takes is two deployments of the *same* project: if the
// value can differ between them it belongs in `env`, secret or not.

/** One capability's contribution: a key the config is read under, and its values. */
export interface ConfigSection<K extends string, V extends object> {
  readonly key: K;
  readonly values: V;
}

/** A section with any key and any values — what the registry array holds. */
export type AnySection = ConfigSection<string, object>;

/**
 * Declare a section. Called by `src/sections/<module>.ts`, which a capability module
 * ships and appends to the registry with its `plugin-array` patch.
 *
 * The key is inferred as a literal so the composed type carries it; the values are
 * inferred *widened* on purpose, so `name: "Acme"` types as `string` and a project may
 * override it with any string rather than only with the seeded one.
 */
export function defineSection<const K extends string, V extends object>(
  key: K,
  values: V
): ConfigSection<K, V> {
  return { key, values };
}

/**
 * The registry. Identity at runtime; it exists so `sections.ts` reads as
 * `export const sections = defineSections({ sections: [...] })` — the exact shape the
 * `plugin-array` codemod (packages/cli/src/lib/patch/ts-module.ts) pushes a section call
 * into. Never omit the `sections` property, even while it is empty.
 */
export function defineSections<const S extends readonly AnySection[]>(input: {
  sections: S;
}): S {
  return input.sections;
}

/** The composed shape: one property per section key, holding that section's values. */
export type Composed<S extends readonly AnySection[]> = {
  readonly [E in S[number] as E["key"]]: E["values"];
};

/**
 * What `src/project.ts` may say. Partial at the section level and partial one level
 * below it, which is exactly how deep the merge goes — so a typo in an override is a
 * `typecheck` failure rather than a value nothing reads.
 */
export type ConfigOverride<C> = {
  [K in keyof C]?: { [P in keyof C[K]]?: C[K][P] };
};

/**
 * Compose the registered sections, apply the project's overrides, and freeze the result.
 *
 * The merge is one level below the section, and no deeper. `project.ts` replaces a leaf
 * value; a nested record or an array is replaced whole. That keeps the rule explainable
 * in one sentence, which matters more here than saving an owner a few keystrokes.
 *
 * Two sections claiming one key throw at module load. `saasaloy add` refuses that pair
 * before it writes, so reaching this throw means the files were edited by hand.
 */
export function defineConfig<const S extends readonly AnySection[]>(args: {
  sections: S;
  overrides?: ConfigOverride<Composed<S>>;
}): Composed<S> {
  const composed: Record<string, Record<string, unknown>> = {};

  for (const section of args.sections) {
    if (section.key in composed) {
      throw new Error(
        `Two config sections claim the key "${section.key}". A section key is the module name, and it has to be unique — rename one of them in packages/config/src/sections/.`
      );
    }
    composed[section.key] = { ...section.values };
  }

  const overrides = (args.overrides ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  for (const [key, patch] of Object.entries(overrides)) {
    const values = composed[key];
    if (patch === undefined) {
      continue;
    }
    if (values === undefined) {
      throw new Error(
        `packages/config/src/project.ts overrides the section "${key}", which no installed module defines.`
      );
    }
    for (const [prop, value] of Object.entries(patch)) {
      // An explicit `undefined` is the owner deleting a line they half-wrote, not a
      // request to unset a seeded value. Skipping it keeps the default.
      if (value !== undefined) {
        values[prop] = value;
      }
    }
  }

  for (const values of Object.values(composed)) {
    Object.freeze(values);
  }
  // The loop above builds exactly the shape `Composed<S>` describes, one property per
  // section key, and no narrower type can be proved from a `Record` the compiler watched
  // being filled. The assertion is the seam between the two, and it is the only one.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Object.freeze(composed) as unknown as Composed<S>;
}
