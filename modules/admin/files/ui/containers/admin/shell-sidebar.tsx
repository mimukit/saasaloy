import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import type { ReactNode } from "react";

import { siteName } from "@repo/ui";
import { BrandMark } from "@repo/ui/blocks/admin/brand-mark";
import { ThemeMenuItem } from "@repo/ui/blocks/admin/theme-toggle";
import { Avatar, AvatarFallback } from "@repo/ui/components/admin/avatar";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@repo/ui/components/admin/menu";
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
} from "@repo/ui/components/admin/sidebar";
import type {
  ShellAccount,
  ShellLink,
  ShellNavArea,
  ShellSignOut,
} from "@repo/ui/containers/admin/shell-nav";
import { withLiveCounts } from "@repo/ui/lib/admin/nav-counts";
import type { LiveCounts } from "@repo/ui/lib/admin/nav-counts";

// The admin sidebar: the brand row, the organization picker's slot, every area's nav
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

/** The active-row look, keyed off the aria-current the app's link sets. */
const ACTIVE_ROW =
  "aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground aria-[current=page]:font-medium";

/** The `counts` default: no live counts, so every row keeps its static one. */
const NO_COUNTS: LiveCounts = {};

export function ShellSidebar({
  areas,
  link: NavLink,
  account,
  signOut: { pending, error, signOut },
  organizationPicker,
  counts = NO_COUNTS,
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
}) {
  const { isMobile, setOpenMobile } = useSidebar();

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
            <span className="text-muted-foreground truncate text-xs">
              Admin
            </span>
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

                    return (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton
                          tooltip={item.label}
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
                        {item.count === undefined ? null : (
                          <SidebarMenuBadge>{item.count}</SidebarMenuBadge>
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

      <SidebarFooter>
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

                <MenuSeparator />

                {/* `closeOnClick={false}` keeps the menu open while the sign-out request
                    runs, so a failure has somewhere to show. A success navigates to
                    /login, which unmounts the shell and this menu with it. */}
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
