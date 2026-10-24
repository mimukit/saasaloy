// The rule that puts a live count on a nav row. The admin app fetches one number per
// NAV_COUNTS entry and hands them to ShellLayout keyed by the row's `to`; the sidebar runs
// its areas through `withLiveCounts` before it renders them.
//
// It is a .ts file with no imports so the tool repo can unit-test it under `node --test`
// with no React and no bundler.
//
// The rule, per row:
//
// - A live count that is a finite number replaces the row's static `count`.
// - A live count of 0 hides the badge. A queue with nothing waiting has nothing to say.
// - With no live count (no entry, still loading, or a failed fetch) the static `count`
//   stays, and a static 0 still renders, as NAV_AREAS documents.

/** Live counts keyed by a nav row's `to`. A missing or `undefined` value is "not known". */
export type LiveCounts = Readonly<Record<string, number | undefined>>;

interface CountedItem {
  readonly to: string;
  readonly count?: number;
}

interface CountedArea {
  readonly groups: readonly {
    readonly items: readonly CountedItem[];
  }[];
}

/** The count a row shows: the live one when known, else its static one. */
export function liveCount(
  item: CountedItem,
  counts: LiveCounts
): number | undefined {
  const live = Object.hasOwn(counts, item.to) ? counts[item.to] : undefined;
  if (typeof live !== "number" || !Number.isFinite(live)) {
    return item.count;
  }
  return live === 0 ? undefined : live;
}

/** The areas with every item's `count` set by `liveCount`. The input is not changed. */
export function withLiveCounts<Area extends CountedArea>(
  areas: readonly Area[],
  counts: LiveCounts
): Area[] {
  return areas.map((area) => ({
    ...area,
    groups: area.groups.map((group) => ({
      ...group,
      items: group.items.map((item) => ({
        ...item,
        count: liveCount(item, counts),
      })),
    })),
  }));
}
