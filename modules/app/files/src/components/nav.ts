import { HouseIcon, LayoutGridIcon } from "lucide-react";

import { config } from "@repo/config";
import { appNav } from "./nav.generated";

// The shell's navigation data. app-shell.tsx hands it to the sidebar in @repo/ui, which
// renders every area's groups. It is a .ts file because nothing here renders.
//
// Dropping src/routes/<screen>.tsx is enough to make a screen reachable: the router plugin
// wires it up with no patch. Adding it to NAV_AREAS below is the separate step that puts
// it in the sidebar. See "Add a screen" in the saasaloy-app skill.
//
// The `to` values are checked against the generated route tree, so an entry that names a
// route that does not exist fails `pnpm typecheck` instead of 404-ing at runtime. That is
// why the list is written out and `as const`: widening `to` to `string` drops the check.
//
// Shape, one area per top-level destination:
//
//   { label, to, icon, groups: [{ label, items: [{ to, label, icon, shortcut? }] }] }
//
// `shortcut` is the row's key sequence, `G` then a letter, written with a space: "G H".
// Pick the letter by hand and never derive it from the label, so two rows that start
// with one letter cannot collide. components/commands.ts turns each row into a "Go to"
// command that carries it, and components/commands.test.ts fails on two rows with one
// shortcut. It binds only when the `command` module is installed.
//
// The area label is the product name, not "Admin": it is the first step of the header's
// page path. The scaffold ships one row, Home. Your first feature adds the second.
const SHIPPED_AREAS = [
  {
    label: config.app.name,
    to: "/",
    icon: LayoutGridIcon,
    groups: [
      {
        label: "Workspace",
        items: [{ to: "/", label: "Home", icon: HouseIcon, shortcut: "G H" }],
      },
    ],
  },
] as const;

// Every area: the rows above, then the rows of the installed modules from
// `./nav.generated.ts`, which the CLI writes on every run. A row of your own goes in a
// group above, or after the spread as \`{ area, group, to, label, icon }\`.
export const NAV_AREAS = withRows(SHIPPED_AREAS, [...appNav]);

export type NavAreas = typeof NAV_AREAS;
export type NavArea = NavAreas[number];
export type NavGroup = NavArea["groups"][number];
export type NavItem = NavGroup["items"][number];

/**
 * The optional key sequence on a nav row. A row that omits `shortcut` has no such key on
 * its `as const` type, so read it through this helper rather than `item.shortcut`. The
 * required `label` keeps the parameter from being a weak type that rejects such a row.
 */
export function navShortcut(entry: {
  readonly label: string;
  readonly shortcut?: string;
}): string | undefined {
  return entry.shortcut;
}

/** The area whose `to` is the longest prefix of the pathname, or the first area. */
export function areaFor(pathname: string): NavArea {
  return (
    NAV_AREAS.filter((candidate) => pathname.startsWith(candidate.to)).toSorted(
      (left, right) => right.to.length - left.to.length
    )[0] ?? NAV_AREAS[0]
  );
}

/** A row of `./nav.generated.ts`: a nav item, and the area and the group it goes into. */
interface NavRow {
  /** The `to` of the area. */
  readonly area: string;
  /** The label of the group. A group the area does not have yet goes after its last one. */
  readonly group: string;
  readonly to: string;
  readonly label: string;
}

/** The shipped shape `withRows` reads: areas, each holding labelled groups of items. */
interface ShippedArea {
  readonly to: string;
  readonly groups: readonly {
    readonly label: string;
    readonly items: readonly object[];
  }[];
}

/** A row without its placement: the nav item it becomes. */
type RowItem<R> = R extends unknown ? Omit<R, "area" | "group"> : never;

/** The items of a group type, as a union. */
type ItemOf<G> = G extends { readonly items: readonly (infer I)[] } ? I : never;

/** The areas with every row's item added to the item type of each group. */
type WithRows<A extends readonly ShippedArea[], R> = {
  readonly [K in keyof A]: Omit<A[K], "groups"> & {
    readonly groups: readonly {
      readonly label: string;
      readonly items: readonly (ItemOf<A[K]["groups"][number]> | RowItem<R>)[];
    }[];
  };
};

/**
 * The shipped areas with each row added to the group its `area` and `group` name, in the
 * order the rows come. A row whose area does not exist throws, so a typo fails the first
 * test that loads the nav.
 */
function withRows<
  const A extends readonly ShippedArea[],
  const R extends readonly NavRow[],
>(areas: A, rows: R): WithRows<A, R[number]> {
  const merged = areas.map((area) => ({
    ...area,
    groups: area.groups.map((group) => ({ ...group, items: [...group.items] })),
  }));
  for (const { area: to, group: label, ...item } of rows) {
    const area = merged.find((candidate) => candidate.to === to);
    if (area === undefined) {
      throw new Error(
        `The nav row ${item.to} names the area ${to}, and NAV_AREAS has no area with that \`to\`.`
      );
    }
    let group = area.groups.find((candidate) => candidate.label === label);
    if (group === undefined) {
      group = { items: [], label };
      area.groups.push(group);
    }
    group.items.push(item);
  }
  return merged as unknown as WithRows<A, R[number]>;
}
