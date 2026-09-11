// The shell's navigation data, and the two rules that read it. It lives in its own module
// rather than in app-shell.tsx because all three shell files need it: app-shell.tsx
// composes, rail.tsx renders the areas, nav-panel.tsx renders one area's groups. With the
// data in the composer the two leaves imported their own parent, which happens to work
// only while nothing reads NAV_AREAS at module scope.
//
// It is a .ts file, not .tsx: nothing here renders, and being JSX-free is what lets the
// tool repo unit-test `navCount` and `areaFor` directly.
//
// Dropping src/routes/<feature>.tsx is enough to make a screen reachable — the router
// plugin wires it up with no patch. Adding it to NAV_AREAS below is the separate, optional
// step that puts it in the nav panel.

import { GaugeIcon, LayoutDashboardIcon, UsersIcon } from "lucide-react";

// The `to` values are checked against the generated route tree, so a nav entry pointing at
// a route that does not exist fails `pnpm typecheck` instead of 404-ing at runtime. That is
// the reason this list is written out rather than derived from the router at runtime, and
// the reason it is `as const`: widening `to` to `string` would take the check away.
//
// Shape, one area per top-level destination in the rail:
//
//   { label, to, icon, count?, groups: [{ label, items: [{ to, label, icon, count? }] }] }
//
// The seed ships one area, "Admin", with one group. A second area gets its own rail icon
// and its own nav panel; nothing else has to change.
export const NAV_AREAS = [
  {
    label: "Admin",
    to: "/",
    icon: LayoutDashboardIcon,
    groups: [
      {
        label: "Manage",
        items: [
          { to: "/", label: "Overview", icon: GaugeIcon },
          { to: "/users", label: "Users", icon: UsersIcon },
        ],
      },
    ],
  },
] as const;

export type NavAreas = typeof NAV_AREAS;
export type NavArea = NavAreas[number];
export type NavGroup = NavArea["groups"][number];
export type NavItem = NavGroup["items"][number];

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
 * The area a path belongs to: the one whose `to` is the longest prefix of the path.
 *
 * Longest prefix, not first match, because "/" prefixes everything — an area at "/reports"
 * has to beat the root area for "/reports/weekly". A path under no area at all falls back
 * to the first, so the shell always has a nav panel to draw.
 */
export function areaFor(pathname: string): NavArea {
  return (
    NAV_AREAS.filter((candidate) => pathname.startsWith(candidate.to)).toSorted(
      (left, right) => right.to.length - left.to.length
    )[0] ?? NAV_AREAS[0]
  );
}
