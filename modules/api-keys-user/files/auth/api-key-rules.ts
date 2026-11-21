import type { Denial } from "./authorize";

// The user owner's decision core: what a key may be issued with, and what a caller may
// do, expressed with zero runtime imports.
//
// `./caller.ts` owns the half that reads the request and throws, and
// `./plugins/api-key.ts` owns the hook that refuses a create. This file owns the rule
// both throw on. The split is the one `./authorize.ts` and `teams`' `permission-rules.ts`
// already draw, and for the same reason: anything importing `better-auth`, `hono` or
// `@repo/db` resolves only inside a scaffolded project, so a rule written there would
// ship with no test able to execute it. `./api-key-rules.test.ts` runs this file under
// `node --test`.
//
// The one `import type` above is erased before the file runs, and `./authorize.ts` itself
// imports nothing. Add a runtime import here and the test stops loading the file — that
// is the guard, not an accident.
//
// It is also the browser-safe half. The caller types live here rather than in
// `./caller.ts`, which pulls `hono` and the auth instance, so code that must not load
// either can still name them. `./caller.ts` re-exports them for a route.
//
// User mode has no `can()`. That function belongs to `teams` and reads role statements
// inside an organization; here there is no organization and no role. The refusal TEXT is
// the same, so a client that matches `permission required: <resource>:<action>` reads
// both modes alike, and the test pins it to `teams`' own functions.

/** A key that holds no statement holds this: no resource, no action. */
export type KeyStatements = Readonly<Record<string, readonly string[]>>;

/**
 * The resource-and-action pairs this project lets a key carry, the shape of
 * `API_KEY_SCOPES` in `./api-key-scopes.ts`.
 */
export type KeyVocabulary = Readonly<Record<string, readonly string[]>>;

/**
 * A demand: resource to the actions the caller must hold on it. Every listed action is
 * required — AND, never OR — exactly as `teams`' `PermissionDemand`. The `| undefined` in
 * the value lets a `Partial<...>` map in without a cast.
 */
export type ScopeDemand = Readonly<
  Record<string, readonly string[] | undefined>
>;

/** A signed-in person, through the session cookie. A scope never narrows one. */
export interface UserPrincipal {
  readonly kind: "user";
}

/**
 * A machine caller, through a key the user owns. `statements` is the key's `permissions`
 * column, fixed at issue time.
 */
export interface ApiKeyPrincipal {
  readonly kind: "apiKey";
  readonly keyId: string;
  readonly statements: KeyStatements;
}

/** Who a request acts as in user mode. Outside tenancy: no organization, no role. */
export type CallerPrincipal = UserPrincipal | ApiKeyPrincipal;

/**
 * What `requireCaller` returns. `userId` is the session's user, or the key's owner, so a
 * route checks data ownership on one field whichever credential arrived.
 */
export interface Caller {
  readonly userId: string;
  readonly principal: CallerPrincipal;
}

/** The answer `keyAllows` gives. Exactly one side is filled in, as `can()` does. */
export type ScopeDecision =
  | { readonly denial: Denial; readonly allowed: false }
  | { readonly denial: null; readonly allowed: true };

const ALLOWED: ScopeDecision = { denial: null, allowed: true };

/**
 * The 403 for one missing pair. The first one, never the whole demand: a refusal that
 * listed every pair would tell an attacker the shape of the route. Same text as
 * `permissionDenial` in `teams`.
 */
function pairDenial(resource: string, action: string): Denial {
  return { status: 403, message: `permission required: ${resource}:${action}` };
}

/**
 * The 403 for a demand that names nothing. Same text as `emptyDemandDenial` in `teams`,
 * and the same fail-closed reason: reading `{}` as "nothing required" would turn a typo or
 * an empty loop into an open route.
 */
const EMPTY_DEMAND: Denial = { status: 403, message: "permission required" };

/** The actions a map holds on a resource, never an inherited property. */
function held(map: KeyVocabulary, resource: string): readonly string[] {
  return Object.hasOwn(map, resource) ? (map[resource] ?? []) : [];
}

/**
 * May a key be issued with this scope?
 *
 * Every pair must appear in the vocabulary. The first one that does not is the refusal.
 * An empty scope is not a denial: a key that holds nothing can exceed nothing, and
 * `requireScope` refuses it every demand anyway.
 *
 * Shipped with an empty vocabulary, so every scoped create is refused until the project
 * declares its pairs. That is the safe default: a key that reaches the table holds only
 * pairs somebody chose to offer.
 */
export function scopeDenial(
  scope: KeyStatements,
  vocabulary: KeyVocabulary
): Denial | null {
  for (const [resource, actions] of Object.entries(scope)) {
    const offered = held(vocabulary, resource);
    for (const action of actions) {
      if (!offered.includes(action)) {
        return pairDenial(resource, action);
      }
    }
  }
  return null;
}

/**
 * May this caller do all of these things?
 *
 * - `user` passes every demand that names at least one pair. A scope narrows a key and
 *   never a person; whose data a route touches is the route's check, on `userId`.
 * - `apiKey` must hold every demanded action in `statements`. An unknown resource holds
 *   no actions and refuses like an empty one.
 * - An empty demand is refused for both kinds, before either arm passes.
 */
export function keyAllows(
  principal: CallerPrincipal,
  demand: ScopeDemand
): ScopeDecision {
  let demanded = 0;
  for (const [resource, actions] of Object.entries(demand)) {
    if (!actions) {
      continue;
    }
    for (const action of actions) {
      demanded += 1;
      if (
        principal.kind === "apiKey" &&
        !held(principal.statements, resource).includes(action)
      ) {
        return { denial: pairDenial(resource, action), allowed: false };
      }
    }
  }

  return demanded === 0 ? { denial: EMPTY_DEMAND, allowed: false } : ALLOWED;
}
