// Object keys are built by the capability, never written by a caller. `buildKey` takes
// parts and returns `t/<tenantId>/<scope>/<id>/<filename>`, so no route can write
// outside its tenant prefix and no filename can traverse out of it. A part that fails
// the check raises `StorageError` with code `invalid_key`.

import { StorageError } from "./provider";

export interface KeyParts {
  /** The owning tenant. Always the first segment, so a prefix list is tenant-scoped. */
  tenantId: string;
  /** What the object is for: "uploads", "exports", "imports", "reports". */
  scope: string;
  /**
   * The per-object id. It is what lets a soft-deleted row keep its key while the same
   * filename is uploaded again — the id differs, so the key differs.
   */
  id: string;
  /** The name the user gave the file. Sanitized, not trusted. */
  filename: string;
}

/** Every key starts here, so one prefix scan finds everything this capability wrote. */
const KEY_PREFIX = "t";

/** Segments that are ids, not text: strict, and rejected rather than repaired. */
const ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** What survives sanitizing in a filename. Anything else becomes `_`. */
const FILENAME_UNSAFE = /[^A-Za-z0-9._-]+/g;

/**
 * A filename may start with the `_` that sanitizing left behind ("отчёт.csv" becomes
 * "_.csv", keeping the extension). It may not start with a dot or a dash, which is what
 * keeps a segment from being `.`, `..`, a hidden file, or a value a CLI reads as a flag.
 */
const FILENAME_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** R2 and S3 both take 1024 UTF-8 bytes; the filename gets the smaller share of it. */
const MAX_FILENAME_LENGTH = 128;

/** The shape `buildKey` produces, and the only shape the proxy route will serve. */
const KEY_PATTERN =
  /^t\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * Build the key for one object.
 *
 * ```ts
 * buildKey({ tenantId: "t1", scope: "uploads", id: "01H…", filename: "notes.txt" });
 * // "t/t1/uploads/01H…/notes.txt"
 * ```
 *
 * `tenantId`, `scope` and `id` are rejected when they are empty, contain a path
 * separator, or are `.` / `..`. `filename` is sanitized instead of rejected — a user
 * picked it — except when sanitizing leaves nothing usable.
 */
export function buildKey(parts: KeyParts): string {
  const tenantId = assertSegment(parts.tenantId, "tenantId");
  const scope = assertSegment(parts.scope, "scope");
  const id = assertSegment(parts.id, "id");
  const filename = sanitizeFilename(parts.filename);

  return [KEY_PREFIX, tenantId, scope, id, filename].join("/");
}

/** True when `key` is a key this capability could have built. */
export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/**
 * Throw unless `key` is one of ours. The proxy route runs this after it verifies a
 * token, because a signed token is only as safe as the key inside it.
 */
export function assertValidKey(key: string): string {
  if (!isValidKey(key)) {
    throw new StorageError(
      "invalid_key",
      `Not a storage key: "${key}". Build one with buildKey({ tenantId, scope, id, filename }).`
    );
  }
  return key;
}

/** The tenant prefix, for a list that must not cross a tenant boundary. */
export function tenantPrefix(tenantId: string, scope?: string): string {
  const segments = [KEY_PREFIX, assertSegment(tenantId, "tenantId")];
  if (scope !== undefined) {
    segments.push(assertSegment(scope, "scope"));
  }
  return `${segments.join("/")}/`;
}

function assertSegment(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StorageError("invalid_key", `${label} is required.`);
  }
  // Checked before the pattern so the message names the real problem: a caller passing
  // "../other-tenant" is trying to traverse, not mistyping an id.
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new StorageError(
      "invalid_key",
      `${label} must not contain a path separator or "..": got "${value}".`
    );
  }
  if (!ID_SEGMENT.test(value)) {
    throw new StorageError(
      "invalid_key",
      `${label} must be letters, digits, ".", "_" or "-", starting with a letter or digit: got "${value}".`
    );
  }
  return value;
}

/**
 * A filename is user text, so it is repaired rather than refused: every run of
 * characters outside `[A-Za-z0-9._-]` becomes a single `_`. That folds a non-ASCII name
 * ("отчёт.csv") to something a key can hold while keeping its extension, and it removes
 * `/`, `\` and the space that would end an unquoted value downstream. Leading dots and
 * dashes go too, so no key segment is `.`, `..`, a hidden file, or something a CLI would
 * read as a flag.
 */
export function sanitizeFilename(filename: unknown): string {
  if (typeof filename !== "string" || filename.length === 0) {
    throw new StorageError("invalid_key", "filename is required.");
  }

  const cleaned = filename
    // Collapse a run of dots first, so no ".." survives anywhere in the segment. It is
    // already flat by then, but a key carrying ".." reads like a traversal to every tool
    // that ever prints it.
    .replaceAll(/\.{2,}/g, ".")
    .replaceAll(FILENAME_UNSAFE, "_")
    .replace(/^[.-]+/, "")
    .slice(0, MAX_FILENAME_LENGTH);

  if (cleaned.length === 0 || !FILENAME_SEGMENT.test(cleaned)) {
    throw new StorageError(
      "invalid_key",
      `filename "${filename}" has no usable characters. Pass a name with at least one letter or digit.`
    );
  }
  return cleaned;
}
