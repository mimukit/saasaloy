import { queryOptions } from "@tanstack/react-query";

import { cms } from "@repo/cms";
import type { Collection } from "@repo/cms";
import type { PickedImage } from "@repo/cms/editor";

import { api } from "@admin/lib/api";
import { apiBaseUrl } from "@admin/lib/auth";
import { readConflict } from "@admin/lib/cms-format";
import type {
  CmsConflict,
  CmsListFilter,
  CmsStatus,
} from "@admin/lib/cms-format";

// The CMS screens' requests: the queries the list and the editor read, the writes they
// send, and the image upload the cover, the Open Graph image and the body share. Every
// call goes through the typed `api` client, so a change to `apps/api/src/routes/cms.ts`
// shows up here as a typecheck failure.

/** The registered collection named by a route param, or undefined for an unknown name. */
export function collectionFor(name: string): Collection | undefined {
  return cms.has(name) ? cms.collection(name) : undefined;
}

/** One row of the list, as `GET /cms/admin/:collection/entries` answers it. */
export interface CmsSummary {
  id: string;
  collection: string;
  title: string;
  slug: string;
  status: CmsStatus;
  version: number;
  authorId: string | null;
  authorName: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  hasUnpublishedEdits: boolean;
  liveSlug: string | null;
  publishedAt: string | null;
  publishedRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One entry for the editor: the summary, its `data`, and the URL of each image in it. */
export interface CmsEntry extends CmsSummary {
  data: unknown;
  mediaUrls: Record<string, string>;
}

export interface CmsList {
  entries: CmsSummary[];
  counts: Record<CmsStatus, number>;
  page: number;
  pageCount: number;
  total: number;
}

export interface CmsRevision {
  id: string;
  title: string;
  slug: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  live: boolean;
}

/** A refused write. `conflict` is set on a stale version, so the screen can name who won. */
export class CmsRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly conflict: CmsConflict | null;

  constructor(
    message: string,
    status: number,
    code: string | undefined,
    conflict: CmsConflict | null
  ) {
    super(message);
    this.name = "CmsRequestError";
    this.status = status;
    this.code = code;
    this.conflict = conflict;
  }
}

/**
 * The api's `{ error: { code, message } }` envelope as a thrown error. Structurally typed,
 * because `hc` hands back its own `ClientResponse`, not a `Response`.
 */
async function refusal(
  response: { json: () => Promise<unknown>; status: number },
  action: string
): Promise<CmsRequestError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: fall through to the status.
  }
  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body.error as { code?: string; message?: string })
      : undefined;
  return new CmsRequestError(
    error?.message ??
      `The api refused to ${action} (${String(response.status)}).`,
    response.status,
    error?.code,
    readConflict(body)
  );
}

export const cmsKeys = {
  all: (collection: string) => ["cms", collection] as const,
  entry: (collection: string, id: string) =>
    ["cms", collection, "entry", id] as const,
  list: (collection: string, filter: CmsListFilter, page: number) =>
    ["cms", collection, "list", filter, page] as const,
  revisions: (collection: string, id: string) =>
    ["cms", collection, "revisions", id] as const,
};

export function listQuery(
  collection: string,
  filter: CmsListFilter,
  page: number
) {
  return queryOptions({
    queryKey: cmsKeys.list(collection, filter, page),
    queryFn: async (): Promise<CmsList> => {
      const response = await api.cms.admin[":collection"].entries.$get({
        param: { collection },
        query: { page: String(page), status: filter },
      });
      if (!response.ok) {
        throw await refusal(response, "list the entries");
      }
      return (await response.json()) as CmsList;
    },
  });
}

export function entryQuery(collection: string, id: string) {
  return queryOptions({
    queryKey: cmsKeys.entry(collection, id),
    queryFn: async (): Promise<CmsEntry> => {
      const response = await api.cms.admin[":collection"].entries[":id"].$get({
        param: { collection, id },
      });
      if (!response.ok) {
        throw await refusal(response, "read the entry");
      }
      return ((await response.json()) as { entry: CmsEntry }).entry;
    },
  });
}

export function revisionsQuery(collection: string, id: string) {
  return queryOptions({
    queryKey: cmsKeys.revisions(collection, id),
    queryFn: async (): Promise<CmsRevision[]> => {
      const response = await api.cms.admin[":collection"].entries[
        ":id"
      ].revisions.$get({ param: { collection, id } });
      if (!response.ok) {
        throw await refusal(response, "list the revisions");
      }
      return ((await response.json()) as { revisions: CmsRevision[] })
        .revisions;
    },
  });
}

/** The body of a create or a save. */
export interface CmsDraft {
  title: string;
  slug: string;
  data: Record<string, unknown>;
}

async function entryFrom(
  response: { ok: boolean; json: () => Promise<unknown>; status: number },
  action: string
): Promise<CmsEntry> {
  if (!response.ok) {
    throw await refusal(response, action);
  }
  return ((await response.json()) as { entry: CmsEntry }).entry;
}

export async function createEntry(
  collection: string,
  draft: CmsDraft
): Promise<CmsEntry> {
  const response = await api.cms.admin[":collection"].entries.$post({
    json: draft,
    param: { collection },
  });
  return entryFrom(response, "create the entry");
}

export async function saveEntry(
  collection: string,
  id: string,
  draft: CmsDraft & { version: number }
): Promise<CmsEntry> {
  const response = await api.cms.admin[":collection"].entries[":id"].$put({
    json: draft,
    param: { collection, id },
  });
  return entryFrom(response, "save the draft");
}

export async function publishEntry(
  collection: string,
  id: string,
  version: number
): Promise<CmsEntry> {
  const response = await api.cms.admin[":collection"].entries[
    ":id"
  ].publish.$post({ json: { version }, param: { collection, id } });
  return entryFrom(response, "publish the entry");
}

export async function unpublishEntry(
  collection: string,
  id: string,
  version: number
): Promise<CmsEntry> {
  const response = await api.cms.admin[":collection"].entries[
    ":id"
  ].unpublish.$post({ json: { version }, param: { collection, id } });
  return entryFrom(response, "unpublish the entry");
}

export async function restoreRevision(
  collection: string,
  id: string,
  revisionId: string,
  version: number
): Promise<CmsEntry> {
  const response = await api.cms.admin[":collection"].entries[":id"].revisions[
    ":revisionId"
  ].restore.$post({
    json: { version },
    param: { collection, id, revisionId },
  });
  return entryFrom(response, "restore the revision");
}

/**
 * Upload one image as a public object through `file-uploads`, the same three steps the
 * Files screen runs: record the intent, PUT the bytes to the target the api names, then
 * mark it complete. The PUT carries no credentials, because the target authorizes itself.
 * The image must be public, so the live post can show it with no signed link.
 */
export async function uploadImage(file: File): Promise<PickedImage> {
  const started = await api.files.uploads.$post({
    json: {
      contentType: file.type || "application/octet-stream",
      filename: file.name,
      size: file.size,
      visibility: "public",
    },
  });
  if (!started.ok) {
    throw await refusal(started, "accept that image");
  }
  const { id, key, upload } = (await started.json()) as {
    id: string;
    key: string;
    upload: { url: string; method: "PUT"; headers: Record<string, string> };
  };

  // The proxy target is a path on the api (`/storage/objects?token=…`) when no
  // `STORAGE_PROXY_URL` is set, so it resolves against the api origin, not this page's.
  const put = await globalThis.fetch(new URL(upload.url, apiBaseUrl), {
    body: file,
    credentials: "omit",
    headers: upload.headers,
    method: upload.method,
  });
  if (!put.ok) {
    throw new CmsRequestError(
      `The storage target refused the image (${String(put.status)}).`,
      put.status,
      undefined,
      null
    );
  }

  const completed = await api.files.uploads[":id"].complete.$post({
    param: { id },
  });
  if (!completed.ok) {
    throw await refusal(completed, "accept the uploaded image");
  }
  const row = (await completed.json()) as { url?: string };
  return { key, objectId: id, ...(row.url ? { url: row.url } : {}) };
}
