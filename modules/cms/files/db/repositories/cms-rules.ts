// The decisions behind `./cms.ts`, with no Drizzle import. The repository runs the queries;
// this file decides what they do: which revisions a prune drops, whether a publish writes a
// redirect, whether an entry may be deleted, and whether a published entry has unpublished
// edits. Keeping them here lets them be tested with no database.

/** The three states an entry can be in. Stored as text in `cms_entries.status`. */
export type CmsStatus = "draft" | "published" | "archived";

export const CMS_STATUSES: readonly CmsStatus[] = [
  "draft",
  "published",
  "archived",
];

/** The newest revisions kept per entry. The live revision is kept on top of these. */
export const REVISION_LIMIT = 50;

/**
 * Why a repository call refused. Phase 3's routes map the code onto a status:
 * `not_found` 404, `conflict` and `slug_taken` 409, `invalid_state` 409.
 */
export type CmsErrorCode =
  "not_found" | "conflict" | "slug_taken" | "invalid_state";

export class CmsRepositoryError extends Error {
  readonly code: CmsErrorCode;

  constructor(code: CmsErrorCode, message: string) {
    super(message);
    this.name = "CmsRepositoryError";
    this.code = code;
  }
}

/**
 * The revision ids a prune deletes: everything past the newest `keep`, by `createdAt`,
 * except the live revision, which is never deleted however old it is.
 */
export function revisionsToPrune(
  revisions: readonly { id: string; createdAt: Date }[],
  liveRevisionId: string | null,
  keep: number = REVISION_LIMIT
): string[] {
  const newestFirst = revisions.toSorted(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)
  );
  return newestFirst
    .slice(keep)
    .filter((revision) => revision.id !== liveRevisionId)
    .map((revision) => revision.id)
    .toSorted();
}

/**
 * JSON with object keys sorted at every depth. Postgres `jsonb` does not keep key order, so
 * two equal documents can come back with their keys in a different order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** The part of an entry or a revision that a publish copies. */
export interface Snapshot {
  title: string;
  slug: string;
  data: unknown;
}

/**
 * True when a published entry's working draft differs from its live revision. The admin
 * list and the editor show "Unpublished edits" for it. A draft or an archived entry has no
 * live revision to differ from, so it is always false.
 */
export function hasUnpublishedEdits(
  entry: Snapshot & { status: string },
  live: Snapshot | null
): boolean {
  if (entry.status !== "published" || live === null) {
    return false;
  }
  return (
    entry.title !== live.title ||
    entry.slug !== live.slug ||
    canonicalJson(entry.data) !== canonicalJson(live.data)
  );
}

/** `published_at` after a publish: set on the first publish, kept on every later one. */
export function publishedAtFor(existing: Date | null, now: Date): Date {
  return existing ?? now;
}

/**
 * The old slug a publish records in `cms_redirects`, or `null`. A redirect is written only
 * when the entry was live before and the publish changes its live slug.
 */
export function redirectSlugFor(
  previousLiveSlug: string | null,
  nextSlug: string
): string | null {
  return previousLiveSlug !== null && previousLiveSlug !== nextSlug
    ? previousLiveSlug
    : null;
}

/** Hard delete works on a draft or an archived entry only. Unpublish a live one first. */
export function assertDeletable(status: string): void {
  if (status !== "draft" && status !== "archived") {
    throw new CmsRepositoryError(
      "invalid_state",
      "A published entry cannot be deleted. Unpublish or archive it first."
    );
  }
}

/** A 1-based page turned into a query window. A page below 1 or not a number is page 1. */
export function pageWindow(
  page: number,
  pageSize: number
): { limit: number; offset: number; page: number } {
  const whole = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  return { limit: pageSize, offset: (whole - 1) * pageSize, page: whole };
}
