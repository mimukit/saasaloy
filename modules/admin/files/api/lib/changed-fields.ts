// The change details an audit row keeps: only the fields that changed, each under its dot
// path, so a save that moved one nested rate stores `rates.us.perKg` and not the whole
// object. `adminWrite` and `adminAuthWrite` in `./admin-write.ts` call it on every entry.
//
// Pure and free of `hono` and `drizzle-orm` on purpose: the saasaloy repo tests it with
// `node --test` (`./changed-fields.test.ts`), where neither package is installed.

export type FlatFields = Record<string, unknown>;

/** A plain object to walk into. An array, a `Date` and `null` are leaves. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/** A leaf as it is stored: a `Date` as its ISO string, anything else as JSON keeps it. */
function leaf(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Every leaf of `value` under its dot path. An `undefined` field is no field. An empty
 * object is a leaf, so a field that became `{}` still shows.
 */
export function flatten(
  value: Record<string, unknown>,
  prefix = ""
): FlatFields {
  const out: FlatFields = {};
  for (const [key, field] of Object.entries(value)) {
    if (field === undefined) {
      continue;
    }
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isRecord(field) && Object.keys(field).length > 0) {
      Object.assign(out, flatten(field, path));
    } else {
      out[path] = leaf(field);
    }
  }
  return out;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The fields that differ between `before` and `after`, each side holding its own value.
 * A field on one side only (a create, a delete, a cleared value) appears on that side
 * only. A side with no changed field is `null`.
 */
export function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): { before: FlatFields | null; after: FlatFields | null } {
  const left = before === null ? {} : flatten(before);
  const right = after === null ? {} : flatten(after);
  const changedBefore: FlatFields = {};
  const changedAfter: FlatFields = {};
  for (const path of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (same(left[path], right[path])) {
      continue;
    }
    if (path in left) {
      changedBefore[path] = left[path];
    }
    if (path in right) {
      changedAfter[path] = right[path];
    }
  }
  return {
    before: Object.keys(changedBefore).length > 0 ? changedBefore : null,
    after: Object.keys(changedAfter).length > 0 ? changedAfter : null,
  };
}

/** What a refused key looks like. Any path segment that names a password matches. */
export const REFUSED_KEY = /password/i;

/**
 * The first key the log refuses, or `null`. A password never goes in, under any path: the
 * whole dot path is tested, so `password.hash` is refused as well as `newPassword`.
 */
export function refusedKey(fields: FlatFields | null): string | null {
  if (fields === null) {
    return null;
  }
  return Object.keys(fields).find((path) => REFUSED_KEY.test(path)) ?? null;
}
