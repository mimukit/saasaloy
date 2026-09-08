// The three rate limit budgets `ratelimit` registers, and the one place their numbers
// are written down for a reader.
//
// This file lands in `packages/kv`, not in `apps/api`, because the policy table belongs
// to the capability: `createKv(env).consume({ policy })` resolves a name here, so nothing
// in `packages/kv` has to reach into an app to learn what "strict" means. Each export is
// a factory rather than a plain object, because `saasaloy add ratelimit` registers it by
// appending a bare `strictPolicy()` call to the `policies` array in `src/index.ts` (the
// `plugin-array` patch kind).
//
// THE NUMBERS HERE ARE NOT THE NUMBERS THAT APPLY on `kv-cloudflare`. Cloudflare's Rate
// Limiting binding keeps its own `limit` and `period` in `apps/api/wrangler.jsonc` under
// `RL_STRICT`, `RL_DEFAULT` and `RL_LOOSE`, and reads nothing from this file. Editing a
// number below changes what a counting provider such as `kv-memory` does and changes
// nothing on Cloudflare. Change both, or the two drift apart in silence. `saasaloy
// doctor` checks the *names* line up; it deliberately does not check the numbers.

import { definePolicy } from "../define";
import type { Policy } from "../provider";

/** Sign-in, sign-up, password reset — anything an attacker would rather do 10,000 times. */
export function strictPolicy(): Policy {
  return definePolicy({ limit: 10, name: "strict", periodSeconds: 10 });
}

/** The everyday budget for an authenticated write route. */
export function defaultPolicy(): Policy {
  return definePolicy({ limit: 100, name: "default", periodSeconds: 60 });
}

/** A read route that is cheap to serve but still worth a ceiling. */
export function loosePolicy(): Policy {
  return definePolicy({ limit: 1000, name: "loose", periodSeconds: 60 });
}
