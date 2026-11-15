// Every admin write, by action. Each installed module ships its own action file in
// `apps/api/src/audit/<module>.ts`, exporting one function that returns its actions, and
// its descriptor carries a `plugin-array` patch that appends that call into `actions`
// below, with the import above it. `saasaloy remove <module>` takes the call and the file
// away again, so no module edits a file another module owns.
//
// An action is named `<area>.<object>.<verb>`, such as `payment.refund.create`. Its entry
// names the route that writes it, as `METHOD /full/path` the way Hono lists it in
// `app.routes`, the target type its rows name, and the area the Activity page groups it
// under. An entry may also carry `label`, the words the Activity page shows for a row
// ("Confirmed a payment"), and `areaLabel`, the words for its area chip ("Payments"). The
// api sends them with each row, so the module that owns an action owns its words, and
// `saasaloy remove` takes both away. A route that makes two kinds of change names two
// actions, so two entries may share a route. An action key is unique across every
// module; a second one throws when this file loads.
//
// `../routes/audit-coverage.test.ts` reads `app.routes` and fails on any admin write route
// no entry names, so a new route is not done until its action file names it. See the
// header of `./admin-write.ts` for the rest of the recipe.
//
// The helpers below import nothing, `hono` included, so the saasaloy repo tests them with
// `node --test` (`./audit-actions.test.ts`). Each takes the action map as an argument and
// defaults it to this project's, which is how that test runs them on a map of its own.

/** The methods that change data. */
export const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

export type WriteMethod = (typeof WRITE_METHODS)[number];

export interface AuditActionSpec {
  /** The route that writes it: `METHOD /full/path`, such as `POST /admin/payment/payments/:id/refunds`. */
  route: `${WriteMethod} /${string}`;
  /** The target type its rows name, such as `payment` or `member`. */
  target: string;
  /** The Activity page's group, such as `payments`, `flags` or `members`. */
  area: string;
  /**
   * What the Activity page calls a row of it, such as "Confirmed a payment". Leave it out
   * and the page shows the action key.
   */
  label?: string;
  /**
   * What the Activity page calls the area, such as "Payments". One action of the area
   * carrying it is enough. Leave it out everywhere and the page capitalizes the area.
   */
  areaLabel?: string;
}

/** One module's actions, keyed by action name. */
export type AuditActionMap = Readonly<Record<string, AuditActionSpec>>;

/** A route as `app.routes` lists it. */
export interface RouteEntry {
  method: string;
  path: string;
}

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

/** Every module's actions merged into one map. With no map registered it is empty. */
export type MergedAuditActions<T extends readonly AuditActionMap[]> = [
  T[number],
] extends [never]
  ? Record<never, AuditActionSpec>
  : UnionToIntersection<T[number]>;

/**
 * Merge every module's action map into one frozen map. Throws on an action two maps both
 * name, so two modules cannot each think they own the same audit rows.
 */
export function defineAuditActions<
  const T extends readonly AuditActionMap[],
>(registry: { actions: T }): Readonly<MergedAuditActions<T>> {
  const merged: Record<string, AuditActionSpec> = {};
  for (const map of registry.actions) {
    for (const [action, spec] of Object.entries(map)) {
      if (Object.hasOwn(merged, action)) {
        throw new Error(
          `Two audit action maps both name "${action}". An action belongs to one module.`
        );
      }
      merged[action] = spec;
    }
  }
  return Object.freeze(merged) as Readonly<MergedAuditActions<T>>;
}

// The registry, and the patch point every module's `plugin-array` patch writes into.
// Keep the line below in this shape, a `defineAuditActions` call whose `actions` is a real
// array literal: the codemod has nothing to append into otherwise. Never omit `actions`,
// even while it is empty.
export const AUDIT_ACTIONS = defineAuditActions({ actions: [] });

/** An action this project's modules register. */
export type AuditAction = keyof typeof AUDIT_ACTIONS & string;

/** The actions an area groups, in registry order. */
export function actionsOfArea(
  area: string,
  actions: AuditActionMap = AUDIT_ACTIONS
): string[] {
  return Object.keys(actions).filter(
    (action) => actions[action]?.area === area
  );
}

/** The words for an action, or its key when no module gives any (or names it any more). */
export function labelOfAction(
  action: string,
  actions: AuditActionMap = AUDIT_ACTIONS
): string {
  return Object.hasOwn(actions, action)
    ? (actions[action]?.label ?? action)
    : action;
}

/** The words for an area: the first `areaLabel` its actions carry, or the area capitalized. */
export function labelOfArea(
  area: string,
  actions: AuditActionMap = AUDIT_ACTIONS
): string {
  for (const spec of Object.values(actions)) {
    if (spec.area === area && spec.areaLabel !== undefined) {
      return spec.areaLabel;
    }
  }
  return area.charAt(0).toUpperCase() + area.slice(1);
}

/** Every area some action names, once each, in registry order, with its words. */
export function auditAreas(
  actions: AuditActionMap = AUDIT_ACTIONS
): { id: string; label: string }[] {
  const areas = [...new Set(Object.values(actions).map((spec) => spec.area))];
  return areas.map((id) => ({ id, label: labelOfArea(id, actions) }));
}

/** The area an action counts under, or `null` for an action no module names any more. */
export function areaOfAction(
  action: string,
  actions: AuditActionMap = AUDIT_ACTIONS
): string | null {
  // `Object.hasOwn`, not `in`: `in` also finds `toString` and the rest of the prototype.
  return Object.hasOwn(actions, action)
    ? (actions[action]?.area ?? null)
    : null;
}

/** The target type an action's rows name, or `null` for an action no module names. */
export function targetOfAction(
  action: string,
  actions: AuditActionMap = AUDIT_ACTIONS
): string | null {
  return Object.hasOwn(actions, action)
    ? (actions[action]?.target ?? null)
    : null;
}

const WRITES = new Set<string>(WRITE_METHODS);

/**
 * Each admin write route in `routes` as `METHOD /path`, once, sorted. `/admin/auth/*` is
 * left out: it is Better Auth's own handler, and the staff writes that pass through it
 * (organizations, api keys) are issue #142's to audit.
 */
export function adminWriteRoutes(routes: readonly RouteEntry[]): string[] {
  return [
    ...new Set(
      routes
        .filter(
          (route) =>
            WRITES.has(route.method) &&
            route.path.startsWith("/admin/") &&
            !route.path.startsWith("/admin/auth/")
        )
        .map((route) => `${route.method} ${route.path}`)
    ),
  ].toSorted();
}

/** The admin write routes in `routes` no action names. The coverage test wants none. */
export function unauditedRoutes(
  routes: readonly RouteEntry[],
  actions: AuditActionMap = AUDIT_ACTIONS
): string[] {
  const named = new Set<string>(
    Object.values(actions).map((spec) => spec.route)
  );
  return adminWriteRoutes(routes).filter((route) => !named.has(route));
}

/** The actions whose route `routes` does not serve. The coverage test wants none. */
export function staleActions(
  routes: readonly RouteEntry[],
  actions: AuditActionMap = AUDIT_ACTIONS
): string[] {
  const served = new Set(adminWriteRoutes(routes));
  return Object.entries(actions)
    .filter(([, spec]) => !served.has(spec.route))
    .map(([action]) => action)
    .toSorted();
}
