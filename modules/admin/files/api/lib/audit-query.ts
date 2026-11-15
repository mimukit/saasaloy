// The pure half of `GET /admin/audit-events` (`../routes/admin-audit.ts`): the page cursor
// and the chip counts. It imports nothing, `hono` included, so the saasaloy repo tests it
// with `node --test` (`./audit-query.test.ts`); the route passes the project's action map
// in.

/** Where the next page starts: the last row of the page before. */
export interface PageCursor {
  createdAt: Date;
  id: string;
}

/** `<created_at ISO>~<id>`, the `nextCursor` the api hands out. */
export function encodeCursor(cursor: PageCursor): string {
  return `${cursor.createdAt.toISOString()}~${cursor.id}`;
}

/**
 * The cursor `encodeCursor` wrote, or `null` for anything else. The route answers 400 on
 * `null`, so a hand-made cursor never turns into a page that silently starts somewhere.
 */
export function decodeCursor(text: string): PageCursor | null {
  const [at, id, ...rest] = text.split("~");
  if (at === undefined || id === undefined || id === "" || rest.length > 0) {
    return null;
  }
  // Only the exact form `toISOString` writes, so `1` or `2026` is no cursor.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)) {
    return null;
  }
  const createdAt = new Date(at);
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
}

/**
 * The chip counts: `all`, and each area in `areas`, from the counts by action. An action
 * no module registers any more counts under `all` only. Every area in `areas` is present,
 * at zero when nothing matched, so a chip never loses its number.
 */
export function areaCounts(
  byAction: Readonly<Record<string, number>>,
  areas: readonly string[],
  areaOf: (action: string) => string | null
): Record<string, number> {
  const counts: Record<string, number> = { all: 0 };
  for (const area of areas) {
    counts[area] = 0;
  }
  for (const [action, total] of Object.entries(byAction)) {
    counts.all = (counts.all ?? 0) + total;
    const area = areaOf(action);
    if (area !== null && Object.hasOwn(counts, area)) {
      counts[area] = (counts[area] ?? 0) + total;
    }
  }
  return counts;
}
