import { asTenantId } from "@repo/db/tenant";
import { HTTPException } from "hono/http-exception";
import { auth } from "../auth";
import { withAuthScope } from "../db-provider";
import { ORGANIZATION_HEADER, headerDenial } from "../tenant-rules";
import type {
  HeaderReader,
  ResolvedStatements,
  Tenant,
  TenantResolver,
} from "../tenant-rules";
import type { TenantRequestContext } from "../tenant";
import {
  INVALID_API_KEY,
  bearerKey,
  hasBearer,
} from "../plugins/api-key-options";

// Re-exported from here, where it lived before the shared options file, so an import that
// names this file keeps working.
export { INVALID_API_KEY } from "../plugins/api-key-options";

// The bearer credential, as a tenant resolver.
//
// `multitenant` ships an empty `tenantResolvers` table in `packages/auth/src/tenant.ts`;
// this module's `plugin-array` patch appends `apiKeyTenant()` to it. From then on a
// request carrying `Authorization: Bearer <key>` is claimed here and never touches the
// session path, so a rejected key cannot quietly fall back to whatever cookie rode along
// with it.
//
// The whole point of the arrangement is that the two paths end in the same value. A route
// written with `requireTenant` and `forTenant` does not know whether the caller was a
// browser or a deploy script, and `requirePermission` runs the same `can()` over the key's fixed
// scope that it runs over a member's resolved statements. There is no second permission
// system on the machine path, and adding one is the mistake this file exists to prevent.

/** The plugin's verify result, narrowed to the fields the resolver reads. */
interface VerifiedKey {
  id: string;
  /**
   * The organization the key belongs to.
   *
   * The plugin's own field name, kept. `apiKeyPlugin()` renames the stored COLUMN to
   * `organizationId` so the table meets the tenant column convention, and the adapter maps
   * it back to the model field on the way out. The rename is a database concern; here the
   * plugin's vocabulary is what arrives.
   */
  referenceId: string;
  permissions?: Record<string, string[]> | null;
}

/** 401, so the caller knows a different credential could work. */
function invalidKeyError(): HTTPException {
  return new HTTPException(401, { message: INVALID_API_KEY });
}

/**
 * The bearer resolver. Registered into `tenantResolvers.resolvers` by this module's
 * `plugin-array` patch, and never called directly.
 *
 * `claims` is the cheap synchronous half: it answers "is this my credential", not "is it
 * valid". Returning `true` commits the request to this resolver, so `resolve` either
 * returns a `Tenant` or throws.
 */
export function apiKeyTenant(): TenantResolver<TenantRequestContext> {
  return {
    name: "api-key",

    claims(headers: HeaderReader): boolean {
      return hasBearer(headers);
    },

    async resolve(c: TenantRequestContext): Promise<Tenant> {
      // `x-organization-id` beside a bearer credential is refused whatever it says. A key
      // is bound to one organization, so a header naming a second one is a mistake or an
      // attack, and 403 says which. Checked before the key is verified: an unauthenticated
      // caller learns nothing from it that the header itself did not already tell them.
      if (c.req.raw.headers.get(ORGANIZATION_HEADER)) {
        const denial = headerDenial();
        throw new HTTPException(denial.status, { message: denial.message });
      }

      const key = bearerKey(c.req.raw.headers);
      if (key === null) {
        throw invalidKeyError();
      }

      // `verifyApiKey` hashes the presented key with SHA-256 and looks the hash up, so the
      // plaintext is never compared against anything stored. It also writes `lastRequest`
      // on every call — one synchronous write per bearer request, accepted by decision.
      //
      // It RETURNS its failures rather than throwing them: `{ valid: false, error: { code
      // } }` for KEY_NOT_FOUND, KEY_DISABLED, KEY_EXPIRED and INVALID_API_KEY alike. All
      // four collapse to the same 401 here. The `try` is for a transport or database
      // failure underneath, which must not surface as a 500 naming the auth internals.
      const result = await withAuthScope(c, async () => {
        try {
          return await auth.api.verifyApiKey({ body: { key } });
        } catch {
          return null;
        }
      });

      if (!result?.valid || !result.key) {
        throw invalidKeyError();
      }
      const verified = result.key as unknown as VerifiedKey;

      // The scope, exactly as it was written at issue time. The plugin parses the stored
      // JSON, so this is already a permission map; `can()` reads it the same way it reads
      // a member's resolved statements. It does NOT follow a later role edit, by decision
      // — revoke and reissue to change what a key may do.
      const statements: ResolvedStatements = verified.permissions ?? {};

      return {
        // The one place a key's organization becomes a `TenantId`. `requireTenant` is the
        // only other caller of `asTenantId`, and between them they are why `forTenant`
        // cannot be handed a value that came out of a request body.
        organizationId: asTenantId(verified.referenceId),
        principal: { kind: "apiKey", keyId: verified.id, statements },
      };
    },
  };
}
