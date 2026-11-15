import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import type { Db } from "../../db/src/client";

// The D1 half of `cms:rerender`'s database handle, selected by `onlyWith: "database-d1"`.
// Its Postgres twin is `open-db.pg.ts`; exactly one lands as `scripts/open-db.ts`.
//
// It opens the local D1 state under `apps/api/.wrangler/state`, through the api's own
// `wrangler.jsonc`, the same way `pnpm db:seed` does. `remoteBindings: false`, because
// wrangler otherwise connects any binding marked remote, and this script must never reach
// Cloudflare.

export async function openDb(root: string) {
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: resolve(root, "apps/api/wrangler.jsonc"),
    persist: { path: resolve(root, "apps/api/.wrangler/state/v3") },
    remoteBindings: false,
  });
  return {
    // The repository uses only the query builder, never the relational API, so a client
    // built without the schema barrel serves it.
    db: drizzle(proxy.env.DB) as unknown as Db,
    dispose: () => proxy.dispose(),
    target: "the local D1 database",
  };
}
