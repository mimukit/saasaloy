import { siteName } from "@repo/ui";
import brandMarkDarkUrl from "@repo/ui/assets/shell/brand-mark-dark.svg";
import brandMarkLightUrl from "@repo/ui/assets/shell/brand-mark-light.svg";
import { cn } from "@repo/ui/lib/utils";

// The shell's brand mark: the sidebar's top row, the collapsed icon strip, the mobile
// header and the sign-in card all render this one block.
//
// The mark is a pair of files, not one: assets/shell/brand-mark-light.svg shows on the
// light theme and assets/shell/brand-mark-dark.svg on the dark one. Both render as an
// <img>, and the `dark:` classes pick one, so a full-colour logo works as well as a
// one-colour one.
//
// `variant="icon"` (the default) is the square mark alone, and its `alt` is the product
// name. `variant="full"` adds `config.app.name` as text beside the mark, so the image takes
// an empty `alt` and the name is read once. `decorative` empties the `alt` of the icon too,
// for a caller that already shows the name as text beside the mark (the sidebar, the
// sign-in card), so a screen reader does not read the name twice.
//
// To use your own mark, replace the two SVG files and keep their names. Keep them square:
// the icon box is `size-7`. For a real wordmark (a logo that already holds the name),
// add the pair as `brand-wordmark-light.svg` and `brand-wordmark-dark.svg`, register both
// in the shell descriptor's `files[]` if you want `saasaloy update` to track them, and
// render them in the `full` branch in place of the icon and the text, with `alt={siteName}`.

export function BrandMark({
  variant = "icon",
  decorative = false,
  className,
}: {
  /** `icon`: the square mark alone. `full`: the mark plus the product name as text. */
  variant?: "icon" | "full";
  /** The caller shows the name as text beside the mark, so the image takes an empty `alt`. */
  decorative?: boolean;
  className?: string;
}) {
  const alt = variant === "icon" && !decorative ? siteName : "";
  const icon = (
    <span className="inline-flex size-7 shrink-0">
      <img
        src={brandMarkLightUrl}
        alt={alt}
        width={32}
        height={32}
        className="size-full dark:hidden"
      />
      <img
        src={brandMarkDarkUrl}
        alt={alt}
        width={32}
        height={32}
        className="hidden size-full dark:block"
      />
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
