// The URL of a wiki page, from its path under `docs/wiki/`. One function holds the rule, so the
// content collection, the remark link rewrite, the sidebar and the raw Markdown routes all
// agree. It imports nothing, so a node:test file and `astro.config.mjs` can load it.
//
// The rule:
//   - `index.md` is the docs root, the empty slug, served at `/docs`.
//   - The `generated/` folder never appears in a URL: `generated/modules/email.md` is
//     `modules/email`, `generated/env.md` is `env`.
//   - A hand-written page whose slug a generated page already holds moves to the slug in
//     SLUG_OVERRIDES. Today that is `modules.md`, the hand-written overview, because the
//     generated catalog owns `/docs/modules`.

/** Hand-written pages that give up their natural slug to a generated page. */
export const SLUG_OVERRIDES: Readonly<Record<string, string>> = {
  "modules.md": "modules/overview",
};

/** The directory under `docs/wiki/` whose pages `pnpm docs:generate` writes. */
export const GENERATED_DIR = "generated";

/**
 * The slug of a wiki page, such as `how-to/add-a-module` for `how-to/add-a-module.md`.
 * `path` is relative to `docs/wiki/` and uses `/`. The docs root has the empty slug.
 */
export function pageSlug(path: string): string {
  const override = SLUG_OVERRIDES[path];
  if (override !== undefined) {
    return override;
  }
  let slug = path.replace(/\.md$/, "");
  if (slug.startsWith(`${GENERATED_DIR}/`)) {
    slug = slug.slice(GENERATED_DIR.length + 1);
  }
  return slug === "index" ? "" : slug;
}

/** The site path of a wiki page: `/docs` for the root, `/docs/<slug>` for the rest. */
export function pageUrl(path: string): string {
  const slug = pageSlug(path);
  return slug === "" ? "/docs" : `/docs/${slug}`;
}

/** Fails when two pages claim one slug, so a new page cannot silently shadow another. */
export function assertUniqueSlugs(paths: readonly string[]): void {
  const seen = new Map<string, string>();
  for (const path of paths) {
    const slug = pageSlug(path);
    const earlier = seen.get(slug);
    if (earlier !== undefined) {
      throw new Error(
        `docs: ${earlier} and ${path} both map to /docs/${slug}. Add one to SLUG_OVERRIDES in apps/web/src/lib/docs-slug.ts.`
      );
    }
    seen.set(slug, path);
  }
}
