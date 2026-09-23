import { statements } from "@repo/auth/access";

// The resource-by-action grid, in one component used two ways: read-only for a base role,
// editable for a custom one. Both render the same rows in the same order, so a reader
// comparing `viewer` against `member` is comparing two identical layouts.
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
    <div className="grid gap-2">
      {RESOURCES.map(([resource, actions]) => (
        <div
          key={resource}
          className="border-border grid gap-2 rounded-lg border px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center"
        >
          <p className="text-sm font-medium">{resource}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {actions.map((action) => {
              const id = `${idPrefix}-${resource}-${action}`;
              const checked = holds(value, resource, action);
              return (
                <label
                  key={action}
                  htmlFor={id}
                  className="flex min-h-11 items-center gap-2 text-sm md:min-h-7"
                >
                  <input
                    id={id}
                    type="checkbox"
                    className="border-border size-4 rounded"
                    checked={checked}
                    // `readOnly` rather than `disabled` for a base role: a disabled box
                    // greys the tick out, and a base role's permissions are the thing a
                    // reader came to see.
                    readOnly={readOnly}
                    disabled={disabled || readOnly}
                    onChange={() => onToggle?.(resource, action)}
                  />
                  <span className={checked ? "" : "text-muted-foreground"}>
                    {action}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
