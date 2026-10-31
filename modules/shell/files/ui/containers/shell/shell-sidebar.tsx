import { ChevronsUpDownIcon, KeyboardIcon, LogOutIcon } from "lucide-react";
import { Fragment } from "react";
import type { ReactNode } from "react";

import { siteName } from "@repo/ui";
import { BrandMark } from "@repo/ui/blocks/shell/brand-mark";
import { ThemeMenuItem } from "@repo/ui/blocks/shell/theme-toggle";
import { Avatar, AvatarFallback } from "@repo/ui/components/shell/avatar";
import { Kbd, KbdGroup } from "@repo/ui/components/shell/kbd";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@repo/ui/components/shell/menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@repo/ui/components/shell/sidebar";
import type {
  ShellAccount,
  ShellLink,
  ShellNavArea,
  ShellSignOut,
} from "@repo/ui/containers/shell/shell-nav";
import { useShortcutHints } from "@repo/ui/lib/shell/commands";
import { withLiveCounts } from "@repo/ui/lib/shell/nav-counts";
import type { LiveCounts } from "@repo/ui/lib/shell/nav-counts";
import { sidebarHints } from "@repo/ui/lib/shell/shortcut-hints";

// The shell sidebar: the brand row, the organization picker's slot, every area's nav
// groups, and the account menu at the foot. The account menu also holds the Theme submenu.
//
// It collapses to an icon strip at desktop (the header's toggle, or ⌘B / Ctrl+B) and
// opens as a sheet below `md`. Both are the coss sidebar's own behaviour; this file only
// fills it. The open state is component state and never storage, so a reload always
// lands on the expanded sidebar.
//
// Every row is the app's own link component, which sets aria-current on the active one.
// The row styles that attribute, so there is no second source of truth for "which screen
// am I on".
//
// With the `command` module mounted, the sidebar also shows the keys (useShortcutHints):
// a row's tooltip names its shortcut, and while a sequence waits for its next key (the
// person pressed `G` and paused), each row it can reach shows that key in place of its
// count. A command the sequence reaches that has no row, such as "Go to New order", is
// listed in a panel beside the footer, and the account menu opens the shortcut sheet.
// The next keys and the panel show at desktop only; the menu item shows everywhere.

/** The active-row look, keyed off the aria-current the app's link sets. */
const ACTIVE_ROW =
  "aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground aria-[current=page]:font-medium";

/** Keycaps drawn side by side, one group per step: `G` `R`. */
function StepKeys({
  steps,
  className,
  capClassName,
}: {
  steps: readonly (readonly string[])[];
  className?: string;
  capClassName?: string;
}) {
  return (
    <KbdGroup className={className}>
      {steps.map((caps, step) => (
        <Fragment key={`${String(step)}:${caps.join("+")}`}>
          {caps.map((cap) => (
            <Kbd key={cap} className={capClassName}>
              {cap}
            </Kbd>
          ))}
        </Fragment>
      ))}
    </KbdGroup>
  );
}

/** The look of the next key while a sequence waits for it. */
const NEXT_KEY = "bg-primary text-primary-foreground";

/** The `counts` default: no live counts, so every row keeps its static one. */
const NO_COUNTS: LiveCounts = {};

export function ShellSidebar({
  areas,
  link: NavLink,
  account,
  signOut: { pending, error, signOut },
  organizationPicker,
  counts = NO_COUNTS,
  subtitle = "Admin",
}: {
  areas: readonly ShellNavArea[];
  link: ShellLink;
  account: ShellAccount;
  signOut: ShellSignOut;
  /** The #141 organization picker. Until a module fills it the slot renders empty. */
  organizationPicker?: ReactNode;
  /**
   * Live counts keyed by a row's `to`. A known one replaces the row's static `count`, and
   * a live 0 hides the badge; see `withLiveCounts`.
   */
  counts?: LiveCounts;
  /** The line under the product name. Defaults to "Admin"; `null` hides it. */
  subtitle?: string | null;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const hints = useShortcutHints();

  const { rows: nextKeys, offSidebar } = sidebarHints(
    areas.flatMap((area) =>
      area.groups.flatMap((group) => group.items.map((item) => item.shortcut))
    ),
    // Below `md` the sidebar is a sheet, and the panel beside its footer would sit
    // outside the sheet's edge, so the sequence hints show at desktop only.
    isMobile ? [] : (hints?.pending ?? [])
  );

  // Below `md` the sidebar is a sheet over the page, so following a link closes it.
  function handleNavigate() {
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <div className="flex h-10 items-center gap-2.5 px-1.5 group-data-[collapsible=icon]:px-0.5">
          <BrandMark />
          <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold">{siteName}</span>
            {subtitle === null ? null : (
              <span className="text-muted-foreground truncate text-xs">
                {subtitle}
              </span>
            )}
          </div>
        </div>

        {/* #141 renders its picker here. The slot carries no chrome of its own, so an
            empty one takes no space. */}
        <div
          data-slot="organization-picker"
          className="group-data-[collapsible=icon]:hidden empty:hidden"
        >
          {organizationPicker}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {withLiveCounts(areas, counts).flatMap((area) =>
          area.groups.map((group) => (
            <SidebarGroup key={`${area.to}:${group.label}`}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const shortcut =
                      hints === null || item.shortcut === undefined
                        ? undefined
                        : hints.keycaps(item.shortcut);
                    const next =
                      item.shortcut === undefined
                        ? undefined
                        : nextKeys.get(item.shortcut);

                    return (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton
                          // With a shortcut the tooltip shows in the open sidebar too,
                          // because the key is the part the row does not already show.
                          tooltip={
                            shortcut === undefined
                              ? item.label
                              : {
                                  hidden: isMobile,
                                  children: (
                                    <span className="flex items-center gap-2">
                                      {item.label}
                                      <StepKeys steps={shortcut} />
                                    </span>
                                  ),
                                }
                          }
                          className={ACTIVE_ROW}
                          render={
                            <NavLink
                              to={item.to}
                              exact={item.to === "/"}
                              onClick={handleNavigate}
                            />
                          }
                        >
                          <Icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                        {next === undefined ? (
                          item.count === undefined ? null : (
                            <SidebarMenuBadge>{item.count}</SidebarMenuBadge>
                          )
                        ) : (
                          <StepKeys
                            steps={next.rest}
                            capClassName={NEXT_KEY}
                            className="pointer-events-none absolute top-1.5 right-1 group-data-[collapsible=icon]:-top-1 group-data-[collapsible=icon]:-right-1 group-data-[collapsible=icon]:scale-75"
                          />
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))
        )}
      </SidebarContent>

      <SidebarFooter className="relative">
        {/* The keys the sequence in progress reaches that no row shows. They float beside
            the footer, over the page, so the panel hides no row and fits the icon strip
            too. The footer never scrolls, so the panel is always in view. */}
        {offSidebar.length === 0 ? null : (
          <div
            data-slot="sequence-hints"
            className="bg-popover text-popover-foreground border-border pointer-events-none absolute bottom-2 left-full z-50 ms-3 flex w-max flex-col gap-1.5 rounded-lg border p-3 shadow-lg"
          >
            <span className="text-muted-foreground text-xs font-medium">
              Also
            </span>
            <ul className="flex flex-col gap-1.5 text-sm">
              {offSidebar.map((entry) => (
                <li key={entry.shortcut} className="flex items-center gap-2">
                  <StepKeys steps={entry.rest} capClassName={NEXT_KEY} />
                  <span>{entry.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <Menu>
              <MenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    aria-label="Account menu"
                    className="group-data-[collapsible=icon]:p-0!"
                  />
                }
              >
                <Avatar className="size-8">
                  <AvatarFallback>{account.initials}</AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-sm font-medium">
                    {account.name}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {account.email}
                  </span>
                </span>
                <ChevronsUpDownIcon className="text-muted-foreground ms-auto size-4" />
              </MenuTrigger>

              <MenuPopup
                side={isMobile ? "top" : "right"}
                align="end"
                sideOffset={8}
                className="min-w-56"
              >
                <MenuGroup>
                  <MenuGroupLabel>
                    <span className="text-foreground block truncate text-sm font-medium">
                      {account.name}
                    </span>
                    <span className="block truncate">{account.email}</span>
                  </MenuGroupLabel>
                </MenuGroup>

                <MenuSeparator />

                <ThemeMenuItem />

                {hints === null ? null : (
                  <MenuItem
                    onClick={() => {
                      hints.openShortcuts();
                    }}
                  >
                    <KeyboardIcon />
                    Keyboard shortcuts
                    <MenuShortcut>
                      {hints.sheetKeycaps.flat().join("")}
                    </MenuShortcut>
                  </MenuItem>
                )}

                <MenuSeparator />

                {/* `closeOnClick={false}` keeps the menu open while the sign-out request
                    runs, so a failure has somewhere to show. A success navigates to the
                    app's sign-in route, which unmounts the shell and this menu with it. */}
                <MenuItem
                  closeOnClick={false}
                  disabled={pending}
                  variant="destructive"
                  onClick={signOut}
                >
                  <LogOutIcon />
                  {pending ? "Signing out…" : "Sign out"}
                </MenuItem>

                {error === null ? null : (
                  <p
                    role="alert"
                    className="text-destructive-foreground px-2 py-1 text-xs"
                  >
                    {error}
                  </p>
                )}
              </MenuPopup>
            </Menu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
