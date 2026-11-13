import { CircleAlertIcon, LockIcon } from "lucide-react";
import type * as React from "react";
import { useId } from "react";

import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { Button } from "@repo/ui/components/shell/button";
import { Skeleton } from "@repo/ui/components/shell/skeleton";
import { Switch } from "@repo/ui/components/shell/switch";

// The Preferences tab of the notifications page: one switch per category.
//
// A required category shows a switch that is on and disabled, with the reason under it,
// because the api refuses to turn it off. The note at the foot says what an opt-out does:
// it stops new rows only, so the inbox keeps what it already holds.
//
// It is presentational. The page owns the preferences query and the save mutation.

/** One category as the api answers it. */
export interface NotificationCategoryPreference {
  id: string;
  label: string;
  description: string;
  required: boolean;
  enabled: boolean;
}

const DEFAULT_COPY = {
  required: "Required. These cannot be turned off.",
  note: "Turning a category off stops new notifications in it. Ones you already have stay in your inbox.",
  errorTitle: "Could not load your preferences",
  errorDescription: "Check your connection and try again.",
  retry: "Try again",
};

export type NotificationPreferencesCopy = typeof DEFAULT_COPY;

export type NotificationPreferencesState = "loading" | "error" | "ready";

function PreferenceRow({
  category,
  saving,
  onChange,
  requiredNote,
}: {
  category: NotificationCategoryPreference;
  saving: boolean;
  onChange: (id: string, enabled: boolean) => void;
  requiredNote: string;
}) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <li className="border-border flex items-start justify-between gap-6 border-b py-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={labelId} className="text-sm font-semibold">
          {category.label}
        </span>
        <span id={descriptionId} className="text-muted-foreground text-sm">
          {category.description}
        </span>
        {category.required ? (
          <span className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
            <LockIcon aria-hidden className="size-3" />
            {requiredNote}
          </span>
        ) : null}
      </div>
      <Switch
        className="mt-0.5"
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        // A required category is always on, whatever the api echoes back.
        checked={category.required || category.enabled}
        disabled={category.required || saving}
        onCheckedChange={(checked) => {
          onChange(category.id, checked);
        }}
      />
    </li>
  );
}

export function NotificationPreferences({
  categories,
  state,
  saving = false,
  onChange,
  onRetry,
  copy: copyOverrides,
}: {
  categories: readonly NotificationCategoryPreference[];
  state: NotificationPreferencesState;
  /** True while a change is saving. The switches hold still until it lands. */
  saving?: boolean;
  /** A switch moved. The page saves `{ [id]: enabled }`. */
  onChange: (id: string, enabled: boolean) => void;
  onRetry: () => void;
  copy?: Partial<NotificationPreferencesCopy>;
}): React.ReactElement {
  const copy = { ...DEFAULT_COPY, ...copyOverrides };

  if (state === "error") {
    return (
      <EmptyState
        icon={CircleAlertIcon}
        title={copy.errorTitle}
        description={copy.errorDescription}
        action={
          <Button variant="outline" onClick={onRetry}>
            {copy.retry}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex max-w-160 flex-col px-(--page-gutter) pt-2 pb-6">
      {state === "loading" ? (
        <div aria-busy className="flex flex-col">
          {[0, 1].map((index) => (
            <div
              key={index}
              className="border-border flex flex-col gap-2 border-b py-4"
            >
              <Skeleton className="h-3.5 w-1/4" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col">
          {categories.map((category) => (
            <PreferenceRow
              key={category.id}
              category={category}
              saving={saving}
              onChange={onChange}
              requiredNote={copy.required}
            />
          ))}
        </ul>
      )}
      <p className="text-muted-foreground pt-3.5 text-xs">{copy.note}</p>
    </div>
  );
}
