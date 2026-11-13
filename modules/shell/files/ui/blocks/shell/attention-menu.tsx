import { BellIcon, ChevronRightIcon } from "lucide-react";
import type * as React from "react";

import { Badge } from "@repo/ui/components/shell/badge";
import { Button } from "@repo/ui/components/shell/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuLinkItem,
  MenuPopup,
  MenuTrigger,
} from "@repo/ui/components/shell/menu";
import type { ShellLink } from "@repo/ui/containers/shell/shell-nav";
import type { AttentionRow } from "@repo/ui/lib/shell/attention";

// The "Needs attention" bell in the shell header. A badge
// shows how many things wait across the queues, and the menu lists each queue with work
// in it as a link. It takes the rows and the words; the app fetches the counts.

export function AttentionMenu({
  rows,
  total,
  link: Link,
  title,
  emptyText,
}: {
  /** The queues with work, from `attentionRows`. */
  rows: readonly AttentionRow[];
  total: number;
  link: ShellLink;
  /** The menu heading and the button's name, for example "Needs attention". */
  title: string;
  /** What the menu says when nothing waits. */
  emptyText: string;
}): React.ReactElement {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative size-8"
            aria-label={total === 0 ? title : `${title}: ${String(total)}`}
          />
        }
      >
        <BellIcon aria-hidden="true" />
        {total === 0 ? null : (
          <Badge
            variant="destructive"
            size="sm"
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 tabular-nums"
          >
            {total > 99 ? "99+" : total}
          </Badge>
        )}
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-64">
        <MenuGroup>
          <MenuGroupLabel>{title}</MenuGroupLabel>
          {rows.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-sm">
              {emptyText}
            </p>
          ) : (
            rows.map((row) => (
              <MenuLinkItem
                key={row.to}
                render={<Link to={row.to} exact={false} />}
              >
                <span className="flex-1">{row.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {row.count}
                </span>
                <ChevronRightIcon aria-hidden="true" />
              </MenuLinkItem>
            ))
          )}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
