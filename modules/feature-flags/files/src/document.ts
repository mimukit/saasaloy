// The shape of a published flag document, the key each one is stored under, and the pure
// evaluation of one entry. Nothing here reaches a store or a database, so every rule about
// what a flag *means* is testable without either.

import { bucket } from "./hash";

/** Bumped only when the document's shape changes. It is part of the key, so an old
 * document is orphaned rather than misread, and a deploy never has to migrate one. */
export const DOCUMENT_VERSION = "v1";

/** The namespace `@repo/kv` builds every flag key under. */
export const FLAGS_NAMESPACE = "flags";

/** What a flag is set to for one scope. Written by the admin routes, never by a reader. */
export interface FlagValue {
  /** Off means off, whatever `percentage` says. */
  enabled: boolean;
  /** 0–100. Read only for a `percentage` flag; `null` on a boolean one. */
  percentage?: number | null;
}

/**
 * One scope's whole flag set in a single document.
 *
 * One document per scope rather than one key per flag: a request checking six flags then
 * costs one KV read instead of six, which matters against the 1,000-operations-per-
 * invocation cap far more than the few bytes saved.
 */
export interface FlagDocument {
  version: typeof DOCUMENT_VERSION;
  /** Unix milliseconds the document was published. Diagnostic only; nothing branches on it. */
  publishedAt: number;
  flags: Record<string, FlagValue>;
}

/** `global`, or `t:<tenantId>`. The unit a document is published and cached under. */
export type FlagScope = "global" | `t:${string}`;

export function tenantScope(tenantId: string): FlagScope {
  return `t:${tenantId}`;
}

/**
 * The key parts for a scope: `flags:v1:global`, or `flags:v1:t:<tenantId>`.
 *
 * Returned as parts rather than a joined string because `@repo/kv` owns the joining and
 * the `KV_KEY_PREFIX` in front of it — see `buildKey`.
 */
export function documentKeyParts(scope: FlagScope): string[] {
  return scope === "global"
    ? [DOCUMENT_VERSION, "global"]
    : [DOCUMENT_VERSION, "t", scope.slice(2)];
}

export function emptyDocument(): FlagDocument {
  return { flags: {}, publishedAt: Date.now(), version: DOCUMENT_VERSION };
}

export function publishedDocument(
  flags: Record<string, FlagValue>
): FlagDocument {
  return { flags, publishedAt: Date.now(), version: DOCUMENT_VERSION };
}

/**
 * Turn one stored value into the boolean a caller gets.
 *
 * `enabled: false` short-circuits, so turning a rollout off is one edit rather than
 * setting the percentage back to zero and remembering what it used to be.
 *
 * A percentage flag with no `subjectId` resolves **false**. There is nothing to bucket, and
 * guessing (a coin flip, or "on for everyone anonymous") would make the same request
 * answer differently on a retry. Pass the user id, the session id, or the device id.
 */
export function evaluate(
  flagKey: string,
  type: "boolean" | "percentage",
  value: FlagValue,
  subjectId: string | undefined
): boolean {
  if (!value.enabled) {
    return false;
  }
  if (type === "boolean") {
    return true;
  }

  const percentage = value.percentage ?? 0;
  if (percentage >= 100) {
    return true;
  }
  if (percentage <= 0 || subjectId === undefined) {
    return false;
  }
  return bucket(flagKey, subjectId) < percentage;
}
