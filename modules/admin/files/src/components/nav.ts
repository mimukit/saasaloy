// The shell's navigation data, and the two rules that read it. app-shell.tsx hands it to
// the sidebar in @repo/ui, which renders every area's groups. It lives in its own module
// rather than in app-shell.tsx so the rules below stay unit-testable without React.
//
// It is a .ts file, not .tsx: nothing here renders, and being JSX-free is what lets the
// tool repo unit-test `navCount` and `areaFor` directly.
//
// Dropping src/routes/<feature>.tsx is enough to make a screen reachable — the router
// plugin wires it up with no patch. Adding it to NAV_AREAS below is the separate, optional
// step that puts it in the sidebar.

import type { NavigateOptions } from "@tanstack/react-router";
import {
  GaugeIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  ShieldIcon,
  UsersIcon,
} from "lucide-react";
import { adminNav } from "./nav.generated";

// The `to` values are checked against the generated route tree (`NavTargets` below), so a
// nav entry pointing at a route that does not exist fails `pnpm typecheck` instead of
// 404-ing at runtime. A row may name a concrete path of a route with a param: `/cms/blog`
// passes because `/cms/$collection` exists. That is
// the reason this list is written out rather than derived from the router at runtime, and
// the reason it is `as const`: widening `to` to `string` would take the check away.
//
// Shape, one area per top-level destination:
//
//   { label, to, icon, count?, groups: [{ label, items: [{ to, label, icon, count?, shortcut? }] }] }
//
// `shortcut` is the row's key sequence, `G` then a letter, written with a space: "G U".
// Pick the letter by hand and never derive it from the label, so "Users" and a later
// "Usage" cannot collide. components/commands.ts turns each row into a "Go to" command
// that carries it, and components/commands.test.ts fails on two rows with one shortcut.
// It binds only when the `command` module is installed; without it the key does nothing.
//
// The seed ships one area, "Admin", with one group. The sidebar lists every area's groups
// in order, and the area's label is the first step of the header's page path; nothing
// else has to change for a second area.
const SHIPPED_AREAS = [
  {
    label: "Admin",
    to: "/",
    icon: LayoutDashboardIcon,
    groups: [
      {
        label: "Manage",
        items: [
          { to: "/", label: "Overview", icon: GaugeIcon, shortcut: "G O" },
          { to: "/users", label: "Users", icon: UsersIcon, shortcut: "G U" },
          {
            to: "/members",
            label: "Members",
            icon: ShieldIcon,
            shortcut: "G M",
          },
          {
            to: "/activity",
            label: "Activity",
            icon: HistoryIcon,
            shortcut: "G A",
          },
        ],
      },
    ],
  },
] as const;

// Every area: the rows above, then the rows of the installed modules from
// `./nav.generated.ts`, which the CLI writes on every run. A row of your own goes in a
// group above, or after the spread as \`{ area, group, to, label, icon }\`.
export const NAV_AREAS = withRows(SHIPPED_AREAS, [...adminNav]);

export type NavAreas = typeof NAV_AREAS;
export type NavArea = NavAreas[number];
export type NavGroup = NavArea["groups"][number];
export type NavItem = NavGroup["items"][number];

/** Every route path the generated tree holds, such as "/users" or "/cms/$collection". */
type RoutePath = Exclude<NonNullable<NavigateOptions["to"]>, "." | "..">;

/** A route path with each `$param` segment widened to any segment. */
type Concrete<P extends string> = P extends `${infer Head}$${infer Rest}`
  ? Rest extends `${string}/${infer Tail}`
    ? `${Head}${string}/${Concrete<Tail>}`
    : `${Head}${string}`
  : P;

/** Every path a nav row may point at: a route of the tree, its params filled in. */
export type NavPath = Concrete<RoutePath>;

type Checked<T extends NavPath> = T;

/** The check itself. A row whose `to` matches no route makes this line fail typecheck. */
export type NavTargets = Checked<NavArea["to"] | NavItem["to"]>;

/**
 * The optional count on an area or a nav row.
 *
 * Read it through this helper rather than `entry.count`. NAV_AREAS is `as const`, which is
 * what keeps every `to` a literal the router can check — and it also means an entry that
 * omits `count` has no such key on its type at all. A parameter with an optional `count`
 * accepts both shapes and still rejects a wrong one.
 *
 * `label` is in the signature to carry that check, not because the count needs it. A
 * parameter whose every property is optional is a "weak type", and TypeScript rejects an
 * argument sharing no property with it — which is exactly the countless entry this helper
 * exists for. One required property both shapes already have settles it.
 */
export function navCount(entry: {
  readonly label: string;
  readonly count?: number;
}): number | undefined {
  return entry.count;
}

/**
 * The optional key sequence on a nav row, read the way `navCount` reads a count and for
 * the same reason: a row that omits `shortcut` has no such key on its `as const` type.
 */
export function navShortcut(entry: {
  readonly label: string;
  readonly shortcut?: string;
}): string | undefined {
  return entry.shortcut;
}

/**
 * The area a path belongs to: the one whose `to` is the longest prefix of the path.
 *
 * Longest prefix, not first match, because "/" prefixes everything — an area at "/reports"
 * has to beat the root area for "/reports/weekly". A path under no area at all falls back
 * to the first, so the shell always has an area to name.
 */
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
