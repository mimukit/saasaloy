import { InboxIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/admin/empty";
import { cn } from "@repo/ui/lib/utils";

// What a list shows when it has no rows: an icon tile, one line that says what is
// missing, one line that says how to change that, and at most one way forward.
//
// It is the filler for DataTable's `emptyState` slot, and the body of any panel that has
// nothing to show yet. The words are the caller's, because only the route knows whether
// the list is empty or merely filtered down to nothing, and those two need different
// sentences.

export function EmptyState({
  title,
  description,
  icon: Icon = InboxIcon,
  action,
  className,
}: {
  /** What is missing, such as "No users match this filter". */
  title: string;
  /** How the visitor changes that. */
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  /** One button or link, such as "Show all users". */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("py-10 md:py-14", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description === undefined ? null : (
          <EmptyDescription>{description}</EmptyDescription>
        )}
      </EmptyHeader>
      {action === undefined ? null : <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
