import { z } from "zod";

// One file per feature, directly under `src/`, imported as `@repo/validators/cms`.
//
// Isomorphic on purpose: no Workers types, no `@repo/db`, no `@repo/cms`. These schemas check
// the envelope of a request. The `data` object is checked a second time, field by field, by
// the collection's own `dataSchema` from `@repo/cms`, which the route looks up by the
// `:collection` param. The slug rule is written here and in `@repo/cms/fields` both, because
// this package may not import that one.

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A slug: lower-case words joined by single hyphens, at most 96 characters. */
export const cmsSlug = z.string().max(96).regex(SLUG, {
  message: "Use lower-case letters, digits and single hyphens.",
});

/** The working-draft fields every write carries. */
const entryFields = {
  /** Checked again by the collection's `dataSchema`. Here it only has to be an object. */
  data: z.record(z.string(), z.unknown()),
  slug: cmsSlug,
  title: z.string().trim().min(1).max(200),
};

/** Optimistic concurrency: the `version` the edit started from. A stale one is a 409. */
const version = z.number().int().min(1);

/** Body of `POST /cms/:collection/entries`. */
export const cmsEntryInput = z.object(entryFields);
export type CmsEntryInput = z.infer<typeof cmsEntryInput>;

/** Body of a draft save. */
export const cmsDraftInput = z.object({ ...entryFields, version });
export type CmsDraftInput = z.infer<typeof cmsDraftInput>;

/** Body of publish, unpublish, archive and restore: only the version. */
export const cmsVersionInput = z.object({ version });
export type CmsVersionInput = z.infer<typeof cmsVersionInput>;

/** The admin list's filter chips. `current` is draft plus published, the default. */
export const CMS_LIST_FILTERS = [
  "current",
  "draft",
  "published",
  "archived",
  "all",
] as const;
export type CmsListFilter = (typeof CMS_LIST_FILTERS)[number];

const page = z.coerce.number().int().min(1).default(1);

/** Query of the admin list. */
export const cmsListQuery = z.object({
  page,
  status: z.enum(CMS_LIST_FILTERS).default("current"),
});
export type CmsListQuery = z.infer<typeof cmsListQuery>;

/** Query of the public list. */
export const cmsPublicListQuery = z.object({ page });
export type CmsPublicListQuery = z.infer<typeof cmsPublicListQuery>;

/** The `:collection` route param. Whether it is registered is the route's check. */
export const cmsCollectionParam = z.object({
  collection: z.string().regex(/^[a-z][a-z0-9-]*$/),
});
