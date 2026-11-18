import { HTTPException } from "hono/http-exception";
import { demandDenial } from "./user-caller-rules";
import type { ScopeDemand, UserCaller } from "./user-caller-rules";
import { getSession, requireSession } from "./server";
import type { AuthRequestContext } from "./server";

export type {
  CallerStatements,
  ScopeDemand,
  ScopedPrincipal,
  SessionPrincipal,
  UserCaller,
  UserCallerPrincipal,
} from "./user-caller-rules";

// The gate for a route that acts for one signed-in user and that an agent may call.
//
// `requireSession` reads the session cookie and nothing else, so a machine caller never
// passes it. A route an agent may call opens with `requireUser` instead, and names the
// scope it needs in the same line:
//
//   const { userId } = await requireUser(c, { notifications: ["read"] });
//
// With no credential module installed it is `requireSession` and nothing more: the
// resolver table below ships empty, the session decides, and the demand passes for a
// person. So swapping `requireSession` for `requireUser` opens a route to no new caller.
//
// A credential module adds a caller kind by appending a resolver to the table, the shape
// `multitenant`'s `tenantResolvers` already has. `api-keys-user` appends `apiKeyUser()`,
// so a user's bearer key acts as that user, limited to the key's scope. A later kind, such
// as an OAuth grant, appends its own resolver and changes no route. `api-keys-organization`
// appends nothing here: an organization's key acts for no user, so a user route refuses it
// with the same 401 a signed-out caller gets.
//
// Every refusal is an `HTTPException`, which api's `onError` renders as the shared
// `{ error: { code, message } }` envelope.

/** One kind of machine caller that acts for a user. */
export interface UserResolver {
  /** A short label for logs: `api-key`. */
  name: string;
  /**
   * Is this credential mine? The cheap synchronous half. `true` commits the request to
   * this resolver when no session rides along, so a credential that fails gets the
   * resolver's own refusal rather than a quiet pass.
   */
  claims(headers: { get(name: string): string | null }): boolean;
  /** The caller, or a thrown `HTTPException` (401 for a credential that fails). */
  resolve(c: AuthRequestContext): Promise<UserCaller>;
}

/** Identity, so `userResolvers` keeps the call shape the `plugin-array` codemod reads. */
function defineUserResolvers(config: { resolvers: UserResolver[] }) {
  return config;
}

// The patch point. A credential module appends its factory call to `resolvers` with a
// `plugin-array` patch (`exportName: "userResolvers"`, `arrayProp: "resolvers"`). Keep
// the line in this exact shape and never omit `resolvers`, even while it is empty.
export const userResolvers = defineUserResolvers({ resolvers: [] });

/** The session's caller. `activeOrganizationId` exists only with the organization plugin. */
async function sessionCaller(c: AuthRequestContext): Promise<UserCaller> {
  const session = await requireSession(c);
  const active = (session.session as { activeOrganizationId?: unknown })
    .activeOrganizationId;
  return {
    activeOrganizationId: typeof active === "string" ? active : null,
    principal: { kind: "user" },
    userId: session.user.id,
  };
}

/**
 * The user this request acts for, or a 401; and a 403 when its credential lacks a pair of
 * `demand`.
 *
 * A signed-in session decides first, exactly as `requireSession` does, whatever else the
 * request carries: every request `requireSession` let through before still gets through,
 * as the same person, and a person passes every demand. Only a request with no session
 * goes to the first resolver that claims it, and its credential must hold every pair of
 * `demand`. An empty demand is refused for both.
 *
 * That order is what keeps the gate additive. A browser that sends a stale `Bearer`
 * header beside its cookie still reads its own data, and a key only ever reaches a route
 * that refused it outright before.
 */
export async function requireUser(
  c: AuthRequestContext,
  demand: ScopeDemand
): Promise<UserCaller> {
  const resolver = userResolvers.resolvers.find((candidate) =>
    candidate.claims(c.req.raw.headers)
  );
  const caller =
    resolver && !(await getSession(c))
      ? await resolver.resolve(c)
      : await sessionCaller(c);
  const denial = demandDenial(caller.principal, demand);
  if (denial) {
    throw new HTTPException(denial.status, { message: denial.message });
  }
  return caller;
}
