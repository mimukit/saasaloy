import type { ComponentType, ReactNode } from "react";

// Your project owns this file. `saasaloy add admin` wrote it once, and `saasaloy update`
// never changes it: it writes it again only when the file is missing, because
// src/components/app-shell.tsx imports it.
//
// Put the components that must wrap the whole signed-in admin app here: a context
// provider your screens share, an analytics or feature provider, a project-wide modal
// host. AppShell renders the shell inside each entry in order, the first entry
// outermost, so everything below it (the sidebar, the header and every page) can read
// what a wrapper provides. The wrappers sit inside the toast provider and render only
// for a signed-in admin, never on /login or the access-denied screen.
//
// A wrapper takes `children` and renders them. For example:
//
//   import { SupportChatProvider } from "@admin/components/support-chat";
//
//   export const rootWrappers: RootWrapper[] = [SupportChatProvider];
export type RootWrapper = ComponentType<{ children: ReactNode }>;

export const rootWrappers: RootWrapper[] = [];
