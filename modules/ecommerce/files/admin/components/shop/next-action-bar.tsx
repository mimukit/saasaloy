import {
  CircleCheckIcon,
  CircleDotIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@repo/ui/components/shell/button";
import { cn } from "@repo/ui/lib/utils";

import type { NextAction, OrderAction } from "@admin/lib/shop-format";

// The order page's next-action bar: the one thing the order waits on, why, and the button
// that does it, under the page header. Every status action on the page lives here, so a
// staff member reads the order's state and its next step in one place, and the rest of the
// page is the record. `nextAction` in shop-format.ts decides what it says.
//
// The tone follows the status pair rules in DESIGN.md: `warn` while money or a call is
// owed, `ok` once the order is done, neutral otherwise. Only the left rule and the icon
// take the colour, so the bar stays calm beside the panels.

const TONE = {
  neutral: {
    icon: CircleDotIcon,
    rule: "before:bg-border",
    text: "text-muted-foreground",
  },
  ok: {
    icon: CircleCheckIcon,
    rule: "before:bg-status-ok",
    text: "text-status-ok-foreground",
  },
  warn: {
    icon: TriangleAlertIcon,
    rule: "before:bg-status-warn",
    text: "text-status-warn-foreground",
  },
} as const;

export function NextActionBar({
  next,
  pending,
  onAction,
}: {
  next: NextAction;
  /** The action in flight, so its button shows it and every button waits. */
  pending: OrderAction | null;
  onAction: (action: OrderAction) => void;
}) {
  const tone = TONE[next.tone];
  const Icon = tone.icon;
  return (
    <section
      aria-label="Next step"
      className={cn(
        "bg-card border-border relative flex flex-col gap-3 overflow-hidden rounded-xl border py-3 pr-3 pl-5 sm:flex-row sm:items-center",
        "before:absolute before:inset-y-0 before:left-0 before:w-1",
        tone.rule
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Icon
          aria-hidden="true"
          className={cn("mt-0.5 size-4 shrink-0", tone.text)}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{next.title}</p>
          <p className="text-muted-foreground text-sm">{next.detail}</p>
        </div>
      </div>
      {next.primary === null && next.secondary.length === 0 ? null : (
        <div className="flex shrink-0 flex-wrap gap-2">
          {next.secondary.map((step) => (
            <Button
              key={step.action}
              size="sm"
              variant={
                step.action === "cancel" || step.action === "return"
                  ? "destructive-outline"
                  : "outline"
              }
              disabled={pending !== null}
              onClick={() => {
                onAction(step.action);
              }}
            >
              {step.label}
            </Button>
          ))}
          {next.primary === null ? null : (
            <Button
              size="sm"
              disabled={pending !== null}
              onClick={() => {
                if (next.primary) {
                  onAction(next.primary.action);
                }
              }}
            >
              {pending === next.primary.action
                ? "Working…"
                : next.primary.label}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
