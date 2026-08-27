import { Link, useRouter } from "@tanstack/react-router";
import type { AnyRoute, LinkProps } from "@tanstack/react-router";

import { Button } from "@repo/ui/components/button";
import { ThemeToggle } from "@repo/ui/blocks/theme-toggle";

// The signed-in chrome, and the reader half of the nav convention.
//
// A page never registers itself here. It declares `staticData: { nav: { label, order } }`
// in its own route file (see src/routes/_authed/index.tsx for the worked example), and
// this component reads that back off the router's own route table. Adding a page is
// therefore one file: drop it under src/routes/_authed/, give it a `nav` entry, and the
// link appears. Delete the file and the link goes with it. There is no array to patch,
// so the nav cannot disagree with the routes it points at.
//
// `router.routesById` is the flat table the router builds from routeTree.gen.ts at
// startup, so this walk costs one pass over a handful of objects per render and needs no
// state of its own.

interface NavItem {
  to: string;
  label: string;
  order: number;
}

function collectNavItems(routes: AnyRoute[]): NavItem[] {
  return routes
    .flatMap((route) => {
      const nav = route.options.staticData?.nav;
      // A route without a `nav` entry is simply not in the nav — that is how /login,
      // /signup and any future detail page stay out of it without saying so.
      return nav ? [{ to: route.fullPath, label: nav.label, order: nav.order }] : [];
    })
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export interface NavProps {
  /** Email of the signed-in user, shown beside the controls. */
  email: string;
  /** Ends the session. The layout owns the call; the nav only renders the button. */
  onSignOut: () => void;
  /** True while sign-out is in flight, so the button cannot be pressed twice. */
  signOutPending?: boolean;
}

export function Nav({ email, onSignOut, signOutPending = false }: NavProps) {
  const router = useRouter();
  const items = collectNavItems(Object.values(router.routesById));

  return (
    <header className="flex items-center gap-6 border-b px-6 py-3">
      <nav aria-label="Main" className="flex items-center gap-1">
        {items.map((item) => (
          <Link
            key={item.to}
            // `fullPath` is a plain string off the route table, while `Link` wants one of
            // the literal paths the generated tree registered. Every value here came from
            // that same tree, so the cast narrows a type the compiler cannot follow
            // through `Object.values` rather than asserting anything new.
            to={item.to as LinkProps["to"]}
            className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm transition-colors"
            activeProps={{ className: "text-foreground font-medium" }}
            activeOptions={{ exact: true }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <span className="text-muted-foreground text-sm">{email}</span>
        <ThemeToggle />
        <Button variant="outline" onClick={onSignOut} disabled={signOutPending}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
