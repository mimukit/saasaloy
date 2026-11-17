import {
  CircleCheckIcon,
  CircleDotIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@repo/ui/components/shell/button";
import { cn } from "@repo/ui/lib/utils";

import type { NextAction } from "@admin/lib/shop-format";

// The line under the order header that says what the order waits on and why. It holds no
// status button: the header carries those, as the approved mockup lays them out. The one
// button it may show is "Record refund" while a refund is due, a payment action the
// approved Refund due banner carries. `nextAction` in shop-format.ts decides what it says.
//
// The tone follows the status pair rules in DESIGN.md: `warn` while money or a call is
// owed, `ok` once the order is done, neutral otherwise.

const TONE = {
  neutral: {
    box: "bg-card border-border",
    icon: CircleDotIcon,
    text: "text-muted-foreground",
  },
  ok: {
    box: "bg-card border-border",
    icon: CircleCheckIcon,
    text: "text-status-ok-foreground",
  },
  warn: {
    box: "bg-status-warn/8 dark:bg-status-warn/16 border-transparent",
    icon: TriangleAlertIcon,
    text: "text-status-warn-foreground",
  },
} as const;

export function NextActionBar({
  next,
  pending,
  onRecordRefund,
}: {
  next: NextAction;
  pending: boolean;
  onRecordRefund: () => void;
}) {
  const tone = TONE[next.tone];
  const Icon = tone.icon;
  const refund = next.primary?.action === "recordRefund";
  return (
    <section
      aria-label="What this order waits on"
      className={cn(
        "flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center",
        tone.box
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Icon
          aria-hidden="true"
          className={cn("mt-0.5 size-4 shrink-0", tone.text)}
        />
        <p className="min-w-0 text-sm">
          <span className="font-semibold">{next.title}.</span>{" "}
          <span className="text-muted-foreground">{next.detail}</span>
        </p>
      </div>
      {refund ? (
        <Button
          size="sm"
          className="shrink-0"
          disabled={pending}
          onClick={onRecordRefund}
        >
          Record refund
        </Button>
      ) : null}
    </section>
  );
}
