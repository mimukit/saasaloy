import { statements } from "@repo/auth/access";
import { Checkbox } from "@repo/ui/components/admin/checkbox";
import { Label } from "@repo/ui/components/admin/label";

// The resource-by-action grid, in one component used two ways: read-only for a base role,
// editable for a custom one. Both render the same rows in the same order, so a reader
// comparing `viewer` against `member` is comparing two identical layouts.
//
// It lives in narrow places — the role's detail panel, the create dialog, the bottom sheet
// below `md` — so each resource stacks its name over its actions rather than sitting in a
// two-column row that would squeeze the boxes at 320px.
//
// The columns come from `packages/auth/src/access.ts`, never from the role being shown. A
// role holding an action that is no longer declared there would otherwise render a column
// nobody else has; here it simply does not appear, which matches the server, where `can()`
// only ever asks about a declared resource.
//
// ADDING A RESOURCE is an edit to `access.ts`. This screen picks it up with no change.

/** A permission map as the plugin stores it: resource to the actions held. */
export type PermissionMap = Record<string, string[]>;

/**
 * The same map, read-only. A base role's statements come out of `access.ts` as `readonly`
 * tuples, so the display side takes this and only the editor takes `PermissionMap`. It
 * saves the one cast that would otherwise sit between the two.
 */
export type ReadonlyPermissionMap = Readonly<
  Record<string, readonly string[] | undefined>
>;

/** Every resource in `access.ts`, with its actions, in declaration order. */
const RESOURCES: readonly (readonly [string, readonly string[]])[] =
  Object.entries(statements);

function holds(
  value: ReadonlyPermissionMap,
  resource: string,
  action: string
): boolean {
  return value[resource]?.includes(action) ?? false;
}

/** How many resource:action pairs `access.ts` declares: the "of N" in the roles table. */
export const PERMISSION_COUNT: number = RESOURCES.reduce(
  (total, [, actions]) => total + actions.length,
  0
);

/**
 * How many declared pairs a role holds. It counts against `RESOURCES`, not the stored
 * map, for the same reason the grid does: an action `access.ts` no longer declares is one
 * `can()` never asks about, so the table must not count it either.
 */
export function countHeld(value: ReadonlyPermissionMap): number {
  return RESOURCES.reduce(
    (total, [resource, actions]) =>
      total + actions.filter((action) => holds(value, resource, action)).length,
    0
  );
}

/**
 * Toggle one resource:action pair, returning a new map. Never mutates: the caller keeps
 * the draft in React state, and an in-place edit would not re-render.
 *
 * A resource with no actions left is dropped rather than stored as `[]`. Better Auth reads
 * an absent resource and an empty one the same way, and dropping it keeps the JSON a
 * customer might read in the database short.
 */
export function togglePermission(
  value: PermissionMap,
  resource: string,
  action: string
): PermissionMap {
  const held = value[resource] ?? [];
  const next = held.includes(action)
    ? held.filter((candidate) => candidate !== action)
    : [...held, action];
  const draft: PermissionMap = { ...value };
  if (next.length === 0) {
    delete draft[resource];
  } else {
    draft[resource] = next;
  }
  return draft;
}

export function PermissionGrid({
  value,
  onToggle,
  disabled = false,
  idPrefix,
}: {
  value: ReadonlyPermissionMap;
  /** Omit to render read-only. A base role passes nothing. */
  onToggle?: (resource: string, action: string) => void;
  disabled?: boolean;
  /** Keeps checkbox ids unique when two grids are on screen at once. */
  idPrefix: string;
}) {
  const readOnly = !onToggle;
  return (
    <div className="border-border divide-border flex flex-col divide-y rounded-lg border">
      {RESOURCES.map(([resource, actions]) => (
        <div key={resource} className="flex flex-col gap-1.5 px-3 py-2.5">
          <p className="text-sm font-medium">{resource}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {actions.map((action) => {
              const id = `${idPrefix}-${resource}-${action}`;
              const checked = holds(value, resource, action);
              return (
                // The admin Checkbox is a Base UI control, not an <input>, so the label
                // wraps it rather than pointing at it with `htmlFor`. The id stays so two
                // grids on screen at once never share one.
                <Label
                  key={action}
                  className="min-h-11 gap-2 font-normal md:min-h-7"
                >
                  <Checkbox
                    id={id}
                    checked={checked}
                    // `readOnly` rather than `disabled` for a base role: a disabled box
                    // greys the tick out, and a base role's permissions are the thing a
                    // reader came to see. `disabled` is only the in-flight save.
                    readOnly={readOnly}
                    disabled={disabled}
                    onCheckedChange={() => onToggle?.(resource, action)}
                  />
                  <span className={checked ? "" : "text-muted-foreground"}>
                    {action}
                  </span>
                </Label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
