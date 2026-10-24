import type { AnchorHTMLAttributes, ComponentType, Ref } from "react";

// The shapes the admin shell containers read, and nothing more. They are structural on
// purpose: the admin app's NAV_AREAS is typed against its route tree, and that typing
// stays in the app. Every `to` there is a literal the router checks; here it is a string,
// because @repo/ui imports no router and so cannot know the routes.
//
// An entry that omits `count` still fits these types, because the property is optional.
//
// The file is `.tsx` with no JSX because the package exports `./containers/*` as
// `*.tsx`, and the admin app imports these types through that path.

export interface ShellNavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  /** An optional count shown at the right of the row. A static zero renders. */
  readonly count?: number;
}

export interface ShellNavGroup {
  readonly label: string;
  readonly items: readonly ShellNavItem[];
}

export interface ShellNavArea extends ShellNavItem {
  readonly groups: readonly ShellNavGroup[];
}

/** The signed-in account the shell's account menu shows. */
export interface ShellAccount {
  readonly name: string;
  readonly email: string;
  readonly initials: string;
}

/** What the account menu needs to sign out, from the app's own sign-out hook. */
export interface ShellSignOut {
  readonly pending: boolean;
  /** The last failure, shown in the menu, or `null`. */
  readonly error: string | null;
  readonly signOut: () => void;
}

/**
 * The props the app's link component receives. The rest of the anchor attributes are
 * there because a Base UI `render` prop merges its own props (an id, aria attributes,
 * event handlers, a ref) into the element it is given, so the link has to pass them on.
 *
 * The app sets `aria-current="page"` on the active link. The shell styles that attribute
 * and reads no current path of its own for the active row.
 */
export interface ShellLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
  /** Match the path exactly. The root entry "/" needs it, or it is active everywhere. */
  exact: boolean;
  ref?: Ref<HTMLAnchorElement>;
}

export type ShellLink = ComponentType<ShellLinkProps>;
