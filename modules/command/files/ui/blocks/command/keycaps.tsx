import type * as React from "react";
import { Fragment } from "react";
import { Kbd, KbdGroup } from "@repo/ui/components/shell/kbd";

// A shortcut drawn as shell keycaps: one `Kbd` per key, one group per step. Inside the
// palette and the shortcut sheet the popup gives each cap its 1px `input` hairline.

/**
 * Draw `steps`, the output of `formatKeycaps`. With `then`, a sequence reads `G then U`,
 * with "then" in the caption size; without it, the steps sit side by side.
 */
export function Keycaps({
  steps,
  then = false,
  className,
}: {
  steps: readonly (readonly string[])[];
  then?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <KbdGroup className={className}>
      {steps.map((caps, step) => (
        <Fragment key={`${String(step)}:${caps.join("+")}`}>
          {then && step > 0 ? (
            <span className="text-muted-foreground text-xs">then</span>
          ) : null}
          {caps.map((cap) => (
            <Kbd key={cap}>{cap}</Kbd>
          ))}
        </Fragment>
      ))}
    </KbdGroup>
  );
}
