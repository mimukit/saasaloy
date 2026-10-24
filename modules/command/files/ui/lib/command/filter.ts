import uFuzzy from "@leeoniya/ufuzzy";

import type {
  PaletteGroup,
  ResolvedCommand,
} from "@repo/ui/lib/command/registry";

// The palette's filter. Base UI's default is a `contains` match that keeps list order,
// which finds nothing for "usr" against "Users" or "refnd" against "Refund". uFuzzy with
// one inserted character allowed per term matches both and ranks the results (plan 0084,
// Phase 1 filter verdict). A row matches on its title plus its keywords. The groups keep
// their fixed order; inside a group, rows follow uFuzzy's rank.

const fuzzy = new uFuzzy({ intraIns: 1 });

/**
 * A palette row after filtering: the command, and the title's matched character ranges.
 * `value` and `label` are the shape Base UI reads a row's text from.
 */
export interface FilteredRow {
  value: string;
  label: string;
  entry: ResolvedCommand;
  /** `[start, end, start, end, …]` offsets into the title; empty with no query. */
  ranges: readonly number[];
}

/** A palette group after filtering. */
export interface FilteredGroup {
  key: string;
  label: string;
  items: FilteredRow[];
}

function rowOf(entry: ResolvedCommand, ranges: readonly number[]): FilteredRow {
  return { value: entry.command.id, label: entry.command.title, entry, ranges };
}

/** Keep the `[start, end]` pairs that fall inside the title; a keyword match marks nothing. */
function titleRanges(all: readonly number[], titleLength: number): number[] {
  const ranges: number[] = [];
  for (let i = 0; i + 1 < all.length; i += 2) {
    const start = all.at(i) ?? 0;
    const end = Math.min(all.at(i + 1) ?? 0, titleLength);
    if (start < end) {
      ranges.push(start, end);
    }
  }
  return ranges;
}

function haystackOf(entry: ResolvedCommand): string {
  const keywords = entry.command.keywords ?? [];
  return [entry.command.title, ...keywords].join(" ");
}

/**
 * Filter and rank the palette groups for `query`. An empty query returns every row in
 * declared order. A group with no match is left out.
 */
export function filterPalette(
  groups: readonly PaletteGroup[],
  query: string
): FilteredGroup[] {
  const needle = query.trim();
  if (needle === "") {
    return groups.map((group) => ({
      key: group.key,
      label: group.label,
      items: group.items.map((entry) => rowOf(entry, [])),
    }));
  }

  const filtered: FilteredGroup[] = [];
  for (const group of groups) {
    const haystack = group.items.map(haystackOf);
    const [indexes, info, order] = fuzzy.search(haystack, needle);
    if (indexes === null || indexes.length === 0) {
      continue;
    }
    const items: FilteredRow[] =
      info === null || order === null
        ? indexes.flatMap((index) => {
            const entry = group.items.at(index);
            return entry === undefined ? [] : [rowOf(entry, [])];
          })
        : order.flatMap((position) => {
            const index = info.idx.at(position);
            const entry =
              index === undefined ? undefined : group.items.at(index);
            if (entry === undefined) {
              return [];
            }
            const ranges = titleRanges(
              info.ranges.at(position) ?? [],
              entry.command.title.length
            );
            return [rowOf(entry, ranges)];
          });
    filtered.push({ key: group.key, label: group.label, items });
  }
  return filtered;
}

/** The title split into plain and matched parts, in order, for drawing the matched letters. */
export function splitMatches(
  title: string,
  ranges: readonly number[]
): { text: string; matched: boolean }[] {
  if (ranges.length === 0) {
    return [{ text: title, matched: false }];
  }
  return uFuzzy.highlight<
    { text: string; matched: boolean }[],
    { text: string; matched: boolean }
  >(
    title,
    [...ranges],
    (part, matched) => ({ text: part, matched }),
    [],
    (parts, part) => {
      parts.push(part);
      return parts;
    }
  );
}
