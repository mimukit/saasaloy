import { z } from "zod";

// The field builders a collection is declared with. Each builder returns a plain object: the
// field's kind, the label the admin form shows, and the Zod schema that checks the field's
// value inside the entry's JSON `data` column.
//
// `title` and `slug` are special. They are typed columns on `cms_entries`, not keys in
// `data`, so `defineCollection` takes them out of the data schema. Every other field lands
// in `data` under its key.
//
// A future module reuses these builders as they are. `richText` and `media` are the two the
// ecommerce plan names for product descriptions and images.

/** The kinds the admin form knows how to draw. A new kind needs a new form control. */
export type FieldKind = "text" | "slug" | "richText" | "media" | "seo";

/**
 * Which column of the admin editor a field sits in. `main` is the wide column beside the
 * body; `side` is the 20rem column of panels, which moves below the main one on a narrow
 * screen. Each kind has a default (see `defaultPlacement`), and a builder's `placement`
 * option overrides it.
 */
export type FieldPlacement = "main" | "side";

/** Where a field sits when its builder was given no `placement`. */
export function defaultPlacement(kind: FieldKind): FieldPlacement {
  return kind === "media" || kind === "seo" ? "side" : "main";
}

/** What every field carries. `schema` checks the value; the rest drives the admin form. */
export interface FieldBase<K extends FieldKind, S extends z.ZodType> {
  readonly kind: K;
  readonly label: string;
  readonly required: boolean;
  /** One line of help under the control. */
  readonly help?: string;
  /** The editor column. Unset means `defaultPlacement(kind)`. */
  readonly placement?: FieldPlacement;
  readonly schema: S;
}

// --- Rich text -------------------------------------------------------------------------

/** One mark on a text node, as Tiptap serializes it. */
export interface RichTextMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** One node of a Tiptap JSON document. */
export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
}

/** A whole Tiptap JSON document. The body is stored in this shape, never as HTML. */
export interface RichTextDocument {
  type: "doc";
  content?: RichTextNode[];
}

const markSchema: z.ZodType<RichTextMark> = z.object({
  attrs: z.record(z.string(), z.unknown()).optional(),
  type: z.string().min(1),
});

const nodeSchema: z.ZodType<RichTextNode> = z.lazy(() =>
  z.object({
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(nodeSchema).optional(),
    marks: z.array(markSchema).optional(),
    text: z.string().optional(),
    type: z.string().min(1),
  })
);

/**
 * The shape check for a stored document. It checks structure only. Whether each node type
 * exists is the renderer's question, and the renderer throws on a node it does not know.
 */
export const richTextDocument: z.ZodType<RichTextDocument> = z.object({
  content: z.array(nodeSchema).optional(),
  type: z.literal("doc"),
});

// --- Media -----------------------------------------------------------------------------

/**
 * A stored image: the `storage_objects` row, its storage key and its alt text. The key is
 * kept beside the id so the renderer builds a public URL with no database read.
 */
export interface MediaValue {
  objectId: string;
  key: string;
  alt?: string;
}

export const mediaValue: z.ZodType<MediaValue> = z.object({
  alt: z.string().max(300).optional(),
  key: z.string().min(1).max(1024),
  objectId: z.string().min(1).max(128),
});

// --- SEO -------------------------------------------------------------------------------

/** The three SEO overrides. Each one falls back when empty; see `seoFallbacks`. */
export interface SeoValue {
  metaTitle?: string;
  metaDescription?: string;
  ogImage?: MediaValue | null;
}

/** The longest meta title the form accepts. Search results cut a title near 60 characters. */
export const META_TITLE_MAX = 70;
/** The longest meta description. Search results cut a description near 155 characters. */
export const META_DESCRIPTION_MAX = 160;

const seoValue: z.ZodType<SeoValue> = z.object({
  metaDescription: z.string().max(META_DESCRIPTION_MAX).optional(),
  metaTitle: z.string().max(META_TITLE_MAX).optional(),
  ogImage: mediaValue.nullable().optional(),
});

// --- Slug ------------------------------------------------------------------------------

/** Lower-case words joined by single hyphens. The same rule `@validators/cms` applies. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The longest slug. It is a URL segment, and a long one helps nobody. */
export const SLUG_MAX = 96;

const slugValue = z.string().max(SLUG_MAX).regex(SLUG_PATTERN, {
  message: "Use lower-case letters, digits and single hyphens.",
});

/**
 * Turn a title into a slug the slug field accepts. The editor calls it while the slug is
 * still untouched; the stored slug is whatever the admin saves.
 */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
}

// --- Builders --------------------------------------------------------------------------

interface CommonOptions {
  label: string;
  required?: boolean;
  help?: string;
  /** The admin editor column. Default: `side` for media and SEO, `main` otherwise. */
  placement?: FieldPlacement;
}

export interface TextOptions extends CommonOptions {
  /** Default 200. */
  maxLength?: number;
  /** Draw a textarea rather than a one-line input. */
  multiline?: boolean;
}

export type TextField = FieldBase<"text", z.ZodType<string | undefined>> & {
  readonly maxLength: number;
  readonly multiline: boolean;
};

/** A plain string. Required means at least one character after trimming. */
export function text(options: TextOptions): TextField {
  const maxLength = options.maxLength ?? 200;
  const base = z.string().trim().max(maxLength);
  return {
    help: options.help,
    kind: "text",
    label: options.label,
    maxLength,
    multiline: options.multiline ?? false,
    placement: options.placement,
    required: options.required ?? false,
    schema: options.required === true ? base.min(1) : base.optional(),
  };
}

export interface SlugOptions {
  label?: string;
  help?: string;
  /** The field the editor derives the slug from while it is untouched. Default `title`. */
  from?: string;
}

export type SlugField = FieldBase<"slug", z.ZodType<string>> & {
  readonly from: string;
};

/** The URL segment. Always required, and stored in the `slug` column, not in `data`. */
export function slug(options: SlugOptions = {}): SlugField {
  return {
    from: options.from ?? "title",
    help: options.help,
    kind: "slug",
    label: options.label ?? "Slug",
    required: true,
    schema: slugValue,
  };
}

export type RichTextField = FieldBase<
  "richText",
  z.ZodType<RichTextDocument | undefined>
>;

/** A Tiptap JSON document, edited with `@repo/cms/editor` and rendered by `renderRichText`. */
export function richText(options: CommonOptions): RichTextField {
  return {
    help: options.help,
    kind: "richText",
    label: options.label,
    placement: options.placement,
    required: options.required ?? false,
    schema:
      options.required === true
        ? richTextDocument
        : richTextDocument.optional(),
  };
}

export type MediaField = FieldBase<
  "media",
  z.ZodType<MediaValue | null | undefined>
>;

/** One image from `file-uploads`. Optional fields store `null` once the image is removed. */
export function media(options: CommonOptions): MediaField {
  return {
    help: options.help,
    kind: "media",
    label: options.label,
    placement: options.placement,
    required: options.required ?? false,
    schema:
      options.required === true ? mediaValue : mediaValue.nullable().optional(),
  };
}

export type SeoField = FieldBase<"seo", z.ZodType<SeoValue | undefined>>;

/** Meta title, meta description and Open Graph image. Always optional. */
export function seo(
  options: { label?: string; help?: string; placement?: FieldPlacement } = {}
): SeoField {
  return {
    help: options.help,
    kind: "seo",
    label: options.label ?? "SEO",
    placement: options.placement,
    required: false,
    schema: seoValue.optional(),
  };
}

/** Any field a collection may declare. */
export type Field =
  TextField | SlugField | RichTextField | MediaField | SeoField;
