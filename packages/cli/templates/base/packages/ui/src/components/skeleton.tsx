import type { ComponentProps } from "react";

import { cn } from "@repo/ui/lib/utils";

function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-muted rounded-md motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton };
