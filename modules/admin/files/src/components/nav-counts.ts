import { adminNavCounts } from "./nav-counts.generated";

// The live counts on the sidebar's rows. app-shell.tsx reads this list, asks the api for
// each entry's number, and the sidebar shows it at the right of the row whose `to` matches.
//
// An entry is `{ to, path }`. `to` is the nav row's route, the same string as its `to` in
// NAV_AREAS (./nav.ts). `path` is an api path, joined to the api origin, that answers
// `{ count: number }` behind the admin session, the way `/admin/payment/review-count` does.
//
// A module adds its entry as a row of the generated table, so the seed ships the list
// empty and needs no edit. The shell fetches every entry on load, again on window
// focus, and every 60 s while the tab is visible, under the query key `["nav-count", to]`.
// A page whose action changes a count invalidates that key, so the badge follows at once.
//
// A live count replaces the row's static `count` in NAV_AREAS, and a live 0 hides the
// badge; the rule lives in @repo/ui/lib/shell/nav-counts. A failed fetch keeps the last
// count it read and never shows an error. Before the first success the row keeps its
// static `count`.

/** One live count: the nav row it belongs to and the api path that answers it. */
export interface NavCountSource {
  /** The nav row's route, matching a `to` in NAV_AREAS. */
  readonly to: string;
  /** The api path, from the api origin, that answers `{ count: number }`. */
  readonly path: string;
}

// The entries of the installed modules come from `./nav-counts.generated.ts`, which the CLI
// writes on every run. An entry of your own goes after the spread.
export const NAV_COUNTS: readonly NavCountSource[] = [...adminNavCounts];
