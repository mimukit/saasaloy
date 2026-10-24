import { HTTPException } from "hono/http-exception";
import { auth } from "./auth";
import { keyAllows, ownerMayUseKeys } from "./api-key-rules";
import type { Caller, KeyOwner, ScopeDemand } from "./api-key-rules";
import { SIGNED_OUT } from "./authorize";
import type { Denial } from "./authorize";
import { withAuthScope } from "./db-provider";
import {
  INVALID_API_KEY,
  bearerKey,
  hasBearer,
} from "./plugins/api-key-options";
import { getSession } from "./server";
import type { AuthRequestContext } from "./server";

export type {
  ApiKeyPrincipal,
  Caller,
  CallerPrincipal,
  ScopeDemand,
  UserPrincipal,
} from "./api-key-rules";

// The route gate for user-owned API keys: who is calling, and may they do this.
//
// `api-keys-user` has no tenant and no resolver table, so the bearer header is read here.
// A route opens with `requireCaller(c)` and gets one value whichever credential arrived:
// the user's id and a principal, `{ kind: "user" }` from a session cookie or
// `{ kind: "apiKey", keyId, statements }` from a key that user owns. It then states what
// it needs with `requireScope(caller, demand)`.
//
//   const caller = await requireCaller(c);
//   requireScope(caller, { cards: ["read"] });
//   return c.json(await listCards(caller.userId));
//
// Whose data the route touches is still the route's check, on `caller.userId`. A scope
// narrows what a key may do; it never says which rows are the caller's.
//
// The rule both functions throw on lives in `./api-key-rules.ts`, which imports nothing,
// so a test can run it. This file reads the request and throws, and nothing more, the
// split `./server.ts` and `./authorize.ts` already draw. Every refusal is an
// `HTTPException`, so `modules/api`'s `onError` renders it as the one
// `{ error: { code, message } }` envelope every other gate answers with.

/** The plugin's verify result, narrowed to the fields the gate reads. */
interface VerifiedKey {
  id: string;
  /**
   * The user the key belongs to.
   *
   * The plugin's own field name, kept. `apiKeyPlugin()` renames the stored COLUMN to
   * `user_id`, and the adapter maps it back to the model field on the way out. The rename
   * is a database concern; here the plugin's vocabulary is what arrives.
   */
  referenceId: string;
  permissions?: Record<string, string[]> | null;
}

function denialError(denial: Denial): HTTPException {
  return new HTTPException(denial.status, { message: denial.message });
}

/** 401, so the caller knows a different credential could work. */
function invalidKeyError(): HTTPException {
  return new HTTPException(401, { message: INVALID_API_KEY });
}

/**
 * The key caller, or a 401. Called only once the request has claimed the bearer path.
 *
 * `verifyApiKey` hashes the presented key with SHA-256 and looks the hash up, so the
 * plaintext is never compared against anything stored. It also writes `lastRequest` on
 * every call — one synchronous write per bearer request, accepted by decision.
 *
 * It RETURNS its failures rather than throwing them: `{ valid: false, error: { code } }`
 * for KEY_NOT_FOUND, KEY_DISABLED, KEY_EXPIRED and INVALID_API_KEY alike. All four
 * collapse to the same 401 here, and so does a key whose owner is banned or gone. The
 * `try` is for a transport or database failure underneath, which must not surface as a
 * 500 naming the auth internals.
 */
async function keyCaller(c: AuthRequestContext): Promise<Caller> {
  const key = bearerKey(c.req.raw.headers);
  if (key === null) {
    throw invalidKeyError();
  }

  const verified = await withAuthScope(c, async () => {
    try {
      const result = await auth.api.verifyApiKey({ body: { key } });
      if (!result.valid || !result.key) {
        return null;
      }
      const found = result.key as unknown as VerifiedKey;
      // A banned owner keeps no working key. `verifyApiKey` never reads the user row, so
      // a ban, which only revokes sessions, would leave every key live. Same 401 as any
      // other failed key, so a caller learns nothing about the account.
      const context = await auth.$context;
      const owner = (await context.internalAdapter.findUserById(
        found.referenceId
      )) as KeyOwner | null;
      return ownerMayUseKeys(owner) ? found : null;
    } catch {
      return null;
    }
  });

  if (!verified) {
    throw invalidKeyError();
  }

  return {
    userId: verified.referenceId,
    principal: {
      kind: "apiKey",
      keyId: verified.id,
      // The scope, exactly as it was written at issue time. The plugin parses the stored
      // JSON, so this is already a permission map. It does NOT follow a later edit of
      // `API_KEY_SCOPES`, by decision — revoke and reissue to change what a key may do.
      statements: verified.permissions ?? {},
    },
  };
}

/**
 * Who is calling, or a 401.
 *
 * A bearer header is read first, and claiming it commits the request to the key path. A
 * key that fails, or `Bearer` with nothing after it, answers 401 `invalid api key` and
 * never falls back to the session cookie riding along with it. Otherwise a revoked key
 * sent from a signed-in browser would keep working as its owner.
 *
 * With no bearer header the session decides, and no session answers the same 401
 * `requireSession` answers.
 */
export async function requireCaller(c: AuthRequestContext): Promise<Caller> {
  if (hasBearer(c.req.raw.headers)) {
    return keyCaller(c);
  }

  const session = await getSession(c);
  if (!session) {
    throw denialError(SIGNED_OUT);
  }
  return { userId: session.user.id, principal: { kind: "user" } };
}

/**
 * Refuse the caller unless it may do all of `demand`, with a 403 naming the first pair it
 * lacks.
 *
 * A session user passes every demand, and a key must hold every demanded action. An empty
 * demand is refused for both, so a demand built from an empty loop fails closed. The rule
 * is `keyAllows()` in `./api-key-rules.ts`; this only throws what it hands back.
 */
export function requireScope(caller: Caller, demand: ScopeDemand): void {
  const { denial } = keyAllows(caller.principal, demand);
  if (denial) {
    throw denialError(denial);
  }
}
