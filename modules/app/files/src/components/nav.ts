import { HouseIcon, LayoutGridIcon } from "lucide-react";

import { config } from "@repo/config";

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
export const NAV_AREAS = [
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
