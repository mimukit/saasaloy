import { defineConfig } from "drizzle-kit";

// Drizzle Kit config — migration GENERATION only. `db:generate` reads the schema glob
// and emits SQL under ./migrations; those files are then applied to D1 by
// `wrangler d1 migrations apply` (never `drizzle-kit push`/`migrate` — migrations stay
// fully manual, see package.json). dialect is `sqlite` because D1 is SQLite at the edge.
//
// The `schema` glob is drizzle-kit's OWN native glob (resolved with esbuild under Node),
// the migration-time twin of the runtime barrel in src/schema.ts. Dropping a
// `src/schema/<name>.ts` table file feeds both with no edit here. It deliberately does
// NOT include the barrel (src/schema.ts sits outside src/schema/), because the barrel
// uses Vite's `import.meta.glob`, which esbuild can't execute.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/*.ts",
  out: "./migrations",
});
