import brandMarkUrl from "@repo/ui/assets/shell/brand-mark.svg";
import { cn } from "@repo/ui/lib/utils";

// The shell's brand mark: the sidebar's top row, the collapsed icon strip, the mobile
// header and the sign-in card all render this one block.
//
// The SVG is used as a CSS mask, not as an <img>. Its shape decides where paint goes and
// the element's `bg-primary` decides the colour, so the mark follows the theme in light
// and dark with one file. Replace assets/shell/brand-mark.svg with your own single-colour mark
// and every placement updates; keep it square, because the mask is sized to fit.

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-primary inline-block size-7 shrink-0 mask-contain mask-center mask-no-repeat",
        className
      )}
      style={{ maskImage: `url("${brandMarkUrl}")` }}
    />
  );
}
