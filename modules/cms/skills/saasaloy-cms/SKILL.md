---
name: saasaloy-cms
description: Runbook for the cms module, the in-house CMS behind apps/admin. Covers code-defined collections, the Tiptap editor, drafts, revisions and redirects, the publish-time renderer, the public blog on apps/web and its 60-second cache. Use when adding a collection or a field, rendering a stored body, reusing the editor, renderer or media field from another module, moving the blog to another path, re-rendering live posts after a renderer upgrade or a STORAGE_PUBLIC_URL change, or working out why a published post is not live yet.
---

# cms: collections, drafts, revisions and the public blog

Staff write and publish content in `apps/admin`, and `apps/web` serves it with no deploy. A developer declares each content type in code as a **collection**. Admins fill entries in, and they cannot create types. The module ships one collection, `blog`.

| File | What it holds |
|---|---|
| `packages/cms/` (`@repo/cms`) | the registry, the field builders, the form rules, the renderer, the editor (`@repo/cms/editor`) and the web client (`@repo/cms/client`) |
| `packages/cms/src/collections/blog.ts` | the `blog` collection |
| `packages/cms/scripts/rerender.ts` | `pnpm cms:rerender`, the local re-render |
| `packages/db/src/schema/cms.ts` | `cms_entries`, `cms_revisions` and `cms_redirects`, in your driver's dialect |
| `packages/db/src/repositories/cms.ts` | publish, restore, pruning, redirects and every other query |
| `packages/validators/src/cms.ts` | the request bodies and queries |
| `packages/config/src/sections/cms.ts` | the `cms` config section |
| `apps/api/src/routes/cms.ts` | the admin and public routes at `/cms` |
| `apps/admin/src/routes/cms/$collection/` | the list, new-entry and editor screens |
| `apps/web/src/pages/blog/` | the index, the post page, `rss.xml` and `sitemap.xml`, all on demand |
| `apps/web/src/lib/cms.ts` | `cmsClient()`, the blog copy and the prose styles |

## How a post moves

`cms_entries` holds the **working draft**. Typed columns carry `collection`, `slug`, `status`, `title`, `published_at`, `author_id`, `updated_by`, `version` and `published_revision_id`. Every other field lives in the JSON `data` column, and the collection's Zod schema checks it on every write.

- **Save draft** writes the working row only. The live post does not change.
- **Publish** copies the working row into a new `cms_revisions` row, renders its HTML once, stores it as `html`, and points `published_revision_id` at it. The public site serves that revision.
- **Unpublish** sets `published_revision_id` to null and the status to `draft`. **Archive** also takes the entry offline and hides it from the default admin list. Publishing an archived entry puts it live again.
- **Restore** copies a revision into the working draft. The live post changes on the next publish only.
- **Delete** works on `draft` and `archived` entries only, and it cascades to their revisions and redirects. A published entry answers `409 invalid_state`.

Each entry keeps its newest 50 revisions. A publish prunes older ones and never prunes the live one. `published_at` is set on the first publish only. The post page shows "Updated" when the live revision's date falls on a later UTC day.

When a publish changes the live slug, the repository writes a `cms_redirects` row. A public read of the old slug answers 301 to the current one. A redirect points at the entry, so a chain of renames ends at the current slug.

Every write sends the `version` it started from. A stale version answers `409 conflict`, and the body names the last editor and the time (`conflict.updatedByName`, `conflict.updatedAt`). The admin editor shows that in its conflict alert and offers Reload only. Nothing is merged.

## Add a collection

A new collection needs no migration, because every collection shares `cms_entries`. It needs one file, one array entry and one nav row.

1. Write the collection in a file of your own, beside `blog.ts`:

   ```ts
   // packages/cms/src/collections/changelog.ts
   import { defineCollection } from "../define";
   import { richText, slug, text } from "../fields";

   export function changelogCollection() {
     return defineCollection({
       name: "changelog",
       label: "Changelog",
       singular: "Release",
       fields: {
         title: text({ label: "Version", maxLength: 80, required: true }),
         slug: slug(),
         body: richText({ label: "Notes", required: true }),
         summary: text({ label: "Summary", multiline: true, placement: "side" }),
       },
     });
   }
   ```

2. Register it in the collections array in `packages/cms/src/index.ts`:

   ```ts
   export const cms = defineCms({
     collections: [blogCollection(), changelogCollection()],
   });
   ```

   Keep that line in the shape `export const cms = defineCms({ collections: [...] })`. It is the `plugin-array` patch point. A module that ships a collection registers it the way this module registers `blog`: a `plugin-array` patch on `packages/cms/src/index.ts` with `exportName: "cms"`, `arrayProp: "collections"` and the factory as `call`.

3. Add the nav row by hand in the "Content" group of `NAV_AREAS` in `apps/admin/src/components/nav.ts`: `{ to: "/cms/changelog", label: "Changelog", icon: ScrollTextIcon }`. A module adds it with a `nav-entry` patch (`area: "/"`, `group: "Content"`).

The list and editor screens at `/cms/changelog` then work with no screen code, and the public routes answer at `/cms/changelog/entries`. No `apps/web` page reads the new collection until you write one (see "Read content on the web").

The rules `defineCollection` enforces, each with an error at startup:

- `name` is lower-case kebab. It is stored in `cms_entries.collection` and appears in admin URLs. Avoid `admin`, which reads like the admin route prefix.
- `title` is built with `text()` and `slug` with `slug()`. Both are typed columns, not keys in `data`.
- A name registers once. A second registration throws.

Do not edit `blog.ts` to change the blog's fields. The file is the module's, and `saasaloy update` may rewrite it. Copy it into your own file, register your factory, and take `blogCollection()` out of the array.

### The field builders

| Builder | Value in `data` | Default column |
|---|---|---|
| `text({ label, required?, maxLength? = 200, multiline?, help?, placement? })` | a string | main |
| `slug({ label? = "Slug", from? = "title", help? })` | the `slug` column | main |
| `richText({ label, required?, help?, placement? })` | a Tiptap JSON document | main |
| `media({ label, required?, help?, placement? })` | `{ objectId, key, alt? }` or `null` | side |
| `seo({ label?, help?, placement? })` | `{ metaTitle?, metaDescription?, ogImage? }` | side |

`placement: "main" | "side"` moves a field to the other editor column. `slug` takes no `placement`.

### How the form is built from the collection

The editor reads `collection.fields` in declaration order, and `formLayout(collection)` splits them into the main column and the 20rem side column. The side column always starts with the Publishing panel, and it moves below the body under `lg`.

- The `title` field is a large input. While the entry was never published, it drives the slug through `nextSlug`.
- `slug` shows the URL prefix from `slugPrefix(name, config.cms.basePath)`. The blog uses `basePath`, and any other collection uses `/<name>/`.
- `richText` is `@repo/cms/editor` with the admin toolbar and image upload.
- `media` is the media picker: `FileDrop` while empty, then the stored image with Replace and Remove.
- `seo` is Meta title, Meta description and an Open Graph picker. Its placeholders come from `seoPlaceholders`.
- `text` is an input, or a textarea when `multiline` is set.

In the side column each field is a panel, with `label` as its title and `help` under it. In the main column `help` is the line under the control. `emptyValues`, `valuesFromEntry`, `toPayload` and `isDirty` in `packages/cms/src/form.ts` build what a save sends. A new field kind needs a new control in `control()` in `apps/admin/src/components/cms/entry-editor.tsx`.

### Which fields the public routes read

The public answer maps fields by kind, not by name:

- the body is the first `richText` field, and it is the only one rendered into `html`,
- the cover is the first `media` field,
- the SEO block is the first `seo` field,
- the excerpt is the field named `excerpt`. An empty one falls back to the first 160 characters of the body text.

Meta title falls back to the title, meta description to the excerpt, and the Open Graph image to the cover. The api resolves every fallback, so the web pages get finished strings. A second `richText` field is stored and edited, but no public answer renders it.

## Render a field

The api renders once, at publish, with `renderCollectionHtml(collection, data, { imageUrl })`, and stores the string in `cms_revisions.html`. `apps/web` serves that string and carries no Tiptap. To render a body yourself, call the renderer on the server side:

```ts
import { renderRichText } from "@repo/cms";
import { publicImageUrl } from "../lib/file-uploads";

const html = renderRichText(doc, { imageUrl: (key) => publicImageUrl(c.env, key) });
```

Two mappings replace Tiptap's own output:

- **Links.** A link keeps only an href that `isSafeHref` accepts: `http`, `https`, `mailto`, `tel`, or a relative URL. A refused link renders its text with no `<a>`. Protocol-relative (`//host`) and backslash URLs are refused. The editor's Link extension checks the same rule, and the renderer checks it again, so a crafted api write cannot put a `javascript:` URL on the site. An absolute web link gets `rel="noopener noreferrer"`.
- **Images.** A body image is an `image` node with `storageKey` and `objectId`. The renderer builds its `src` from `storageKey` through `imageUrl`, which the api backs with `publicImageUrl` from `file-uploads`. An image with no buildable URL renders nothing. Uploads are public (`visibility: "public"`), and a public image needs `STORAGE_PUBLIC_URL`.

`renderRichText` throws on a node or mark that the extension list does not know. The api maps that throw to `400 invalid_input`, on save and on publish.

The image URL is baked into the stored HTML at publish. That is why a `STORAGE_PUBLIC_URL` change needs a re-render.

## Re-render live posts

Run a re-render after a Tiptap or renderer upgrade, after a change to `cmsExtensions()` or the renderer's mappings, and after `STORAGE_PUBLIC_URL` or `STORAGE_IMAGE_TRANSFORMS` changes. It rebuilds `html` for every live revision. Drafts and older revisions stay as they are.

- **Local:** `pnpm cms:rerender` from the repo root. It writes to the local database that `vite dev` uses, and it reads `apps/api/.env`. Under `database-postgres` that file must carry `DATABASE_URL`. It refuses `NODE_ENV=production`.
- **A deployed Worker:** `POST /cms/admin/rerender` with an admin session. It runs inside the Worker, with that environment's bindings and `STORAGE_PUBLIC_URL`, and answers `{ rerendered, skipped }`. From the admin app, call it through the typed client, or from the browser console on the admin origin:

  ```ts
  await fetch(`${API_URL}/cms/admin/rerender`, {
    method: "POST",
    credentials: "include",
    headers: { "x-auth-audience": "admin" },
  }).then((r) => r.json());
  ```

A revision whose collection is no longer registered, or whose body throws in the renderer, keeps its old `html` and counts in `skipped`. A non-zero `skipped` after an upgrade means a stored node the new renderer does not know.

## Reuse the editor, renderer and media field from another module

A later module, such as `ecommerce` for product descriptions, reuses the CMS building blocks and never imports Tiptap. `packages/cms` owns every Tiptap dependency (ADR 0020), so add `@repo/cms: workspace:*` with a `package-json-dependency` patch and import these:

| Need | Import |
|---|---|
| a rich-text column and its Zod check | `richText`, `richTextDocument`, `RichTextDocument` from `@repo/cms` |
| an image column | `media`, `mediaValue`, `MediaValue` from `@repo/cms` |
| HTML from a stored body | `renderRichText` from `@repo/cms`, on the server |
| plain text and an excerpt | `plainText`, `excerptOf` from `@repo/cms` |
| the link rule | `isSafeHref` from `@repo/cms` |
| the editor | `RichTextEditor`, `PickedImage` from `@repo/cms/editor` |

`RichTextEditor` takes `value` and `onChange` (Tiptap JSON both ways), and these optional props:

- `onRequestImage` resolves a `PickedImage` (`{ objectId, key, alt?, url? }`) or `null`. Leave it out to hide the image tool.
- `onRequestLink` asks for a link URL. It defaults to `window.prompt`.
- `onLinkRefused` receives a URL the link rule refused, so the host can say why.
- `toolbar` is a render prop that receives the tools as data. `apps/admin` draws them with the shell primitives in `apps/admin/src/components/cms/editor-toolbar.tsx`. Without it, a plain toolbar of text buttons renders.

React is a peer dependency, so the host app's React runs. Store the document as JSON in your own table, never as HTML. Render it once when it goes live, and store the HTML beside it, the same way the CMS does.

For an image field in an admin screen, copy `apps/admin/src/components/cms/media-picker.tsx` and its upload helper in `apps/admin/src/lib/cms-api.ts`. They use the `file-uploads` three-step upload and add no storage code.

## Read content on the web

`apps/web` reads the public routes over `PUBLIC_API_URL` with `@repo/cms/client`, which reaches neither Tiptap nor Zod. There is no service binding.

```ts
import { cmsClient } from "@web/lib/cms";

const result = await cmsClient().entry("changelog", Astro.params.slug ?? "");
if (result.kind === "missing") return new Response(null, { status: 404 });
if (result.kind === "redirect") return Astro.redirect(`/changelog/${result.slug}`, 301);
const { entry } = result; // title, html, excerpt, cover, seo, authorName, publishedAt, updatedAt
```

`list(collection, page)` answers one page, newest `publishedAt` first, with `config.cms.pageSize` entries. A page that reads the client must set `export const prerender = false`.

**The cache.** The client keeps an isolate-local `Map` with a 60-second TTL, shared by every client in the isolate and keyed by URL. It caches entries, pages, 404s and redirects. It never caches an error. A publish takes up to 60 seconds to show, and nothing purges the cache on publish. Pass `ttlSeconds: 0` to `createCmsClient` to turn it off. If traffic outgrows one cache per isolate, move it to the `kv` capability.

## Move the blog to another path

`config.cms.basePath` (default `/blog`) builds every **link** the blog writes: post links, the pager, the RSS and sitemap URLs, and the admin slug prefix. It does not move a route. Astro routes by folder, so the pages answer at `/blog` whatever the config says. To move the blog to `/notes`, change all of these in one edit:

1. Set `cms: { basePath: "/notes" }` in `packages/config/src/project.ts`.
2. Rename `apps/web/src/pages/blog/` to `apps/web/src/pages/notes/`.
3. Change the two `assets.run_worker_first` entries in `apps/web/wrangler.jsonc` to `"/notes"` and `"/notes/*"`.
4. Change the Blog row in `pageLinks` in `packages/ui/src/blocks/navbar.tsx` to `href: "/notes"`.

Old `/blog` links then answer the site's 404. Add a redirect yourself if they are already shared.

## `run_worker_first`

`apps/web/wrangler.jsonc` carries `assets.run_worker_first: ["/blog", "/blog/*"]`. With `not_found_handling: "404-page"`, the assets layer answers a browser navigation that matches no file with the 404 page, and the Worker never runs. `curl` gets 200 and a browser gets 404. The two entries send blog paths to the Worker first. A new on-demand page for another collection needs its own pair.

The Astro Cloudflare adapter sets the Worker `main` itself once one page is on demand, so `wrangler.jsonc` needs no `main`.

## Deleting a media file breaks live posts

**The CMS does not track which entries use a file.** A cover, an Open Graph image and every body image point at a `storage_objects` row by key. Delete that file from the Files screen, or through `DELETE /files/:id`, and every live post that uses it shows a broken image. Nothing warns first, and a re-render does not fix it. Check the posts before you delete an image, and replace the image in each entry, then publish again.

## Settings

| Key | Default | What it does |
|---|---|---|
| `cms.basePath` | `/blog` | The prefix of every blog link. See "Move the blog to another path". |
| `cms.pageSize` | `10` | Entries per page on the blog index, in the public list route, in the RSS feed and in the admin list. |
| `cms.rssTitle` | `Blog` | The RSS channel title. |
| `cms.rssDescription` | `The latest posts.` | The RSS channel description. |

Override a key in `packages/config/src/project.ts`. The module declares no env var. It uses `PUBLIC_API_URL` on `apps/web` and the `file-uploads` storage keys on `apps/api`.

## Removal

`saasaloy remove cms` deletes the files it wrote and reverses its patches: the collection registration, the config section, the `/cms` route, the `@repo/cms` dependencies, the nav rows, the navbar Blog link, the `run_worker_first` entries and the `cms:rerender` script. It leaves these:

- The `cms_entries`, `cms_revisions` and `cms_redirects` tables, and every post in them. Run `pnpm --filter @repo/db db:generate`, read the drop migration, then apply it with your driver's command.
- The uploaded images. They are `file-uploads` rows in `storage_objects` with objects in the bucket, and they stay while `file-uploads` is installed. Delete them from the Files screen if nothing else uses them.
- A collection file you wrote and its line in the collections array, a nav row you added by hand, and any page you wrote for another collection. Take them out by hand.
- A renamed blog folder or a changed `basePath` override in `project.ts`.

## Failure modes

| Symptom | Cause |
|---|---|
| A published post 404s for up to a minute | The web cache holds the earlier 404. Wait 60 seconds. |
| An edit is live in the admin but not on the site | The edit is a draft. Publish it. "Unpublished edits" in the list marks it. |
| `/blog` works in `curl` and 404s in a browser | The `run_worker_first` entries are missing from `apps/web/wrangler.jsonc`. |
| Blog links point at `/notes` and the pages 404 | `basePath` changed and the folder did not. Rename `apps/web/src/pages/blog/`. |
| Images on live posts are broken | The file was deleted, or `STORAGE_PUBLIC_URL` changed. Re-upload and publish again, or run a re-render. |
| The cover picker says the upload is refused | `STORAGE_PUBLIC_URL` is unset on the api, so no public upload can be made. |
| `409 conflict` on save or publish | Someone saved after you opened the entry. Reload, then apply your change again. |
| `409 slug_taken` | Another entry uses that slug as its draft or live slug. |
| `400 invalid_input` with a `data.` message | `data` fails the collection's schema. A message about a node or mark means the renderer does not know a type in the body. |
| `Collection "x" is not registered` | The factory is not in the collections array in `packages/cms/src/index.ts`. |
| `cms:rerender` refuses to run | `NODE_ENV=production` is set. In production, call `POST /cms/admin/rerender`. |
| `rerender` answers a non-zero `skipped` | A live revision's collection is not registered, or its body holds a node the renderer does not know. |
| The web client throws about `PUBLIC_API_URL` | `apps/web/.env` has no `PUBLIC_API_URL`. Run `pnpm env:setup`. |

## Not in this module

Draft preview links, scheduled publishing, media reference tracking, a cache purge on publish, admin-defined types, author and editor roles, taxonomies, comments, search and i18n. Products belong to a future `ecommerce` module, which reuses the parts in "Reuse the editor, renderer and media field from another module".

## Next

Run `saasaloy-admin` to add a staff screen beside the CMS screens, `saasaloy-file-uploads` for the image path and `STORAGE_PUBLIC_URL`, and `saasaloy-database` for the migration that `add` and `remove` leave for you.
