import { useState } from "react";
import type { FormEvent } from "react";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { cn } from "@repo/ui/lib/utils";

// The Flags screen's markup, and nothing else.
//
// **This block knows nothing about the network.** It takes the rows and four callbacks and
// calls them. Where a toggle goes, which client sends it, and what a failure means are the
// app's business, so `packages/ui` imports no api package and no http client — the same rule
// the waitlist block follows. `apps/admin/src/routes/flags.tsx` supplies the functions.
//
// It also knows nothing about the cache. Everything it renders came from the database, which
// is what stops the screen showing an operator their own write stale: the published document
// is up to ~70 seconds behind on purpose, and that is the wrong number to put next to a
// switch somebody just moved.
//
// The maintenance flag is pulled out of the list into its own panel. It is the one flag whose
// effect is the whole site, and burying it in a list sorted by key would put it between two
// ordinary rollouts.

export interface FlagRow {
  key: string;
  type: "boolean" | "percentage";
  description: string | null;
  /** The value that applies now. Falls back to the code default when no row exists. */
  enabled: boolean;
  /** 0–100 on a percentage flag, `null` otherwise. */
  percentage: number | null;
  /** What the code declares. Shown when nothing has been set, so "unset" is legible. */
  codeDefault: boolean;
  /** False until somebody has saved a value. */
  hasRow: boolean;
}

export interface FlagOverrideRow {
  flagKey: string;
  tenantId: string;
  enabled: boolean;
  percentage: number | null;
}

export interface FeatureFlagsProps {
  flags: FlagRow[];
  overrides: FlagOverrideRow[];
  /** Save the global value for a flag. */
  onSave: (
    key: string,
    value: { enabled: boolean; percentage: number | null }
  ) => void;
  /** Save one tenant's override. */
  onSaveOverride: (
    key: string,
    tenantId: string,
    value: { enabled: boolean; percentage: number | null }
  ) => void;
  /** Delete one tenant's override, so the tenant inherits the global value again. */
  onClearOverride: (key: string, tenantId: string) => void;
  /** Set while a save is in flight, so the controls can refuse a second click. */
  busy?: boolean;
  /** Shown above the list when the last action failed. */
  error?: string | null;
  /** The reserved key the maintenance panel is built from. */
  maintenanceKey?: string;
}

export function FeatureFlags({
  flags,
  overrides,
  onSave,
  onSaveOverride,
  onClearOverride,
  busy = false,
  error = null,
  maintenanceKey = "system.maintenance",
}: FeatureFlagsProps) {
  const maintenance = flags.find((flag) => flag.key === maintenanceKey);
  const rest = flags.filter((flag) => flag.key !== maintenanceKey);

  return (
    <div className="grid gap-6">
      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      {maintenance ? (
        <Card
          className={cn(
            maintenance.enabled && "border-destructive/60 bg-destructive/5"
          )}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Maintenance mode
              {maintenance.enabled ? (
                <Badge variant="destructive">Site closed</Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              While this is on, every request outside the bypass paths gets a
              503 page. Admins still get through. It takes about a minute to
              reach every location.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant={maintenance.enabled ? "destructive" : "outline"}
              className="min-h-11"
              disabled={busy}
              aria-pressed={maintenance.enabled}
              onClick={() =>
                onSave(maintenance.key, {
                  enabled: !maintenance.enabled,
                  percentage: null,
                })
              }
            >
              {maintenance.enabled ? "Reopen the site" : "Close the site"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Flags</CardTitle>
          <CardDescription>
            A value change takes effect without a deploy. A new key does not —
            add it to the flags array in packages/feature-flags and ship.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {rest.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No flags are registered yet.
            </p>
          ) : (
            rest.map((flag) => (
              <FlagCard
                key={flag.key}
                flag={flag}
                overrides={overrides.filter(
                  (override) => override.flagKey === flag.key
                )}
                busy={busy}
                onSave={onSave}
                onSaveOverride={onSaveOverride}
                onClearOverride={onClearOverride}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FlagCard({
  flag,
  overrides,
  busy,
  onSave,
  onSaveOverride,
  onClearOverride,
}: {
  flag: FlagRow;
  overrides: FlagOverrideRow[];
  busy: boolean;
  onSave: FeatureFlagsProps["onSave"];
  onSaveOverride: FeatureFlagsProps["onSaveOverride"];
  onClearOverride: FeatureFlagsProps["onClearOverride"];
}) {
  // Local, so dragging the slider does not fire a request per pixel. The Save button is what
  // commits. `base` records the server value the draft was taken from, so a refreshed row
  // replaces the draft instead of leaving a stale number on the slider.
  const serverPercentage = flag.percentage ?? 0;
  const [draft, setDraft] = useState({
    base: serverPercentage,
    value: serverPercentage,
  });
  const [tenantId, setTenantId] = useState("");

  if (draft.base !== serverPercentage) {
    setDraft({ base: serverPercentage, value: serverPercentage });
  }

  const percentage = draft.value;
  const setPercentage = (value: number) => {
    setDraft({ base: serverPercentage, value });
  };

  const isPercentage = flag.type === "percentage";
  const dirty = isPercentage && percentage !== serverPercentage;

  function addOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tenantId.trim() === "") {
      return;
    }
    onSaveOverride(flag.key, tenantId.trim(), {
      enabled: true,
      percentage: isPercentage ? percentage : null,
    });
    setTenantId("");
  }

  return (
    <div className="border-border grid gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-sm font-medium">{flag.key}</code>
            <Badge variant="secondary">{flag.type}</Badge>
            {flag.hasRow ? null : <Badge variant="outline">code default</Badge>}
          </div>
          {flag.description ? (
            <p className="text-muted-foreground mt-1 text-sm">
              {flag.description}
            </p>
          ) : null}
        </div>

        <Button
          variant={flag.enabled ? "default" : "outline"}
          size="sm"
          className="min-h-11 md:min-h-8"
          disabled={busy}
          aria-pressed={flag.enabled}
          onClick={() =>
            onSave(flag.key, {
              enabled: !flag.enabled,
              // The server's value, not the draft: On/Off must not commit an
              // uncommitted slider drag.
              percentage: isPercentage ? serverPercentage : null,
            })
          }
        >
          {flag.enabled ? "On" : "Off"}
        </Button>
      </div>

      {isPercentage ? (
        <div className="flex items-center gap-3">
          <Label
            htmlFor={`${flag.key}-percentage`}
            className="text-muted-foreground shrink-0 text-xs"
          >
            Rollout
          </Label>
          <input
            id={`${flag.key}-percentage`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={percentage}
            disabled={busy}
            onChange={(event) => setPercentage(Number(event.target.value))}
            className="accent-primary h-11 min-w-0 flex-1 md:h-8"
          />
          <span className="w-12 shrink-0 text-right text-sm tabular-nums">
            {percentage}%
          </span>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 md:min-h-8"
            disabled={busy || !dirty}
            onClick={() =>
              onSave(flag.key, { enabled: flag.enabled, percentage })
            }
          >
            Save
          </Button>
        </div>
      ) : null}

      {overrides.length > 0 ? (
        <ul className="grid gap-1">
          {overrides.map((override) => (
            <li
              key={override.tenantId}
              className="bg-muted/40 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm"
            >
              <span className="truncate">
                <code className="text-xs">{override.tenantId}</code>
                <span className="text-muted-foreground ml-2">
                  {override.enabled ? "on" : "off"}
                  {override.percentage === null
                    ? ""
                    : ` · ${String(override.percentage)}%`}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 md:min-h-8"
                disabled={busy}
                onClick={() => onClearOverride(flag.key, override.tenantId)}
              >
                Clear
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={addOverride} className="flex items-center gap-2">
        <Input
          value={tenantId}
          disabled={busy}
          onChange={(event) => setTenantId(event.target.value)}
          placeholder="Tenant id"
          aria-label={`Tenant id to override ${flag.key} for`}
          className="h-11 md:h-8"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="min-h-11 shrink-0 md:min-h-8"
          disabled={busy}
        >
          Override on
        </Button>
      </form>
    </div>
  );
}
