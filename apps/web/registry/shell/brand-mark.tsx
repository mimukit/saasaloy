import { siteName } from "@repo/ui";
import { cn } from "@repo/ui/lib/utils";

// The public stand-in for the shell's brand mark (modules/shell/files/ui/blocks/shell/
// brand-mark.tsx). The shell's mark is a pair of SVG files imported as URLs, and an SVG
// import gives a URL in Vite but an image object in Next.js, so the asset pair does not
// travel through `shadcn add`. This file keeps the same props and draws the first letter
// of the product name on the primary colour instead. Replace it with your own logo.
//
// Only Saasaloy UI ships it: the auth card imports it as `@/components/blocks/shell/
// brand-mark`, and the preview frame on saasaloy.com/ui renders it in place of the shell's
// mark, so the preview shows what an install gives.

export function BrandMark({
  variant = "icon",
  decorative = false,
  className,
}: {
  /** `icon`: the square mark alone. `full`: the mark plus the product name as text. */
  variant?: "icon" | "full";
  /** The caller shows the name as text beside the mark, so the mark is hidden from a screen reader. */
  decorative?: boolean;
  className?: string;
}) {
  const label = variant === "icon" && !decorative ? siteName : undefined;
  const icon = (
    <span
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className="bg-primary text-primary-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold"
    >
      {siteName.slice(0, 1).toUpperCase()}
    </span>
  );
  if (variant === "icon") {
    return (
      <span className={cn("inline-flex shrink-0", className)}>{icon}</span>
    );
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-2", className)}>
      {icon}
      <span className="text-foreground text-base font-semibold tracking-tight">
        {siteName}
      </span>
    </span>
  );
}
