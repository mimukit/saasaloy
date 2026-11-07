import { defineCms } from "./define";

// `@repo/cms`: the collection registry, the field builders, the renderer and the text
// helpers. The editor is a separate subpath, `@repo/cms/editor`, so the api and the
// renderer never pull React in. `apps/web` imports only `@repo/cms/client`, which reaches
// neither Tiptap nor Zod.

export { defineCms, defineCollection } from "./define";
export type {
  Collection,
  CollectionData,
  CollectionFields,
  CollectionInput,
  CmsConfig,
  CmsRegistry,
  DataKeys,
  DataSchema,
} from "./define";
export {
  defaultPlacement,
  media,
  mediaValue,
  META_DESCRIPTION_MAX,
  META_TITLE_MAX,
  richText,
  richTextDocument,
  seo,
  slug,
  SLUG_MAX,
  SLUG_PATTERN,
  slugify,
  text,
} from "./fields";
export type {
  Field,
  FieldKind,
  FieldPlacement,
  MediaField,
  MediaValue,
  RichTextDocument,
  RichTextField,
  RichTextMark,
  RichTextNode,
  SeoField,
  SeoValue,
  SlugField,
  TextField,
} from "./fields";
export {
  emptyValues,
  formLayout,
  isDirty,
  nextSlug,
  seoPlaceholders,
  slugPrefix,
  toPayload,
  valuesFromEntry,
} from "./form";
export type { FormField, FormLayout, FormValues } from "./form";
export { ALLOWED_SCHEMES, isSafeHref } from "./links";
export { renderCollectionHtml, renderRichText } from "./renderer";
export type { RenderOptions } from "./renderer";
export {
  EXCERPT_FALLBACK_LENGTH,
  excerptOf,
  plainText,
  seoFallbacks,
} from "./text";
export type { ResolvedSeo } from "./text";

// The registry, and the patch point every collection lands in. `saasaloy add cms` appends
// `blogCollection()` here; a project adds its own collection the same way.
//
// Keep this line in exactly this shape: `export const cms = defineCms({ collections: [...] })`
// with a real array literal. The codemod behind the `plugin-array` patch kind
// (packages/cli/src/lib/patch/ts-module.ts) has nothing to push into otherwise, and an
// install fails silently. Never omit `collections`, even while it is empty.
export const cms = defineCms({ collections: [] });

/** Every registered collection name, as a type. */
export type CollectionName = (typeof cms.collections)[number]["name"];
