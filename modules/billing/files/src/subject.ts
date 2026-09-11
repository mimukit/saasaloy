import { BillingError } from "./provider";
import type { BillableSubject } from "./provider";

// Who the bill is addressed to, and who may act on it. This is the file `teams` replaces.
//
// The default bills the signed-in user: `customerType` is `"user"`, `referenceId` is the
// user id, and the only subject a user may act on is their own. Installing `teams` ships
// an organization version of this same file under `onlyWith`, which reads the active
// organization off the session and checks membership instead. Nothing else in the
// capability — no route, no job, no entitlement check — learns which of the two it has,
// which is what lets a project move billing from users to organizations by replacing one
// file. See CONTEXT.md → "Billable subject".
//
// Both functions are deliberately free of framework types. The core has zero npm runtime
// dependencies, so the request is taken structurally: anything with a `get(key)` fits,
// which is what a Hono `Context` is.

/** The minimum a signed-in principal has to carry for this file to work. */
export interface SubjectUser {
  id: string;
  [key: string]: unknown;
}

/** The slice of the request context this file reads. A Hono `Context` satisfies it. */
export interface SubjectContext {
  get(key: string): unknown;
}

/** What a caller wants to do with a subject. `authorizeSubject` decides on both. */
export type SubjectAction = "read" | "manage";

/**
 * Read the billable subject off the request. The route has already run the session
 * middleware, so `c.get("user")` is set; an unset one is a routing mistake and throws
 * rather than billing nobody.
 */
export function resolveSubject(c: SubjectContext): BillableSubject {
  const user = c.get("user") as SubjectUser | null | undefined;

  if (!user?.id) {
    throw new BillingError(
      "invalid_request",
      "No signed-in user on the request. Every billing route runs behind the session middleware; resolveSubject is not callable without it."
    );
  }

  return { customerType: "user", referenceId: user.id };
}

/**
 * Whether this user may act on this subject. The default answer is "only their own row",
 * for both actions. `billing-stripe` wires this into the plugin's `authorizeReference`, so
 * the same rule guards the vendor's own checkout and portal endpoints as guards the
 * capability's routes.
 */
export function authorizeSubject(
  user: SubjectUser | null | undefined,
  subject: BillableSubject,
  _action: SubjectAction
): boolean {
  if (!user?.id) {
    return false;
  }
  return subject.customerType === "user" && subject.referenceId === user.id;
}

/** `authorizeSubject`, as the throwing form a route wants. */
export function assertSubject(
  user: SubjectUser | null | undefined,
  subject: BillableSubject,
  action: SubjectAction
): void {
  if (!authorizeSubject(user, subject, action)) {
    throw new BillingError(
      "invalid_request",
      `Not allowed to ${action} billing for ${subject.customerType} ${subject.referenceId}.`
    );
  }
}
