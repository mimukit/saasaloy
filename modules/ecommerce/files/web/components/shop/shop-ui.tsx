import { AlertTriangleIcon, MinusIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { OrderStatus } from "@repo/ecommerce";
import type { ShopImage } from "@repo/ecommerce/client";
import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";
import { STATUS_LABEL } from "@web/lib/shop";

// Small pieces the shop islands share. Tokens only, from apps/web/DESIGN.md: the warning
// pair is the one tint, every other status reads in the neutral pairs.

const STATUS_TONE: Readonly<Record<OrderStatus, string>> = {
  cancelled: "border-border text-muted-foreground",
  confirmed: "bg-secondary text-secondary-foreground",
  delivered: "bg-primary text-primary-foreground",
  placed: "bg-warning/15 text-warning-foreground",
  returned: "border-border text-muted-foreground",
  shipped: "bg-secondary text-secondary-foreground",
};

export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-4xl border border-transparent px-2.5 text-xs font-medium whitespace-nowrap",
        STATUS_TONE[status]
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A product image, or a muted square in its place when the product has none. */
export function Thumb({
  image,
  className,
}: {
  image: ShopImage | null | undefined;
  className?: string;
}) {
  if (!image?.url) {
    return (
      <div
        aria-hidden="true"
        className={cn("bg-muted shrink-0 rounded-lg border", className)}
      />
    );
  }
  return (
    <img
      src={image.url}
      alt={image.alt}
      loading="lazy"
      className={cn(
        "bg-muted shrink-0 rounded-lg border object-cover",
        className
      )}
    />
  );
}

/** A minus, the number, a plus. The buttons stop at `min` and `max`. */
export function QuantityStepper({
  value,
  min = 1,
  max,
  label,
  disabled = false,
  onChange,
}: {
  value: number;
  min?: number;
  max: number;
  label: string;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="border-border inline-flex h-10 items-center rounded-lg border"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-10 rounded-r-none"
        aria-label="One fewer"
        disabled={disabled || value <= min}
        onClick={() => {
          onChange(value - 1);
        }}
      >
        <MinusIcon />
      </Button>
      <output
        aria-live="polite"
        className="w-8 text-center text-sm tabular-nums"
      >
        {value}
      </output>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-10 rounded-l-none"
        aria-label="One more"
        disabled={disabled || value >= max}
        onClick={() => {
          onChange(value + 1);
        }}
      >
        <PlusIcon />
      </Button>
    </div>
  );
}

/** A line that needs the buyer's attention, in the warning tone. */
export function WarningLine({ children }: { children: ReactNode }) {
  return (
    <p className="text-warning-foreground flex items-start gap-2 text-sm">
      <AlertTriangleIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0"
      />
      <span>{children}</span>
    </p>
  );
}

/** A request's refusal, read out to screen readers. */
export function ErrorLine({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}

/** A label above a field. */
export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
      {children}
    </label>
  );
}
