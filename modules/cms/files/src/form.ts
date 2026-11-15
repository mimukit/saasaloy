import type { Collection } from "./define";
import { defaultPlacement, slugify } from "./fields";
import type { Field, FieldPlacement, SeoValue } from "./fields";

// The rules that turn a collection definition into the admin editor's form. `apps/admin`
// draws one control per field kind and asks this file everything else: which column a
// field sits in, what an empty entry holds, what a save sends, and what the empty SEO
// fields fall back to. A new collection therefore needs no new screen code, and a later
// module that edits a collection (ecommerce products) reuses the same rules.
//
// Pure, with no React, so `form.test.ts` runs it under `node --test`.

/** One field of the form, with its key in the collection and its editor column. */
export interface FormField {
  key: string;
  field: Field;
  placement: FieldPlacement;
}

/** The two editor columns, each in declaration order. */
export interface FormLayout {
  main: FormField[];
  side: FormField[];
}

/** Split a collection's fields into the main and the side column. */
export function formLayout(collection: Collection): FormLayout {
  const layout: FormLayout = { main: [], side: [] };
  for (const [key, field] of Object.entries(collection.fields)) {
    const placement = field.placement ?? defaultPlacement(field.kind);
    layout[placement].push({ field, key, placement });
  }
  return layout;
}

/** What the form edits: the two typed columns and the JSON `data`. */
export interface FormValues {
  title: string;
  slug: string;
  data: Record<string, unknown>;
}

const EMPTY_DOCUMENT = { content: [{ type: "paragraph" }], type: "doc" };

function emptyValue(field: Field): unknown {
  switch (field.kind) {
    case "richText": {
      return structuredClone(EMPTY_DOCUMENT);
    }
    case "media": {
      return null;
    }
    case "seo": {
      return {};
    }
    default: {
      return "";
    }
  }
}

function dataFields(collection: Collection): [string, Field][] {
  return Object.entries(collection.fields).filter(
    ([key]) => key !== "title" && key !== "slug"
  );
}

/** The values of a new, empty entry. */
export function emptyValues(collection: Collection): FormValues {
  return {
    data: Object.fromEntries(
      dataFields(collection).map(([key, field]) => [key, emptyValue(field)])
    ),
    slug: "",
    title: "",
  };
}

/**
 * The form's values for a stored entry. A key the collection declares but `data` lacks
 * gets its empty value, and a key the collection no longer declares is dropped, so a
 * save never sends a key the strict data schema refuses.
 */
export function valuesFromEntry(
  collection: Collection,
  entry: { title: string; slug: string; data: unknown }
): FormValues {
  const stored =
    typeof entry.data === "object" && entry.data !== null
      ? (entry.data as Record<string, unknown>)
      : {};
  return {
    data: Object.fromEntries(
      dataFields(collection).map(([key, field]) => [
        key,
        stored[key] ?? emptyValue(field),
      ])
    ),
    slug: entry.slug,
    title: entry.title,
  };
}

function trimmedSeo(value: unknown): SeoValue {
  const seo = (value ?? {}) as SeoValue;
  const out: SeoValue = {};
  const metaTitle = seo.metaTitle?.trim();
  const metaDescription = seo.metaDescription?.trim();
  if (metaTitle) {
    out.metaTitle = metaTitle;
  }
  if (metaDescription) {
    out.metaDescription = metaDescription;
  }
  if (seo.ogImage) {
    out.ogImage = seo.ogImage;
  }
  return out;
}

/**
 * The body of a save: the title trimmed, an empty optional text left out, and empty SEO
 * strings left out, so an untouched field is absent rather than stored as "".
 */
export function toPayload(
  collection: Collection,
  values: FormValues
): FormValues {
  const data: Record<string, unknown> = {};
  for (const [key, field] of dataFields(collection)) {
    const value = values.data[key];
    if (field.kind === "text") {
      const text = typeof value === "string" ? value.trim() : "";
      if (text !== "" || field.required) {
        data[key] = text;
      }
    } else if (field.kind === "seo") {
      data[key] = trimmedSeo(value);
    } else if (field.kind === "media") {
      data[key] = value ?? null;
    } else if (value !== undefined) {
      data[key] = value;
    }
  }
  return { data, slug: values.slug.trim(), title: values.title.trim() };
}

/** JSON with sorted keys, so two equal values compare equal whatever their key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === "object" && inner !== null && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).toSorted(([left], [right]) =>
            left.localeCompare(right)
          )
        )
      : inner
  );
}

/** True when a save of `next` would store something other than `saved`. */
export function isDirty(
  collection: Collection,
  saved: FormValues,
  next: FormValues
): boolean {
  return (
    canonical(toPayload(collection, saved)) !==
    canonical(toPayload(collection, next))
  );
}

/**
 * The slug after a title change. It follows the title while the slug is empty or still
 * equals the old title's slug, and stays put once the admin has typed one of their own.
 */
export function nextSlug(input: {
  previousTitle: string;
  title: string;
  slug: string;
}): string {
  const following =
    input.slug === "" || input.slug === slugify(input.previousTitle);
  return following ? slugify(input.title) : input.slug;
}

/**
 * The URL path the slug field shows in front of the slug. The blog's comes from
 * `config.cms.basePath`; any other collection is served under its own name until a
 * project gives it a path of its own.
 */
export function slugPrefix(collection: string, blogBasePath: string): string {
  const base = collection === "blog" ? blogBasePath : `/${collection}`;
  return `${base.replace(/\/+$/, "")}/`;
}

/**
 * The placeholders of the empty SEO fields: the value each one falls back to, the same
 * rule `seoFallbacks` applies on the api. The excerpt is the field named `excerpt`.
 */
export function seoPlaceholders(values: FormValues): {
  metaTitle: string;
  metaDescription: string;
} {
  const title = values.title.trim();
  const excerpt =
    typeof values.data.excerpt === "string" ? values.data.excerpt.trim() : "";
  return {
    metaDescription: excerpt === "" ? "Uses the excerpt when empty." : excerpt,
    metaTitle: title === "" ? "Uses the title when empty." : title,
  };
}
