import type { Denial } from "./authorize";

// The decision core of `requireUser`: may this caller do what a route demands.
//
// `./user-caller.ts` reads the request, runs the resolver that claims it, and throws. This
// file owns the rule it throws on, with zero runtime imports, so `pnpm test:modules` runs
// `./user-caller-rules.test.ts` against it with no scaffolded project behind it. The one
// `import type` above is erased before the file runs.
//
// The rule is the one `api-keys-user`'s `keyAllows()` and `teams`' `can()` already apply,
// with the same refusal text, so a client that matches `permission required:
// <resource>:<action>` reads every gate alike.

/** The scope a credential holds: resource to the actions it may take on it. */
export type CallerStatements = Readonly<Record<string, readonly string[]>>;

/**
 * What a route demands: resource to the actions the caller must hold. Every listed action
 * is required, AND and never OR. The `| undefined` lets a `Partial<...>` map in.
 */
export type ScopeDemand = Readonly<
  Record<string, readonly string[] | undefined>
>;

/** A signed-in person, through the session cookie. A scope never narrows one. */
export interface SessionPrincipal {
  readonly kind: "user";
}

/**
 * A machine caller acting for one user, through a credential that carries its own scope.
 * `kind` names the credential: `apiKey` for a key that `api-keys-user` verifies. A later
 * credential, such as an OAuth grant, is a third kind with the same two fields, and it
 * needs only a resolver of its own; this rule reads `statements` whatever the kind.
 */
export interface ScopedPrincipal {
  readonly kind: "apiKey";
  /** The credential's id, for an audit row. */
  readonly id: string;
  /** The scope fixed when the credential was issued. */
  readonly statements: CallerStatements;
}

export type UserCallerPrincipal = SessionPrincipal | ScopedPrincipal;

/**
 * What `requireUser` returns: the user a request acts for, whichever credential arrived.
 * A route checks data ownership on `userId` and nothing else.
 */
export interface UserCaller {
  readonly userId: string;
  readonly principal: UserCallerPrincipal;
  /**
   * The session's active organization, or `null`. Always `null` for a scoped principal:
   * a user's key acts for the user, never for an organization.
   */
  readonly activeOrganizationId: string | null;
}

/** The 403 for a demand that names nothing: an empty demand fails closed. */
const EMPTY_DEMAND: Denial = { status: 403, message: "permission required" };

function held(map: CallerStatements, resource: string): readonly string[] {
  return Object.hasOwn(map, resource) ? (map[resource] ?? []) : [];
}

/**
 * Why this caller may not do all of `demand`, or `null` when it may.
 *
 * - A session principal passes every demand that names at least one pair.
 * - A scoped principal must hold every demanded action. The refusal names the first pair
 *   it lacks, never the whole demand.
 * - An empty demand is refused for both, so a demand built from an empty loop fails
 *   closed rather than opening the route.
 */
export function demandDenial(
  principal: UserCallerPrincipal,
  demand: ScopeDemand
): Denial | null {
  let demanded = 0;
  for (const [resource, actions] of Object.entries(demand)) {
    for (const action of actions ?? []) {
      demanded += 1;
      if (
        principal.kind !== "user" &&
        !held(principal.statements, resource).includes(action)
      ) {
        return {
          status: 403,
          message: `permission required: ${resource}:${action}`,
        };
      }
    }
  }
  return demanded === 0 ? EMPTY_DEMAND : null;
}
