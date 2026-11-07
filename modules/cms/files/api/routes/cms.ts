import { zValidator } from "@hono/zod-validator";
import { requireAdmin, withAuthScope } from "@repo/auth/server";
import {
  excerptOf,
  cms as registry,
  renderCollectionHtml,
  seoFallbacks,
} from "@repo/cms";
import { config } from "@repo/config";
import { withDb } from "@repo/db/client";
import {
  archiveEntry,
  CmsRepositoryError,
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  listPublished,
  listRevisions,
  publishEntry,
  readPublished,
  rerenderLiveRevisions,
  restoreRevision,
  saveDraft,
  unpublishEntry,
} from "@repo/db/repositories/cms";
import {
  cmsDraftInput,
  cmsEntryInput,
  cmsListQuery,
  cmsPublicListQuery,
  cmsVersionInput,
} from "@repo/validators/cms";
import { errorBody } from "@repo/validators/common";
import { Hono } from "hono";
import { apiEnv } from "../env";
import { publicImageUrl } from "../lib/file-uploads";
import type { AuthDbBindings } from "@repo/auth/server";
import type {
  Collection,
  MediaValue,
  RichTextDocument,
  SeoValue,
} from "@repo/cms";
import type { Db } from "@repo/db/client";
import type {
  CmsEntry,
  CmsEntrySummary,
  CmsPublicEntry,
} from "@repo/db/repositories/cms";
import type { Context } from "hono";
import type { FileUploadsEnv } from "../lib/file-uploads";

// The CMS api: the admin routes behind the editor in `apps/admin`, and the public routes
// `apps/web` reads the blog through.
//
//   /cms/admin/:collection/entries...   admin only (`requireAdmin`), the working drafts
//   /cms/admin/rerender                 admin only, rebuilds every live revision's html
//   /cms/:collection/entries...         public, published entries only
//
// Route module contract: export a Hono sub-app under a NAMED export matching the file,
// built as ONE chained expression. Splitting the chain into statements empties the routes
// out of `AppType`. This module's `chained-route` patch mounts it at `/cms`.
//
// Three rules run through the file:
//
//   **Every write checks `data` twice.** The collection's Zod `dataSchema` checks the
//   shape, then the renderer runs once over the body, because `renderRichText` throws on a
//   node or mark it does not know and the schema cannot see that. Both failures answer
//   400 `invalid_input`, the envelope the rest of the api uses, so a crafted api call
//   cannot store a body that a later publish would fail to render.
//
//   **The api renders, the web app does not.** A publish stores the rendered html in the
//   revision, and the public routes hand `apps/web` finished strings: the html, the
//   excerpt with its fallback, the SEO values with theirs, and image URLs. `apps/web`
//   carries no Tiptap and no `@repo/cms` renderer.
//
//   **Drafts never leave the public routes.** They read through `listPublished` and
//   `readPublished`, which join on the live revision. A draft, an archived entry and an
//   unpublished one all answer 404.
//
// No CORS and no `onError`: `modules/api`'s spine applies the credentialed `CORS_ORIGINS`
// allowlist before this sub-app is mounted, and an unset `onError` inherits api's, which
// renders the `HTTPException` `requireAdmin` throws as the shared error envelope.

type Bindings = AuthDbBindings & FileUploadsEnv;
type CmsContext = Context<{ Bindings: Bindings }>;

/** The repository's codes on HTTP. Every one but `not_found` is a 409. */
const STATUS_FOR = {
  conflict: 409,
  invalid_state: 409,
  not_found: 404,
  slug_taken: 409,
} as const;

/** What a Zod failure carries, structurally, so one helper takes every schema's error. */
interface Issues {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}

function firstIssue(error: Issues, prefix = ""): string {
  const [issue] = error.issues;
  return issue
    ? `${[prefix, ...issue.path.map(String)].filter(Boolean).join(".")}: ${issue.message}`
    : "invalid request body";
}

/** The shared failure hook, so a rejected body gets the api's error envelope. */
function invalid(result: { success: boolean; error?: Issues }, c: Context) {
  if (!result.success && result.error) {
    return c.json(errorBody("invalid_input", firstIssue(result.error)), 400);
  }
}

const validateCreate = zValidator("json", cmsEntryInput, invalid);
const validateDraft = zValidator("json", cmsDraftInput, invalid);
const validateVersion = zValidator("json", cmsVersionInput, invalid);
const validateList = zValidator("query", cmsListQuery, invalid);
const validatePublicList = zValidator("query", cmsPublicListQuery, invalid);

/** The registered collection called `name`, or undefined. */
function collectionFor(name: string): Collection | undefined {
  return (registry.collections as readonly Collection[]).find(
    (collection) => collection.name === name
  );
}

function unknownCollection(c: Context, name: string) {
  return c.json(
    errorBody("not_found", `No collection named "${name}" is registered.`),
    404
  );
}

/** The image URL resolver every render uses: `file-uploads`' public image URL. */
function imageUrlFor(c: CmsContext) {
  const env = apiEnv(c.env);
  return (key: string) => publicImageUrl(env, key);
}

/** Render a snapshot of `collection`. Throws on a node or mark the renderer does not know. */
function renderFor(c: CmsContext, collection: Collection) {
  const imageUrl = imageUrlFor(c);
  return (data: unknown) =>
    renderCollectionHtml(collection, data, { imageUrl });
}

/**
 * Check `data` against the collection: the Zod schema, then one render. Returns the parsed
 * data, or the 400 response to send.
 */
function checkData(
  c: CmsContext,
  collection: Collection,
  data: unknown
): { data: Record<string, unknown> } | { response: Response } {
  const parsed = collection.dataSchema.safeParse(data);
  if (!parsed.success) {
    return {
      response: c.json(
        errorBody("invalid_input", firstIssue(parsed.error, "data")),
        400
      ),
    };
  }
  try {
    renderFor(c, collection)(parsed.data);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      response: c.json(
        errorBody(
          "invalid_input",
          `data: the body cannot be rendered (${reason}).`
        ),
        400
      ),
    };
  }
  return { data: parsed.data as Record<string, unknown> };
}

/** An entry as every admin route answers: the row, its names and its publishing state. */
function toAdminSummary(entry: CmsEntrySummary) {
  return {
    authorId: entry.authorId,
    authorName: entry.authorName,
    collection: entry.collection,
    createdAt: entry.createdAt.toISOString(),
    hasUnpublishedEdits: entry.unpublishedEdits,
    id: entry.id,
    liveSlug: entry.liveSlug,
    publishedAt: entry.publishedAt?.toISOString() ?? null,
    publishedRevisionId: entry.publishedRevisionId,
    slug: entry.slug,
    status: entry.status,
    title: entry.title,
    updatedAt: entry.updatedAt.toISOString(),
    updatedBy: entry.updatedBy,
    updatedByName: entry.updatedByName,
    version: entry.version,
  };
}

/**
 * Every storage key a stored value holds, at any depth: a media field's `{ objectId, key }`,
 * the SEO block's `ogImage`, and a body image node's `storageKey` attribute.
 */
function storageKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      storageKeys(item, into);
    }
    return into;
  }
  if (typeof value !== "object" || value === null) {
    return into;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.objectId === "string" && typeof record.key === "string") {
    into.add(record.key);
  }
  if (typeof record.storageKey === "string") {
    into.add(record.storageKey);
  }
  for (const inner of Object.values(record)) {
    storageKeys(inner, into);
  }
  return into;
}

/**
 * An entry for the editor: the summary, the working draft's `data`, and `mediaUrls`, the
 * public URL of every image the draft names, keyed by storage key. The browser cannot read
 * `STORAGE_PUBLIC_URL`, so the api builds the URLs, as it does for the public routes.
 */
function toAdminEntry(c: CmsContext, entry: CmsEntry) {
  const imageUrl = imageUrlFor(c);
  const mediaUrls: Record<string, string> = {};
  for (const key of storageKeys(entry.data)) {
    const url = imageUrl(key);
    if (url !== undefined) {
      mediaUrls[key] = url;
    }
  }
  return { ...toAdminSummary(entry), data: entry.data, mediaUrls };
}

/** Read the entry back after a write, so the answer carries names and edit state. */
async function readBack(c: CmsContext, db: Db, collection: string, id: string) {
  const entry = await getEntry(db, collection, id);
  if (!entry) {
    throw new CmsRepositoryError("not_found", "No such entry.");
  }
  return toAdminEntry(c, entry);
}

/**
 * Map a repository error onto HTTP. A `conflict` also names who saved last and when, and
 * the version they left, so the admin alert can say "Alan Admin saved this at 14:02".
 */
async function repositoryFailure(
  c: CmsContext,
  error: unknown,
  collection: string,
  id?: string
): Promise<Response> {
  if (!(error instanceof CmsRepositoryError)) {
    throw error;
  }
  const body = errorBody(error.code, error.message);
  if (error.code === "conflict" && id !== undefined) {
    const current = await withDb(c, (db) => getEntry(db, collection, id));
    if (current) {
      return c.json(
        {
          ...body,
          conflict: {
            updatedAt: current.updatedAt.toISOString(),
            updatedByName: current.updatedByName,
            version: current.version,
          },
        },
        409
      );
    }
  }
  return c.json(body, STATUS_FOR[error.code]);
}

/** A media value with the URL that serves it, or null. */
function withUrl(c: CmsContext, media: MediaValue | null | undefined) {
  if (!media) {
    return null;
  }
  return { ...media, url: imageUrlFor(c)(media.key) ?? null };
}

/** The first field of `kind` in the collection, read from `data`. */
function fieldOf(collection: Collection, data: unknown, kind: string): unknown {
  const key = Object.keys(collection.fields).find(
    (name) => collection.fields[name]?.kind === kind
  );
  if (key === undefined || typeof data !== "object" || data === null) {
    return undefined;
  }
  return (data as Record<string, unknown>)[key];
}

/**
 * The finished strings a public page shows. `excerpt` is read from a field named
 * `excerpt`; the body, the cover and the SEO block are the collection's first `richText`,
 * `media` and `seo` fields. A collection without one of them gets the fallback.
 */
function publicFields(
  c: CmsContext,
  collection: Collection,
  entry: CmsPublicEntry
) {
  const data = (entry.data ?? {}) as Record<string, unknown>;
  const manual = typeof data.excerpt === "string" ? data.excerpt : undefined;
  const excerpt = excerptOf({
    body: fieldOf(collection, data, "richText") as RichTextDocument | undefined,
    ...(manual === undefined ? {} : { excerpt: manual }),
  });
  const cover = (fieldOf(collection, data, "media") ??
    null) as MediaValue | null;
  const seo = fieldOf(collection, data, "seo") as SeoValue | undefined;
  const resolved = seoFallbacks({
    cover,
    excerpt,
    title: entry.title,
    ...(seo === undefined ? {} : { seo }),
  });
  return {
    authorName: entry.authorName,
    cover: withUrl(c, cover),
    excerpt,
    id: entry.id,
    publishedAt: entry.publishedAt.toISOString(),
    seo: {
      metaDescription: resolved.metaDescription,
      metaTitle: resolved.metaTitle,
      ogImage: withUrl(c, resolved.ogImage),
    },
    slug: entry.slug,
    title: entry.title,
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export const cms = new Hono<{ Bindings: Bindings }>()
  // --- Admin -------------------------------------------------------------------------
  //
  // Rebuild the html of every live revision inside the Worker, so production re-renders
  // with its own bindings and `STORAGE_PUBLIC_URL`. `pnpm cms:rerender` is the local path.
  // A revision whose collection is no longer registered, or whose body no longer renders,
  // keeps its html and is counted in `skipped`.
  .post("/admin/rerender", (c) =>
    withAuthScope(c, async () => {
      await requireAdmin(c);
      const imageUrl = imageUrlFor(c);
      let skipped = 0;
      const rerendered = await withDb(c, (db) =>
        rerenderLiveRevisions(db, (snapshot) => {
          const collection = collectionFor(snapshot.collection);
          if (!collection) {
            skipped += 1;
            return null;
          }
          try {
            return renderCollectionHtml(collection, snapshot.data, {
              imageUrl,
            });
          } catch {
            skipped += 1;
            return null;
          }
        })
      );
      return c.json({ rerendered, skipped }, 200);
    })
  )

  // The list, most recently updated first. `status` is the filter chip: `current` (draft
  // and published, the default), `draft`, `published`, `archived` or `all`.
  .get("/admin/:collection/entries", validateList, (c) =>
    withAuthScope(c, async () => {
      await requireAdmin(c);
      const name = c.req.param("collection");
      if (!collectionFor(name)) {
        return unknownCollection(c, name);
      }
      const { page, status } = c.req.valid("query");
      const result = await withDb(c, (db) =>
        listEntries(db, name, {
          filter: status,
          page,
          pageSize: config.cms.pageSize,
        })
      );
      return c.json(
        {
          counts: result.counts,
          entries: result.entries.map(toAdminSummary),
          page: result.page,
          pageCount: result.pageCount,
          total: result.total,
        },
        200
      );
    })
  )

  // Create a draft. The caller becomes its author and its last editor.
  .post("/admin/:collection/entries", validateCreate, (c) =>
    withAuthScope(c, async () => {
      const session = await requireAdmin(c);
      const name = c.req.param("collection");
      const collection = collectionFor(name);
      if (!collection) {
        return unknownCollection(c, name);
      }
      const input = c.req.valid("json");
      const checked = checkData(c, collection, input.data);
      if ("response" in checked) {
        return checked.response;
      }
      try {
        const entry = await withDb(c, async (db) => {
          const row = await createEntry(db, {
            authorId: session.user.id,
            collection: name,
            data: checked.data,
            slug: input.slug,
            title: input.title,
          });
          return readBack(c, db, name, row.id);
        });
        return c.json({ entry }, 201);
      } catch (error) {
        return repositoryFailure(c, error, name);
      }
    })
  )

  // One entry with its working draft's `data`, for the editor.
  .get("/admin/:collection/entries/:id", (c) =>
    withAuthScope(c, async () => {
      await requireAdmin(c);
      const name = c.req.param("collection");
      if (!collectionFor(name)) {
        return unknownCollection(c, name);
      }
      const entry = await withDb(c, (db) =>
        getEntry(db, name, c.req.param("id"))
      );
      if (!entry) {
        return c.json(errorBody("not_found", "No such entry."), 404);
      }
      return c.json({ entry: toAdminEntry(c, entry) }, 200);
    })
  )

  // Save the working draft. The live post does not change. A stale `version` is a 409.
  .put("/admin/:collection/entries/:id", validateDraft, (c) =>
    withAuthScope(c, async () => {
      const session = await requireAdmin(c);
      const name = c.req.param("collection");
      const id = c.req.param("id");
      const collection = collectionFor(name);
      if (!collection) {
        return unknownCollection(c, name);
      }
      const input = c.req.valid("json");
      const checked = checkData(c, collection, input.data);
      if ("response" in checked) {
        return checked.response;
      }
      try {
        const entry = await withDb(c, async (db) => {
          await saveDraft(db, {
            collection: name,
            data: checked.data,
            editorId: session.user.id,
            id,
            slug: input.slug,
            title: input.title,
            version: input.version,
          });
          return readBack(c, db, name, id);
        });
        return c.json({ entry }, 200);
      } catch (error) {
        return repositoryFailure(c, error, name, id);
      }
    })
  )

  // Hard delete. Only a draft or an archived entry; a published one is a 409
  // `invalid_state`, so a live post is unpublished on purpose before it can go.
  .delete("/admin/:collection/entries/:id", (c) =>
    withAuthScope(c, async () => {
      await requireAdmin(c);
      const name = c.req.param("collection");
      const id = c.req.param("id");
      if (!collectionFor(name)) {
        return unknownCollection(c, name);
      }
      try {
        await withDb(c, (db) => deleteEntry(db, { collection: name, id }));
        return c.body(null, 204);
      } catch (error) {
        return repositoryFailure(c, error, name);
      }
    })
  )

  // Publish the working draft: a new revision with its rendered html becomes live. The
  // draft is checked again first, because a collection's schema can change after a save.
  .post("/admin/:collection/entries/:id/publish", validateVersion, (c) =>
    withAuthScope(c, async () => {
      const session = await requireAdmin(c);
      const name = c.req.param("collection");
      const id = c.req.param("id");
      const collection = collectionFor(name);
      if (!collection) {
        return unknownCollection(c, name);
      }
      const { version } = c.req.valid("json");
      try {
        const current = await withDb(c, (db) => getEntry(db, name, id));
        if (!current) {
          return c.json(errorBody("not_found", "No such entry."), 404);
        }
        if (current.version !== version) {
          throw new CmsRepositoryError(
            "conflict",
            "Someone else saved this entry after you opened it. Reload to see their changes."
          );
        }
        const checked = checkData(c, collection, current.data);
        if ("response" in checked) {
          return checked.response;
        }
        const render = renderFor(c, collection);
        const result = await withDb(c, async (db) => {
          const published = await publishEntry(db, {
            authorId: session.user.id,
            collection: name,
            id,
            render: (snapshot) => render(snapshot.data),
            version,
          });
          return {
            entry: await readBack(c, db, name, id),
            revision: {
              createdAt: published.revision.createdAt.toISOString(),
              html: published.revision.html,
              id: published.revision.id,
              slug: published.revision.slug,
              title: published.revision.title,
            },
          };
        });
        return c.json(result, 200);
      } catch (error) {
        return repositoryFailure(c, error, name, id);
      }
    })
  )

  // Take a published entry offline. It becomes a draft and keeps its revisions.
  .post("/admin/:collection/entries/:id/unpublish", validateVersion, (c) =>
    withAuthScope(c, async () => {
      const session = await requireAdmin(c);
      const name = c.req.param("collection");
      const id = c.req.param("id");
      if (!collectionFor(name)) {
        return unknownCollection(c, name);
      }
      const { version } = c.req.valid("json");
      try {
        const entry = await withDb(c, async (db) => {
          await unpublishEntry(db, {
            collection: name,
            editorId: session.user.id,
            id,
            version,
          });
          return readBack(c, db, name, id);
        });
        return c.json({ entry }, 200);
      } catch (error) {
        return repositoryFailure(c, error, name, id);
      }
    })
  )

  // Archive: offline, and out of the default list. Publishing it again puts it back live.
  .post("/admin/:collection/entries/:id/archive", validateVersion, (c) =>
    withAuthScope(c, async () => {
      const session = await requireAdmin(c);
      const name = c.req.param("collection");
      const id = c.req.param("id");
      if (!collectionFor(name)) {
        return unknownCollection(c, name);
      }
      const { version } = c.req.valid("json");
      try {
        const entry = await withDb(c, async (db) => {
          await archiveEntry(db, {
            collection: name,
            editorId: session.user.id,
            id,
            version,
          });
          return readBack(c, db, name, id);
        });
        return c.json({ entry }, 200);
      } catch (error) {
        return repositoryFailure(c, error, name, id);
      }
    })
  )

  // The revisions drawer: newest first, the live one marked.
  .get("/admin/:collection/entries/:id/revisions", (c) =>
    withAuthScope(c, async () => {
      await requireAdmin(c);
      const name = c.req.param("collection");
      const id = c.req.param("id");
      if (!collectionFor(name)) {
        return unknownCollection(c, name);
      }
      try {
        const revisions = await withDb(c, (db) => listRevisions(db, name, id));
        return c.json(
          {
            revisions: revisions.map((revision) => ({
              ...revision,
              createdAt: revision.createdAt.toISOString(),
            })),
          },
          200
        );
      } catch (error) {
        return repositoryFailure(c, error, name);
      }
    })
  )

  // Copy a revision into the working draft. The live post changes on the next publish.
  .post(
    "/admin/:collection/entries/:id/revisions/:revisionId/restore",
    validateVersion,
    (c) =>
      withAuthScope(c, async () => {
        const session = await requireAdmin(c);
        const name = c.req.param("collection");
        const id = c.req.param("id");
        if (!collectionFor(name)) {
          return unknownCollection(c, name);
        }
        const { version } = c.req.valid("json");
        try {
          const entry = await withDb(c, async (db) => {
            await restoreRevision(db, {
              collection: name,
              editorId: session.user.id,
              id,
              revisionId: c.req.param("revisionId"),
              version,
            });
            return readBack(c, db, name, id);
          });
          return c.json({ entry }, 200);
        } catch (error) {
          return repositoryFailure(c, error, name, id);
        }
      })
  )

  // --- Public ------------------------------------------------------------------------
  //
  // No session. Published entries only, newest `published_at` first, `config.cms.pageSize`
  // to a page. Each entry carries its finished excerpt, cover URL and author name, and no
  // `data` and no html: the list does not need the body.
  .get("/:collection/entries", validatePublicList, async (c) => {
    const name = c.req.param("collection");
    const collection = collectionFor(name);
    if (!collection) {
      return unknownCollection(c, name);
    }
    const { page } = c.req.valid("query");
    const result = await withDb(c, (db) =>
      listPublished(db, name, { page, pageSize: config.cms.pageSize })
    );
    return c.json(
      {
        entries: result.entries.map((entry) => {
          const { seo: _seo, ...listed } = publicFields(c, collection, entry);
          return listed;
        }),
        page: result.page,
        pageCount: result.pageCount,
        total: result.total,
      },
      200
    );
  })

  // One published entry by its live slug, with the live revision's html. An old slug
  // answers 301 with the current one in `location` and in the body, so `apps/web` can
  // redirect `/blog/<old>` to `/blog/<new>` without following the api's own URL.
  .get("/:collection/entries/:slug", async (c) => {
    const name = c.req.param("collection");
    const collection = collectionFor(name);
    if (!collection) {
      return unknownCollection(c, name);
    }
    const found = await withDb(c, (db) =>
      readPublished(db, name, c.req.param("slug"))
    );
    if (found.kind === "redirect") {
      const { path } = c.req;
      const location = `${path.slice(0, path.lastIndexOf("/") + 1)}${encodeURIComponent(found.slug)}`;
      return c.json({ slug: found.slug }, 301, { location });
    }
    if (found.kind === "missing") {
      return c.json(errorBody("not_found", "No such post."), 404);
    }
    return c.json(
      {
        entry: {
          ...publicFields(c, collection, found.entry),
          html: found.entry.html,
        },
      },
      200
    );
  });
