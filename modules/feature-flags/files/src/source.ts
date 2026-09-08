// The database, described as an interface this package never implements.
//
// `packages/feature-flags` imports no `@repo/db`, no Drizzle and no dialect. The source of
// truth is two tables, but *reaching* them is the api's job: `apps/api/src/lib/flags.ts`
// builds a source over the repository, and this package only ever sees the two functions
// below. That is what lets the resolver, the bucketing and the evaluation be tested with a
// plain object, and it keeps a database driver out of a package that has no business
// knowing which one is installed.

import type { FlagValue } from "./document";

export interface FlagSource {
  /** Every row of `feature_flag`, keyed by flag key. The values that apply to everyone. */
  loadGlobal(): Promise<Record<string, FlagValue>>;
  /**
   * Every row of `feature_flag_override` for one tenant, keyed by flag key. A tenant with no
   * overrides returns `{}` — that is not an error, and it is the common case.
   */
  loadTenant(tenantId: string): Promise<Record<string, FlagValue>>;
}
