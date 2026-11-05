// The pure half of the members routes (`../routes/admin-members.ts`): how the admin group
// splits into active and removed members, and how a Better Auth refusal becomes the api's
// answer. It imports nothing, `hono` and `better-auth` included, so the saasaloy repo tests
// it with `node --test` (`./members.test.ts`).

/** An account as `adminAuth.api.listUsers` returns it, reduced to what the split reads. */
export interface GroupUser {
  id: string;
  name: string;
  email: string;
  role?: string | null | undefined;
  banned?: boolean | null | undefined;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** Who made a change to a member, and when: the newest audit row of one action. */
export interface MemberEvent {
  at: Date;
  by: string;
}

/** What the split reads besides the accounts, each keyed by user id. */
export interface MemberFacts {
  /** The `member.add` row of each member a person added through the members screen. */
  added: ReadonlyMap<string, MemberEvent>;
  /** The newest `member.remove` row of each removed member. */
  removed: ReadonlyMap<string, MemberEvent>;
  /** When each member last opened an admin session that is still on record. */
  signedIn: ReadonlyMap<string, Date>;
}

export interface ActiveMember {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  /** The person who added them, or `null` for an account made outside the screen. */
  addedBy: string | null;
  /** The newest admin session still on record. Better Auth deletes one at sign-out. */
  lastSignInAt: string | null;
}

export interface RemovedMember {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  /** The `member.remove` row's time; an account banned outside the screen falls back to `updatedAt`. */
  removedAt: string;
  /** The `member.remove` row's actor, or `null` when there is no row. */
  removedBy: string | null;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

/**
 * Split the admin group into the members who can sign in and the removed ones. Removing a
 * member bans the account, so `banned` decides the side. Active members sort by name and
 * removed ones newest removal first.
 */
export function splitMembers(
  users: readonly GroupUser[],
  facts: MemberFacts,
  fallbackRole: string
): { members: ActiveMember[]; removed: RemovedMember[] } {
  const members: ActiveMember[] = [];
  const removed: RemovedMember[] = [];
  for (const user of users) {
    const base = {
      createdAt: iso(user.createdAt),
      email: user.email,
      id: user.id,
      name: user.name,
      role: user.role ?? fallbackRole,
    };
    if (user.banned === true) {
      const event = facts.removed.get(user.id);
      removed.push({
        ...base,
        removedAt: iso(event?.at ?? user.updatedAt),
        removedBy: event?.by ?? null,
      });
    } else {
      const signedIn = facts.signedIn.get(user.id);
      members.push({
        ...base,
        addedBy: facts.added.get(user.id)?.by ?? null,
        lastSignInAt: signedIn === undefined ? null : iso(signedIn),
      });
    }
  }
  members.sort((left, right) => left.name.localeCompare(right.name));
  removed.sort((left, right) => right.removedAt.localeCompare(left.removedAt));
  return { members, removed };
}

/** The api statuses a members route passes on from a Better Auth refusal. */
export type RefusalStatus = 400 | 401 | 403 | 404 | 409 | 422;

/** A refusal from `adminAuth.api.*`, as the api answers it. */
export interface AuthRefusal {
  status: RefusalStatus;
  message: string;
}

const PASSED_ON: readonly RefusalStatus[] = [400, 401, 403, 404, 409, 422];

/**
 * The status and message of a Better Auth refusal, or `null` for any other error, which
 * the route rethrows so the api answers 500. Read structurally: `apps/api` imports no
 * `better-auth` (ADR 0020), and its `APIError` carries `statusCode` and `body.message`.
 */
export function authRefusal(error: unknown): AuthRefusal | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const { statusCode, body } = error as {
    statusCode?: unknown;
    body?: { message?: unknown } | null;
  };
  const status = PASSED_ON.find((candidate) => candidate === statusCode);
  if (status === undefined) {
    return null;
  }
  const message =
    typeof body?.message === "string" && body.message !== ""
      ? body.message
      : "refused";
  return { message, status };
}
