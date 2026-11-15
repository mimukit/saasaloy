import { z } from "zod";
import type { Field, SlugField, TextField } from "./fields";

// The collection registry. A developer declares a content type in code with
// `defineCollection`, and registers it by appending its factory call to the array in
// `src/index.ts`. Admins fill entries in; they never create a type.
//
// A collection's `title` and `slug` fields map to typed columns on `cms_entries`. Every other
// field is a key in the entry's JSON `data` column, and `dataSchema` checks that column on
// every write.

/** The fields a collection declares. `title` and `slug` are required and typed. */
export type CollectionFields = {
  title: TextField;
  slug: SlugField;
} & Record<string, Field>;

/** The keys that land in `data`: every field but the two column-backed ones. */
export type DataKeys<F extends CollectionFields> = Exclude<
  keyof F,
  "title" | "slug"
> &
  string;

/** The Zod object that checks `data`. */
export type DataSchema<F extends CollectionFields> = z.ZodObject<
  { [K in DataKeys<F>]: F[K]["schema"] },
  z.core.$strict
>;

export interface CollectionInput<N extends string, F extends CollectionFields> {
  /** Lower-case kebab, unique in the registry. It is the `collection` column's value. */
  name: N;
  /** The plural label: the admin nav entry and the list heading, e.g. "Blog". */
  label: string;
  /** The singular label: "New post", "Delete post". */
  singular: string;
  fields: F;
}

export interface Collection<
  N extends string = string,
  F extends CollectionFields = CollectionFields,
> {
  readonly name: N;
  readonly label: string;
  readonly singular: string;
  readonly fields: F;
  /** Checks the JSON `data` column. Unknown keys are refused. */
  readonly dataSchema: DataSchema<F>;
}

/** The parsed `data` of a collection's entry. */
export type CollectionData<C extends Collection> = z.infer<C["dataSchema"]>;

const NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Declare a collection.
 *
 * ```ts
 * defineCollection({
 *   name: "pages",
 *   label: "Pages",
 *   singular: "Page",
 *   fields: { title: text({ label: "Title", required: true }), slug: slug(), body: richText({ label: "Body" }) },
 * });
 * ```
 */
export function defineCollection<
  const N extends string,
  const F extends CollectionFields,
>(input: CollectionInput<N, F>): Collection<N, F> {
  const { fields, label, name, singular } = input;

  if (!NAME.test(name)) {
    throw new Error(
      `Collection name ${JSON.stringify(name)} must be lower-case kebab, e.g. "blog". ` +
        `It is stored in the cms_entries.collection column and appears in admin URLs.`
    );
  }
  if ((fields.title as Field | undefined)?.kind !== "text") {
    throw new Error(
      `Collection "${name}" needs a \`title\` field built with text(). ` +
        `The title is a typed column on cms_entries.`
    );
  }
  if ((fields.slug as Field | undefined)?.kind !== "slug") {
    throw new Error(
      `Collection "${name}" needs a \`slug\` field built with slug(). ` +
        `The slug is a typed column on cms_entries.`
    );
  }

  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (key !== "title" && key !== "slug") {
      shape[key] = field.schema;
    }
  }

  return {
    dataSchema: z.strictObject(shape) as unknown as DataSchema<F>,
    fields,
    label,
    name,
    singular,
  };
}

export interface CmsConfig<C extends readonly Collection[]> {
  collections: C;
}

export interface CmsRegistry<C extends readonly Collection[]> {
  /** Every registered collection, in registration order. What the admin nav lists. */
  readonly collections: C;
  /** True when `name` is a registered collection. Use it to 404 an unknown route param. */
  has(name: string): name is C[number]["name"];
  /** The collection called `name`. Throws when it is not registered. */
  collection<N extends C[number]["name"]>(
    name: N
  ): Extract<C[number], { name: N }>;
}

/**
 * Build the registry. `collections` is a patch point: `saasaloy add cms` appends
 * `blogCollection()` to the array in `src/index.ts` with a `plugin-array` patch, and a
 * project adds its own collection the same way.
 */
export function defineCms<const C extends readonly Collection[]>(
  config: CmsConfig<C>
): CmsRegistry<C> {
  const { collections } = config;
  const byName = new Map<string, Collection>();
  for (const collection of collections) {
    if (byName.has(collection.name)) {
      throw new Error(
        `Collection "${collection.name}" is registered twice. Each name maps to one ` +
          `collection, so the second registration would be silently ignored.`
      );
    }
    byName.set(collection.name, collection);
  }

  return {
    collection(name) {
      const found = byName.get(name);
      if (!found) {
        throw new Error(
          `Collection ${JSON.stringify(name)} is not registered. Add it to the collections ` +
            `array in packages/cms/src/index.ts.`
        );
      }
      return found as Extract<C[number], { name: typeof name }>;
    },
    collections,
    has(name): name is C[number]["name"] {
      return byName.has(name);
    },
  };
}
