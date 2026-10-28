import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@web/lib/utils";

// The button scale from apps/web/DESIGN.md: square corners, a 2.5rem height, the
// `label-md` type (text-sm, medium). `default` is the solid cobalt button with a white
// label in both themes; `outline` is the outlined secondary button, drawn in `highlight`;
// `ghost` carries the icon controls in the navbar. Colours are semantic tokens only.
//
// Every state keeps its label at 4.5:1 or more in both themes. The default hover darkens
// toward `foreground` in light (6.2:1 with white) rather than fading the fill, because
// `bg-primary/85` lets the pale page through and drops to 4.1:1. In dark the page under
// the fade is navy, so the fade darkens it too (6.5:1). There is no destructive variant:
// nothing used it, and red text on a red tint read 3.7:1.
const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 press inline-flex shrink-0 items-center justify-center rounded-none border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default:
          "h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-10",
        "icon-lg": "size-10",
        "icon-sm": "size-8",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        sm: "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-7 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
      },
      variant: {
        default:
          "bg-primary text-primary-foreground dark:hover:bg-primary/85 hover:bg-[color-mix(in_oklab,var(--color-primary)_85%,var(--color-foreground))]",
        ghost: "text-highlight hover:bg-muted aria-expanded:bg-muted",
        link: "text-highlight underline-offset-4 hover:underline",
        outline:
          "border-highlight bg-card text-highlight hover:bg-muted aria-expanded:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground aria-expanded:bg-secondary aria-expanded:text-secondary-foreground hover:bg-muted",
      },
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ className, size, variant }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
