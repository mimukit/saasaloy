// The rows of the shell's "Needs attention" menu. Each row is a queue a person should look
// at: a link, its words, and a live count the app already fetches for the sidebar. The
// menu lists a queue only while something waits in it.
//
// Pure and React-free, so the rule is unit-tested without rendering.

/** One queue the app offers to the menu. */
export interface AttentionSource {
  to: string;
  label: string;
}

/** One queue with work in it. */
export interface AttentionRow extends AttentionSource {
  count: number;
}

/**
 * The queues with a count above zero, in the order the app lists them, and their total.
 * A count that is unknown (still loading, or failed) counts as nothing, so a broken
 * endpoint hides its row rather than showing a wrong number.
 */
export function attentionRows(
  sources: readonly AttentionSource[],
  counts: Readonly<Record<string, number | undefined>>
): { rows: AttentionRow[]; total: number } {
  const rows = sources.flatMap((source) => {
    const count = counts[source.to];
    return count === undefined || count <= 0 ? [] : [{ ...source, count }];
  });
  return { rows, total: rows.reduce((sum, row) => sum + row.count, 0) };
}
