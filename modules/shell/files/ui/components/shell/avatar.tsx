import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type React from "react";
import { cn } from "@repo/ui/lib/utils";

export function Avatar({
  className,
  ...props
}: AvatarPrimitive.Root.Props): React.ReactElement {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "bg-background relative isolate inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full align-middle text-xs font-medium select-none",
        className
      )}
      data-slot="avatar"
      {...props}
    />
  );
}

export function AvatarImage({
  className,
  ...props
}: AvatarPrimitive.Image.Props): React.ReactElement {
  return (
    <AvatarPrimitive.Image
      className={cn(
        "absolute inset-0 z-10 size-full object-cover data-error:invisible data-loading:invisible",
        className
      )}
      data-slot="avatar-image"
      {...props}
    />
  );
}

export function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props): React.ReactElement {
  return (
    // The inset hairline keeps the circle visible where --muted matches the canvas, as it
    // does on the app canvas. Inset, because the root clips anything outside it.
    <AvatarPrimitive.Fallback
      className={cn(
        "bg-muted ring-border absolute inset-0 flex size-full items-center justify-center rounded-full ring-1 ring-inset",
        className
      )}
      data-slot="avatar-fallback"
      {...props}
    />
  );
}

export { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
