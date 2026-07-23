// The schema barrel — the convention feature modules extend by dropping a
// `src/schema/<name>.ts` table file. It merges every table module under `src/schema/`
// into one `schema` object at build time via Vite's `import.meta.glob`, which the api
// Worker's Vite bundles (the only runtime where the D1 binding exists). `getDb` passes
// this object to Drizzle so relational queries and `db.query.<table>` work.
//
// Empty-safe: with no table files the glob is `{}` and `schema` is `{}` — the base
// module ships zero tables, so `add database` alone leaves a clean, working barrel.
//
// This file lives BESIDE `src/schema/` (not inside it as index.ts) on purpose: the
// drizzle-kit migration glob (`./src/schema/*.ts`) must NOT pick it up, because
// `import.meta.glob` is Vite-only and drizzle-kit loads schema files with esbuild.
const modules = import.meta.glob<Record<string, unknown>>("./schema/*.ts", {
  eager: true,
});

export const schema: Record<string, unknown> = Object.assign(
  {},
  ...Object.values(modules),
);
