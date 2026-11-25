// The tab strip that the landing command field and the docs `saasaloy-command` block share,
// so the two never drift apart. Option B of mockup round 2 of plan 0125, approved
// 2026-11-25.

export const STRIP =
  "bg-muted border-border flex items-center justify-between gap-2 border-b p-1";

// A coarse pointer gets a 44px target, so a finger can hit the small controls.
const CONTROL =
  "focus-visible:outline-ring motion-safe:ease-out-soft inline-flex h-7 cursor-pointer items-center border font-mono text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 motion-safe:transition-colors motion-safe:duration-150 pointer-coarse:h-11";

export const TAB = `${CONTROL} px-3`;

export const TAB_ACTIVE = "bg-card border-border text-highlight";

export const TAB_INACTIVE =
  "text-muted-foreground hover:text-foreground border-transparent";

// The minimum width fits "Copied", so the label swap never moves the strip.
export const COPY_BUTTON = `${CONTROL} text-highlight min-w-22 shrink-0 justify-center gap-1.5 border-transparent px-2 underline-offset-4 hover:underline`;

export const COPY_ICON = "size-3.5";
